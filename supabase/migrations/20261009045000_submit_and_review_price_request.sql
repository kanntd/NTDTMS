-- Let authorized reviewers submit a proposal and approve it atomically.

create or replace function private.submit_and_resolve_price_request(
  request_id uuid,
  proposed_price numeric,
  approved_price numeric,
  actual_collected_amount numeric default null,
  resolution_type text default 'STANDARD',
  proposal_note text default '',
  approval_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_role(array['owner', 'admin', 'accountant']);

  perform private.submit_price_proposal(
    request_id,
    proposed_price,
    actual_collected_amount,
    proposal_note
  );

  result := private.resolve_shared_price_request(
    request_id,
    approved_price,
    resolution_type,
    approval_note
  );

  return result;
end
$$;

revoke all on function private.submit_and_resolve_price_request(
  uuid, numeric, numeric, numeric, text, text, text
) from public, anon, authenticated;
grant execute on function private.submit_and_resolve_price_request(
  uuid, numeric, numeric, numeric, text, text, text
) to authenticated;

create or replace function public.submit_and_resolve_price_request(
  request_id uuid,
  proposed_price numeric,
  approved_price numeric,
  actual_collected_amount numeric default null,
  resolution_type text default 'STANDARD',
  proposal_note text default '',
  approval_note text default ''
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.submit_and_resolve_price_request(
    request_id,
    proposed_price,
    approved_price,
    actual_collected_amount,
    resolution_type,
    proposal_note,
    approval_note
  )
$$;

revoke all on function public.submit_and_resolve_price_request(
  uuid, numeric, numeric, numeric, text, text, text
) from public, anon;
grant execute on function public.submit_and_resolve_price_request(
  uuid, numeric, numeric, numeric, text, text, text
) to authenticated;

notify pgrst, 'reload schema';
