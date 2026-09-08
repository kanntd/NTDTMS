alter table public.branches
  add column if not exists branch_kind text not null default 'ORIGIN' check (branch_kind in ('ORIGIN', 'DESTINATION', 'HUB', 'ADMIN')),
  add column if not exists province_name text not null default '',
  add column if not exists address text not null default '',
  add column if not exists is_active boolean not null default true,
  add column if not exists version_no integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

alter table public.companies
  add column if not exists is_active boolean not null default true,
  add column if not exists version_no integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

alter table public.products
  add column if not exists is_active boolean not null default true,
  add column if not exists version_no integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

alter table public.parties
  add column if not exists party_code text,
  add column if not exists party_type text not null default 'CUSTOMER' check (party_type in ('CUSTOMER', 'VENDOR', 'BOTH')),
  add column if not exists deleted_at timestamptz;

create table if not exists public.erp_modules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  module_no integer not null check (module_no between 1 and 99),
  code text not null,
  name text not null,
  description text not null default '',
  phase text not null default 'V2_FOUNDATION',
  owner_role text not null default 'owner',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, code),
  unique (company_id, module_no)
);

create table if not exists public.erp_module_tables (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  module_id uuid not null references public.erp_modules,
  table_name text not null,
  purpose text not null default '',
  data_owner text not null default 'admin',
  has_snapshot boolean not null default false,
  has_cancel_reverse boolean not null default false,
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, table_name)
);

create table if not exists public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  code text not null,
  name text not null,
  entity_type text not null,
  min_amount numeric(18,2),
  required_role text not null default 'owner',
  step_order integer not null default 1,
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, code)
);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  workflow_id uuid references public.approval_workflows,
  entity_type text not null,
  entity_id uuid,
  request_reason text not null default '',
  payload jsonb not null default '{}',
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users,
  decision_note text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz
);

create table if not exists public.price_books (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  code text not null,
  name text not null,
  effective_from date not null,
  effective_to date,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'ARCHIVED', 'CANCELLED')),
  approval_request_id uuid references public.approval_requests,
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, code),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.price_book_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  price_book_id uuid not null references public.price_books,
  product_id uuid not null references public.products,
  zone_id uuid references public.service_zones,
  district_id uuid references public.districts,
  charge_basis text not null default 'UNIT' check (charge_basis in ('UNIT', 'WEIGHT', 'VOLUME', 'TRIP', 'CUSTOM')),
  unit_name text not null default '',
  base_price numeric(18,2) not null check (base_price >= 0),
  minimum_price numeric(18,2) not null default 0 check (minimum_price >= 0),
  price_snapshot jsonb not null default '{}',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz
);

create table if not exists public.price_tiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  price_book_line_id uuid not null references public.price_book_lines,
  from_quantity numeric(18,4) not null default 0,
  to_quantity numeric(18,4),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  check (to_quantity is null or to_quantity > from_quantity)
);

create table if not exists public.shipment_collections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  shipment_id uuid references public.shipments,
  invoice_id uuid references public.invoices,
  collection_no text not null,
  collection_type text not null check (collection_type in ('CASH_ORIGIN', 'CASH_DESTINATION', 'CREDIT_COLLECTION', 'ADJUSTMENT')),
  payer_snapshot jsonb not null default '{}',
  amount numeric(18,2) not null check (amount > 0),
  method text not null default 'CASH' check (method in ('CASH', 'TRANSFER', 'QR', 'CHEQUE', 'OFFSET')),
  collected_at timestamptz not null default now(),
  deposited_at timestamptz,
  status text not null default 'COLLECTED' check (status in ('COLLECTED', 'DEPOSITED', 'REVERSED', 'CANCELLED')),
  reverse_of uuid references public.shipment_collections,
  cancel_reason text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, collection_no)
);

create table if not exists public.branch_receiving_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  origin_branch_id uuid references public.branches,
  destination_branch_id uuid references public.branches,
  receiving_no text not null,
  receiving_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  received_by_name text not null default '',
  source_document_snapshot jsonb not null default '{}',
  total_shipments integer not null default 0 check (total_shipments >= 0),
  total_quantity numeric(18,4) not null default 0 check (total_quantity >= 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED')),
  posted_at timestamptz,
  reverse_of uuid references public.branch_receiving_transactions,
  cancel_reason text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, receiving_no)
);

