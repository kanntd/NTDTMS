create or replace function private.workspace_product_uuid(value text)
returns uuid
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
begin
  if value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return value::uuid;
  end if;
  if value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:.+$' then
    return md5(value)::uuid;
  end if;
  raise exception 'Invalid product identifier' using errcode = '22P02';
end
$$;

create or replace function private.normalize_workspace_records(records jsonb, id_field text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  record_data jsonb;
  normalized jsonb := '[]'::jsonb;
begin
  for record_data in select value from jsonb_array_elements(coalesce(records, '[]'::jsonb))
  loop
    if record_data ? id_field and nullif(record_data->>id_field, '') is not null then
      record_data := jsonb_set(
        record_data, array[id_field],
        to_jsonb(private.workspace_product_uuid(record_data->>id_field)::text)
      );
    end if;
    normalized := normalized || jsonb_build_array(record_data);
  end loop;
  return normalized;
end
$$;

create or replace function private.normalize_reception_registry(registry jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_entry record;
  active_map jsonb := '{}'::jsonb;
  result jsonb := coalesce(registry, '{}'::jsonb);
begin
  result := jsonb_set(result, '{catalog}',
    private.normalize_workspace_records(
      private.normalize_workspace_records(result->'catalog', 'id'), 'productId'
    )
  );
  for active_entry in select * from jsonb_each(coalesce(result->'catalogActive', '{}'::jsonb))
  loop
    active_map := jsonb_set(active_map,
      array[private.workspace_product_uuid(active_entry.key)::text], active_entry.value
    );
  end loop;
  return jsonb_set(result, '{catalogActive}', active_map);
end
$$;

create or replace function private.normalize_reception_operations(operations jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  field_name text;
  result jsonb := coalesce(operations, '{}'::jsonb);
begin
  foreach field_name in array array['receiverProducts', 'relationProducts', 'agreements', 'priceRequests']
  loop
    result := jsonb_set(result, array[field_name],
      private.normalize_workspace_records(result->field_name, 'catalogId')
    );
  end loop;
  return result;
end
$$;

create or replace function private.normalize_reception_bill(data jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_set(data, '{items}',
    private.normalize_workspace_records(data->'items', 'catalog_id'))
$$;

revoke all on function private.workspace_product_uuid(text) from public, anon;
revoke all on function private.normalize_workspace_records(jsonb, text) from public, anon;
revoke all on function private.normalize_reception_registry(jsonb) from public, anon;
revoke all on function private.normalize_reception_operations(jsonb) from public, anon;
revoke all on function private.normalize_reception_bill(jsonb) from public, anon;
grant execute on function private.workspace_product_uuid(text) to authenticated;
grant execute on function private.normalize_workspace_records(jsonb, text) to authenticated;
grant execute on function private.normalize_reception_registry(jsonb) to authenticated;
grant execute on function private.normalize_reception_operations(jsonb) to authenticated;
grant execute on function private.normalize_reception_bill(jsonb) to authenticated;

create or replace function public.sync_reception_workspace(registry jsonb, operations jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.sync_reception_workspace(
    private.normalize_reception_registry(registry),
    private.normalize_reception_operations(operations)
  )
$$;

create or replace function public.issue_reception_bill_v2(data jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.issue_reception_bill_v2(private.normalize_reception_bill(data)) $$;
