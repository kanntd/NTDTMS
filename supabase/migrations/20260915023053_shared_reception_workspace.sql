-- Connect the redesigned reception workspace to shared, normalized data.

alter table public.employees
  add column if not exists nickname text not null default '';

alter table public.price_requests
  add column if not exists bill_number text not null default '',
  add column if not exists proposed_price numeric(18,2),
  add column if not exists approved_price numeric(18,2),
  add column if not exists approval_note text not null default '';

alter table public.contract_price_versions
  add column if not exists approved_by_name text not null default '';

alter table public.shipments
  add column if not exists destination_branch_code text not null default '',
  add column if not exists opened_by_employee_id uuid references public.employees,
  add column if not exists withholding_amount numeric(18,2) not null default 0,
  add column if not exists price_pending boolean not null default false;

alter table public.shipment_items
  add column if not exists product_unit_id uuid references public.product_units,
  add column if not exists price_pending boolean not null default false,
  add column if not exists width numeric(18,4),
  add column if not exists length numeric(18,4),
  add column if not exists height numeric(18,4);

alter table public.shipments drop constraint if exists shipments_total_amount_check;
alter table public.shipments
  add constraint shipments_total_amount_check check (total_amount >= 0);
alter table public.invoices drop constraint if exists invoices_total_amount_check;
alter table public.invoices
  add constraint invoices_total_amount_check check (total_amount >= 0);

insert into public.branches(
  company_id, code, name, branch_kind, province_name, is_active
)
select id, 'SWL', 'สาขาสวรรคโลก', 'DESTINATION', 'สุโขทัย', true
from public.companies
where code = 'NTD'
on conflict (company_id, code) do update
set name = excluded.name,
    branch_kind = excluded.branch_kind,
    province_name = excluded.province_name,
    is_active = true;

create or replace function private.load_reception_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.profiles := private.require_role(array['owner','admin','clerk','accountant','viewer']);
begin
  return jsonb_build_object(
    'branches', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, code, name from public.branches
        where company_id = m.company_id and is_active
        order by code
      ) x
    ), '[]'::jsonb),
    'parties', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select p.id, p.display_name, coalesce(p.phone, '') phone,
          coalesce(p.address, '') address, p.tax_id, p.credit_limit,
          p.credit_days, p.is_active, p.prefix, p.legal_name,
          p.district, p.province, b.code default_branch_code, p.note
        from public.parties p
        left join public.branches b on b.id = p.default_branch_id
        where p.company_id = m.company_id
        order by p.display_name
      ) x
    ), '[]'::jsonb),
    'party_roles', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select party_id, role, is_active from public.party_roles
        where company_id = m.company_id
      ) x
    ), '[]'::jsonb),
    'catalog', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select u.id, u.product_family_id product_id, f.name,
          u.unit_name unit, u.default_weight weight, u.default_width width,
          u.default_length length, u.default_height height, u.is_active
        from public.product_units u
        join public.product_families f on f.id = u.product_family_id
        where u.company_id = m.company_id
        order by f.name, u.unit_name
      ) x
    ), '[]'::jsonb),
    'relations', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, receiver_id, sender_id, default_payment_mode,
          billing_cycle, credit_days, is_active, created_at, updated_at
        from public.customer_relations where company_id = m.company_id
      ) x
    ), '[]'::jsonb),
    'receiver_products', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, receiver_id, product_unit_id, is_active, created_at
        from public.receiver_product_links where company_id = m.company_id
      ) x
    ), '[]'::jsonb),
    'relation_products', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select rp.id, r.receiver_id, r.sender_id, rp.product_unit_id,
          rp.is_active, rp.created_at
        from public.customer_relation_products rp
        join public.customer_relations r on r.id = rp.customer_relation_id
        where rp.company_id = m.company_id
      ) x
    ), '[]'::jsonb),
    'agreements', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select a.id, a.receiver_id, a.sender_id, a.product_unit_id,
          a.payment_mode, b.code branch_code, a.current_version_id, a.is_active
        from public.contract_price_agreements a
        join public.branches b on b.id = a.branch_id
        where a.company_id = m.company_id
      ) x
    ), '[]'::jsonb),
    'price_versions', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, agreement_id, version_no, unit_price, effective_from,
          source, reason, created_at, approved_by_name
        from public.contract_price_versions where company_id = m.company_id
      ) x
    ), '[]'::jsonb),
    'price_requests', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select r.id, r.receiver_id, r.sender_id, r.product_unit_id,
          r.payment_mode, b.code branch_code, r.bill_number, r.quantity,
          r.proposed_price, r.approved_price, r.actual_collected_amount,
          r.status, r.resolution_type, r.requested_at, r.submitted_at,
          r.returned_at, r.return_reason, r.resolved_at, r.note,
          r.approval_note
        from public.price_requests r
        join public.branches b on b.id = r.branch_id
        where r.company_id = m.company_id
      ) x
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select e.id, e.employee_code, e.display_name, e.nickname, e.phone,
          e.position_name, b.code branch_code, e.driver_license_no,
          e.driver_license_expires_on, e.is_active
        from public.employees e
        left join public.branches b on b.id = e.home_branch_id
        where e.company_id = m.company_id
        order by e.display_name
      ) x
    ), '[]'::jsonb),
    'vehicles', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select v.id, v.vehicle_no, v.plate_no, v.vehicle_type,
          b.code branch_code, v.ownership_type, v.note, v.is_active
        from public.vehicle_assets v
        left join public.branches b on b.id = v.branch_id
        where v.company_id = m.company_id
        order by v.plate_no
      ) x
    ), '[]'::jsonb),
    'driver_assignments', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, vehicle_id, employee_id, starts_on, ends_on
        from public.vehicle_driver_assignments where company_id = m.company_id
      ) x
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select id, owner_type, coalesce(employee_id, vehicle_id) owner_id,
          document_kind, filename, mime_type, byte_size, object_key,
          expires_on, created_at
        from public.master_documents
        where company_id = m.company_id and is_active
      ) x
    ), '[]'::jsonb)
  );