create table if not exists public.branch_receiving_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  receiving_id uuid not null references public.branch_receiving_transactions,
  shipment_id uuid references public.shipments,
  line_no integer not null,
  shipment_snapshot jsonb not null default '{}',
  expected_quantity numeric(18,4) not null default 0,
  received_quantity numeric(18,4) not null default 0,
  exception_note text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (receiving_id, line_no)
);

create table if not exists public.billing_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  customer_id uuid references public.parties,
  billing_no text not null,
  billing_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  customer_snapshot jsonb not null default '{}',
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED', 'REVERSED')),
  due_date date,
  reverse_of uuid references public.billing_batches,
  cancel_reason text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, billing_no)
);

create table if not exists public.billing_batch_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  billing_batch_id uuid not null references public.billing_batches,
  invoice_id uuid references public.invoices,
  shipment_id uuid references public.shipments,
  line_no integer not null,
  document_snapshot jsonb not null default '{}',
  amount numeric(18,2) not null check (amount >= 0),
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (billing_batch_id, line_no)
);

create table if not exists public.remittance_slips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  from_branch_id uuid references public.branches,
  to_branch_id uuid references public.branches,
  remittance_no text not null,
  remittance_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  amount numeric(18,2) not null check (amount >= 0),
  method text not null default 'TRANSFER' check (method in ('CASH', 'TRANSFER', 'QR', 'CHEQUE')),
  reference_no text not null default '',
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SENT', 'CONFIRMED', 'CANCELLED', 'REVERSED')),
  reverse_of uuid references public.remittance_slips,
  cancel_reason text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, remittance_no)
);

create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  account_code text not null,
  account_name text not null,
  account_type text not null check (account_type in ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  parent_account_id uuid references public.chart_of_accounts,
  is_posting boolean not null default true,
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, account_code)
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  journal_no text not null,
  journal_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  source_module text not null default '',
  source_entity_type text not null default '',
  source_entity_id uuid,
  memo text not null default '',
  status text not null default 'DRAFT' check (status in ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED')),
  posted_at timestamptz,
  reverse_of uuid references public.journal_entries,
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, journal_no)
);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  journal_entry_id uuid not null references public.journal_entries,
  account_id uuid not null references public.chart_of_accounts,
  line_no integer not null,
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  party_id uuid references public.parties,
  memo text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (journal_entry_id, line_no),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create table if not exists public.vehicle_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  vehicle_no text not null,
  plate_no text not null,
  vehicle_type text not null default '',
  ownership_type text not null default 'OWNED' check (ownership_type in ('OWNED', 'LEASED', 'SUBCONTRACT')),
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, vehicle_no),
  unique (company_id, plate_no)
);

create table if not exists public.trip_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  origin_branch_id uuid references public.branches,
  destination_branch_id uuid references public.branches,
  vehicle_id uuid references public.vehicle_assets,
  trip_no text not null,
  trip_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  driver_name text not null default '',
  route_snapshot jsonb not null default '{}',
  revenue_amount numeric(18,2) not null default 0,
  cost_amount numeric(18,2) not null default 0,
  status text not null default 'PLANNED' check (status in ('PLANNED', 'LOADED', 'IN_TRANSIT', 'CLOSED', 'CANCELLED', 'REVERSED')),
  closed_at timestamptz,
  reverse_of uuid references public.trip_runs,
  cancel_reason text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, trip_no)
);

create table if not exists public.trip_run_shipments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  trip_run_id uuid not null references public.trip_runs,
  shipment_id uuid references public.shipments,
  line_no integer not null,
  shipment_snapshot jsonb not null default '{}',
  allocated_revenue numeric(18,2) not null default 0,
  allocated_cost numeric(18,2) not null default 0,
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (trip_run_id, line_no)
);

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, code)
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  sku text not null,
  name text not null,
  item_type text not null default 'SUPPLY' check (item_type in ('SUPPLY', 'SPARE_PART', 'PACKAGING', 'FUEL')),
  unit text not null default 'ชิ้น',
  standard_cost numeric(18,2) not null default 0,
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, sku)
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  location_id uuid references public.inventory_locations,
  item_id uuid not null references public.inventory_items,
  movement_no text not null,
  movement_type text not null check (movement_type in ('RECEIVE', 'ISSUE', 'ADJUST', 'TRANSFER', 'REVERSE')),
  quantity numeric(18,4) not null,
  unit_cost numeric(18,2) not null default 0,
  source_entity_type text not null default '',
  source_entity_id uuid,
  status text not null default 'POSTED' check (status in ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED')),
  reverse_of uuid references public.inventory_movements,
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, movement_no),
  check (quantity <> 0)
);

