-- Reception master data, customer-specific pricing history, staff, fleet and R2 metadata.

alter table public.parties
  add column if not exists prefix text not null default '',
  add column if not exists legal_name text not null default '',
  add column if not exists district text not null default '',
  add column if not exists province text not null default '',
  add column if not exists default_branch_id uuid references public.branches,
  add column if not exists note text not null default '';

alter table public.parties alter column phone drop not null;
alter table public.parties alter column address drop not null;
alter table public.parties drop constraint if exists parties_phone_check;
alter table public.parties drop constraint if exists parties_address_check;
alter table public.parties
  add constraint parties_phone_optional_check
    check (phone is null or phone = '' or length(phone) between 8 and 30),
  add constraint parties_address_optional_check
    check (address is null or address = '' or length(address) <= 1500);

create table if not exists public.party_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  party_id uuid not null,
  role text not null check (role in ('RECEIVER', 'SENDER')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  foreign key (party_id, company_id) references public.parties(id, company_id),
  unique (company_id, party_id, role)
);

create table if not exists public.customer_relations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  receiver_id uuid not null,
  sender_id uuid not null,
  default_payment_mode text not null check (default_payment_mode in ('CASH_ORIGIN', 'CASH_DESTINATION', 'CREDIT_ORIGIN', 'CREDIT_DESTINATION')),
  billing_cycle text not null default 'MONTH_END' check (billing_cycle in ('MONTH_END', 'NET_DAYS')),
  credit_days integer not null default 30 check (credit_days between 0 and 365),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  foreign key (receiver_id, company_id) references public.parties(id, company_id),
  foreign key (sender_id, company_id) references public.parties(id, company_id),
  unique (id, company_id),
  unique (company_id, receiver_id, sender_id),
  check (receiver_id <> sender_id),
  check (default_payment_mode not like 'CREDIT%' or credit_days > 0)
);

create table if not exists public.product_families (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  name text not null check (length(trim(name)) between 1 and 255),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  unique (id, company_id),
  unique (company_id, name)
);

create table if not exists public.product_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  product_family_id uuid not null,
  unit_name text not null check (length(trim(unit_name)) between 1 and 100),
  default_weight numeric(18,4) check (default_weight is null or default_weight >= 0),
  default_width numeric(18,4) check (default_width is null or default_width >= 0),
  default_length numeric(18,4) check (default_length is null or default_length >= 0),
  default_height numeric(18,4) check (default_height is null or default_height >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  foreign key (product_family_id, company_id) references public.product_families(id, company_id),
  unique (id, company_id),
  unique (company_id, product_family_id, unit_name)
);

create table if not exists public.receiver_product_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  receiver_id uuid not null,
  product_unit_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  foreign key (receiver_id, company_id) references public.parties(id, company_id),
  foreign key (product_unit_id, company_id) references public.product_units(id, company_id),
  unique (company_id, receiver_id, product_unit_id)
);

create table if not exists public.customer_relation_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  customer_relation_id uuid not null,
  product_unit_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  foreign key (customer_relation_id, company_id) references public.customer_relations(id, company_id),
  foreign key (product_unit_id, company_id) references public.product_units(id, company_id),
  unique (company_id, customer_relation_id, product_unit_id)
);

create table if not exists public.contract_price_agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  receiver_id uuid not null,
  sender_id uuid not null,
  product_unit_id uuid not null,
  branch_id uuid not null,
  payment_mode text not null check (payment_mode in ('CASH_ORIGIN', 'CASH_DESTINATION', 'CREDIT_ORIGIN', 'CREDIT_DESTINATION')),
  current_version_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  foreign key (receiver_id, company_id) references public.parties(id, company_id),
  foreign key (sender_id, company_id) references public.parties(id, company_id),
  foreign key (product_unit_id, company_id) references public.product_units(id, company_id),
  foreign key (branch_id, company_id) references public.branches(id, company_id),
  unique (id, company_id),
  unique (company_id, receiver_id, sender_id, product_unit_id, branch_id, payment_mode)
);

