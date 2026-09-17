-- Foundation tables for the search and bill-tracking module.

create table if not exists public.load_manifests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  origin_branch_id uuid references public.branches,
  destination_branch_id uuid references public.branches,
  trip_run_id uuid references public.trip_runs,
  vehicle_id uuid references public.vehicle_assets,
  driver_employee_id uuid references public.employees,
  manifest_no text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'LOADED', 'DEPARTED', 'RECEIVED', 'CANCELLED')),
  loaded_at timestamptz,
  departed_at timestamptz,
  received_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users,
  updated_by uuid references auth.users,
  unique (company_id, manifest_no)
);

create table if not exists public.load_manifest_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  manifest_id uuid not null references public.load_manifests,
  shipment_id uuid not null references public.shipments,
  line_no integer not null,
  loaded_at timestamptz not null default now(),
  unloaded_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users,
  unique (manifest_id, line_no),
  unique (manifest_id, shipment_id)
);

create table if not exists public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  shipment_id uuid not null references public.shipments,
  attempt_no integer not null,
  attempted_at timestamptz not null default now(),
  result text not null
    check (result in ('DELIVERED', 'CUSTOMER_ABSENT', 'REFUSED', 'DAMAGED', 'RESCHEDULED', 'OTHER')),
  receiver_name text not null default '',
  receiver_phone text not null default '',
  collected_amount numeric(18,2) not null default 0 check (collected_amount >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users,
  unique (shipment_id, attempt_no)
);

create table if not exists public.shipment_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies,
  shipment_id uuid not null references public.shipments,
  event_type text not null
    check (event_type in ('CREATED', 'EDITED', 'LOADED', 'DEPARTED', 'ARRIVED_BRANCH', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PAYMENT_COLLECTED', 'CANCELLED')),
  event_at timestamptz not null default now(),
  branch_id uuid references public.branches,
  manifest_id uuid references public.load_manifests,
  detail jsonb not null default '{}',
  created_by uuid not null references auth.users
);

create table if not exists public.bill_revisions (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies,
  shipment_id uuid not null references public.shipments,
  revision_no integer not null,
  reason text not null,
  before_data jsonb not null,
  after_data jsonb not null,
  revised_at timestamptz not null default now(),
  revised_by uuid not null references auth.users,
  unique (shipment_id, revision_no)
);

create table if not exists public.print_logs (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies,
  shipment_id uuid not null references public.shipments,
  document_type text not null default 'RECEIPT'
    check (document_type in ('RECEIPT', 'DELIVERY_NOTE', 'COPY')),
  printed_at timestamptz not null default now(),
  printed_by uuid not null references auth.users
);

create index if not exists load_manifests_company_date
  on public.load_manifests(company_id, loaded_at desc);
create index if not exists load_manifest_items_shipment
  on public.load_manifest_items(shipment_id, loaded_at desc)
  where is_active;
create index if not exists delivery_attempts_shipment
  on public.delivery_attempts(shipment_id, attempted_at desc);
create index if not exists shipment_events_timeline
  on public.shipment_events(shipment_id, event_at desc);
create index if not exists bill_revisions_shipment
  on public.bill_revisions(shipment_id, revision_no desc);
create index if not exists print_logs_shipment
  on public.print_logs(shipment_id, printed_at desc);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'load_manifests',
    'load_manifest_items',
    'delivery_attempts',
    'shipment_events',
    'bill_revisions',
    'print_logs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end $$;

create policy "members read load manifests"
  on public.load_manifests for select to authenticated
  using (company_id = (select (private.member()).company_id));
create policy "members read load manifest items"
  on public.load_manifest_items for select to authenticated
  using (company_id = (select (private.member()).company_id));
create policy "members read delivery attempts"
  on public.delivery_attempts for select to authenticated
  using (company_id = (select (private.member()).company_id));
create policy "members read shipment events"
  on public.shipment_events for select to authenticated
  using (company_id = (select (private.member()).company_id));
create policy "members read bill revisions"
  on public.bill_revisions for select to authenticated
  using (company_id = (select (private.member()).company_id));
create policy "members read print logs"
  on public.print_logs for select to authenticated
  using (company_id = (select (private.member()).company_id));