create table if not exists public.document_reversals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  source_entity_type text not null,
  source_entity_id uuid not null,
  reversal_entity_type text not null,
  reversal_entity_id uuid not null,
  reason text not null,
  reversed_at timestamptz not null default now(),
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz
);

create index if not exists erp_modules_company on public.erp_modules(company_id, module_no);
create index if not exists erp_module_tables_module on public.erp_module_tables(module_id);
create index if not exists approvals_company_status on public.approval_requests(company_id, status, requested_at desc);
create index if not exists price_books_company_effective on public.price_books(company_id, status, effective_from desc);
create index if not exists price_book_lines_lookup on public.price_book_lines(company_id, product_id, zone_id, district_id);
create index if not exists price_tiers_line on public.price_tiers(price_book_line_id, from_quantity);
create index if not exists collections_company_time on public.shipment_collections(company_id, collected_at desc);
create index if not exists branch_receiving_company_date on public.branch_receiving_transactions(company_id, receiving_date desc);
create index if not exists billing_customer_date on public.billing_batches(company_id, customer_id, billing_date desc);
create index if not exists remittance_company_date on public.remittance_slips(company_id, remittance_date desc);
create index if not exists journal_company_date on public.journal_entries(company_id, journal_date desc);
create index if not exists journal_lines_account on public.journal_lines(account_id);
create index if not exists trip_runs_company_date on public.trip_runs(company_id, trip_date desc);
create index if not exists inventory_movements_company_item on public.inventory_movements(company_id, item_id, created_at desc);

create or replace view public.v2_module_overview
with (security_invoker=true)
as
select
  m.company_id,
  m.module_no,
  m.code,
  m.name,
  m.phase,
  m.description,
  count(t.id) as table_count,
  coalesce(jsonb_agg(jsonb_build_object('table', t.table_name, 'purpose', t.purpose) order by t.table_name) filter (where t.id is not null), '[]'::jsonb) as tables
from public.erp_modules m
left join public.erp_module_tables t on t.module_id = m.id and t.deleted_at is null
where m.deleted_at is null
group by m.company_id, m.module_no, m.code, m.name, m.phase, m.description;

create or replace view public.v2_trip_profit
with (security_invoker=true)
as
select
  t.company_id,
  t.id as trip_run_id,
  t.trip_no,
  t.trip_date,
  t.revenue_amount,
  t.cost_amount,
  (t.revenue_amount - t.cost_amount)::numeric(18,2) as gross_profit,
  case when t.revenue_amount = 0 then 0 else round(((t.revenue_amount - t.cost_amount) / t.revenue_amount) * 100, 2) end as gross_margin_percent,
  t.status
from public.trip_runs t
where t.deleted_at is null;

