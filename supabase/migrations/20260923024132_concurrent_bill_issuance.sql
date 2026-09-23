-- Bill issuance is a high-frequency workflow. A transactional counter row and
-- an early workspace revision update used to serialize whole bill transactions,
-- causing the second workstation to hit statement_timeout. PostgreSQL sequences
-- allocate numbers without holding a row lock until commit, and the workspace
-- revision is now touched only at the end of the business transaction.

create sequence if not exists private.ntd_bill_number_seq;

do $$
declare
  current_number bigint;
begin
  select greatest(coalesce(max(last_number), 0), 1)
  into current_number
  from private.document_sequences
  where document_type = 'NTD';
  perform setval('private.ntd_bill_number_seq', current_number, true);
end $$;

create or replace function private.next_number(b uuid, typ text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n bigint;
  period text;
  branch_code text;
  bill_code text;
  branch_active boolean;
  branch_can_issue boolean;
begin
  select code, document_code, is_active, can_issue_bills
  into branch_code, bill_code, branch_active, branch_can_issue
  from public.branches
  where id = b;

  if branch_code is null then raise exception 'ไม่พบสาขาต้นทาง'; end if;

  if typ = 'NTD' then
    if not branch_active or not branch_can_issue or bill_code = '' then
      raise exception 'สาขาต้นทางยังไม่มีรหัสออกบิลหรือไม่ได้เปิดสิทธิ์ออกบิล';
    end if;
    period := to_char(now() at time zone 'Asia/Bangkok', 'YYYY');
    n := nextval('private.ntd_bill_number_seq');
    update public.branches
    set document_code_locked_at = coalesce(document_code_locked_at, now())
    where id = b and document_code_locked_at is null;
    return bill_code || right(period, 2) || lpad(n::text, 6, '0');
  end if;

  period := to_char(now() at time zone 'Asia/Bangkok', 'YYYYMM');
  insert into private.document_sequences(branch_id, document_type, period, last_number)
  values (b, typ, period, 1)
  on conflict on constraint document_sequences_pkey do update
  set last_number = private.document_sequences.last_number + 1
  returning last_number into n;

  return typ || '-' || branch_code || '-' || period || '-' ||
    lpad(n::text, greatest(5, length(n::text)), '0');
end $$;

create or replace function private.issue_reception_bill_with_payment(data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.profiles := private.require_role(array['owner','admin','clerk']);
  result jsonb;
  method_value text := coalesce(nullif(data->>'payment_method', ''), 'CASH');
  payment_reference_value text := coalesce(data->>'payment_reference', '');
  invoice_total numeric;
begin
  if data->>'payment_mode' = 'CASH_ORIGIN' then
    if method_value not in ('CASH', 'TRANSFER') then
      raise exception 'วิธีรับเงินต้นทางไม่ถูกต้อง';
    end if;
  end if;

  -- Suppress row-by-row refresh triggers for this transaction. The single
  -- revision update below happens after all bill rows and payments are ready.
  perform set_config(
    'ntdtms.workspace_revision_company',
    member.company_id::text,
    true
  );

  result := private.issue_reception_bill_v2(
    data || jsonb_build_object('collect_now', false)
  );

  if data->>'payment_mode' = 'CASH_ORIGIN' then
    select total_amount into invoice_total
    from public.invoices
    where shipment_id = (result->>'id')::uuid;

    if invoice_total > 0 then
      perform private.receive_payment(
        (result->>'id')::uuid,
        invoice_total,
        method_value,
        payment_reference_value,
        (data->>'id')::uuid
      );
    end if;
  end if;

  insert into public.workspace_revisions(company_id, revision, changed_at)
  values (member.company_id, 1, now())
  on conflict (company_id) do update
  set revision = public.workspace_revisions.revision + 1,
      changed_at = excluded.changed_at;

  return result;
end $$;