end
$$;

create or replace function private.sync_reception_workspace(
  registry jsonb,
  operations jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.profiles := private.require_role(array['owner','admin']);
  row_data jsonb;
  role_entry record;
  branch_id_value uuid;
  relation_id_value uuid;
begin
  for row_data in select value from jsonb_array_elements(coalesce(registry->'parties', '[]'::jsonb))
  loop
    select id into branch_id_value from public.branches
    where company_id = m.company_id and code = nullif(row_data->>'branch_code', '');
    insert into public.parties(
      id, company_id, display_name, phone, address, tax_id, credit_limit,
      credit_days, is_active, prefix, legal_name, district, province,
      default_branch_id, note, created_by, updated_by
    ) values (
      (row_data->>'id')::uuid, m.company_id, trim(row_data->>'display_name'),
      coalesce(row_data->>'phone', ''), coalesce(row_data->>'address', ''),
      coalesce(row_data->>'tax_id', ''), coalesce((row_data->>'credit_limit')::numeric, 0),
      coalesce((row_data->>'credit_days')::integer, 30),
      coalesce((row_data->>'is_active')::boolean, true),
      coalesce(row_data->>'prefix', ''), coalesce(row_data->>'legal_name', ''),
      coalesce(row_data->>'district', ''), coalesce(row_data->>'province', ''),
      branch_id_value, coalesce(row_data->>'note', ''), m.id, m.id
    )
    on conflict (id) do update set
      display_name = excluded.display_name, phone = excluded.phone,
      address = excluded.address, tax_id = excluded.tax_id,
      credit_limit = excluded.credit_limit, credit_days = excluded.credit_days,
      is_active = excluded.is_active, prefix = excluded.prefix,
      legal_name = excluded.legal_name, district = excluded.district,
      province = excluded.province, default_branch_id = excluded.default_branch_id,
      note = excluded.note, updated_at = now(), updated_by = m.id;
  end loop;

  for role_entry in select * from jsonb_each(coalesce(registry->'party_roles', '{}'::jsonb))
  loop
    insert into public.party_roles(company_id, party_id, role, is_active, created_by, updated_by)
    values (m.company_id, role_entry.key::uuid, 'RECEIVER',
      coalesce((role_entry.value->>'receiver')::boolean, false), m.id, m.id)
    on conflict (company_id, party_id, role) do update
      set is_active = excluded.is_active, updated_at = now(), updated_by = m.id;
    insert into public.party_roles(company_id, party_id, role, is_active, created_by, updated_by)
    values (m.company_id, role_entry.key::uuid, 'SENDER',
      coalesce((role_entry.value->>'sender')::boolean, false), m.id, m.id)
    on conflict (company_id, party_id, role) do update
      set is_active = excluded.is_active, updated_at = now(), updated_by = m.id;
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(registry->'catalog', '[]'::jsonb))
  loop
    insert into public.product_families(id, company_id, name, is_active, created_by, updated_by)
    values ((row_data->>'productId')::uuid, m.company_id, trim(row_data->>'name'), true, m.id, m.id)
    on conflict (id) do update set name = excluded.name, updated_at = now(), updated_by = m.id;

    insert into public.product_units(
      id, company_id, product_family_id, unit_name, default_weight,
      default_width, default_length, default_height, is_active, created_by, updated_by
    ) values (
      (row_data->>'id')::uuid, m.company_id, (row_data->>'productId')::uuid,
      trim(row_data->>'unit'), nullif(row_data->>'weight', '')::numeric,
      nullif(row_data->>'width', '')::numeric, nullif(row_data->>'length', '')::numeric,
      nullif(row_data->>'height', '')::numeric,
      coalesce((registry->'catalogActive'->>(row_data->>'id'))::boolean, true), m.id, m.id
    )
    on conflict (id) do update set
      product_family_id = excluded.product_family_id, unit_name = excluded.unit_name,
      default_weight = excluded.default_weight, default_width = excluded.default_width,
      default_length = excluded.default_length, default_height = excluded.default_height,
      is_active = excluded.is_active, updated_at = now(), updated_by = m.id;

    insert into public.products(id, company_id, name, unit, is_active, updated_at)
    values ((row_data->>'id')::uuid, m.company_id, trim(row_data->>'name'),
      trim(row_data->>'unit'), coalesce((registry->'catalogActive'->>(row_data->>'id'))::boolean, true), now())
    on conflict (id) do update set name = excluded.name, unit = excluded.unit,
      is_active = excluded.is_active, updated_at = now();
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(operations->'relations', '[]'::jsonb))
  loop
    insert into public.customer_relations(
      id, company_id, receiver_id, sender_id, default_payment_mode,
      billing_cycle, credit_days, is_active, created_by, updated_by
    ) values (
      (row_data->>'id')::uuid, m.company_id, (row_data->>'receiverId')::uuid,
      (row_data->>'senderId')::uuid, row_data->>'defaultPayment',
      coalesce(row_data->>'billingCycle', 'MONTH_END'),
      coalesce((row_data->>'creditDays')::integer, 30),
      coalesce((row_data->>'active')::boolean, true), m.id, m.id
    )
    on conflict (id) do update set
      default_payment_mode = excluded.default_payment_mode,
      billing_cycle = excluded.billing_cycle, credit_days = excluded.credit_days,
      is_active = excluded.is_active, updated_at = now(), updated_by = m.id;
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(operations->'receiverProducts', '[]'::jsonb))
  loop
    insert into public.receiver_product_links(
      id, company_id, receiver_id, product_unit_id, is_active, created_by, updated_by
    ) values (
      (row_data->>'id')::uuid, m.company_id, (row_data->>'receiverId')::uuid,
      (row_data->>'catalogId')::uuid, coalesce((row_data->>'active')::boolean, true), m.id, m.id
    ) on conflict (id) do update set is_active = excluded.is_active,
      updated_at = now(), updated_by = m.id;
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(operations->'relationProducts', '[]'::jsonb))
  loop
    select id into relation_id_value from public.customer_relations
    where company_id = m.company_id
      and receiver_id = (row_data->>'receiverId')::uuid
      and sender_id = (row_data->>'senderId')::uuid;
    if relation_id_value is not null then
      insert into public.customer_relation_products(
        id, company_id, customer_relation_id, product_unit_id, is_active, created_by, updated_by
      ) values (
        (row_data->>'id')::uuid, m.company_id, relation_id_value,
        (row_data->>'catalogId')::uuid, coalesce((row_data->>'active')::boolean, true), m.id, m.id
      ) on conflict (id) do update set is_active = excluded.is_active,
        updated_at = now(), updated_by = m.id;
    end if;
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(operations->'agreements', '[]'::jsonb))
  loop
    select id into branch_id_value from public.branches
    where company_id = m.company_id and code = row_data->>'branch';
    insert into public.contract_price_agreements(
      id, company_id, receiver_id, sender_id, product_unit_id, branch_id,
      payment_mode, current_version_id, is_active, created_by, updated_by
    ) values (
      (row_data->>'id')::uuid, m.company_id, (row_data->>'receiverId')::uuid,
      (row_data->>'senderId')::uuid, (row_data->>'catalogId')::uuid,
      branch_id_value, row_data->>'payment', null,
      coalesce((row_data->>'active')::boolean, true), m.id, m.id
    ) on conflict (id) do update set
      payment_mode = excluded.payment_mode, branch_id = excluded.branch_id,
      is_active = excluded.is_active, updated_at = now(), updated_by = m.id;
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(operations->'priceVersions', '[]'::jsonb))
  loop
    insert into public.contract_price_versions(
      id, company_id, agreement_id, version_no, unit_price, effective_from,
      source, reason, approved_by, approved_by_name
    ) values (
      (row_data->>'id')::uuid, m.company_id, (row_data->>'agreementId')::uuid,
      (row_data->>'version')::integer, (row_data->>'price')::numeric,
      (row_data->>'effectiveFrom')::date, row_data->>'source',
      row_data->>'reason', m.id, coalesce(row_data->>'approvedBy', m.display_name)
    ) on conflict (id) do nothing;
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(operations->'agreements', '[]'::jsonb))
  loop
    update public.contract_price_agreements
    set current_version_id = nullif(row_data->>'currentVersionId', '')::uuid,
      updated_at = now(), updated_by = m.id
    where id = (row_data->>'id')::uuid and company_id = m.company_id;
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(operations->'priceRequests', '[]'::jsonb))
  loop
    select id into branch_id_value from public.branches
    where company_id = m.company_id and code = row_data->>'branch';
    insert into public.price_requests(
      id, company_id, receiver_id, sender_id, product_unit_id, branch_id,
      payment_mode, bill_number, quantity, proposed_price, approved_price,
      actual_collected_amount, status, resolution_type, note, requested_at,
      submitted_at, returned_at, return_reason, resolved_at, requested_by,
      submitted_by, returned_by, resolved_by, approval_note
    ) values (
      (row_data->>'id')::uuid, m.company_id, (row_data->>'receiverId')::uuid,
      (row_data->>'senderId')::uuid, (row_data->>'catalogId')::uuid,
      branch_id_value, row_data->>'payment', coalesce(row_data->>'billNumber', ''),
      coalesce((row_data->>'quantity')::numeric, 1),
      nullif(row_data->>'proposedPrice', '')::numeric,
      nullif(row_data->>'approvedPrice', '')::numeric,
      nullif(row_data->>'actualCollectedAmount', '')::numeric,
      row_data->>'status', nullif(row_data->>'resolutionType', ''),
      coalesce(row_data->>'note', ''), (row_data->>'requestedAt')::timestamptz,
      nullif(row_data->>'submittedAt', '')::timestamptz,
      nullif(row_data->>'returnedAt', '')::timestamptz,
      nullif(row_data->>'returnReason', ''), nullif(row_data->>'resolvedAt', '')::timestamptz,
      m.id,
      case when nullif(row_data->>'submittedAt', '') is null then null else m.id end,
      case when nullif(row_data->>'returnedAt', '') is null then null else m.id end,
      case when nullif(row_data->>'resolvedAt', '') is null then null else m.id end,
      coalesce(row_data->>'approvalNote', '')
    ) on conflict (id) do update set
      proposed_price = excluded.proposed_price, approved_price = excluded.approved_price,
      actual_collected_amount = excluded.actual_collected_amount,
      status = excluded.status, resolution_type = excluded.resolution_type,
      note = excluded.note, submitted_at = excluded.submitted_at,
      submitted_by = excluded.submitted_by, returned_at = excluded.returned_at,
      returned_by = excluded.returned_by, return_reason = excluded.return_reason,
      resolved_at = excluded.resolved_at, resolved_by = excluded.resolved_by,
      approval_note = excluded.approval_note;
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(operations->'employees', '[]'::jsonb))
  loop
    select id into branch_id_value from public.branches
    where company_id = m.company_id and code = row_data->>'branch';
    insert into public.employees(
      id, company_id, home_branch_id, employee_code, display_name, nickname,
      phone, position_name, driver_license_no, driver_license_expires_on,
      is_active, created_by, updated_by
    ) values (
      (row_data->>'id')::uuid, m.company_id, branch_id_value,
      coalesce(row_data->>'code', ''), trim(row_data->>'name'),
      coalesce(row_data->>'nickname', ''), coalesce(row_data->>'phone', ''),
      coalesce(row_data->>'position', ''), coalesce(row_data->>'licenseNo', ''),
      nullif(row_data->>'licenseExpiry', '')::date,
      coalesce((row_data->>'active')::boolean, true), m.id, m.id
    ) on conflict (id) do update set
      home_branch_id = excluded.home_branch_id, employee_code = excluded.employee_code,
      display_name = excluded.display_name, nickname = excluded.nickname,
      phone = excluded.phone, position_name = excluded.position_name,
      driver_license_no = excluded.driver_license_no,
      driver_license_expires_on = excluded.driver_license_expires_on,
      is_active = excluded.is_active, updated_at = now(), updated_by = m.id;
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(operations->'vehicles', '[]'::jsonb))
  loop
    select id into branch_id_value from public.branches
    where company_id = m.company_id and code = row_data->>'branch';
    insert into public.vehicle_assets(
      id, company_id, branch_id, vehicle_no, plate_no, vehicle_type,
      ownership_type, note, is_active, created_by, updated_by
    ) values (
      (row_data->>'id')::uuid, m.company_id, branch_id_value,
      coalesce(row_data->>'internalNo', ''), trim(row_data->>'plateNo'),
      coalesce(row_data->>'vehicleType', ''), row_data->>'ownership',
      coalesce(row_data->>'note', ''), coalesce((row_data->>'active')::boolean, true), m.id, m.id
    ) on conflict (id) do update set
      branch_id = excluded.branch_id, vehicle_no = excluded.vehicle_no,
      plate_no = excluded.plate_no, vehicle_type = excluded.vehicle_type,
      ownership_type = excluded.ownership_type, note = excluded.note,
      is_active = excluded.is_active, updated_at = now(), updated_by = m.id;
  end loop;

  for row_data in select value from jsonb_array_elements(coalesce(operations->'driverAssignments', '[]'::jsonb))
  loop
    insert into public.vehicle_driver_assignments(
      id, company_id, vehicle_id, employee_id, starts_on, ends_on, created_by
    ) values (
      (row_data->>'id')::uuid, m.company_id, (row_data->>'vehicleId')::uuid,
      (row_data->>'employeeId')::uuid, (row_data->>'startsAt')::date,
      nullif(row_data->>'endsAt', '')::date, m.id
    ) on conflict (id) do update set ends_on = excluded.ends_on;
  end loop;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, record_id, detail)
  values (m.company_id, m.id, 'SYNC', 'reception_workspace', m.company_id,
    jsonb_build_object('parties', jsonb_array_length(coalesce(registry->'parties', '[]'::jsonb)),
      'employees', jsonb_array_length(coalesce(operations->'employees', '[]'::jsonb))));
