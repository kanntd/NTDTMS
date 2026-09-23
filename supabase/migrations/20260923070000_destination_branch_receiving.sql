-- Destination branch receiving: records the actual branch receipt time used by
-- branch-level delivery KPIs. Company KPIs continue to use shipments.received_at.

create index if not exists load_manifests_destination_status_received
  on public.load_manifests(destination_branch_id, status, received_at desc);

-- Headquarters roles can see the company. Branch users can only see trips
-- they send or receive, and destination shipments assigned to their branch.
drop policy if exists "members read load manifests" on public.load_manifests;
create policy "members read relevant load manifests"
  on public.load_manifests for select to authenticated
  using (
    company_id = (select (private.member()).company_id)
    and (
      (select (private.member()).role) in ('owner', 'admin', 'accountant')
      or origin_branch_id = (select (private.member()).branch_id)
      or destination_branch_id = (select (private.member()).branch_id)
    )
  );

drop policy if exists "members read item load allocations" on public.load_manifest_item_lines;
create policy "members read relevant item load allocations"
  on public.load_manifest_item_lines for select to authenticated
  using (
    company_id = (select (private.member()).company_id)
    and exists (
      select 1 from public.load_manifests manifest
      where manifest.id = manifest_id
    )
  );

drop policy if exists "members read load manifest items" on public.load_manifest_items;
create policy "members read relevant load manifest items"
  on public.load_manifest_items for select to authenticated
  using (
    company_id = (select (private.member()).company_id)
    and exists (
      select 1 from public.load_manifests manifest
      where manifest.id = manifest_id
    )
  );

drop policy if exists destination_branch_reads_shipments on public.shipments;
create policy destination_branch_reads_shipments
  on public.shipments for select to authenticated
  using (
    company_id = (select (private.member()).company_id)
    and exists (
      select 1 from public.branches branch
      where branch.id = (select (private.member()).branch_id)
        and branch.company_id = public.shipments.company_id
        and branch.code = public.shipments.destination_branch_code
    )
  );

drop policy if exists destination_branch_reads_shipment_items on public.shipment_items;
create policy destination_branch_reads_shipment_items
  on public.shipment_items for select to authenticated
  using (
    exists (
      select 1 from public.shipments shipment
      join public.branches branch
        on branch.id = (select (private.member()).branch_id)
       and branch.company_id = shipment.company_id
       and branch.code = shipment.destination_branch_code
      where shipment.id = shipment_id
        and shipment.company_id = (select (private.member()).company_id)
    )
  );

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
  elsif action_value = 'RECEIVE' then
    if trip.status <> 'DEPARTED' then
      raise exception 'รับรถได้เฉพาะเที่ยวที่ออกจากต้นทางแล้ว';
    end if;
    if m.role not in ('owner', 'admin') and m.branch_id is distinct from trip.destination_branch_id then
      raise exception 'รับรถได้เฉพาะเที่ยวที่เข้าสาขาของคุณ';
    end if;
    update public.load_manifests set status = 'RECEIVED', received_at = now(),
      updated_at = now(), updated_by = m.id where id = trip.id;
    for shipment_value in select distinct shipment_id
      from public.load_manifest_item_lines where manifest_id = trip.id and is_active
    loop
      insert into public.shipment_events (
        company_id, shipment_id, event_type, event_at, branch_id,
        manifest_id, detail, created_by
      ) values (
        m.company_id, shipment_value, 'ARRIVED_BRANCH', now(),
        trip.destination_branch_id, trip.id,
        jsonb_build_object('manifest_no', trip.manifest_no), m.id
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

revoke all on function private.set_load_trip_status(jsonb) from public, anon, authenticated;
grant execute on function private.set_load_trip_status(jsonb) to authenticated;