create table if not exists public.contract_price_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  agreement_id uuid not null,
  version_no integer not null check (version_no > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  effective_from date not null default (now() at time zone 'Asia/Bangkok')::date,
  source text not null check (source in ('INITIAL', 'PRICE_REQUEST', 'MANUAL', 'BATCH')),
  reason text not null check (length(trim(reason)) >= 3),
  approved_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  foreign key (agreement_id, company_id) references public.contract_price_agreements(id, company_id),
  unique (id, agreement_id),
  unique (agreement_id, version_no)
);

alter table public.contract_price_agreements
  drop constraint if exists contract_price_agreements_current_version_fk;
alter table public.contract_price_agreements
  add constraint contract_price_agreements_current_version_fk
  foreign key (current_version_id, id)
  references public.contract_price_versions(id, agreement_id)
  deferrable initially deferred;

create table if not exists public.price_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  shipment_id uuid references public.shipments,
  shipment_item_id uuid references public.shipment_items,
  receiver_id uuid not null,
  sender_id uuid not null,
  product_unit_id uuid not null,
  branch_id uuid not null,
  payment_mode text not null check (payment_mode in ('CASH_ORIGIN', 'CASH_DESTINATION', 'CREDIT_ORIGIN', 'CREDIT_DESTINATION')),
  quantity numeric(18,4) not null default 1 check (quantity > 0),
  collected_price numeric(18,2) check (collected_price is null or collected_price >= 0),
  actual_collected_amount numeric(18,2) check (actual_collected_amount is null or actual_collected_amount >= 0),
  status text not null default 'PENDING_PRICE' check (status in ('PENDING_PRICE', 'PENDING_APPROVAL', 'RETURNED', 'RESOLVED', 'CANCELLED')),
  resolution_type text check (resolution_type is null or resolution_type in ('STANDARD', 'BILL_ONLY')),
  note text not null default '',
  requested_at timestamptz not null default now(),
  submitted_at timestamptz,
  submitted_by uuid references auth.users,
  returned_at timestamptz,
  returned_by uuid references auth.users,
  return_reason text,
  resolved_at timestamptz,
  requested_by uuid not null references auth.users,
  resolved_by uuid references auth.users,
  foreign key (receiver_id, company_id) references public.parties(id, company_id),
  foreign key (sender_id, company_id) references public.parties(id, company_id),
  foreign key (product_unit_id, company_id) references public.product_units(id, company_id),
  foreign key (branch_id, company_id) references public.branches(id, company_id),
  check (
    (status = 'RESOLVED' and resolved_at is not null and resolved_by is not null)
    or (status <> 'RESOLVED' and resolved_at is null and resolved_by is null)
  )
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  home_branch_id uuid references public.branches,
  employee_code text not null,
  display_name text not null check (length(trim(display_name)) between 1 and 255),
  phone text not null default '',
  position_name text not null default '',
  driver_license_no text not null default '',
  driver_license_expires_on date,
  profile_id uuid references public.profiles,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  unique (id, company_id),
  unique (company_id, employee_code)
);

create unique index if not exists vehicle_assets_id_company
  on public.vehicle_assets(id, company_id);

create table if not exists public.vehicle_driver_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  vehicle_id uuid not null,
  employee_id uuid not null,
  starts_on date not null default (now() at time zone 'Asia/Bangkok')::date,
  ends_on date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users,
  foreign key (vehicle_id, company_id) references public.vehicle_assets(id, company_id),
  foreign key (employee_id, company_id) references public.employees(id, company_id),
  check (ends_on is null or ends_on >= starts_on)
);

create unique index if not exists vehicle_one_current_driver
  on public.vehicle_driver_assignments(vehicle_id)
  where ends_on is null;

create table if not exists public.master_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  owner_type text not null check (owner_type in ('EMPLOYEE', 'VEHICLE')),
  employee_id uuid,
  vehicle_id uuid,
  document_kind text not null check (document_kind in ('ID_CARD', 'DRIVER_LICENSE', 'VEHICLE_REGISTRATION', 'INSURANCE', 'OTHER')),
  object_key text not null,
  filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size integer not null check (byte_size between 1 and 15728640),
  expires_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users,
  foreign key (employee_id, company_id) references public.employees(id, company_id),
  foreign key (vehicle_id, company_id) references public.vehicle_assets(id, company_id),
  unique (company_id, object_key),
  check (
    (owner_type = 'EMPLOYEE' and employee_id is not null and vehicle_id is null)
    or (owner_type = 'VEHICLE' and vehicle_id is not null and employee_id is null)
  )
);

