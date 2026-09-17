-- Human-readable bill numbers are independent from route codes such as BKK/KPT.
alter table public.branches
  add column if not exists document_code text not null default '',
  add column if not exists can_issue_bills boolean not null default false,
  add column if not exists document_code_locked_at timestamptz;

alter table public.branches drop constraint if exists branches_branch_kind_check;
alter table public.branches
  add constraint branches_branch_kind_check
  check (branch_kind in ('ORIGIN', 'DESTINATION', 'BOTH', 'HUB', 'ADMIN'));

update public.branches
set document_code = case code
  when 'BKK' then 'B01'
  when 'KPT' then 'K01'
  when 'PLK' then 'P01'
  when 'STI' then 'S01'
  when 'SWL' then 'W01'
  else document_code
end,
can_issue_bills = case when code = 'BKK' then true else can_issue_bills end
where document_code = '' or code = 'BKK';

alter table public.branches drop constraint if exists branches_document_code_format;
alter table public.branches
  add constraint branches_document_code_format
  check (document_code = '' or document_code ~ '^[A-Z][0-9]{2}$');

create unique index if not exists branches_company_document_code_unique
  on public.branches(company_id, upper(document_code))
  where document_code <> '';

create or replace function private.protect_branch_document_code()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.document_code is distinct from new.document_code
    and (
      old.document_code_locked_at is not null
      or exists (select 1 from public.shipments where branch_id = old.id)
    )
  then
    raise exception 'รหัสออกบิลถูกใช้งานแล้ว จึงเปลี่ยนไม่ได้';
  end if;
  return new;
end
$$;

revoke all on function private.protect_branch_document_code() from public, anon, authenticated;

drop trigger if exists branches_protect_document_code on public.branches;
create trigger branches_protect_document_code
before update of document_code on public.branches
for each row execute function private.protect_branch_document_code();

create or replace function private.next_number(b uuid, typ text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n bigint;
  period text;
  branch_code text;
  bill_code text;
  branch_active boolean;
  branch_can_issue boolean;
begin
  select code, document_code, is_active, can_issue_bills
  into branch_code, bill_code, branch_active, branch_can_issue
  from public.branches
  where id = b;

  if branch_code is null then raise exception 'ไม่พบสาขาต้นทาง'; end if;

  if typ = 'NTD' then
    if not branch_active or not branch_can_issue or bill_code = '' then
      raise exception 'สาขาต้นทางยังไม่มีรหัสออกบิลหรือไม่ได้เปิดสิทธิ์ออกบิล';
    end if;
    period := to_char(now() at time zone 'Asia/Bangkok', 'YYYY');
  else
    period := to_char(now() at time zone 'Asia/Bangkok', 'YYYYMM');
  end if;

  insert into private.document_sequences(branch_id, document_type, period, last_number)
  values (b, typ, period, 1)
  on conflict on constraint document_sequences_pkey do update
  set last_number = private.document_sequences.last_number + 1
  returning last_number into n;

  if typ = 'NTD' then
    update public.branches
    set document_code_locked_at = coalesce(document_code_locked_at, now())
    where id = b;
    return bill_code || right(period, 2) || lpad(n::text, 6, '0');
  end if;

  return typ || '-' || branch_code || '-' || period || '-' ||
    lpad(n::text, greatest(5, length(n::text)), '0');
end
$$;

create or replace function private.manage_branch_setting(action text, data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.profiles := private.require_role(array['owner', 'admin']);
  branch_id_value uuid := (data->>'id')::uuid;
  document_code_value text := upper(trim(coalesce(data->>'document_code', '')));
  branch_kind_value text := coalesce(data->>'branch_kind', 'DESTINATION');
begin
  if action = 'save' then
    if document_code_value !~ '^[A-Z][0-9]{2}$' then
      raise exception 'รหัสออกบิลต้องเป็นตัวอักษร 1 ตัวและตัวเลข 2 หลัก เช่น B01';
    end if;
    if branch_kind_value not in ('ORIGIN', 'DESTINATION', 'BOTH', 'HUB', 'ADMIN') then
      raise exception 'ประเภทสาขาไม่ถูกต้อง';
    end if;

    if coalesce((data->>'is_new')::boolean, false) then
      insert into public.branches(
        id, company_id, code, document_code, name, branch_kind,
        province_name, can_issue_bills, is_active
      ) values (
        branch_id_value, m.company_id, upper(trim(data->>'code')),
        document_code_value, trim(data->>'name'), branch_kind_value,
        trim(data->>'province_name'),
        coalesce((data->>'can_issue_bills')::boolean, false),
        coalesce((data->>'is_active')::boolean, true)
      );
    else
      update public.branches
      set document_code = document_code_value,
          name = trim(data->>'name'),
          branch_kind = branch_kind_value,
          province_name = trim(data->>'province_name'),
          can_issue_bills = coalesce((data->>'can_issue_bills')::boolean, false),
          is_active = coalesce((data->>'is_active')::boolean, true),
          updated_at = now()
      where id = branch_id_value and company_id = m.company_id;
      if not found then raise exception 'ไม่พบสาขา'; end if;
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
    branch_id_value, data
  );
end
$$;

revoke all on function private.manage_branch_setting(text, jsonb)
from public, anon, authenticated;

create or replace function public.manage_branch_setting(action text, data jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.manage_branch_setting(action, data) $$;

revoke all on function public.manage_branch_setting(text, jsonb) from public, anon;
grant execute on function public.manage_branch_setting(text, jsonb) to authenticated;
grant select on public.branches to authenticated;
