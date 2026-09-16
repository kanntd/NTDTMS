-- A single business action can touch many rows. Emit one refresh per company
-- and transaction so connected workstations do not reload repeatedly.

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

  if company_id_value is not null
    and current_setting('ntdtms.workspace_revision_company', true)
      is distinct from company_id_value::text
  then
    perform set_config(
      'ntdtms.workspace_revision_company',
      company_id_value::text,
      true
    );
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
