-- Preserve shipment item ids while an edited bill replaces its item rows.
-- Referencing load/delivery rows are checked at transaction commit, after the
-- replacement rows have been inserted.
do $$
declare
  relation_name text;
  constraint_name text;
begin
  for relation_name, constraint_name in
    select constraint_table.relname, constraint_row.conname
    from pg_constraint constraint_row
    join pg_class constraint_table
      on constraint_table.oid = constraint_row.conrelid
    join pg_namespace constraint_schema
      on constraint_schema.oid = constraint_table.relnamespace
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.shipment_items'::regclass
      and constraint_schema.nspname = 'public'
      and constraint_table.relname in (
        'load_manifest_item_lines',
        'delivery_attempt_lines'
      )
  loop
    execute format(
      'alter table public.%I alter constraint %I deferrable initially deferred',
      relation_name,
      constraint_name
    );
  end loop;
end
$$;

-- Keep the original implementation behind an authorization wrapper so only
-- owner and admin accounts can edit a bill after the vehicle has departed.
alter function private.update_reception_bill_v2(uuid, jsonb, text)
  rename to update_reception_bill_v2_impl;

revoke all on function private.update_reception_bill_v2_impl(uuid, jsonb, text)
from public, anon, authenticated;

create function private.update_reception_bill_v2(
  doc uuid,
  data jsonb,
  reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.profiles := private.require_role(array['owner', 'admin', 'clerk']);
  current_status text;
begin
  select shipment_status into current_status
  from public.shipments
  where id = doc and company_id = member.company_id;

  if current_status is null then raise exception 'ไม่พบบิล'; end if;
  if current_status <> 'RECEIVED' and member.role not in ('owner', 'admin') then
    raise exception 'บิลบันทึกรถออกแล้ว ต้องใช้บัญชีเจ้าของหรือผู้ดูแลระบบจึงจะแก้ไขได้';
  end if;

  return private.update_reception_bill_v2_impl(doc, data, reason);
end
$$;

revoke all on function private.update_reception_bill_v2(uuid, jsonb, text)
from public, anon, authenticated;
grant execute on function private.update_reception_bill_v2(uuid, jsonb, text)
to authenticated;

create or replace function public.update_reception_bill_v2(
  doc uuid,
  data jsonb,
  reason text default ''
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.update_reception_bill_v2(
    doc,
    private.normalize_reception_bill(data),
    reason
  )
$$;

revoke all on function public.update_reception_bill_v2(uuid, jsonb, text)
from public, anon;
grant execute on function public.update_reception_bill_v2(uuid, jsonb, text)
to authenticated;