create index if not exists party_roles_company_role on public.party_roles(company_id, role, is_active);
create index if not exists customer_relations_receiver on public.customer_relations(company_id, receiver_id, is_active);
create index if not exists customer_relations_sender on public.customer_relations(company_id, sender_id, is_active);
create index if not exists product_units_family on public.product_units(product_family_id, is_active);
create index if not exists receiver_products_receiver on public.receiver_product_links(company_id, receiver_id, is_active);
create index if not exists relation_products_relation on public.customer_relation_products(company_id, customer_relation_id, is_active);
create index if not exists contract_prices_lookup on public.contract_price_agreements(company_id, receiver_id, sender_id, product_unit_id, branch_id, payment_mode) where is_active;
create index if not exists contract_price_history on public.contract_price_versions(agreement_id, version_no desc);
create index if not exists price_requests_pending on public.price_requests(company_id, status, requested_at) where status in ('PENDING_PRICE', 'PENDING_APPROVAL', 'RETURNED');
create index if not exists employees_company_branch on public.employees(company_id, home_branch_id, is_active);
create index if not exists vehicle_driver_history on public.vehicle_driver_assignments(vehicle_id, starts_on desc);
create index if not exists master_documents_employee on public.master_documents(employee_id, created_at desc) where is_active;
create index if not exists master_documents_vehicle on public.master_documents(vehicle_id, created_at desc) where is_active;

create or replace function private.reject_price_version_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ประวัติราคาแก้ไขหรือลบไม่ได้ ให้สร้างเวอร์ชันใหม่';
end $$;

drop trigger if exists immutable_contract_price_versions on public.contract_price_versions;
create trigger immutable_contract_price_versions
before update or delete on public.contract_price_versions
for each row execute function private.reject_price_version_change();

create or replace view public.current_contract_prices
with (security_invoker = true)
as
select
  a.id,
  a.company_id,
  a.receiver_id,
  a.sender_id,
  a.product_unit_id,
  a.branch_id,
  a.payment_mode,
  v.id as price_version_id,
  v.version_no,
  v.unit_price,
  v.effective_from,
  v.reason,
  v.created_at
from public.contract_price_agreements a
join public.contract_price_versions v on v.id = a.current_version_id
where a.is_active;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'party_roles',
    'customer_relations',
    'product_families',
    'product_units',
    'receiver_product_links',
    'customer_relation_products',
    'contract_price_agreements',
    'contract_price_versions',
    'price_requests',
    'employees',
    'vehicle_driver_assignments',
    'master_documents'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update on public.%I to authenticated', table_name);
    execute format('drop policy if exists company_admin_select on public.%I', table_name);
    execute format('drop policy if exists company_admin_insert on public.%I', table_name);
    execute format('drop policy if exists company_admin_update on public.%I', table_name);
    execute format(
      'create policy company_admin_select on public.%I for select to authenticated using (company_id = (select (private.member()).company_id) and (select (private.member()).role) in (''owner'', ''admin''))',
      table_name
    );
    execute format(
      'create policy company_admin_insert on public.%I for insert to authenticated with check (company_id = (select (private.member()).company_id) and (select (private.member()).role) in (''owner'', ''admin''))',
      table_name
    );
    execute format(
      'create policy company_admin_update on public.%I for update to authenticated using (company_id = (select (private.member()).company_id) and (select (private.member()).role) in (''owner'', ''admin'')) with check (company_id = (select (private.member()).company_id) and (select (private.member()).role) in (''owner'', ''admin''))',
      table_name
    );
  end loop;
end $$;

revoke all on public.current_contract_prices from anon;
grant select on public.current_contract_prices to authenticated;

-- Price history is insert-only even for admins. Current agreements are updated
-- to point to a newly inserted version inside one transaction.
revoke update on public.contract_price_versions from authenticated;
