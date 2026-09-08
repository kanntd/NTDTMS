create or replace function private.provision_invited_confirmed_staff(target_email text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  invitation public.staff_invites;
  user_row auth.users;
begin
  select *
    into invitation
    from public.staff_invites
   where email = lower(trim(target_email))
     and is_active;

  if not found then
    return;
  end if;

  for user_row in
    select *
      from auth.users
     where lower(email) = invitation.email
       and email_confirmed_at is not null
  loop
    insert into public.profiles(id, company_id, branch_id, display_name, email, role, is_active)
    values (
      user_row.id,
      invitation.company_id,
      invitation.branch_id,
      invitation.display_name,
      invitation.email,
      invitation.role,
      invitation.is_active
    )
    on conflict (id) do update
      set branch_id = excluded.branch_id,
          display_name = excluded.display_name,
          email = excluded.email,
          role = excluded.role,
          is_active = excluded.is_active,
          updated_at = now()
    where public.profiles.company_id = excluded.company_id
      and public.profiles.role <> 'owner';
  end loop;
end
$$;

revoke all on function private.provision_invited_confirmed_staff(text) from public, anon, authenticated;

create or replace function private.provision_staff()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  perform private.provision_invited_confirmed_staff(new.email);
  return new;
end
$$;

create or replace function private.manage_setting(kind text, data jsonb)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  m public.profiles := private.require_role(array['owner','admin']);
  rec uuid;
  email_value text;
  target public.staff_invites;
  version integer;
begin
  if kind = 'invite' then
    email_value := lower(trim(data->>'email'));

    select *
      into target
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

    insert into public.staff_invites(email, display_name, company_id, branch_id, role, is_active)
    values (
      email_value,
      trim(data->>'display_name'),
      m.company_id,
      m.branch_id,
      data->>'role',
      coalesce((data->>'is_active')::boolean, true)
    )
    on conflict(email) do update
      set display_name = excluded.display_name,
          role = excluded.role,
          is_active = excluded.is_active;

    update public.profiles
       set role = data->>'role',
           display_name = data->>'display_name',
           is_active = coalesce((data->>'is_active')::boolean, true),
           updated_at = now()
     where email = email_value
       and company_id = m.company_id
       and role <> 'owner';

    perform private.provision_invited_confirmed_staff(email_value);
    rec := m.id;
  elsif kind = 'zone' then
    rec := (data->>'id')::uuid;
    update public.service_zones
       set name = trim(data->>'name'),
           color = data->>'color'
     where id = rec
       and company_id = m.company_id;
    if not found then
      raise exception 'ไม่พบจังหวัด';
    end if;
  elsif kind = 'district' then
    rec := (data->>'id')::uuid;
    update public.districts
       set name = trim(data->>'name')
     where id = rec
       and zone_id in (select id from public.service_zones where company_id = m.company_id);
    if not found then
      raise exception 'ไม่พบอำเภอ';
    end if;
  elsif kind = 'price' then
    perform pg_advisory_xact_lock(hashtextextended(m.company_id::text || (data->>'product_id'), 0));
    select coalesce(max(version_no), 0) + 1
      into version
      from public.price_rules
     where company_id = m.company_id
       and product_id = (data->>'product_id')::uuid
       and zone_id is not distinct from nullif(data->>'zone_id', '')::uuid;

    insert into public.price_rules(company_id, product_id, zone_id, unit_price, version_no, created_by)
    values (
      m.company_id,
      (data->>'product_id')::uuid,
      nullif(data->>'zone_id', '')::uuid,
      (data->>'unit_price')::numeric,
      version,
      m.id
    )
    returning id into rec;
  else
    raise exception 'ประเภทตั้งค่าไม่ถูกต้อง';
  end if;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, record_id, detail)
  values(m.company_id, m.id, 'CONFIGURE', kind, rec, data);
end
$$;
