-- Keep an immutable routing identity for the original Sukhothai/Sawankhalok rules.
alter table public.branches add column if not exists route_key text;
update public.branches set route_key = code where route_key is null;
alter table public.branches alter column route_key set not null;
alter table public.service_zones add column if not exists route_key text;
update public.service_zones set route_key = code where route_key is null;

create or replace function private.manage_branch_setting(action text, data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.profiles := private.require_role(array['owner', 'admin']);
  branch_id_value uuid := (data->>'id')::uuid;
  route_code_value text := upper(trim(coalesce(data->>'code', '')));
  document_code_value text := upper(trim(coalesce(data->>'document_code', '')));
  branch_kind_value text := coalesce(data->>'branch_kind', 'DESTINATION');
  old_branch public.branches;
begin
  if action = 'save' then
    if route_code_value !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'รหัสเส้นทางต้องเป็นตัวอักษรอังกฤษหรือตัวเลข 2-8 ตัว';
    end if;
    if document_code_value !~ '^[A-Z][0-9]{2}$' then
      raise exception 'รหัสออกบิลต้องเป็นตัวอักษร 1 ตัวและตัวเลข 2 หลัก เช่น B01';
    end if;
    if branch_kind_value not in ('ORIGIN', 'DESTINATION', 'BOTH', 'HUB', 'ADMIN') then
      raise exception 'ประเภทสาขาไม่ถูกต้อง';
    end if;
    if coalesce((data->>'is_new')::boolean, false) then
      insert into public.branches(
        id, company_id, code, route_key, document_code, name, branch_kind,
        province_name, can_issue_bills, is_active
      ) values (
        branch_id_value, m.company_id, route_code_value, route_code_value,
        document_code_value, trim(data->>'name'), branch_kind_value,
        trim(data->>'province_name'),
        coalesce((data->>'can_issue_bills')::boolean, false),
        coalesce((data->>'is_active')::boolean, true)
      );
    else
      select * into old_branch from public.branches
      where id = branch_id_value and company_id = m.company_id for update;
      if old_branch.id is null then raise exception 'ไม่พบสาขา'; end if;
      if old_branch.document_code_locked_at is not null
        and old_branch.document_code <> document_code_value then
        raise exception 'รหัสออกบิลถูกใช้งานแล้ว จึงเปลี่ยนไม่ได้';
      end if;
      if old_branch.code <> route_code_value and exists (
        select 1 from public.service_zones
        where company_id = m.company_id and code = route_code_value
      ) then
        raise exception 'รหัสเส้นทางนี้ชนกับรหัสพื้นที่ให้บริการ';
      end if;
      update public.branches
      set code = route_code_value,
          document_code = document_code_value,
          name = trim(data->>'name'),
          branch_kind = branch_kind_value,
          province_name = trim(data->>'province_name'),
          can_issue_bills = coalesce((data->>'can_issue_bills')::boolean, false),
          is_active = coalesce((data->>'is_active')::boolean, true),
          updated_at = now()
      where id = branch_id_value and company_id = m.company_id;
      if old_branch.code <> route_code_value then
        update public.service_zones set code = route_code_value
        where company_id = m.company_id and code = old_branch.code;
        update public.shipments set destination_branch_code = route_code_value
        where company_id = m.company_id and destination_branch_code = old_branch.code;
      end if;
    end if;
  elsif action = 'delete' then
    update public.branches
    set is_active = false, can_issue_bills = false, updated_at = now()
    where id = branch_id_value and company_id = m.company_id;
    if not found then raise exception 'ไม่พบสาขา'; end if;
  else
    raise exception 'คำสั่งสาขาไม่ถูกต้อง';
  end if;
  insert into public.audit_logs(
    company_id, actor_id, action, entity_type, record_id, detail
  ) values (
    m.company_id, m.id, 'CONFIGURE', 'branch_' || action,
    branch_id_value, data || jsonb_build_object('previous_code', old_branch.code)
  );
end
$$;

-- Existing bill procedures have a special Sawankhalok route. Match its stable
-- route identity, not the user-editable display code.
do $$
declare
  procedure_name text;
  definition text;
begin
  foreach procedure_name in array array[
    'private.issue_reception_bill_v2(jsonb)',
    'private.update_reception_bill_v2(uuid,jsonb,text)'
  ] loop
    definition := pg_get_functiondef(procedure_name::regprocedure);
    if position('destination_branch.code = ''SWL''' in definition) = 0 then
      raise exception 'Special route rule not found in %', procedure_name;
    end if;
    definition := replace(definition,
      'destination_branch.code = ''SWL''',
      'destination_branch.route_key = ''SWL''');
    definition := replace(definition,
      'code = ''STI'' and is_active',
      'route_key = ''STI'' and is_active');
    execute definition;
  end loop;
end
$$;

create or replace function private.normalize_shipment_district()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  route_identity text;
begin
  select route_key into route_identity from public.branches
  where company_id = new.company_id and code = new.destination_branch_code;
  if btrim(coalesce(new.receiver_snapshot->>'district', '')) = '' then
    if route_identity = 'SWL' then
      select id, name into new.district_id, new.district_name
      from public.districts
      where zone_id = new.zone_id and is_active and name = 'สวรรคโลก'
      limit 1;
    else
      select id, name into new.district_id, new.district_name
      from public.districts
      where zone_id = new.zone_id and is_active and name like 'เมือง%'
      order by name limit 1;
    end if;
    if new.district_id is null then
      select id, name into new.district_id, new.district_name
      from public.districts
      where zone_id = new.zone_id and name = 'ไม่ระบุอำเภอ' limit 1;
    end if;
  end if;
  return new;
end
$$;
