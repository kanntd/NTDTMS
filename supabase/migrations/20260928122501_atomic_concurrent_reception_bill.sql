-- Issue a bill together with only the master-data rows used by that bill.
-- Natural-key upserts make concurrent creation of the same product safe and
-- avoid syncing the company's entire reception workspace before every bill.

create or replace function private.issue_reception_bill_atomic(
  data jsonb,
  receiver_data jsonb,
  sender_data jsonb,
  catalog_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.profiles := private.require_role(array['owner', 'admin', 'clerk']);
  party_data jsonb;
  party_role text;
  party_branch_id uuid;
  catalog_row jsonb;
  item_row jsonb;
  family_id uuid;
  unit_id uuid;
  source_catalog_id text;
  catalog_map jsonb := '{}'::jsonb;
  normalized_items jsonb := '[]'::jsonb;
  issued jsonb;
begin
  if receiver_data is null or sender_data is null then
    raise exception 'กรุณาระบุผู้รับและผู้ส่ง';
  end if;

  for party_data, party_role in
    select value->'party', value->>'role'
    from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('party', receiver_data, 'role', 'RECEIVER'),
      jsonb_build_object('party', sender_data, 'role', 'SENDER')
    ))
  loop
    select id into party_branch_id
    from public.branches
    where company_id = member.company_id
      and code = nullif(party_data->>'branch_code', '');

    insert into public.parties(
      id, company_id, display_name, phone, address, tax_id, credit_limit,
      credit_days, is_active, prefix, legal_name, district, province,
      default_branch_id, note, created_by, updated_by
    ) values (
      (party_data->>'id')::uuid, member.company_id,
      trim(party_data->>'display_name'), nullif(party_data->>'phone', ''),
      nullif(party_data->>'address', ''), coalesce(party_data->>'tax_id', ''),
      coalesce(nullif(party_data->>'credit_limit', '')::numeric, 0),
      coalesce(nullif(party_data->>'credit_days', '')::integer, 30),
      coalesce((party_data->>'is_active')::boolean, true),
      coalesce(party_data->>'prefix', ''),
      coalesce(party_data->>'legal_name', ''),
      coalesce(party_data->>'district', ''),
      coalesce(party_data->>'province', ''), party_branch_id,
      coalesce(party_data->>'note', ''), member.id, member.id
    )
    on conflict (id) do update set
      display_name = excluded.display_name,
      phone = excluded.phone,
      address = excluded.address,
      tax_id = excluded.tax_id,
      credit_limit = excluded.credit_limit,
      credit_days = excluded.credit_days,
      is_active = excluded.is_active,
      prefix = excluded.prefix,
      legal_name = excluded.legal_name,
      district = excluded.district,
      province = excluded.province,
      default_branch_id = excluded.default_branch_id,
      note = excluded.note,
      updated_at = now(),
      updated_by = member.id;

    insert into public.party_roles(
      company_id, party_id, role, is_active, created_by, updated_by
    ) values (
      member.company_id, (party_data->>'id')::uuid, party_role,
      true, member.id, member.id
    )
    on conflict (company_id, party_id, role) do update
      set is_active = true, updated_at = now(), updated_by = member.id;
  end loop;

  for catalog_row in
    select value
    from jsonb_array_elements(coalesce(catalog_data, '[]'::jsonb))
  loop
    source_catalog_id := catalog_row->>'id';

    insert into public.product_families(
      id, company_id, name, is_active, created_by, updated_by
    ) values (
      private.workspace_product_uuid(catalog_row->>'productId'),
      member.company_id, trim(catalog_row->>'name'), true,
      member.id, member.id
    )
    on conflict (company_id, name) do update
      set is_active = true, updated_at = now(), updated_by = member.id
    returning id into family_id;

    insert into public.product_units(
      id, company_id, product_family_id, unit_name, default_weight,
      default_width, default_length, default_height, is_active,
      created_by, updated_by
    ) values (
      private.workspace_product_uuid(source_catalog_id), member.company_id,
      family_id, trim(catalog_row->>'unit'),
      nullif(catalog_row->>'weight', '')::numeric,
      nullif(catalog_row->>'width', '')::numeric,
      nullif(catalog_row->>'length', '')::numeric,
      nullif(catalog_row->>'height', '')::numeric,
      true, member.id, member.id
    )
    on conflict (company_id, product_family_id, unit_name) do update set
      default_weight = coalesce(excluded.default_weight, public.product_units.default_weight),
      default_width = coalesce(excluded.default_width, public.product_units.default_width),
      default_length = coalesce(excluded.default_length, public.product_units.default_length),
      default_height = coalesce(excluded.default_height, public.product_units.default_height),
      is_active = true, updated_at = now(), updated_by = member.id
    returning id into unit_id;

    insert into public.products(id, company_id, name, unit, is_active, updated_at)
    values (
      unit_id, member.company_id, trim(catalog_row->>'name'),
      trim(catalog_row->>'unit'), true, now()
    )
    on conflict (company_id, name, unit) do update
      set is_active = true, updated_at = now();

    catalog_map := jsonb_set(
      catalog_map,
      array[private.workspace_product_uuid(source_catalog_id)::text],
      to_jsonb(unit_id::text)
    );
  end loop;

  for item_row in
    select value from jsonb_array_elements(coalesce(data->'items', '[]'::jsonb))
  loop
    source_catalog_id := private.workspace_product_uuid(item_row->>'catalog_id')::text;
    unit_id := nullif(catalog_map->>source_catalog_id, '')::uuid;
    if unit_id is null then
      select id into unit_id
      from public.product_units
      where id = source_catalog_id::uuid
        and company_id = member.company_id
        and is_active;
    end if;
    if unit_id is null then
      raise exception 'ไม่พบสินค้า % ในข้อมูลกลาง', coalesce(item_row->>'name', '');
    end if;
    normalized_items := normalized_items || jsonb_build_array(
      jsonb_set(item_row, '{catalog_id}', to_jsonb(unit_id::text))
    );
  end loop;

  issued := private.issue_reception_bill_with_payment(
    jsonb_set(data, '{items}', normalized_items)
  );
  return issued || jsonb_build_object('catalog_map', catalog_map);
end
$$;

revoke all on function private.issue_reception_bill_atomic(jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function private.issue_reception_bill_atomic(jsonb, jsonb, jsonb, jsonb)
  to authenticated;

create or replace function public.issue_reception_bill_v3(
  data jsonb,
  receiver_data jsonb,
  sender_data jsonb,
  catalog_data jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.issue_reception_bill_atomic(
    private.normalize_reception_bill(data),
    receiver_data,
    sender_data,
    catalog_data
  )
$$;

revoke all on function public.issue_reception_bill_v3(jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.issue_reception_bill_v3(jsonb, jsonb, jsonb, jsonb)
  to authenticated;
