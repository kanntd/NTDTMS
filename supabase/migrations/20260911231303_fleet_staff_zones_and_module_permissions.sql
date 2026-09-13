-- Extend fleet/staff master data, editable service areas and module access.

alter table public.vehicle_assets
  add column if not exists note text not null default '';

alter table public.service_zones
  add column if not exists is_active boolean not null default true;

alter table public.districts
  add column if not exists is_active boolean not null default true;

alter table public.staff_invites
  add column if not exists module_permissions jsonb not null default '{}'::jsonb,
  add constraint staff_invites_module_permissions_object
    check (jsonb_typeof(module_permissions) = 'object');

alter table public.profiles
  add column if not exists module_permissions jsonb not null default '{}'::jsonb,
  add constraint profiles_module_permissions_object
    check (jsonb_typeof(module_permissions) = 'object');

create table if not exists private.master_code_sequences (
  company_id uuid not null references public.companies,
  code_type text not null check (code_type in ('EMPLOYEE', 'VEHICLE')),
  last_number bigint not null default 0 check (last_number >= 0),
  primary key (company_id, code_type)
);

revoke all on private.master_code_sequences from public, anon, authenticated;

insert into private.master_code_sequences(company_id, code_type, last_number)
select
  company_id,
  'EMPLOYEE',
  coalesce(max(substring(employee_code from '([0-9]+)$')::bigint), 0)
from public.employees
where employee_code ~ '[0-9]+$'
group by company_id
on conflict (company_id, code_type) do update
set last_number = greatest(
  private.master_code_sequences.last_number,
  excluded.last_number
);

insert into private.master_code_sequences(company_id, code_type, last_number)
select
  company_id,
  'VEHICLE',
  coalesce(max(substring(vehicle_no from '([0-9]+)$')::bigint), 0)
from public.vehicle_assets
where vehicle_no ~ '[0-9]+$'
group by company_id
on conflict (company_id, code_type) do update
set last_number = greatest(
  private.master_code_sequences.last_number,
  excluded.last_number
);

create or replace function private.assign_master_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number bigint;
  sequence_type text;
begin
  sequence_type := case tg_table_name
    when 'employees' then 'EMPLOYEE'
    else 'VEHICLE'
  end;

  if tg_table_name = 'employees' then
    if nullif(trim(new.employee_code), '') is not null then
      return new;
    end if;
  else
    if nullif(trim(new.vehicle_no), '') is not null then
      return new;
    end if;
  end if;

  insert into private.master_code_sequences(company_id, code_type, last_number)
  values (new.company_id, sequence_type, 1)
  on conflict (company_id, code_type) do update
    set last_number = private.master_code_sequences.last_number + 1
  returning last_number into next_number;

  if tg_table_name = 'employees' then
    new.employee_code := 'EMP-' || lpad(next_number::text, 3, '0');
  else
    new.vehicle_no := 'TRUCK-' || lpad(next_number::text, 3, '0');
  end if;
  return new;
end
$$;

revoke all on function private.assign_master_code() from public, anon, authenticated;

drop trigger if exists employees_assign_code on public.employees;
create trigger employees_assign_code
before insert on public.employees
for each row execute function private.assign_master_code();

drop trigger if exists vehicles_assign_code on public.vehicle_assets;
create trigger vehicles_assign_code
before insert on public.vehicle_assets
for each row execute function private.assign_master_code();

