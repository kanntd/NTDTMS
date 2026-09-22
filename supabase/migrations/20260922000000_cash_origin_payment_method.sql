-- Cash at origin is collected when the bill is issued; the operator may choose transfer.
create or replace function private.issue_reception_bill_with_payment(data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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

  return result;
end
$$;

revoke all on function private.issue_reception_bill_with_payment(jsonb) from public, anon, authenticated;
grant execute on function private.issue_reception_bill_with_payment(jsonb) to authenticated;

create or replace function public.issue_reception_bill_v2(data jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.issue_reception_bill_with_payment(private.normalize_reception_bill(data))
$$;
