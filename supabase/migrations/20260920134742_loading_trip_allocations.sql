-- Item-level allocations let one bill travel on more than one vehicle/trip.

create table if not exists public.load_manifest_item_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  manifest_id uuid not null references public.load_manifests,
  shipment_id uuid not null references public.shipments,
  shipment_item_id uuid not null references public.shipment_items,
  quantity numeric(18,4) not null check (quantity > 0),
  unit_snapshot text not null default '',
  loaded_at timestamptz not null default now(),
  unloaded_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users,
  unique (manifest_id, shipment_item_id)
);

create index if not exists load_manifest_item_lines_company
  on public.load_manifest_item_lines(company_id);
create index if not exists load_manifest_item_lines_shipment
  on public.load_manifest_item_lines(shipment_id, loaded_at desc)
  where is_active;
create index if not exists load_manifest_item_lines_item
  on public.load_manifest_item_lines(shipment_item_id, loaded_at desc)
  where is_active;

alter table public.load_manifest_item_lines enable row level security;
revoke all on public.load_manifest_item_lines from anon, authenticated;
grant select on public.load_manifest_item_lines to authenticated;

create policy "members read item load allocations"
  on public.load_manifest_item_lines for select to authenticated
  using (company_id = (select (private.member()).company_id));

create or replace function private.create_load_manifest(data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.profiles := private.require_role(array['owner', 'admin', 'clerk']);
  manifest_id_value uuid := gen_random_uuid();
  destination_branch_id_value uuid;
  vehicle_id_value uuid := nullif(data->>'vehicle_id', '')::uuid;
  driver_id_value uuid := nullif(data->>'driver_employee_id', '')::uuid;
  manifest_no_value text := upper(trim(coalesce(data->>'manifest_no', '')));
  destination_code_value text := upper(trim(coalesce(data->>'destination_branch_code', '')));
  confirmed_at_value timestamptz := coalesce(
    nullif(data->>'confirmed_at', '')::timestamptz,
    now()
  );
  allocation jsonb;
  item_row record;
  quantity_value numeric(18,4);
  loaded_value numeric(18,4);
  manifest_line_no integer := 0;
  shipment_value uuid;
begin
  if manifest_no_value = '' then
    raise exception 'กรุณาระบุเลขเที่ยวรถ';
  end if;
  if jsonb_typeof(data->'allocations') <> 'array'
     or jsonb_array_length(data->'allocations') = 0 then
    raise exception 'กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ';
  end if;

  select b.id into destination_branch_id_value
  from public.branches b
  where b.company_id = m.company_id
    and upper(b.code) = destination_code_value
    and b.is_active;
  if destination_branch_id_value is null then
    raise exception 'ไม่พบสาขาปลายทาง';
  end if;

  if not exists (
    select 1 from public.vehicle_assets v
    where v.id = vehicle_id_value
      and v.company_id = m.company_id
      and v.is_active
  ) then
    raise exception 'ไม่พบทะเบียนรถหรือรถหยุดใช้งานแล้ว';
  end if;
  if not exists (
    select 1 from public.employees e
    where e.id = driver_id_value
      and e.company_id = m.company_id
      and e.is_active
  ) then
    raise exception 'ไม่พบพนักงานขับรถหรือพนักงานหยุดใช้งานแล้ว';
  end if;

  insert into public.load_manifests(
    id, company_id, origin_branch_id, destination_branch_id,
    vehicle_id, driver_employee_id, manifest_no, status,
    loaded_at, departed_at, created_by, updated_by
  ) values (
    manifest_id_value, m.company_id, m.branch_id, destination_branch_id_value,
    vehicle_id_value, driver_id_value, manifest_no_value, 'DEPARTED',
    confirmed_at_value, confirmed_at_value, m.id, m.id
  );

  for allocation in select value from jsonb_array_elements(data->'allocations')
  loop
    quantity_value := nullif(allocation->>'quantity', '')::numeric;
    select
      si.id as item_id,
      si.shipment_id,
      si.quantity as item_quantity,
      si.unit,
      s.destination_branch_code,
      s.shipment_status
    into item_row
    from public.shipment_items si
    join public.shipments s on s.id = si.shipment_id
    where si.id = nullif(allocation->>'shipment_item_id', '')::uuid
      and si.shipment_id = nullif(allocation->>'shipment_id', '')::uuid
      and s.company_id = m.company_id
    for update of si;

    if item_row.item_id is null then
      raise exception 'ไม่พบรายการสินค้าในบิล';
    end if;
    if item_row.shipment_status not in ('RECEIVED', 'IN_TRANSIT') then
      raise exception 'บิลนี้ไม่อยู่ในสถานะที่จัดขึ้นรถได้';
    end if;
    if upper(coalesce(item_row.destination_branch_code, '')) <> destination_code_value then
      raise exception 'มีบิลที่ไม่ได้ไปสาขาปลายทางของเที่ยวรถ';
    end if;

    select coalesce(sum(lines.quantity), 0)
      into loaded_value
    from public.load_manifest_item_lines lines
    join public.load_manifests manifests on manifests.id = lines.manifest_id
    where lines.shipment_item_id = item_row.item_id
      and lines.is_active
      and manifests.status <> 'CANCELLED';

    if quantity_value is null or quantity_value <= 0 then
      raise exception 'จำนวนขึ้นรถต้องมากกว่า 0';
    end if;
    if quantity_value > item_row.item_quantity - loaded_value then
      raise exception 'จำนวนขึ้นรถมากกว่าจำนวนคงเหลือ';
    end if;

    if not exists (
      select 1 from public.load_manifest_items
      where manifest_id = manifest_id_value
        and shipment_id = item_row.shipment_id
    ) then
      manifest_line_no := manifest_line_no + 1;
      insert into public.load_manifest_items(
        company_id, manifest_id, shipment_id, line_no,
        loaded_at, is_active, created_by
      ) values (
        m.company_id, manifest_id_value, item_row.shipment_id,
        manifest_line_no, confirmed_at_value, true, m.id
      );
    end if;

    insert into public.load_manifest_item_lines(
      company_id, manifest_id, shipment_id, shipment_item_id,
      quantity, unit_snapshot, loaded_at, created_by
    ) values (
      m.company_id, manifest_id_value, item_row.shipment_id, item_row.item_id,
      quantity_value, item_row.unit, confirmed_at_value, m.id
    );
  end loop;

  for shipment_value in
    select distinct nullif(value->>'shipment_id', '')::uuid
    from jsonb_array_elements(data->'allocations')
  loop
    update public.shipments
    set shipment_status = 'IN_TRANSIT', version_no = version_no + 1
    where id = shipment_value and company_id = m.company_id;

    insert into public.shipment_events(
      company_id, shipment_id, event_type, event_at,
      branch_id, manifest_id, detail, created_by
    ) values (
      m.company_id, shipment_value, 'DEPARTED', confirmed_at_value,
      m.branch_id, manifest_id_value,
      jsonb_build_object(
        'manifest_no', manifest_no_value,
        'destination_branch_code', destination_code_value,
        'driver_name', coalesce(data->>'driver_name', '')
      ),
      m.id
    );
  end loop;

  insert into public.audit_logs(
    company_id, actor_id, action, entity_type, record_id, detail
  ) values (
    m.company_id, m.id, 'CREATE', 'load_manifest', manifest_id_value,
    jsonb_build_object(
      'manifest_no', manifest_no_value,
      'destination_branch_code', destination_code_value,
      'allocation_count', jsonb_array_length(data->'allocations')
    )
  );

  return manifest_id_value;
end
$$;

create or replace function public.create_load_manifest(data jsonb)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_load_manifest(data)
$$;

create or replace function private.update_load_manifest(data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.profiles := private.require_role(array['owner', 'admin']);
  manifest_row public.load_manifests;
  action_value text := upper(trim(coalesce(data->>'action', 'UPDATE')));
  vehicle_id_value uuid := nullif(data->>'vehicle_id', '')::uuid;
  driver_id_value uuid := nullif(data->>'driver_employee_id', '')::uuid;
  line_row record;
  allocation jsonb;
  quantity_value numeric(18,4);
  other_loaded_value numeric(18,4);
  shipment_value uuid;
begin
  select * into manifest_row
  from public.load_manifests
  where id = nullif(data->>'id', '')::uuid
    and company_id = m.company_id
  for update;

  if manifest_row.id is null then
    raise exception 'ไม่พบเที่ยวรถ';
  end if;
  if manifest_row.status in ('RECEIVED', 'CANCELLED') then
    raise exception 'เที่ยวรถนี้แก้ไขไม่ได้แล้ว';
  end if;

  if action_value = 'CANCEL' then
    update public.load_manifests
    set status = 'CANCELLED', updated_at = now(), updated_by = m.id
    where id = manifest_row.id;

    update public.load_manifest_item_lines
    set is_active = false
    where manifest_id = manifest_row.id;

    update public.load_manifest_items
    set is_active = false, unloaded_at = now()
    where manifest_id = manifest_row.id;

    for shipment_value in
      select distinct shipment_id
      from public.load_manifest_item_lines
      where manifest_id = manifest_row.id
    loop
      update public.shipments shipment
      set shipment_status = case
        when exists (
          select 1
          from public.load_manifest_item_lines line
          join public.load_manifests manifest on manifest.id = line.manifest_id
          where line.shipment_id = shipment_value
            and line.is_active
            and manifest.status <> 'CANCELLED'
        ) then 'IN_TRANSIT'
        else 'RECEIVED'
      end,
      version_no = version_no + 1
      where shipment.id = shipment_value
        and shipment.company_id = m.company_id
        and shipment.shipment_status not in ('DELIVERED', 'CANCELLED');
    end loop;

    insert into public.audit_logs(
      company_id, actor_id, action, entity_type, record_id, detail
    ) values (
      m.company_id, m.id, 'CANCEL', 'load_manifest', manifest_row.id,
      jsonb_build_object('manifest_no', manifest_row.manifest_no)
    );
    return;
  end if;

  if action_value <> 'UPDATE' then
    raise exception 'คำสั่งแก้ไขเที่ยวรถไม่ถูกต้อง';
  end if;
  if jsonb_typeof(data->'allocations') <> 'array' then
    raise exception 'ไม่พบรายการสินค้าที่ต้องการแก้ไข';
  end if;
  if not exists (
    select 1 from public.vehicle_assets vehicle
    where vehicle.id = vehicle_id_value
      and vehicle.company_id = m.company_id
      and vehicle.is_active
  ) then
    raise exception 'ไม่พบทะเบียนรถหรือรถหยุดใช้งานแล้ว';
  end if;
  if not exists (
    select 1 from public.employees employee
    where employee.id = driver_id_value
      and employee.company_id = m.company_id
      and employee.is_active
  ) then
    raise exception 'ไม่พบพนักงานขับรถหรือพนักงานหยุดใช้งานแล้ว';
  end if;

  for line_row in
    select line.id, line.shipment_id, line.shipment_item_id,
      item.quantity as original_quantity
    from public.load_manifest_item_lines line
    join public.shipment_items item on item.id = line.shipment_item_id
    where line.manifest_id = manifest_row.id
    for update of line, item
  loop
    allocation := null;
    select value into allocation
    from jsonb_array_elements(data->'allocations')
    where value->>'line_id' = line_row.id::text
    limit 1;

    quantity_value := coalesce(
      nullif(allocation->>'quantity', '')::numeric,
      0
    );
    if quantity_value < 0 then
      raise exception 'จำนวนขึ้นรถต้องไม่ติดลบ';
    end if;

    select coalesce(sum(other_line.quantity), 0)
      into other_loaded_value
    from public.load_manifest_item_lines other_line
    join public.load_manifests other_manifest
      on other_manifest.id = other_line.manifest_id
    where other_line.shipment_item_id = line_row.shipment_item_id
      and other_line.id <> line_row.id
      and other_line.is_active
      and other_manifest.status <> 'CANCELLED';

    if quantity_value > line_row.original_quantity - other_loaded_value then
      raise exception 'จำนวนขึ้นรถมากกว่าจำนวนที่ยังจัดขึ้นรถได้';
    end if;

    if quantity_value = 0 then
      update public.load_manifest_item_lines
      set is_active = false
      where id = line_row.id;
    else
      update public.load_manifest_item_lines
      set quantity = quantity_value, is_active = true
      where id = line_row.id;
    end if;
  end loop;

  if not exists (
    select 1 from public.load_manifest_item_lines
    where manifest_id = manifest_row.id and is_active
  ) then
    raise exception 'ถ้าต้องการนำออกทั้งหมด กรุณายกเลิกทั้งเที่ยวรถ';
  end if;

  update public.load_manifest_items manifest_item
  set is_active = exists (
        select 1
        from public.load_manifest_item_lines line
        where line.manifest_id = manifest_row.id
          and line.shipment_id = manifest_item.shipment_id
          and line.is_active
      ),
      unloaded_at = case
        when exists (
          select 1
          from public.load_manifest_item_lines line
          where line.manifest_id = manifest_row.id
            and line.shipment_id = manifest_item.shipment_id
            and line.is_active
        ) then null
        else now()
      end
  where manifest_item.manifest_id = manifest_row.id;

  update public.load_manifests
  set vehicle_id = vehicle_id_value,
      driver_employee_id = driver_id_value,
      note = coalesce(data->>'note', ''),
      updated_at = now(),
      updated_by = m.id
  where id = manifest_row.id;

  for shipment_value in
    select distinct shipment_id
    from public.load_manifest_item_lines
    where manifest_id = manifest_row.id
  loop
    update public.shipments shipment
    set shipment_status = case
      when exists (
        select 1
        from public.load_manifest_item_lines line
        join public.load_manifests manifest on manifest.id = line.manifest_id
        where line.shipment_id = shipment_value
          and line.is_active
          and manifest.status <> 'CANCELLED'
      ) then 'IN_TRANSIT'
      else 'RECEIVED'
    end,
    version_no = version_no + 1
    where shipment.id = shipment_value
      and shipment.company_id = m.company_id
      and shipment.shipment_status not in ('DELIVERED', 'CANCELLED');
  end loop;

  insert into public.audit_logs(
    company_id, actor_id, action, entity_type, record_id, detail
  ) values (
    m.company_id, m.id, 'UPDATE', 'load_manifest', manifest_row.id,
    jsonb_build_object(
      'manifest_no', manifest_row.manifest_no,
      'vehicle_id', vehicle_id_value,
      'active_line_count', (
        select count(*) from public.load_manifest_item_lines
        where manifest_id = manifest_row.id and is_active
      )
    )
  );
end
$$;

create or replace function public.update_load_manifest(data jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_load_manifest(data)
$$;

revoke all on function private.create_load_manifest(jsonb) from public, anon, authenticated;
grant execute on function private.create_load_manifest(jsonb) to authenticated;
revoke all on function public.create_load_manifest(jsonb) from public, anon;
grant execute on function public.create_load_manifest(jsonb) to authenticated;
revoke all on function private.update_load_manifest(jsonb) from public, anon, authenticated;
grant execute on function private.update_load_manifest(jsonb) to authenticated;
revoke all on function public.update_load_manifest(jsonb) from public, anon;
grant execute on function public.update_load_manifest(jsonb) to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'load_manifests',
    'load_manifest_items',
    'load_manifest_item_lines'
  ]
  loop
    execute format(
      'drop trigger if exists workspace_revision_changed on public.%I',
      table_name
    );
    execute format(
      'create trigger workspace_revision_changed after insert or update or delete on public.%I for each row execute function private.bump_workspace_revision()',
      table_name
    );
  end loop;
end
$$;
