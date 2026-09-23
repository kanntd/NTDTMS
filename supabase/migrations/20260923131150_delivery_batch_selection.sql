-- Record only the item quantities selected on the branch delivery screen.
-- The original function remains available for older clients without `items`.
create or replace function private.record_branch_delivery_items(data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  member public.profiles := private.require_role(array['owner', 'admin', 'clerk', 'accountant']);
  shipment public.shipments;
  member_branch public.branches;
  attempt_id_value uuid;
  request_id_value uuid := nullif(data->>'request_id', '')::uuid;
  attempt_number integer;
  requested jsonb;
  item_id_value uuid;
  quantity_value numeric;
  arrived_value numeric;
  delivered_value numeric;
  inserted_count integer := 0;
  is_complete boolean;
begin
  if upper(trim(coalesce(data->>'result', ''))) <> 'DELIVERED' then
    raise exception 'รายการจำนวนสินค้าใช้ได้กับผลส่งสำเร็จเท่านั้น';
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

  select coalesce(max(attempt_no), 0) + 1 into attempt_number
  from public.delivery_attempts where shipment_id = shipment.id;
  insert into public.delivery_attempts (
    company_id, shipment_id, attempt_no, result, collected_amount, note,
    request_id, round_reference, created_by
  ) values (
    member.company_id, shipment.id, attempt_number, 'DELIVERED', 0,
    trim(coalesce(data->>'note', '')), request_id_value,
    trim(coalesce(data->>'round_reference', '')), member.id
  ) returning id into attempt_id_value;

  for requested in select value from jsonb_array_elements(coalesce(data->'items', '[]'::jsonb))
  loop
    item_id_value := nullif(requested->>'shipment_item_id', '')::uuid;
    quantity_value := nullif(requested->>'quantity', '')::numeric;
    if item_id_value is null or quantity_value is null or quantity_value <= 0 then
      raise exception 'จำนวนสินค้าที่ส่งไม่ถูกต้อง';
    end if;
    if not exists (
      select 1 from public.shipment_items
      where id = item_id_value and shipment_id = shipment.id
    ) then raise exception 'รายการสินค้าไม่อยู่ในบิลนี้'; end if;

    select coalesce(sum(line.quantity), 0) into arrived_value
    from public.load_manifest_item_lines line
    join public.load_manifests manifest on manifest.id = line.manifest_id
    where line.shipment_id = shipment.id
      and line.shipment_item_id = item_id_value
      and line.is_active and manifest.status = 'RECEIVED'
      and (member.role in ('owner', 'admin') or manifest.destination_branch_id = member.branch_id);
    select coalesce(sum(quantity), 0) into delivered_value
    from public.delivery_attempt_item_lines
    where shipment_id = shipment.id and shipment_item_id = item_id_value;
    if quantity_value > arrived_value - delivered_value then
      raise exception 'จำนวนส่งมากกว่าจำนวนคงเหลือ';
    end if;

    insert into public.delivery_attempt_item_lines (
      company_id, attempt_id, shipment_id, shipment_item_id, quantity, created_by
    ) values (
      member.company_id, attempt_id_value, shipment.id, item_id_value,
      quantity_value, member.id
    );
    inserted_count := inserted_count + 1;
  end loop;
  if inserted_count = 0 then raise exception 'กรุณาระบุสินค้าที่ส่ง'; end if;

  select not exists (
    select 1 from public.shipment_items item
    where item.shipment_id = shipment.id
      and coalesce((select sum(line.quantity)
        from public.delivery_attempt_item_lines line
        where line.shipment_item_id = item.id), 0) < item.quantity
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
  insert into public.audit_logs(company_id, actor_id, action, entity_type, record_id, detail)
  values (member.company_id, member.id, 'DELIVERY_ATTEMPT', 'shipment', shipment.id,
    jsonb_build_object('attempt_id', attempt_id_value, 'result', 'DELIVERED'));
  return attempt_id_value;
end $$;

create or replace function public.record_branch_delivery(data jsonb)
returns uuid language sql security invoker set search_path = '' as $$
  select case
    when jsonb_array_length(coalesce(data->'items', '[]'::jsonb)) > 0
      then private.record_branch_delivery_items(data)
    else private.record_branch_delivery(data)
  end
$$;
revoke all on function public.record_branch_delivery(jsonb) from public, anon;
grant execute on function public.record_branch_delivery(jsonb) to authenticated;
