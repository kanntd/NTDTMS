-- Count a bill once per vehicle. Remaining quantities may be split across trips,
-- but the same bill cannot be added to the same trip twice.
create or replace function private.save_load_trip_items(data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.profiles := private.require_role(array['owner', 'admin', 'clerk']);
  trip public.load_manifests;
  entry jsonb;
  item_row record;
  existing_line public.load_manifest_item_lines;
  requested numeric;
  next_quantity numeric(18,4);
  allocated_elsewhere numeric(18,4);
  mode_value text := upper(coalesce(data->>'mode', 'ADD'));
  duplicate_shipment_no text;
begin
  select * into trip from public.load_manifests
  where id = nullif(data->>'id', '')::uuid and company_id = m.company_id for update;
  if trip.id is null then raise exception 'ไม่พบเที่ยวรถ'; end if;
  if trip.status <> 'DRAFT' then raise exception 'เที่ยวรถปิดแล้ว กรุณาเปิดรถกลับก่อนแก้สินค้า'; end if;
  if mode_value not in ('ADD', 'SET') then raise exception 'รูปแบบบันทึกสินค้าไม่ถูกต้อง'; end if;
  if jsonb_typeof(data->'allocations') <> 'array'
     or jsonb_array_length(data->'allocations') = 0 then
    raise exception 'กรุณาเลือกรายการสินค้า';
  end if;
  if exists (
    select 1 from jsonb_array_elements(data->'allocations') as x(value)
    group by x.value->>'shipment_item_id' having count(*) > 1
  ) then raise exception 'มีรายการสินค้าซ้ำในคำขอ'; end if;

  if mode_value = 'ADD' then
    select shipment.shipment_no into duplicate_shipment_no
    from jsonb_array_elements(data->'allocations') as x(value)
    join public.load_manifest_items manifest_item
      on manifest_item.manifest_id = trip.id
      and manifest_item.shipment_id = nullif(x.value->>'shipment_id', '')::uuid
      and manifest_item.is_active
    join public.shipments shipment on shipment.id = manifest_item.shipment_id
    limit 1;
    if duplicate_shipment_no is not null then
      raise exception 'บิล % อยู่ในเที่ยวรถนี้แล้ว กรุณาแก้จำนวนจากเที่ยวรถเดิม', duplicate_shipment_no;
    end if;
  end if;

  for entry in
    select value from jsonb_array_elements(data->'allocations')
    order by value->>'shipment_item_id'
  loop
    requested := nullif(entry->>'quantity', '')::numeric;
    if requested is null or requested < 0 or requested <> round(requested, 4) then
      raise exception 'จำนวนขึ้นรถต้องไม่ติดลบและมีทศนิยมไม่เกิน 4 ตำแหน่ง';
    end if;
    select si.id, si.shipment_id, si.quantity, si.unit,
      s.shipment_no, s.shipment_status, s.destination_branch_code
    into item_row
    from public.shipment_items si
    join public.shipments s on s.id = si.shipment_id
    where si.id = nullif(entry->>'shipment_item_id', '')::uuid
      and si.shipment_id = nullif(entry->>'shipment_id', '')::uuid
      and s.company_id = m.company_id
    for update of s, si;
    if item_row.id is null then raise exception 'ไม่พบรายการสินค้าในบิล'; end if;
    if item_row.shipment_status not in ('RECEIVED', 'IN_TRANSIT') then
      raise exception 'บิลนี้ไม่อยู่ในสถานะที่จัดขึ้นรถได้';
    end if;
    if not exists (
      select 1 from public.branches b where b.id = trip.destination_branch_id
        and upper(b.code) = upper(coalesce(item_row.destination_branch_code, ''))
    ) then raise exception 'บิลนี้ไปคนละสาขากับเที่ยวรถ'; end if;

    select * into existing_line from public.load_manifest_item_lines
    where manifest_id = trip.id and shipment_item_id = item_row.id for update;
    select coalesce(sum(line.quantity), 0) into allocated_elsewhere
    from public.load_manifest_item_lines line
    join public.load_manifests manifest on manifest.id = line.manifest_id
    where line.shipment_item_id = item_row.id and line.is_active
      and manifest.status <> 'CANCELLED' and manifest.id <> trip.id;
    next_quantity := case when mode_value = 'ADD'
      then coalesce(case when existing_line.is_active then existing_line.quantity end, 0) + requested
      else requested end;
    if next_quantity > item_row.quantity - allocated_elsewhere then
      raise exception 'จำนวนขึ้นรถมากกว่าจำนวนคงเหลือ';
    end if;

    if next_quantity = 0 then
      if existing_line.id is not null then
        update public.load_manifest_item_lines
        set is_active = false, unloaded_at = now()
        where id = existing_line.id;
      end if;
    elsif existing_line.id is null then
      insert into public.load_manifest_item_lines (
        company_id, manifest_id, shipment_id, shipment_item_id,
        quantity, unit_snapshot, created_by
      ) values (
        m.company_id, trip.id, item_row.shipment_id, item_row.id,
        next_quantity, item_row.unit, m.id
      );
    else
      update public.load_manifest_item_lines
      set quantity = next_quantity, is_active = true, unloaded_at = null
      where id = existing_line.id;
    end if;

    if next_quantity > 0 then
      insert into public.load_manifest_items (
        company_id, manifest_id, shipment_id, line_no, created_by
      ) values (
        m.company_id, trip.id, item_row.shipment_id,
        (select coalesce(max(line_no), 0) + 1 from public.load_manifest_items
          where manifest_id = trip.id), m.id
      ) on conflict (manifest_id, shipment_id)
      do update set is_active = true, unloaded_at = null;
    end if;
  end loop;

  update public.load_manifest_items manifest_item
  set is_active = exists (
      select 1 from public.load_manifest_item_lines line
      where line.manifest_id = trip.id
        and line.shipment_id = manifest_item.shipment_id and line.is_active
    ),
    unloaded_at = case when exists (
      select 1 from public.load_manifest_item_lines line
      where line.manifest_id = trip.id
        and line.shipment_id = manifest_item.shipment_id and line.is_active
    ) then null else now() end
  where manifest_item.manifest_id = trip.id;

  update public.load_manifests set updated_at = now(), updated_by = m.id where id = trip.id;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, record_id, detail)
  values (m.company_id, m.id, 'UPDATE', 'load_manifest', trip.id,
    jsonb_build_object('mode', mode_value, 'item_count', jsonb_array_length(data->'allocations')));
end $$;
