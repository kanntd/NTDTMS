-- The resolution_type parameter shares its name with a price_requests column.
-- Qualify it in the pending-request query to avoid PL/pgSQL ambiguity.
do $$
declare
  definition text;
  bill_only_clause text := '(resolution_type = ''BILL_ONLY'' and r.id = source_request.id)';
  standard_clause text := 'resolution_type = ''STANDARD''
          and r.receiver_id';
begin
  definition := pg_get_functiondef(
    'private.resolve_shared_price_request(uuid,numeric,text,text)'::regprocedure
  );
  if position(bill_only_clause in definition) = 0
    or position(standard_clause in definition) = 0 then
    raise exception 'Price resolution function differs from expected version';
  end if;
  definition := replace(
    definition,
    bill_only_clause,
    '(resolve_shared_price_request.resolution_type = ''BILL_ONLY'' and r.id = source_request.id)'
  );
  definition := replace(
    definition,
    standard_clause,
    'resolve_shared_price_request.resolution_type = ''STANDARD''
          and r.receiver_id'
  );
  execute definition;
end
$$;