do $$
declare
  c uuid;
  b_bkk uuid;
  b_plk uuid;
  b_sti uuid;
  b_kpt uuid;
  book uuid;
  line_id uuid;
  product public.products;
  modules text[][] := array[
    array['1','ORG','Organization & Branch','บริษัท สาขา เขตบริการ และโครงสิทธิ์ตามสาขา'],
    array['2','IAM','Identity & Access','ผู้ใช้ บทบาท สิทธิ์ และ branch scope สำหรับรอบถัดไป'],
    array['3','CUSTOMER','Customer & CRM','ลูกค้า ผู้ส่ง ผู้รับ เครดิต และประวัติการติดต่อ'],
    array['4','PRICING','Pricing Engine','Price book, rule, tier, snapshot ราคา และ approval'],
    array['5','SHIPMENT','Shipment & Waybill','รับสินค้า ออกบิล ใบรับสินค้า และ snapshot เอกสาร'],
    array['6','BRANCH_RECEIVING','Branch Receiving','งานขาเข้าปลายทางและรับสินค้าระหว่างสาขา'],
    array['7','COLLECTION','Cash Collection','เก็บเงินต้นทาง/ปลายทาง ใบส่งเงิน และ reverse'],
    array['8','BILLING','Billing & AR','ใบวางบิล ลูกหนี้ และรอบชำระเงิน'],
    array['9','AP','Payable & Payout','ใบนำจ่าย เจ้าหนี้ และจ่ายคู่ค้า'],
    array['10','ACCOUNTING','Financials GL','ผังบัญชี Journal Entry และบัญชีคู่'],
    array['11','TRIP','Trip Management','เที่ยวรถ รายได้ ต้นทุน และ gross profit'],
    array['12','FLEET','Fleet & Vehicle','ทะเบียนรถ ทรัพย์สิน และสถานะรถ'],
    array['13','DRIVER','Driver & Contractor','พนักงานขับรถ ผู้รับเหมา และประวัติงาน'],
    array['14','FUEL','Fuel & Expense','ค่าน้ำมัน ค่าเที่ยว และค่าใช้จ่ายเดินรถ'],
    array['15','MAINTENANCE','Maintenance','ซ่อมบำรุงรถและอะไหล่'],
    array['16','INVENTORY','Inventory','สต็อกวัสดุ อะไหล่ และ movement'],
    array['17','DOCUMENT','Document Control','ไฟล์แนบ รูปภาพ และเอกสารประกอบ'],
    array['18','APPROVAL','Approval Workflow','อนุมัติราคา เครดิต ยกเลิก และรายการสำคัญ'],
    array['19','AUDIT','Audit & Compliance','audit log และประวัติแก้ไข'],
    array['20','REPORTING','Reporting & BI','รายงานยอดขาย ยอดค้าง และกำไร'],
    array['21','INTEGRATION','Integration & API','Cloudflare, R2, Google Drive, GitHub และ API ภายนอก']
  ];
  m text[];
  module_id uuid;
