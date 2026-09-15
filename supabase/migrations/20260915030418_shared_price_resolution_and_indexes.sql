-- Resolve pending prices and affected bills atomically for every workstation.

create index if not exists price_requests_pending_dimensions
  on public.price_requests(
    company_id, receiver_id, sender_id, product_unit_id, branch_id,
    payment_mode, requested_at
  )
  where status in ('PENDING_PRICE', 'PENDING_APPROVAL', 'RETURNED');

create index if not exists shipment_items_pending_product_unit
  on public.shipment_items(product_unit_id, shipment_id)
  where price_pending;

create index if not exists shipments_opened_by_employee
  on public.shipments(opened_by_employee_id, received_at desc)
  where opened_by_employee_id is not null;

create or replace function private.resolve_shared_price_request(
  request_id uuid,
  approved_price numeric,
  resolution_type text,
  approval_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.profiles := private.require_role(array['owner','admin','accountant']);
  source_request public.price_requests;
  target_request record;
  agreement_id_value uuid;
  version_id_value uuid;
  next_version integer;
  new_subtotal numeric(18,2);
  new_total numeric(18,2);
  saved_rounding numeric(18,2);
  affected integer := 0;
begin
  if approved_price is null or approved_price < 0 then
    raise exception 'ราคาที่อนุมัติไม่ถูกต้อง';
  end if;
  if resolution_type not in ('STANDARD', 'BILL_ONLY') then
    raise exception 'รูปแบบการอนุมัติราคาไม่ถูกต้อง';
  end if;

  select * into source_request
  from public.price_requests
  where id = request_id and company_id = m.company_id
  for update;

  if source_request.id is null then raise exception 'ไม่พบคำขอราคา'; end if;
  if source_request.status in ('RESOLVED', 'CANCELLED') then
    raise exception 'คำขอราคานี้ปิดแล้ว';
  end if;

  if resolution_type = 'STANDARD' then
    insert into public.contract_price_agreements(
      company_id, receiver_id, sender_id, product_unit_id, branch_id,
      payment_mode, is_active, created_by, updated_by
    ) values (
      m.company_id, source_request.receiver_id, source_request.sender_id,
      source_request.product_unit_id, source_request.branch_id,
      source_request.payment_mode, true, m.id, m.id
    )
    on conflict (
      company_id, receiver_id, sender_id, product_unit_id, branch_id, payment_mode
    ) do update set is_active = true, updated_at = now(), updated_by = m.id
    returning id into agreement_id_value;

    perform 1 from public.contract_price_agreements
    where id = agreement_id_value for update;
    select coalesce(max(version_no), 0) + 1 into next_version
    from public.contract_price_versions
    where agreement_id = agreement_id_value;

    insert into public.contract_price_versions(
      company_id, agreement_id, version_no, unit_price, effective_from,
      source, reason, approved_by, approved_by_name
    ) values (
      m.company_id, agreement_id_value, next_version, approved_price,
      (source_request.requested_at at time zone 'Asia/Bangkok')::date,
      'PRICE_REQUEST',
      coalesce(nullif(trim(approval_note), ''),
        'อนุมัติจากคำขอราคา ' || source_request.bill_number),
      m.id, m.display_name
    ) returning id into version_id_value;

    update public.contract_price_agreements
    set current_version_id = version_id_value, updated_at = now(), updated_by = m.id
    where id = agreement_id_value;
  end if;

  for target_request in
    select r.id, r.shipment_id, r.shipment_item_id
    from public.price_requests r
    where r.company_id = m.company_id
      and r.status in ('PENDING_PRICE', 'PENDING_APPROVAL', 'RETURNED')
      and (
        (resolution_type = 'BILL_ONLY' and r.id = source_request.id)
        or (
          resolution_type = 'STANDARD'
          and r.receiver_id = source_request.receiver_id
          and r.sender_id = source_request.sender_id
          and r.product_unit_id = source_request.product_unit_id
          and r.branch_id = source_request.branch_id
          and r.payment_mode = source_request.payment_mode
          and r.requested_at >= source_request.requested_at
        )
      )
    order by r.requested_at, r.id
    for update
  loop
    update public.price_requests
    set approved_price = resolve_shared_price_request.approved_price,
      status = 'RESOLVED',
      resolution_type = resolve_shared_price_request.resolution_type,
      resolved_at = now(), resolved_by = m.id,
      approval_note = coalesce(resolve_shared_price_request.approval_note, '')
    where id = target_request.id;

    if target_request.shipment_item_id is not null then
      select i.total_amount - (s.total_amount - s.withholding_amount)
      into saved_rounding
      from public.shipments s
      join public.invoices i on i.shipment_id = s.id
      where s.id = target_request.shipment_id;

      update public.shipment_items
      set unit_price = resolve_shared_price_request.approved_price,
        price_pending = false
      where id = target_request.shipment_item_id;

      select coalesce(sum(line_total), 0) into new_subtotal
      from public.shipment_items
      where shipment_id = target_request.shipment_id;

      select new_subtotal + extra_charge - discount into new_total
      from public.shipments where id = target_request.shipment_id;

      update public.shipments s
      set subtotal = new_subtotal,
        total_amount = new_total,
        price_pending = exists (
          select 1 from public.shipment_items si
          where si.shipment_id = s.id and si.price_pending
        ),
        version_no = version_no + 1
      where s.id = target_request.shipment_id;

      update public.invoices i
      set total_amount = greatest(
        0,
        new_total - s.withholding_amount + coalesce(saved_rounding, 0)
      )
      from public.shipments s
      where i.shipment_id = target_request.shipment_id and s.id = i.shipment_id;
    end if;
    affected := affected + 1;
  end loop;

  insert into public.audit_logs(
    company_id, actor_id, action, entity_type, record_id, detail
  ) values (
    m.company_id, m.id, 'RESOLVE_PRICE', 'price_request', source_request.id,
    jsonb_build_object(
      'approved_price', approved_price,
      'resolution_type', resolution_type,
      'affected_requests', affected
    )
  );

  return jsonb_build_object(
    'request_id', source_request.id,
    'affected_requests', affected,
    'price_version_id', version_id_value
  );
end
$$;

revoke all on function private.resolve_shared_price_request(uuid, numeric, text, text)
  from public, anon, authenticated;
grant execute on function private.resolve_shared_price_request(uuid, numeric, text, text)
  to authenticated;

create or replace function public.resolve_shared_price_request(
  request_id uuid,
  approved_price numeric,
  resolution_type text,
  approval_note text default ''
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.resolve_shared_price_request(
    request_id, approved_price, resolution_type, approval_note
  )
$$;

revoke all on function public.resolve_shared_price_request(uuid, numeric, text, text)
  from public, anon;
grant execute on function public.resolve_shared_price_request(uuid, numeric, text, text)
  to authenticated;
