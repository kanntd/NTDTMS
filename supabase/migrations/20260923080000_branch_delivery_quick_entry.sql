-- Quick branch delivery entry. A bill may be delivered in several batches when
-- its items arrive on different manifests. The shipment closes only after every
-- item quantity has been delivered.

alter table public.shipments
  add column if not exists delivered_at timestamptz;
alter table public.delivery_attempts
  add column if not exists request_id uuid,
  add column if not exists round_reference text not null default '';
create unique index if not exists delivery_attempts_request_id_unique
  on public.delivery_attempts(request_id) where request_id is not null;

create table if not exists public.delivery_attempt_item_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  attempt_id uuid not null references public.delivery_attempts on delete cascade,
  shipment_id uuid not null references public.shipments,
  shipment_item_id uuid not null references public.shipment_items,
  quantity numeric(18,4) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users,
  unique (attempt_id, shipment_item_id)
);
create index if not exists delivery_attempt_item_lines_shipment
  on public.delivery_attempt_item_lines(shipment_id, shipment_item_id);

alter table public.delivery_attempt_item_lines enable row level security;
revoke all on public.delivery_attempt_item_lines from anon, authenticated;
grant select on public.delivery_attempt_item_lines to authenticated;

create or replace function private.can_read_document(doc uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.shipments shipment
    cross join private.member() member
    left join public.branches branch on branch.id = member.branch_id
    where shipment.id = doc
      and shipment.company_id = member.company_id
      and (
        member.role in ('owner', 'admin', 'accountant')
        or shipment.branch_id = member.branch_id
        or branch.code = shipment.destination_branch_code
      )
  )
$$;

drop policy if exists "members read delivery attempts" on public.delivery_attempts;
create policy "members read relevant delivery attempts"
  on public.delivery_attempts for select to authenticated
  using (private.can_read_document(shipment_id));

create policy "members read relevant delivery item lines"
  on public.delivery_attempt_item_lines for select to authenticated
  using (private.can_read_document(shipment_id));

create or replace function private.record_branch_delivery(data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  member public.profiles := private.require_role(array['owner', 'admin', 'clerk', 'accountant']);
  shipment public.shipments;
  member_branch public.branches;
  attempt_id_value uuid;
  request_id_value uuid := nullif(data->>'request_id', '')::uuid;
  result_value text := upper(trim(coalesce(data->>'result', '')));
  collected_value numeric := coalesce(nullif(data->>'collected_amount', '')::numeric, 0);
  attempt_number integer;
  is_complete boolean;
begin
  if result_value not in ('DELIVERED', 'CUSTOMER_ABSENT', 'REFUSED', 'DAMAGED', 'RESCHEDULED', 'OTHER') then
    raise exception 'ผลการส่งสินค้าไม่ถูกต้อง';
  end if;
  if request_id_value is null then raise exception 'ไม่พบรหัสคำขอ'; end if;

  select id into attempt_id_value from public.delivery_attempts
  where request_id = request_id_value;
  if attempt_id_value is not null then return attempt_id_value; end if;

  select * into shipment from public.shipments
  where id = nullif(data->>'shipment_id', '')::uuid
    and company_id = member.company_id for update;
  if shipment.id is null then raise exception 'ไม่พบบิล'; end if;
  if shipment.shipment_status in ('DELIVERED', 'CANCELLED') then
    raise exception 'บิลนี้ปิดงานแล้ว';
  end if;

  select * into member_branch from public.branches where id = member.branch_id;
  if member.role not in ('owner', 'admin')
    and member_branch.code is distinct from shipment.destination_branch_code then
    raise exception 'บิลนี้ไม่ใช่ของสาขาคุณ';
  end if;
  if not exists (
    select 1 from public.load_manifest_item_lines line
    join public.load_manifests manifest on manifest.id = line.manifest_id
    where line.shipment_id = shipment.id and line.is_active
      and manifest.status = 'RECEIVED'
      and (member.role in ('owner', 'admin') or manifest.destination_branch_id = member.branch_id)
  ) then raise exception 'บิลนี้ยังไม่มีสินค้าที่สาขารับรถแล้ว'; end if;

  select coalesce(max(attempt_no), 0) + 1 into attempt_number
  from public.delivery_attempts where shipment_id = shipment.id;
  insert into public.delivery_attempts (
    company_id, shipment_id, attempt_no, result, collected_amount, note,
    request_id, round_reference, created_by
  ) values (
    member.company_id, shipment.id, attempt_number, result_value,
    collected_value, trim(coalesce(data->>'note', '')), request_id_value,
    trim(coalesce(data->>'round_reference', '')), member.id
  ) returning id into attempt_id_value;

  if result_value = 'DELIVERED' then
    insert into public.delivery_attempt_item_lines (
      company_id, attempt_id, shipment_id, shipment_item_id, quantity, created_by
    )
    select member.company_id, attempt_id_value, shipment.id, arrived.shipment_item_id,
      arrived.quantity - coalesce(delivered.quantity, 0), member.id
    from (
      select line.shipment_item_id, sum(line.quantity) quantity
      from public.load_manifest_item_lines line
      join public.load_manifests manifest on manifest.id = line.manifest_id
      where line.shipment_id = shipment.id and line.is_active
        and manifest.status = 'RECEIVED'
      group by line.shipment_item_id
    ) arrived
    left join (
      select shipment_item_id, sum(quantity) quantity
      from public.delivery_attempt_item_lines
      where shipment_id = shipment.id
      group by shipment_item_id
    ) delivered using (shipment_item_id)
    where arrived.quantity - coalesce(delivered.quantity, 0) > 0;

    if not found then raise exception 'บิลนี้ไม่มีสินค้าคงเหลือให้บันทึกส่ง'; end if;
    if collected_value > 0 then
      if shipment.payment_mode <> 'CASH_DESTINATION' then
        raise exception 'บิลนี้ไม่ใช่เงินสดปลายทาง';
      end if;
      perform private.receive_payment(
        shipment.id, collected_value, 'CASH', '', request_id_value
      );
    end if;

    select not exists (
      select 1 from public.shipment_items item
      where item.shipment_id = shipment.id
        and coalesce((
          select sum(line.quantity) from public.delivery_attempt_item_lines line
          where line.shipment_item_id = item.id
        ), 0) < item.quantity
    ) into is_complete;

    if is_complete then
      update public.shipments set shipment_status = 'DELIVERED', delivered_at = now(),
        version_no = version_no + 1 where id = shipment.id;
      insert into public.shipment_events (
        company_id, shipment_id, event_type, event_at, branch_id, detail, created_by
      ) values (
        member.company_id, shipment.id, 'DELIVERED', now(),
        coalesce(member.branch_id, shipment.branch_id),
        jsonb_build_object('attempt_id', attempt_id_value), member.id
      );
    end if;
  end if;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, record_id, detail)
  values (member.company_id, member.id, 'DELIVERY_ATTEMPT', 'shipment', shipment.id,
    jsonb_build_object('attempt_id', attempt_id_value, 'result', result_value,
      'collected_amount', collected_value));
  return attempt_id_value;
end $$;

create or replace function public.record_branch_delivery(data jsonb)
returns uuid language sql security invoker set search_path = '' as $$
  select private.record_branch_delivery(data)
$$;
revoke all on function public.record_branch_delivery(jsonb) from public, anon;
grant execute on function public.record_branch_delivery(jsonb) to authenticated;

