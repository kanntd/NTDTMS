-- Allow pricing staff to submit proposals without granting accounting approval.

create or replace function private.submit_price_proposal(
  request_id uuid,
  proposed_price numeric,
  actual_collected_amount numeric default null,
  proposal_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.profiles := private.require_role(
    array['owner', 'admin', 'clerk', 'accountant']
  );
  price_request public.price_requests;
begin
  if proposed_price is null or proposed_price < 0 then
    raise exception 'ราคาเสนอไม่ถูกต้อง';
  end if;
  if actual_collected_amount is not null and actual_collected_amount < 0 then
    raise exception 'ยอดเงินที่เก็บได้จริงไม่ถูกต้อง';
  end if;

  select * into price_request
  from public.price_requests
  where id = request_id and company_id = member.company_id
  for update;

  if price_request.id is null then
    raise exception 'ไม่พบคำขอราคา';
  end if;
  if price_request.status not in ('PENDING_PRICE', 'RETURNED') then
    raise exception 'รายการนี้ไม่ได้อยู่ในสถานะที่แก้ราคาเสนอได้';
  end if;

  update public.price_requests
  set proposed_price = submit_price_proposal.proposed_price,
    actual_collected_amount = submit_price_proposal.actual_collected_amount,
    note = coalesce(submit_price_proposal.proposal_note, ''),
    status = 'PENDING_APPROVAL',
    submitted_at = now(),
    submitted_by = member.id,
    returned_at = null,
    returned_by = null,
    return_reason = null
  where id = price_request.id
  returning * into price_request;

  insert into public.audit_logs(
    company_id, actor_id, action, entity_type, record_id, detail
  ) values (
    member.company_id, member.id, 'SUBMIT_PRICE', 'price_request',
    price_request.id,
    jsonb_build_object(
      'proposed_price', price_request.proposed_price,
      'actual_collected_amount', price_request.actual_collected_amount
    )
  );

  return jsonb_build_object(
    'request_id', price_request.id,
    'status', price_request.status,
    'proposed_price', price_request.proposed_price,
    'actual_collected_amount', price_request.actual_collected_amount,
    'note', price_request.note,
    'submitted_at', price_request.submitted_at
  );
end
$$;

revoke all on function private.submit_price_proposal(uuid, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function private.submit_price_proposal(uuid, numeric, numeric, text)
  to authenticated;

create or replace function public.submit_price_proposal(
  request_id uuid,
  proposed_price numeric,
  actual_collected_amount numeric default null,
  proposal_note text default ''
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.submit_price_proposal(
    request_id, proposed_price, actual_collected_amount, proposal_note
  )
$$;

revoke all on function public.submit_price_proposal(uuid, numeric, numeric, text)
  from public, anon;
grant execute on function public.submit_price_proposal(uuid, numeric, numeric, text)
  to authenticated;

create or replace function private.return_shared_price_request(
  request_id uuid,
  return_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.profiles := private.require_role(
    array['owner', 'admin', 'accountant']
  );
  price_request public.price_requests;
begin
  if length(trim(coalesce(return_reason, ''))) < 3 then
    raise exception 'กรุณาระบุเหตุผลที่ส่งกลับอย่างน้อย 3 ตัวอักษร';
  end if;

  select * into price_request
  from public.price_requests
  where id = request_id and company_id = member.company_id
  for update;

  if price_request.id is null then
    raise exception 'ไม่พบคำขอราคา';
  end if;
  if price_request.status <> 'PENDING_APPROVAL' then
    raise exception 'รายการนี้ไม่ได้อยู่ในสถานะรอตรวจของบัญชี';
  end if;

  update public.price_requests
  set status = 'RETURNED',
    returned_at = now(),
    returned_by = member.id,
    return_reason = trim(return_shared_price_request.return_reason)
  where id = price_request.id
  returning * into price_request;

  insert into public.audit_logs(
    company_id, actor_id, action, entity_type, record_id, detail
  ) values (
    member.company_id, member.id, 'RETURN_PRICE', 'price_request',
    price_request.id,
    jsonb_build_object('reason', price_request.return_reason)
  );

  return jsonb_build_object(
    'request_id', price_request.id,
    'status', price_request.status,
    'returned_at', price_request.returned_at,
    'return_reason', price_request.return_reason
  );
end
$$;

revoke all on function private.return_shared_price_request(uuid, text)
  from public, anon, authenticated;
grant execute on function private.return_shared_price_request(uuid, text)
  to authenticated;

create or replace function public.return_shared_price_request(
  request_id uuid,
  return_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.return_shared_price_request(request_id, return_reason)
$$;

revoke all on function public.return_shared_price_request(uuid, text)
  from public, anon;
grant execute on function public.return_shared_price_request(uuid, text)
  to authenticated;