end
$$;

revoke all on function private.load_reception_workspace() from public, anon, authenticated;
revoke all on function private.sync_reception_workspace(jsonb, jsonb) from public, anon, authenticated;
grant execute on function private.load_reception_workspace() to authenticated;
grant execute on function private.sync_reception_workspace(jsonb, jsonb) to authenticated;

create or replace function public.load_reception_workspace()
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.load_reception_workspace() $$;

create or replace function public.sync_reception_workspace(registry jsonb, operations jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.sync_reception_workspace(registry, operations) $$;

revoke all on function public.load_reception_workspace() from public, anon;
revoke all on function public.sync_reception_workspace(jsonb, jsonb) from public, anon;
grant execute on function public.load_reception_workspace() to authenticated;
grant execute on function public.sync_reception_workspace(jsonb, jsonb) to authenticated;

create or replace function private.issue_reception_bill_v2(data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.profiles := private.require_role(array['owner','admin','clerk']);
  existing public.shipments;
  sender public.parties;
  receiver public.parties;
  destination_branch public.branches;
  zone_row public.service_zones;
  district_row public.districts;
  employee_id_value uuid;
  payer_id uuid;
  shipment_id_value uuid;
  shipment_item_id_value uuid;
  agreement_id_value uuid;
  price_version_id_value uuid;
  line_data jsonb;
  bill_no text;
  item_no integer := 0;
  quantity_value numeric;
  price_value numeric;
  subtotal_value numeric := 0;
  total_quantity_value numeric := 0;
  total_weight_value numeric := 0;
  discount_value numeric := coalesce((data->>'discount')::numeric, 0);
  withholding_value numeric := coalesce((data->>'withholding_amount')::numeric, 0);
  total_value numeric;
  due_value numeric;
  pending_value boolean := false;
  payment_value text := data->>'payment_mode';
  credit_days_value integer := coalesce((data->>'credit_days')::integer, 0);
begin
  select * into existing from public.shipments
  where company_id = m.company_id and request_id = (data->>'id')::uuid;
  if found then
    return jsonb_build_object('id', existing.id, 'number', existing.shipment_no);
  end if;

  select * into sender from public.parties
  where id = (data->>'sender_id')::uuid and company_id = m.company_id and is_active;
  select * into receiver from public.parties
  where id = (data->>'receiver_id')::uuid and company_id = m.company_id and is_active;
  if sender.id is null or receiver.id is null then
    raise exception 'ไม่พบผู้รับหรือผู้ส่งในข้อมูลกลาง';
  end if;

  select * into destination_branch from public.branches
  where company_id = m.company_id and code = data->>'destination_branch_code' and is_active;
  if destination_branch.id is null then raise exception 'ไม่พบสาขาปลายทาง'; end if;

  if destination_branch.code = 'SWL' then
    select * into zone_row from public.service_zones
    where company_id = m.company_id and code = 'STI' and is_active;
    select * into district_row from public.districts
    where zone_id = zone_row.id and name = 'สวรรคโลก' and is_active;
  else
    select * into zone_row from public.service_zones
    where company_id = m.company_id and code = destination_branch.code and is_active;
    select * into district_row from public.districts
    where zone_id = zone_row.id and is_active
      and name = nullif(receiver.district, '');
    if district_row.id is null then
      select * into district_row from public.districts
      where zone_id = zone_row.id and is_active order by name limit 1;
    end if;
  end if;
  if zone_row.id is null or district_row.id is null then
    raise exception 'ยังไม่ได้ตั้งค่าพื้นที่ปลายทาง';
  end if;

  if payment_value not in ('CASH_ORIGIN','CASH_DESTINATION','CREDIT_ORIGIN','CREDIT_DESTINATION') then
    raise exception 'ประเภทการชำระเงินไม่ถูกต้อง';
  end if;
  if payment_value not like 'CREDIT%' then credit_days_value := 0; end if;
  if payment_value like 'CREDIT%' and credit_days_value <= 0 then credit_days_value := 30; end if;

  if jsonb_array_length(coalesce(data->'items', '[]'::jsonb)) = 0 then
    raise exception 'ต้องมีสินค้าอย่างน้อย 1 รายการ';
  end if;
  for line_data in select value from jsonb_array_elements(data->'items')
  loop
    quantity_value := (line_data->>'quantity')::numeric;
    price_value := coalesce((line_data->>'price')::numeric, 0);
    if quantity_value <= 0 or price_value < 0 then raise exception 'จำนวนหรือราคาไม่ถูกต้อง'; end if;
    if not exists (
      select 1 from public.product_units
      where id = (line_data->>'catalog_id')::uuid and company_id = m.company_id and is_active
    ) then raise exception 'ไม่พบสินค้าในข้อมูลกลาง'; end if;
    subtotal_value := subtotal_value + round(quantity_value * price_value, 2);
    total_quantity_value := total_quantity_value + quantity_value;
    total_weight_value := total_weight_value + coalesce((line_data->>'weight')::numeric, 0);
    pending_value := pending_value or coalesce((line_data->>'request_price')::boolean, false);
  end loop;

  total_value := subtotal_value - discount_value;
  due_value := total_value - withholding_value + coalesce((data->>'rounding')::numeric, 0);
  if total_value < 0 or due_value < 0 then raise exception 'ยอดบิลไม่ถูกต้อง'; end if;

  employee_id_value := nullif(data->>'opened_by_employee_id', '')::uuid;
  if employee_id_value is not null and not exists (
    select 1 from public.employees where id = employee_id_value and company_id = m.company_id
  ) then employee_id_value := null; end if;

  payer_id := case when payment_value like '%ORIGIN' then sender.id else receiver.id end;
  bill_no := private.next_number(m.branch_id, 'NTD');
  insert into public.shipments(
    company_id, branch_id, request_id, shipment_no, sender_party_id,
    receiver_party_id, payer_party_id, sender_snapshot, receiver_snapshot,
    zone_id, district_id, zone_name, district_name, zone_color, payment_mode,
    credit_days, total_quantity, total_weight, subtotal, extra_charge,
    discount, total_amount, note, price_reason, created_by,
    destination_branch_code, opened_by_employee_id, withholding_amount,
    price_pending
  ) values (
    m.company_id, m.branch_id, (data->>'id')::uuid, bill_no, sender.id,
    receiver.id, payer_id, to_jsonb(sender), to_jsonb(receiver), zone_row.id,
    district_row.id, zone_row.name, district_row.name, zone_row.color,
    payment_value, credit_days_value, total_quantity_value, total_weight_value,
    subtotal_value, 0, discount_value, total_value, coalesce(data->>'note', ''),
    coalesce(data->>'discount_reason', ''), m.id,
    destination_branch.code, employee_id_value, withholding_value, pending_value
  ) returning id into shipment_id_value;

  insert into public.customer_relations(
    company_id, receiver_id, sender_id, default_payment_mode, billing_cycle,
    credit_days, is_active, created_by, updated_by
  ) values (
    m.company_id, receiver.id, sender.id, payment_value,
    coalesce(data->>'billing_cycle', 'MONTH_END'), credit_days_value,
    true, m.id, m.id
  ) on conflict (company_id, receiver_id, sender_id) do update set
    default_payment_mode = excluded.default_payment_mode,
    billing_cycle = excluded.billing_cycle, credit_days = excluded.credit_days,
    is_active = true, updated_at = now(), updated_by = m.id;

  for line_data in select value from jsonb_array_elements(data->'items')
  loop
    item_no := item_no + 1;
    quantity_value := (line_data->>'quantity')::numeric;
    price_value := coalesce((line_data->>'price')::numeric, 0);
    insert into public.shipment_items(
      id, shipment_id, line_no, product_id, product_unit_id, description,
      quantity, unit, unit_price, weight, price_pending, width, length, height
    ) values (
      (line_data->>'id')::uuid, shipment_id_value, item_no,
      (line_data->>'catalog_id')::uuid, (line_data->>'catalog_id')::uuid,
      trim(line_data->>'name'), quantity_value, trim(line_data->>'unit'),
      price_value, coalesce((line_data->>'weight')::numeric, 0),
      coalesce((line_data->>'request_price')::boolean, false),
      nullif(line_data->>'width', '')::numeric,
      nullif(line_data->>'length', '')::numeric,
      nullif(line_data->>'height', '')::numeric
    ) returning id into shipment_item_id_value;

    insert into public.receiver_product_links(
      company_id, receiver_id, product_unit_id, is_active, created_by, updated_by
    ) values (m.company_id, receiver.id, (line_data->>'catalog_id')::uuid, true, m.id, m.id)
    on conflict (company_id, receiver_id, product_unit_id) do update
      set is_active = true, updated_at = now(), updated_by = m.id;

    select id into agreement_id_value from public.customer_relations
    where company_id = m.company_id and receiver_id = receiver.id and sender_id = sender.id;
    insert into public.customer_relation_products(
      company_id, customer_relation_id, product_unit_id, is_active, created_by, updated_by
    ) values (m.company_id, agreement_id_value, (line_data->>'catalog_id')::uuid, true, m.id, m.id)
    on conflict (company_id, customer_relation_id, product_unit_id) do update
      set is_active = true, updated_at = now(), updated_by = m.id;

    if coalesce((line_data->>'request_price')::boolean, false) then
      insert into public.price_requests(
        company_id, shipment_id, shipment_item_id, receiver_id, sender_id,
        product_unit_id, branch_id, payment_mode, bill_number, quantity,
        status, note, requested_by
      ) values (
        m.company_id, shipment_id_value, shipment_item_id_value, receiver.id,
        sender.id, (line_data->>'catalog_id')::uuid, destination_branch.id,
        payment_value, bill_no, quantity_value, 'PENDING_PRICE',
        'ต้นทางไม่ได้ระบุราคา', m.id
      );
    else
      select id, current_version_id into agreement_id_value, price_version_id_value
      from public.contract_price_agreements
      where company_id = m.company_id and receiver_id = receiver.id
        and sender_id = sender.id and product_unit_id = (line_data->>'catalog_id')::uuid
        and branch_id = destination_branch.id and payment_mode = payment_value;
      if agreement_id_value is null then
        insert into public.contract_price_agreements(
          company_id, receiver_id, sender_id, product_unit_id, branch_id,
          payment_mode, is_active, created_by, updated_by
        ) values (
          m.company_id, receiver.id, sender.id, (line_data->>'catalog_id')::uuid,
          destination_branch.id, payment_value, true, m.id, m.id
        ) returning id into agreement_id_value;
        price_version_id_value := null;
      end if;
      if price_version_id_value is null then
        insert into public.contract_price_versions(
          company_id, agreement_id, version_no, unit_price, source, reason,
          approved_by, approved_by_name
        ) values (
          m.company_id, agreement_id_value, 1, price_value, 'INITIAL',
          'ราคาที่ต้นทางระบุครั้งแรก', m.id, m.display_name
        ) returning id into price_version_id_value;
        update public.contract_price_agreements
        set current_version_id = price_version_id_value, updated_at = now(), updated_by = m.id
        where id = agreement_id_value;
      end if;
    end if;
  end loop;

  insert into public.shipment_stops(shipment_id, sequence, kind, contact_snapshot)
  values (shipment_id_value, 1, 'PICKUP', to_jsonb(sender)),
    (shipment_id_value, 2, 'DELIVERY', to_jsonb(receiver));

  insert into public.invoices(
    shipment_id, invoice_no, payer_party_id, total_amount, due_date
  ) values (
    shipment_id_value, private.next_number(m.branch_id, 'INV'), payer_id,
    due_value,
    case
      when nullif(data->>'billing_period_end', '') is not null
        then (data->>'billing_period_end')::date
      else (now() at time zone 'Asia/Bangkok')::date + credit_days_value
    end
  );

  if coalesce((data->>'collect_now')::boolean, false) and due_value > 0 then
    if payment_value <> 'CASH_ORIGIN' then raise exception 'รับเงินทันทีได้เฉพาะเงินสดต้นทาง'; end if;
    perform private.receive_payment(shipment_id_value, due_value, 'CASH', '', (data->>'id')::uuid);
  end if;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, record_id, detail)
  values (m.company_id, m.id, 'ISSUE', 'shipment', shipment_id_value,
    jsonb_build_object('shipment_no', bill_no, 'price_pending', pending_value));
  return jsonb_build_object('id', shipment_id_value, 'number', bill_no);
end
$$;

revoke all on function private.issue_reception_bill_v2(jsonb) from public, anon, authenticated;
grant execute on function private.issue_reception_bill_v2(jsonb) to authenticated;

create or replace function public.issue_reception_bill_v2(data jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.issue_reception_bill_v2(data) $$;

revoke all on function public.issue_reception_bill_v2(jsonb) from public, anon;
grant execute on function public.issue_reception_bill_v2(jsonb) to authenticated;

drop view if exists public.shipment_register;
create view public.shipment_register
with (security_invoker = true)
as
select s.*, i.id invoice_id, i.due_date,
  coalesce(a.paid, 0)::numeric(18,2) paid_amount,
  case when s.shipment_status = 'CANCELLED' then 0
    else greatest(i.total_amount - coalesce(a.paid, 0), 0)
  end::numeric(18,2) outstanding_amount
from public.shipments s
join public.invoices i on i.shipment_id = s.id
left join (
  select invoice_id, sum(amount) paid
  from public.payment_allocations group by invoice_id
) a on a.invoice_id = i.id;

revoke all on public.shipment_register from anon;
grant select on public.shipment_register to authenticated;