create or replace function private.default_module_permissions(role_name text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case role_name
    when 'owner' then '{"intake":true,"shipments":true,"master_data":true,"pricing":true,"finance":true,"reports":true,"settings":true}'::jsonb
    when 'admin' then '{"intake":true,"shipments":true,"master_data":true,"pricing":true,"finance":true,"reports":true,"settings":true}'::jsonb
    when 'clerk' then '{"intake":true,"shipments":true}'::jsonb
    when 'accountant' then '{"shipments":true,"pricing":true,"finance":true,"reports":true}'::jsonb
    else '{"shipments":true,"reports":true}'::jsonb
  end
$$;

revoke all on function private.default_module_permissions(text) from public, anon, authenticated;

update public.staff_invites
set module_permissions = private.default_module_permissions(role)
where module_permissions = '{}'::jsonb;

update public.profiles
set module_permissions = private.default_module_permissions(role)
where module_permissions = '{}'::jsonb;

create or replace function private.apply_invite_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(
    (
      select invitation.module_permissions
      from public.staff_invites invitation
      where invitation.email = lower(new.email)
        and invitation.company_id = new.company_id
    ),
    private.default_module_permissions(new.role)
  ) into new.module_permissions;
  return new;
end
$$;

revoke all on function private.apply_invite_permissions() from public, anon, authenticated;

drop trigger if exists profiles_apply_invite_permissions on public.profiles;
create trigger profiles_apply_invite_permissions
before insert or update of email, role on public.profiles
for each row execute function private.apply_invite_permissions();

create or replace function private.manage_setting(kind text, data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.profiles := private.require_role(array['owner','admin']);
  rec uuid;
  email_value text;
  target public.staff_invites;
  version integer;
  district_data jsonb;
  permissions jsonb;
begin
  if kind = 'invite' then
    email_value := lower(trim(data->>'email'));

    select * into target
    from public.staff_invites
    where email = email_value
    for update;

    if target.email is not null and target.company_id <> m.company_id then
      raise exception 'อีเมลนี้อยู่ในบริษัทอื่น';
    end if;
    if (data->>'role') = 'owner' or target.role = 'owner' or email_value = m.email then
      raise exception 'ไม่สามารถแก้สิทธิ์เจ้าของหรือบัญชีตนเองจากหน้านี้';
    end if;
    if email_value !~ '^[^@ ]+@[^@ ]+\.[^@ ]+$' then
      raise exception 'อีเมลไม่ถูกต้อง';
    end if;

    permissions := coalesce(
      data->'module_permissions',
      private.default_module_permissions(data->>'role')
    );
    if jsonb_typeof(permissions) <> 'object' then
      raise exception 'รูปแบบสิทธิ์โมดูลไม่ถูกต้อง';
    end if;

    insert into public.staff_invites(
      email, display_name, company_id, branch_id, role, is_active, module_permissions
    ) values (
      email_value,
      trim(data->>'display_name'),
      m.company_id,
      m.branch_id,
      data->>'role',
      coalesce((data->>'is_active')::boolean, true),
      permissions
    )
    on conflict(email) do update
      set display_name = excluded.display_name,
          role = excluded.role,
          is_active = excluded.is_active,
          module_permissions = excluded.module_permissions;

    update public.profiles
    set role = data->>'role',
        display_name = data->>'display_name',
        is_active = coalesce((data->>'is_active')::boolean, true),
        module_permissions = permissions,
        updated_at = now()
    where email = email_value
      and company_id = m.company_id
      and role <> 'owner';

    perform private.provision_invited_confirmed_staff(email_value);
    rec := m.id;
  elsif kind = 'zone_save' then
    rec := (data->>'id')::uuid;
    if coalesce((data->>'is_new')::boolean, false) then
      insert into public.service_zones(
        id, company_id, code, name, color, sort_order, is_active
      ) values (
        rec,
        m.company_id,
        upper(trim(data->>'code')),
        trim(data->>'name'),
        data->>'color',
        coalesce((data->>'sort_order')::integer, 0),
        true
      );
    else
      update public.service_zones
      set name = trim(data->>'name'),
          color = data->>'color',
          is_active = true
      where id = rec and company_id = m.company_id;
      if not found then raise exception 'ไม่พบจังหวัด'; end if;
    end if;

    update public.districts
    set is_active = false
    where zone_id = rec;

    for district_data in
      select value from jsonb_array_elements(coalesce(data->'districts', '[]'::jsonb))
    loop
      update public.districts
      set name = trim(district_data->>'name'), is_active = true
      where id = (district_data->>'id')::uuid and zone_id = rec;
      if not found then
        insert into public.districts(id, zone_id, name, is_active)
        values (
          (district_data->>'id')::uuid,
          rec,
          trim(district_data->>'name'),
          true
        );
      end if;
    end loop;
  elsif kind = 'zone_delete' then
    rec := (data->>'id')::uuid;
    update public.service_zones
    set is_active = false
    where id = rec and company_id = m.company_id;
    if not found then raise exception 'ไม่พบจังหวัด'; end if;
    update public.districts set is_active = false where zone_id = rec;
  elsif kind = 'zone' then
    rec := (data->>'id')::uuid;
    update public.service_zones
    set name = trim(data->>'name'), color = data->>'color'
    where id = rec and company_id = m.company_id;
    if not found then raise exception 'ไม่พบจังหวัด'; end if;
  elsif kind = 'district' then
    rec := (data->>'id')::uuid;
    update public.districts
    set name = trim(data->>'name')
    where id = rec
      and zone_id in (
        select id from public.service_zones where company_id = m.company_id
      );
    if not found then raise exception 'ไม่พบอำเภอ'; end if;
  elsif kind = 'price' then
    perform pg_advisory_xact_lock(
      hashtextextended(m.company_id::text || (data->>'product_id'), 0)
    );
    select coalesce(max(version_no), 0) + 1 into version
    from public.price_rules
    where company_id = m.company_id
      and product_id = (data->>'product_id')::uuid
      and zone_id is not distinct from nullif(data->>'zone_id', '')::uuid;

    insert into public.price_rules(
      company_id, product_id, zone_id, unit_price, version_no, created_by
    ) values (
      m.company_id,
      (data->>'product_id')::uuid,
      nullif(data->>'zone_id', '')::uuid,
      (data->>'unit_price')::numeric,
      version,
      m.id
    ) returning id into rec;
  else
    raise exception 'ประเภทตั้งค่าไม่ถูกต้อง';
  end if;

  insert into public.audit_logs(
    company_id, actor_id, action, entity_type, record_id, detail
  ) values (m.company_id, m.id, 'CONFIGURE', kind, rec, data);
end
$$;
