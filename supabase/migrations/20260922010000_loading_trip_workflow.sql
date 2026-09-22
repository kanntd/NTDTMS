-- Trips reserve item quantities while they are drafts. Departure happens only after closing.
create or replace function private.create_load_trip(data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  m public.profiles := private.require_role(array['owner', 'admin', 'clerk']);
  destination_id uuid;
  vehicle_value uuid := nullif(data->>'vehicle_id', '')::uuid;
  driver_value uuid;
  trip_id uuid := gen_random_uuid();
  trip_no text := upper(trim(coalesce(data->>'manifest_no', '')));
begin
  if trip_no = '' then raise exception 'กรุณาระบุเลขเที่ยวรถ'; end if;
  select id into destination_id from public.branches
  where company_id = m.company_id
    and upper(code) = upper(trim(coalesce(data->>'destination_branch_code', '')))
    and is_active;
  if destination_id is null then raise exception 'ไม่พบสาขาปลายทาง'; end if;
  if not exists (select 1 from public.vehicle_assets
    where id = vehicle_value and company_id = m.company_id and is_active) then
    raise exception 'ไม่พบทะเบียนรถหรือรถหยุดใช้งานแล้ว';
  end if;
  select assignment.employee_id into driver_value
  from public.vehicle_driver_assignments assignment
  join public.employees employee on employee.id = assignment.employee_id
  where assignment.vehicle_id = vehicle_value and assignment.company_id = m.company_id
    and assignment.ends_on is null and employee.is_active;
  insert into public.load_manifests (
    id, company_id, origin_branch_id, destination_branch_id,
    vehicle_id, driver_employee_id, manifest_no, status, created_by, updated_by
  ) values (
    trip_id, m.company_id, m.branch_id, destination_id,
    vehicle_value, driver_value, trip_no, 'DRAFT', m.id, m.id
  );
  insert into public.audit_logs(company_id, actor_id, action, entity_type, record_id, detail)
  values (m.company_id, m.id, 'CREATE', 'load_manifest', trip_id,
    jsonb_build_object('manifest_no', trip_no, 'status', 'DRAFT', 'vehicle_id', vehicle_value));
  return trip_id;
end $$;

create or replace function public.create_load_trip(data jsonb)
returns uuid language sql security invoker set search_path = ''
as $$ select private.create_load_trip(data) $$;

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
  shipment_value uuid;
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

  for entry in
    select value from jsonb_array_elements(data->'allocations')
    order by value->>'shipment_item_id'
  loop
    requested := nullif(entry->>'quantity', '')::numeric;
    if requested is null or requested < 0 or requested <> round(requested, 4) then
      raise exception 'จำนวนขึ้นรถต้องไม่ติดลบและมีทศนิยมไม่เกิน 4 ตำแหน่ง';
    end if;
    select si.id, si.shipment_id, si.quantity, si.unit,
      s.shipment_status, s.destination_branch_code
    into item_row
    from public.shipment_items si
    join public.shipments s on s.id = si.shipment_id
    where si.id = nullif(entry->>'shipment_item_id', '')::uuid
      and si.shipment_id = nullif(entry->>'shipment_id', '')::uuid
      and s.company_id = m.company_id
    for update of si;
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

create or replace function public.save_load_trip_items(data jsonb)
returns void language sql security invoker set search_path = ''
as $$ select private.save_load_trip_items(data) $$;

create or replace function private.set_load_trip_status(data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.profiles := private.require_role(array['owner', 'admin', 'clerk']);
  trip public.load_manifests;
  action_value text := upper(trim(coalesce(data->>'action', '')));
  vehicle_value uuid := nullif(data->>'vehicle_id', '')::uuid;
  driver_value uuid := nullif(data->>'driver_employee_id', '')::uuid;
  shipment_value uuid;
  reason_value text := trim(coalesce(data->>'reason', ''));
begin
  select * into trip from public.load_manifests
  where id = nullif(data->>'id', '')::uuid and company_id = m.company_id for update;
  if trip.id is null then raise exception 'ไม่พบเที่ยวรถ'; end if;

  if action_value = 'CLOSE' then
    if trip.status <> 'DRAFT' then raise exception 'ปิดได้เฉพาะเที่ยวที่กำลังจัดของ'; end if;
    if not exists (select 1 from public.load_manifest_item_lines
      where manifest_id = trip.id and is_active) then
      raise exception 'กรุณาบันทึกสินค้าอย่างน้อย 1 รายการก่อนปิดรถ';
    end if;
    if not exists (select 1 from public.vehicle_assets
      where id = vehicle_value and company_id = m.company_id and is_active) then
      raise exception 'ไม่พบทะเบียนรถหรือรถหยุดใช้งานแล้ว';
    end if;
    if not exists (select 1 from public.employees
      where id = driver_value and company_id = m.company_id and is_active) then
      raise exception 'ไม่พบพนักงานขับรถหรือพนักงานหยุดใช้งานแล้ว';
    end if;
    if not exists (select 1 from public.vehicle_driver_assignments
      where vehicle_id = vehicle_value and employee_id = driver_value
        and company_id = m.company_id and ends_on is null) then
      raise exception 'ทะเบียนนี้ยังไม่ได้ผูกกับพนักงานขับรถที่เลือก';
    end if;
    update public.load_manifests set status = 'LOADED', vehicle_id = vehicle_value,
      driver_employee_id = driver_value, note = coalesce(data->>'note', ''),
      loaded_at = now(), updated_at = now(), updated_by = m.id where id = trip.id;
  elsif action_value = 'DEPART' then
    if trip.status <> 'LOADED' then raise exception 'กรุณาปิดรถก่อนยืนยันรถออก'; end if;
    update public.load_manifests set status = 'DEPARTED', departed_at = now(),
      updated_at = now(), updated_by = m.id where id = trip.id;
    for shipment_value in select distinct shipment_id
      from public.load_manifest_item_lines where manifest_id = trip.id and is_active
    loop
      if not exists (select 1 from public.shipments
        where id = shipment_value and company_id = m.company_id
          and shipment_status in ('RECEIVED', 'IN_TRANSIT')) then
        raise exception 'มีบิลที่ไม่สามารถยืนยันรถออกได้';
      end if;
      update public.shipments set shipment_status = 'IN_TRANSIT',
        version_no = version_no + 1
      where id = shipment_value and company_id = m.company_id
        and shipment_status in ('RECEIVED', 'IN_TRANSIT');
      insert into public.shipment_events (
        company_id, shipment_id, event_type, event_at, branch_id,
        manifest_id, detail, created_by
      ) values (
        m.company_id, shipment_value, 'DEPARTED', now(), m.branch_id,
        trip.id, jsonb_build_object('manifest_no', trip.manifest_no), m.id
      );
    end loop;
  elsif action_value = 'REOPEN' then
    if m.role not in ('owner', 'admin') then raise exception 'ไม่มีสิทธิ์เปิดรถกลับ'; end if;
    if trip.status <> 'LOADED' then raise exception 'เปิดรถกลับได้เฉพาะรถที่ยังไม่ออก'; end if;
    if length(reason_value) < 3 then raise exception 'กรุณาระบุเหตุผลเปิดรถกลับ'; end if;
    update public.load_manifests set status = 'DRAFT', loaded_at = null,
      updated_at = now(), updated_by = m.id where id = trip.id;
  elsif action_value = 'CANCEL' then
    if m.role not in ('owner', 'admin') then raise exception 'ไม่มีสิทธิ์ยกเลิกเที่ยวรถ'; end if;
    if trip.status not in ('DRAFT', 'LOADED') then
      raise exception 'ยกเลิกได้เฉพาะเที่ยวที่รถยังไม่ออก';
    end if;
    update public.load_manifests set status = 'CANCELLED', updated_at = now(),
      updated_by = m.id where id = trip.id;
    update public.load_manifest_item_lines set is_active = false,
      unloaded_at = now() where manifest_id = trip.id;
    update public.load_manifest_items set is_active = false,
      unloaded_at = now() where manifest_id = trip.id;
  else
    raise exception 'คำสั่งสถานะเที่ยวรถไม่ถูกต้อง';
  end if;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, record_id, detail)
  values (m.company_id, m.id, action_value, 'load_manifest', trip.id,
    jsonb_build_object('manifest_no', trip.manifest_no, 'reason', reason_value));
end $$;

create or replace function public.set_load_trip_status(data jsonb)
returns void language sql security invoker set search_path = ''
as $$ select private.set_load_trip_status(data) $$;

revoke all on function private.create_load_trip(jsonb) from public, anon, authenticated;
revoke all on function private.save_load_trip_items(jsonb) from public, anon, authenticated;
revoke all on function private.set_load_trip_status(jsonb) from public, anon, authenticated;
grant execute on function private.create_load_trip(jsonb) to authenticated;
grant execute on function private.save_load_trip_items(jsonb) to authenticated;
grant execute on function private.set_load_trip_status(jsonb) to authenticated;
revoke all on function public.create_load_trip(jsonb) from public, anon;
revoke all on function public.save_load_trip_items(jsonb) from public, anon;
revoke all on function public.set_load_trip_status(jsonb) from public, anon;
grant execute on function public.create_load_trip(jsonb) to authenticated;
grant execute on function public.save_load_trip_items(jsonb) to authenticated;
grant execute on function public.set_load_trip_status(jsonb) to authenticated;

-- Retire the one-step departure endpoints so clients cannot bypass the workflow.
revoke execute on function public.create_load_manifest(jsonb) from authenticated;
revoke execute on function private.create_load_manifest(jsonb) from authenticated;
revoke execute on function public.update_load_manifest(jsonb) from authenticated;
revoke execute on function private.update_load_manifest(jsonb) from authenticated;
