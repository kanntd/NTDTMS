create unique index if not exists price_book_lines_unique_active
  on public.price_book_lines (
    price_book_id,
    product_id,
    coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(district_id, '00000000-0000-0000-0000-000000000000'::uuid),
    charge_basis,
    unit_name
  )
  where deleted_at is null;

create unique index if not exists price_tiers_unique_active
  on public.price_tiers (
    price_book_line_id,
    from_quantity,
    coalesce(to_quantity, 999999999::numeric)
  )
  where deleted_at is null;

create table if not exists public.payable_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  vendor_id uuid references public.parties,
  payable_no text not null,
  payable_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  vendor_snapshot jsonb not null default '{}',
  source_module text not null default '',
  source_entity_id uuid,
  total_amount numeric(18,2) not null check (total_amount >= 0),
  due_date date,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED', 'REVERSED')),
  reverse_of uuid references public.payable_bills,
  cancel_reason text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, payable_no)
);

create table if not exists public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  payout_no text not null,
  payout_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  payee_snapshot jsonb not null default '{}',
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  method text not null default 'TRANSFER' check (method in ('CASH', 'TRANSFER', 'CHEQUE', 'OFFSET')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED', 'REVERSED')),
  reverse_of uuid references public.payout_batches,
  cancel_reason text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, payout_no)
);

create table if not exists public.payout_batch_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  payout_batch_id uuid not null references public.payout_batches,
  payable_bill_id uuid references public.payable_bills,
  line_no integer not null,
  payable_snapshot jsonb not null default '{}',
  amount numeric(18,2) not null check (amount >= 0),
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (payout_batch_id, line_no)
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  home_branch_id uuid references public.branches,
  driver_code text not null,
  display_name text not null,
  phone text not null default '',
  license_no text not null default '',
  employment_type text not null default 'EMPLOYEE' check (employment_type in ('EMPLOYEE', 'CONTRACTOR')),
  party_id uuid references public.parties,
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, driver_code)
);

create table if not exists public.fuel_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  trip_run_id uuid references public.trip_runs,
  vehicle_id uuid references public.vehicle_assets,
  fuel_no text not null,
  fuel_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  liters numeric(18,3) not null check (liters > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  total_amount numeric(18,2) generated always as (round(liters * unit_price, 2)) stored,
  station_name text not null default '',
  receipt_snapshot jsonb not null default '{}',
  status text not null default 'POSTED' check (status in ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED')),
  reverse_of uuid references public.fuel_logs,
  cancel_reason text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, fuel_no)
);

create table if not exists public.maintenance_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  vehicle_id uuid references public.vehicle_assets,
  order_no text not null,
  order_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  maintenance_type text not null default 'REPAIR' check (maintenance_type in ('SERVICE', 'REPAIR', 'INSPECTION', 'TYRE', 'OTHER')),
  description text not null default '',
  vendor_snapshot jsonb not null default '{}',
  cost_amount numeric(18,2) not null default 0 check (cost_amount >= 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'APPROVED', 'DONE', 'CANCELLED', 'REVERSED')),
  reverse_of uuid references public.maintenance_orders,
  cancel_reason text not null default '',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, order_no)
);

create table if not exists public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  report_code text not null,
  report_name text not null,
  period_start date not null,
  period_end date not null,
  metrics jsonb not null default '{}',
  generated_at timestamptz not null default now(),
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  check (period_end >= period_start)
);

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  provider text not null check (provider in ('CLOUDFLARE', 'SUPABASE', 'GITHUB', 'GOOGLE_DRIVE', 'OTHER')),
  connection_name text not null,
  external_ref text not null default '',
  status text not null default 'PENDING' check (status in ('PENDING', 'CONNECTED', 'ERROR', 'DISABLED')),
  last_checked_at timestamptz,
  metadata jsonb not null default '{}',
  is_active boolean not null default true,
  version_no integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  deleted_at timestamptz,
  unique (company_id, provider, connection_name)
);

create index if not exists payable_bills_company_date on public.payable_bills(company_id, payable_date desc);
create index if not exists payout_batches_company_date on public.payout_batches(company_id, payout_date desc);
create index if not exists payout_lines_bill on public.payout_batch_lines(payable_bill_id);
create index if not exists drivers_company_branch on public.drivers(company_id, home_branch_id);
create index if not exists fuel_logs_company_date on public.fuel_logs(company_id, fuel_date desc);
create index if not exists maintenance_company_vehicle on public.maintenance_orders(company_id, vehicle_id, order_date desc);
create index if not exists report_snapshots_company_period on public.report_snapshots(company_id, report_code, period_start, period_end);
create index if not exists integration_connections_company_provider on public.integration_connections(company_id, provider, status);

do $$
declare
  t text;
  c uuid;
  b_bkk uuid;
  driver_id uuid;
  vehicle_id uuid;
  vendor_id uuid;
