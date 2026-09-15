-- Give every confirmed staff login one employee record for bill attribution.

create unique index if not exists employees_profile_unique
  on public.employees(profile_id)
  where profile_id is not null;

create or replace function private.provision_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.staff_invites;
begin
  if new.email_confirmed_at is null then return new; end if;

  select * into invitation
  from public.staff_invites
  where email = lower(new.email) and is_active;

  if found then
    insert into public.profiles(
      id, company_id, branch_id, display_name, email, role
    ) values (
      new.id, invitation.company_id, invitation.branch_id,
      invitation.display_name, lower(new.email), invitation.role
    )
    on conflict (id) do update set
      company_id = excluded.company_id,
      branch_id = excluded.branch_id,
      display_name = excluded.display_name,
      email = excluded.email,
      role = excluded.role,
      is_active = true;

    insert into public.employees(
      id, company_id, home_branch_id, employee_code, display_name,
      profile_id, position_name, is_active, created_by, updated_by
    ) values (
      new.id, invitation.company_id, invitation.branch_id,
      'EMP-' || upper(substr(replace(new.id::text, '-', ''), 1, 8)),
      invitation.display_name, new.id,
      case invitation.role
        when 'owner' then 'เจ้าของกิจการ'
        when 'admin' then 'ผู้ดูแลระบบ'
        when 'accountant' then 'บัญชี'
        else 'พนักงานรับสินค้า'
      end,
      true, new.id, new.id
    )
    on conflict (profile_id) where profile_id is not null do update set
      company_id = excluded.company_id,
      home_branch_id = excluded.home_branch_id,
      display_name = excluded.display_name,
      is_active = true,
      updated_at = now(),
      updated_by = new.id;
  end if;
  return new;
end
$$;
