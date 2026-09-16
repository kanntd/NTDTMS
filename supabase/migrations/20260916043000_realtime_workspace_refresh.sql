-- Notify every signed-in workstation when shared company data changes.

create table if not exists public.workspace_revisions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  revision bigint not null default 0,
  changed_at timestamptz not null default now()
);

alter table public.workspace_revisions enable row level security;
grant select on public.workspace_revisions to authenticated;

drop policy if exists member_workspace_revisions on public.workspace_revisions;
create policy member_workspace_revisions
on public.workspace_revisions
for select
to authenticated
using (company_id = (select (private.member()).company_id));

insert into public.workspace_revisions(company_id)
select id from public.companies
on conflict (company_id) do nothing;

create or replace function private.bump_workspace_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_data jsonb;
  company_id_value uuid;
begin
  record_data := case
    when tg_op = 'DELETE' then to_jsonb(old)
    else to_jsonb(new)
  end;
  company_id_value := nullif(record_data->>'company_id', '')::uuid;

  if company_id_value is null and tg_table_name = 'districts' then
    select zone.company_id into company_id_value
    from public.service_zones as zone
    where zone.id = nullif(record_data->>'zone_id', '')::uuid;
  elsif company_id_value is null and tg_table_name in (
    'shipment_items', 'shipment_stops', 'invoices', 'payments',
    'shipment_files'
  ) then
    select shipment.company_id into company_id_value
    from public.shipments as shipment
    where shipment.id = nullif(record_data->>'shipment_id', '')::uuid;
  elsif company_id_value is null and tg_table_name = 'payment_allocations' then
    select shipment.company_id into company_id_value
    from public.payments as payment
    join public.shipments as shipment on shipment.id = payment.shipment_id
    where payment.id = nullif(record_data->>'payment_id', '')::uuid;
  end if;

  if company_id_value is not null then
    insert into public.workspace_revisions(company_id, revision, changed_at)
    values (company_id_value, 1, now())
    on conflict (company_id) do update
      set revision = public.workspace_revisions.revision + 1,
          changed_at = excluded.changed_at;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'branches',
    'profiles',
    'staff_invites',
    'service_zones',
    'districts',
    'parties',
    'products',
    'price_rules',
    'shipments',
    'shipment_items',
    'shipment_stops',
    'invoices',
    'payments',
    'payment_allocations',
    'shipment_files',
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
    'vehicle_assets',
    'vehicle_driver_assignments',
    'master_documents'
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

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_revisions'
  ) then
    alter publication supabase_realtime add table public.workspace_revisions;
  end if;
end
$$;