begin
  select id into c from public.companies where code = 'NTD' limit 1;
  select id into b_bkk from public.branches where company_id = c and code = 'BKK' limit 1;

  update public.branches
     set branch_kind = 'ORIGIN',
         province_name = 'กรุงเทพมหานคร',
         address = coalesce(nullif(address, ''), 'สำนักงานใหญ่ กรุงเทพฯ')
   where id = b_bkk;

  insert into public.branches(company_id, code, name, branch_kind, province_name, address)
  values
    (c, 'PLK', 'สาขาพิษณุโลก', 'DESTINATION', 'พิษณุโลก', 'พื้นที่ปลายทางพิษณุโลก'),
    (c, 'STI', 'สาขาสุโขทัย', 'DESTINATION', 'สุโขทัย', 'พื้นที่ปลายทางสุโขทัย'),
    (c, 'KPT', 'สาขากำแพงเพชร', 'DESTINATION', 'กำแพงเพชร', 'พื้นที่ปลายทางกำแพงเพชร')
  on conflict (company_id, code) do update
    set name = excluded.name,
        branch_kind = excluded.branch_kind,
        province_name = excluded.province_name,
        address = excluded.address,
        updated_at = now();

  select id into b_plk from public.branches where company_id = c and code = 'PLK';
  select id into b_sti from public.branches where company_id = c and code = 'STI';
  select id into b_kpt from public.branches where company_id = c and code = 'KPT';

  foreach m slice 1 in array modules loop
    insert into public.erp_modules(company_id, module_no, code, name, description)
    values (c, m[1]::integer, m[2], m[3], m[4])
    on conflict (company_id, code) do update
      set module_no = excluded.module_no,
          name = excluded.name,
          description = excluded.description,
          updated_at = now()
    returning id into module_id;
  end loop;

  insert into public.erp_module_tables(company_id, module_id, table_name, purpose, has_snapshot, has_cancel_reverse)
  select c, m.id, x.table_name, x.purpose, x.has_snapshot, x.has_cancel_reverse
  from public.erp_modules m
  join (
    values
      ('ORG','companies','บริษัทหลัก',false,false),
      ('ORG','branches','สาขาต้นทาง/ปลายทาง',false,false),
      ('IAM','profiles','ผู้ใช้และบทบาท',false,false),
      ('CUSTOMER','parties','ลูกค้า ผู้ส่ง ผู้รับ และเครดิตอนุมัติ',false,false),
      ('PRICING','price_books','ชุดราคาตามช่วงเวลา',true,true),
      ('PRICING','price_book_lines','ราคาตามสินค้า จังหวัด อำเภอ และรูปแบบคิดราคา',true,true),
      ('PRICING','price_tiers','ขั้นบันไดราคา/จำนวน',true,false),
      ('SHIPMENT','shipments','เอกสารรับสินค้าและใบขนส่ง',true,true),
      ('SHIPMENT','shipment_items','รายการสินค้าในบิล',true,false),
      ('BRANCH_RECEIVING','branch_receiving_transactions','รับสินค้าขาเข้าที่สาขาปลายทาง',true,true),
      ('COLLECTION','shipment_collections','เก็บเงินและใบส่งเงินจาก shipment',true,true),
      ('BILLING','billing_batches','ใบวางบิลลูกค้าเครดิต',true,true),
      ('ACCOUNTING','chart_of_accounts','ผังบัญชี',false,false),
      ('ACCOUNTING','journal_entries','สมุดรายวันบัญชีคู่',true,true),
      ('ACCOUNTING','journal_lines','เดบิตเครดิต',false,false),
      ('TRIP','trip_runs','เที่ยวรถและกำไรขั้นต้น',true,true),
      ('FLEET','vehicle_assets','ทะเบียนรถและทรัพย์สินรถ',false,false),
      ('INVENTORY','inventory_items','วัสดุและอะไหล่',false,false),
      ('INVENTORY','inventory_movements','รับจ่ายปรับสต็อก',true,true),
      ('DOCUMENT','shipment_files','รูปสินค้าและเอกสารแนบ',false,false),
      ('APPROVAL','approval_requests','อนุมัติรายการสำคัญ',true,true),
      ('AUDIT','audit_logs','ประวัติกิจกรรมระบบ',true,false)
  ) as x(module_code, table_name, purpose, has_snapshot, has_cancel_reverse) on x.module_code = m.code
  where m.company_id = c
  on conflict (company_id, table_name) do update
    set module_id = excluded.module_id,
        purpose = excluded.purpose,
        has_snapshot = excluded.has_snapshot,
        has_cancel_reverse = excluded.has_cancel_reverse,
        updated_at = now();

  insert into public.price_books(company_id, code, name, effective_from, status)
  values (c, 'PB-NTD-2026-BASE', 'ราคาขนส่งมาตรฐาน NTD 2026', '2026-09-07', 'ACTIVE')
  on conflict (company_id, code) do update
    set name = excluded.name,
        status = excluded.status,
        updated_at = now()
  returning id into book;

  for product in select * from public.products where company_id = c loop
    insert into public.price_book_lines(company_id, price_book_id, product_id, charge_basis, unit_name, base_price, minimum_price, price_snapshot)
    values (
      c,
      book,
      product.id,
      case when product.unit = 'พาเลท' then 'TRIP' else 'UNIT' end,
      product.unit,
      case product.unit
        when 'กล่อง' then 40
        when 'ลัง' then 60
        when 'มัด' then 80
        when 'กระสอบ' then 50
        else 450
      end,
      0,
      jsonb_build_object('product_name', product.name, 'unit', product.unit, 'source', 'v2 seed')
    )
    returning id into line_id;

    insert into public.price_tiers(company_id, price_book_line_id, from_quantity, to_quantity, unit_price)
    values
      (c, line_id, 1, 20, case product.unit when 'กล่อง' then 40 when 'ลัง' then 60 when 'มัด' then 80 when 'กระสอบ' then 50 else 450 end),
      (c, line_id, 21, null, case product.unit when 'กล่อง' then 38 when 'ลัง' then 57 when 'มัด' then 76 when 'กระสอบ' then 48 else 430 end);
  end loop;

  insert into public.approval_workflows(company_id, code, name, entity_type, min_amount, required_role)
  values
    (c, 'PRICE_OVERRIDE', 'อนุมัติราคานอกตาราง', 'shipment', 0, 'owner'),
    (c, 'CREDIT_CHANGE', 'อนุมัติแก้ไขวงเงินเครดิต', 'party', 0, 'owner'),
    (c, 'DOCUMENT_CANCEL', 'อนุมัติยกเลิกเอกสาร', 'document', 0, 'owner')
  on conflict (company_id, code) do update
    set name = excluded.name,
        entity_type = excluded.entity_type,
        min_amount = excluded.min_amount,
        required_role = excluded.required_role,
        updated_at = now();

  insert into public.chart_of_accounts(company_id, account_code, account_name, account_type, is_posting)
  values
    (c, '1100', 'เงินสดและเงินฝากธนาคาร', 'ASSET', true),
    (c, '1130', 'ลูกหนี้การค้า', 'ASSET', true),
    (c, '4100', 'รายได้ค่าขนส่ง', 'REVENUE', true),
    (c, '5100', 'ต้นทุนขนส่ง', 'EXPENSE', true),
    (c, '5200', 'ค่าน้ำมันและค่าเที่ยว', 'EXPENSE', true)
  on conflict (company_id, account_code) do update
    set account_name = excluded.account_name,
        account_type = excluded.account_type,
        updated_at = now();

  insert into public.parties(company_id, party_code, party_type, display_name, phone, address, tax_id, credit_limit, credit_days)
  values
    (c, 'CUST-BKK-001', 'CUSTOMER', 'บริษัท สยามบรรจุภัณฑ์ จำกัด', '0990000001', '88 ถนนประชาราษฎร์ แขวงบางซื่อ เขตบางซื่อ กรุงเทพฯ', '', 50000, 30),
    (c, 'CUST-STI-001', 'CUSTOMER', 'ร้านสุโขทัยเครื่องเขียน', '0990000002', '128 ถนนสายหลัก อำเภอเมืองสุโขทัย สุโขทัย', '', 30000, 30),
    (c, 'CUST-PLK-001', 'CUSTOMER', 'ร้านพิษณุโลกอะไหล่', '0990000003', '45 ถนนมิตรภาพ อำเภอเมืองพิษณุโลก พิษณุโลก', '', 40000, 30),
    (c, 'CUST-KPT-001', 'CUSTOMER', 'ร้านกำแพงเพชรเทรดดิ้ง', '0990000004', '77 อำเภอเมืองกำแพงเพชร กำแพงเพชร', '', 25000, 15)
  on conflict do nothing;

  insert into public.vehicle_assets(company_id, branch_id, vehicle_no, plate_no, vehicle_type)
  values
    (c, b_bkk, 'TRUCK-001', '70-0001 กรุงเทพฯ', 'รถหกล้อ'),
    (c, b_bkk, 'TRUCK-002', '70-0002 กรุงเทพฯ', 'รถสิบล้อ')
  on conflict (company_id, vehicle_no) do update
    set plate_no = excluded.plate_no,
        vehicle_type = excluded.vehicle_type,
        updated_at = now();

  insert into public.inventory_locations(company_id, branch_id, code, name)
  values
    (c, b_bkk, 'BKK-WH', 'คลังวัสดุกรุงเทพฯ'),
    (c, b_sti, 'STI-WH', 'คลังปลายทางสุโขทัย'),
    (c, b_plk, 'PLK-WH', 'คลังปลายทางพิษณุโลก'),
    (c, b_kpt, 'KPT-WH', 'คลังปลายทางกำแพงเพชร')
  on conflict (company_id, code) do update
    set name = excluded.name,
        updated_at = now();

  insert into public.inventory_items(company_id, sku, name, item_type, unit, standard_cost)
  values
    (c, 'SUP-TAPE', 'เทปกาวปิดกล่อง', 'PACKAGING', 'ม้วน', 28),
    (c, 'SUP-STRETCH', 'ฟิล์มพันพาเลท', 'PACKAGING', 'ม้วน', 180),
    (c, 'SP-TIRE-6W', 'ยางรถหกล้อ', 'SPARE_PART', 'เส้น', 6200)
  on conflict (company_id, sku) do update
    set name = excluded.name,
        item_type = excluded.item_type,
        unit = excluded.unit,
        standard_cost = excluded.standard_cost,
        updated_at = now();
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'erp_modules',
    'erp_module_tables',
    'approval_workflows',
    'approval_requests',
    'price_books',
    'price_book_lines',
    'price_tiers',
    'shipment_collections',
    'branch_receiving_transactions',
    'branch_receiving_items',
    'billing_batches',
    'billing_batch_lines',
    'remittance_slips',
    'chart_of_accounts',
    'journal_entries',
    'journal_lines',
    'vehicle_assets',
    'trip_runs',
    'trip_run_shipments',
    'inventory_locations',
    'inventory_items',
    'inventory_movements',
    'document_reversals'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists owner_admin_read on public.%I', t);
    execute format(
      'create policy owner_admin_read on public.%I for select to authenticated using (company_id = (select (private.member()).company_id) and (select (private.member()).role) in (''owner'', ''admin''))',
      t
    );
  end loop;
end $$;

revoke all on public.v2_module_overview from anon;
revoke all on public.v2_trip_profit from anon;
grant select on public.v2_module_overview to authenticated;
grant select on public.v2_trip_profit to authenticated;
