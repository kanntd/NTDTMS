create or replace function private.blank_numeric_fields_to_null(record_data jsonb, field_names text[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  field_name text;
  result jsonb := record_data;
begin
  foreach field_name in array field_names
  loop
    if result ? field_name and btrim(coalesce(result->>field_name, '')) = '' then
      result := jsonb_set(result, array[field_name], 'null'::jsonb);
    end if;
  end loop;
  return result;
end
$$;

create or replace function private.normalize_numeric_records(records jsonb, field_names text[])
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
    normalized := normalized || jsonb_build_array(
      private.blank_numeric_fields_to_null(record_data, field_names)
    );
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
  result := jsonb_set(result, '{parties}',
    private.normalize_numeric_records(result->'parties', array['credit_limit'])
  );
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
  result := jsonb_set(result, '{priceRequests}',
    private.normalize_numeric_records(result->'priceRequests', array['quantity'])
  );
  return result;
end
$$;

create or replace function private.normalize_reception_bill(data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  result := private.blank_numeric_fields_to_null(data,
    array['credit_days', 'discount', 'withholding_amount', 'rounding']
  );
  result := jsonb_set(result, '{items}',
    private.normalize_numeric_records(
      private.normalize_workspace_records(result->'items', 'catalog_id'),
      array['price', 'weight', 'width', 'length', 'height']
    )
  );
  return result;
end
$$;

revoke all on function private.blank_numeric_fields_to_null(jsonb, text[]) from public, anon;
revoke all on function private.normalize_numeric_records(jsonb, text[]) from public, anon;
grant execute on function private.blank_numeric_fields_to_null(jsonb, text[]) to authenticated;
grant execute on function private.normalize_numeric_records(jsonb, text[]) to authenticated;