begin
  foreach t in array array[
    'payable_bills',
    'payout_batches',
    'payout_batch_lines',
    'drivers',
    'fuel_logs',
    'maintenance_orders',
    'report_snapshots',
    'integration_connections'
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

  select id into c from public.companies where code = 'NTD' limit 1;
  select id into b_bkk from public.branches where company_id = c and code = 'BKK' limit 1;
  select id into vehicle_id from public.vehicle_assets where company_id = c and vehicle_no = 'TRUCK-001' limit 1;

  insert into public.parties(company_id, party_code, party_type, display_name, phone, address, tax_id, credit_limit, credit_days)
  values (c, 'VEND-FUEL-001', 'VENDOR', 'สถานีน้ำมันคู่ค้า NTD', '0990000100', 'กรุงเทพมหานคร', '', 0, 0)
  on conflict do nothing;

  select id into vendor_id from public.parties where company_id = c and party_code = 'VEND-FUEL-001' limit 1;

  insert into public.drivers(company_id, home_branch_id, driver_code, display_name, phone, license_no)
  values (c, b_bkk, 'DRV-001', 'สมชาย ขับดี', '0990000201', 'DL-NTD-001')
  on conflict (company_id, driver_code) do update
    set display_name = excluded.display_name,
        phone = excluded.phone,
        license_no = excluded.license_no,
        updated_at = now()
  returning id into driver_id;

  insert into public.fuel_logs(company_id, branch_id, vehicle_id, fuel_no, liters, unit_price, station_name, receipt_snapshot)
  values (c, b_bkk, vehicle_id, 'FUEL-202609-0001', 120, 34.75, 'สถานีน้ำมันคู่ค้า NTD', jsonb_build_object('vendor_id', vendor_id, 'note', 'ข้อมูลจำลอง V2'))
  on conflict (company_id, fuel_no) do nothing;

  insert into public.maintenance_orders(company_id, branch_id, vehicle_id, order_no, maintenance_type, description, vendor_snapshot, cost_amount)
  values (c, b_bkk, vehicle_id, 'MT-202609-0001', 'SERVICE', 'เปลี่ยนถ่ายน้ำมันเครื่องตามรอบ', jsonb_build_object('vendor_name', 'อู่บริการคู่ค้า'), 2800)
  on conflict (company_id, order_no) do nothing;

  insert into public.payable_bills(company_id, branch_id, vendor_id, payable_no, vendor_snapshot, source_module, total_amount, due_date, status)
  values (c, b_bkk, vendor_id, 'AP-202609-0001', jsonb_build_object('display_name', 'สถานีน้ำมันคู่ค้า NTD'), 'FUEL', 4170, '2026-09-15', 'APPROVED')
  on conflict (company_id, payable_no) do nothing;

  insert into public.report_snapshots(company_id, branch_id, report_code, report_name, period_start, period_end, metrics)
  values (c, b_bkk, 'DAILY-OPS', 'รายงานปฏิบัติการรายวัน', '2026-09-07', '2026-09-07', jsonb_build_object('shipments', 0, 'revenue', 0, 'note', 'เริ่มต้นหลังสร้าง V2 foundation'))
  on conflict do nothing;

  insert into public.integration_connections(company_id, provider, connection_name, external_ref, status, last_checked_at, metadata)
  values
    (c, 'SUPABASE', 'ntdtms', 'giejnvnnbgzlqfzvfzzf', 'CONNECTED', now(), jsonb_build_object('purpose', 'database auth rls')),
    (c, 'CLOUDFLARE', 'ntdtms', 'ntdtms.pages.dev', 'PENDING', now(), jsonb_build_object('r2', 'dashboard enable required')),
    (c, 'GITHUB', 'ntdtms', '', 'PENDING', now(), jsonb_build_object('reason', 'local GitHub CLI/token unavailable in current task'))
  on conflict (company_id, provider, connection_name) do update
    set external_ref = excluded.external_ref,
        status = excluded.status,
        last_checked_at = excluded.last_checked_at,
        metadata = excluded.metadata,
        updated_at = now();
end $$;

do $$
declare
  c uuid;
begin
  select id into c from public.companies where code = 'NTD' limit 1;

  insert into public.erp_module_tables(company_id, module_id, table_name, purpose, has_snapshot, has_cancel_reverse)
  select c, m.id, x.table_name, x.purpose, x.has_snapshot, x.has_cancel_reverse
  from public.erp_modules m
  join (
    values
      ('BRANCH_RECEIVING','branch_receiving_items','รายการรับสินค้าขาเข้ารายบิล',true,false),
      ('BILLING','billing_batch_lines','รายการในใบวางบิล',true,false),
      ('AP','payable_bills','เจ้าหนี้และเอกสารตั้งหนี้',true,true),
      ('AP','payout_batches','ชุดจ่ายเงินและใบนำจ่าย',true,true),
      ('AP','payout_batch_lines','รายการจ่ายเงินรายเอกสาร',true,false),
      ('TRIP','trip_run_shipments','สินค้าในเที่ยวรถและ allocation กำไร',true,false),
      ('DRIVER','drivers','พนักงานขับรถและผู้รับเหมา',false,false),
      ('FUEL','fuel_logs','บันทึกน้ำมันและต้นทุนเดินรถ',true,true),
      ('MAINTENANCE','maintenance_orders','งานซ่อมบำรุงและต้นทุนรถ',true,true),
      ('INVENTORY','inventory_locations','ตำแหน่งคลังวัสดุ/อะไหล่',false,false),
      ('REPORTING','report_snapshots','snapshot รายงานตามงวด',true,false),
      ('INTEGRATION','integration_connections','สถานะการเชื่อมต่อระบบภายนอก',true,false),
      ('APPROVAL','approval_workflows','กติกาอนุมัติ',false,false),
      ('DOCUMENT','document_reversals','เอกสาร reverse/cancel cross-module',true,true),
      ('COLLECTION','remittance_slips','ใบส่งเงินระหว่างสาขา',true,true)
  ) as x(module_code, table_name, purpose, has_snapshot, has_cancel_reverse) on x.module_code = m.code
  where m.company_id = c
  on conflict (company_id, table_name) do update
    set module_id = excluded.module_id,
        purpose = excluded.purpose,
        has_snapshot = excluded.has_snapshot,
        has_cancel_reverse = excluded.has_cancel_reverse,
        updated_at = now();
end $$;
