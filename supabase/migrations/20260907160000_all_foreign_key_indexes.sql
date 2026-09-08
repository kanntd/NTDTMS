do $$
declare
  row record;
begin
  for row in
    select
      r.relname as table_name,
      left(r.relname || '_' || c.conname || '_idx', 63) as index_name,
      string_agg(quote_ident(a.attname), ', ' order by ord.n) as columns_sql
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    join unnest(c.conkey) with ordinality as ord(attnum, n) on true
    join pg_attribute a on a.attrelid = r.oid and a.attnum = ord.attnum
    where c.contype = 'f'
      and n.nspname = 'public'
    group by r.relname, c.conname
  loop
    execute format(
      'create index if not exists %I on public.%I (%s)',
      row.index_name,
      row.table_name,
      row.columns_sql
    );
  end loop;
end
$$;
