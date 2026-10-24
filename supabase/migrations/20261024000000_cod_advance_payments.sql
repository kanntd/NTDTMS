-- Money collected before COD prices are approved remains a real payment on the
-- shipment. Only the part covered by the current invoice is allocated.
create or replace function private.collect_cod_advance(data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member public.profiles := private.require_role(array['owner','admin','clerk','accountant']);
  shipment public.shipments;
  invoice public.invoices;
  existing public.payments;
  method_option public.cod_payment_methods;
  request_id_value uuid := (data->>'request_id')::uuid;
  shipment_id_value uuid := (data->>'shipment_id')::uuid;
  option_id_value uuid := nullif(data->>'method_option_id', '')::uuid;
  method_value text := data->>'method';
  note_value text := trim(coalesce(data->>'note', ''));
  amount_value numeric := (data->>'amount')::numeric;
  allocated numeric;
  already_allocated numeric;
  payment_id_value uuid;
  submitted_count integer := 0;
  saved_payload jsonb;
begin
  if jsonb_typeof(data) <> 'object' or request_id_value is null
     or shipment_id_value is null or amount_value is null
     or amount_value <= 0 or amount_value <> round(amount_value, 2)
     or length(note_value) > 500
     or jsonb_typeof(coalesce(data->'items', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(data->'items', '[]'::jsonb)) > 100 then
    raise exception 'ข้อมูลรับเงินไม่ถูกต้อง';
  end if;

  -- Use the same lock order as price approval and ordinary COD collection.
  perform id from public.price_requests
  where company_id = member.company_id and shipment_id = shipment_id_value
    and status in ('PENDING_PRICE','PENDING_APPROVAL','RETURNED')
  order by requested_at, id for update;
  select * into shipment from public.shipments
  where id = shipment_id_value for update;
  if shipment.id is null or shipment.company_id <> member.company_id
     or shipment.payment_mode <> 'CASH_DESTINATION'
     or shipment.shipment_status = 'CANCELLED' or not shipment.price_pending
     or not private.can_read_document(shipment_id_value) then
    raise exception 'บิลนี้ไม่มีรายการรอราคาหรือไม่มีสิทธิ์รับเงิน';
  end if;

  select * into existing from public.payments where request_id = request_id_value;
  if existing.id is not null then
    select request_payload into saved_payload from public.cod_payment_details
    where payment_id = existing.id;
    if existing.shipment_id <> shipment_id_value
       or saved_payload is distinct from data then
      raise exception 'คำขอรับเงินซ้ำมีข้อมูลไม่ตรงกัน';
    end if;
    return jsonb_build_object('payment_id', existing.id, 'submitted_prices', 0);
  end if;

  if option_id_value is null then
    if method_value is null or method_value not in ('CASH','TRANSFER','QR') then
      raise exception 'วิธีรับเงินไม่ถูกต้อง';
    end if;
  else
    select * into method_option from public.cod_payment_methods
    where id = option_id_value and company_id = member.company_id and is_active;
    if method_option.id is null or method_value <> method_option.base_method then
      raise exception 'วิธีรับเงินที่เพิ่มเองไม่ถูกต้อง';
    end if;
  end if;

  select * into invoice from public.invoices
  where shipment_id = shipment_id_value for update;
  if invoice.id is null or invoice.status <> 'ISSUED' then
    raise exception 'ไม่พบใบแจ้งหนี้ที่รับเงินได้';
  end if;
  if (data->>'expected_discount')::numeric is distinct from shipment.discount
     or (data->>'discount')::numeric is distinct from shipment.discount then
    raise exception 'ส่วนลดของบิลเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่';
  end if;
  select coalesce(sum(amount), 0) into already_allocated
  from public.payment_allocations where invoice_id = invoice.id;
  allocated := least(amount_value, greatest(invoice.total_amount - already_allocated, 0));

  insert into public.payments(
    shipment_id, request_id, payment_no, amount, method, reference_no,
    received_by, payment_method_option_id
  ) values (
    shipment_id_value, request_id_value,
    private.next_number(shipment.branch_id, 'RC'), amount_value,
    method_value, note_value, member.id, option_id_value
  ) returning id into payment_id_value;
  if allocated > 0 then
    insert into public.payment_allocations(payment_id, invoice_id, amount)
    values(payment_id_value, invoice.id, allocated);
  end if;
  insert into public.cod_payment_details(
    payment_id, company_id, discount_total, item_prices, request_payload
  ) values (
    payment_id_value, member.company_id, shipment.discount,
    coalesce(data->'items', '[]'::jsonb), data
  );

  if jsonb_array_length(coalesce(data->'items', '[]'::jsonb)) > 0 then
    select (private.submit_cod_item_prices(jsonb_build_object(
      'shipment_id', shipment_id_value, 'items', data->'items'
    ))->>'submitted_prices')::integer into submitted_count;
  end if;
  insert into public.audit_logs(company_id, actor_id, action, entity_type,
    record_id, detail)
  values(member.company_id, member.id, 'COD_ADVANCE', 'payment', payment_id_value,
    jsonb_build_object('amount', amount_value, 'allocated', allocated,
      'advance', amount_value - allocated, 'shipment_id', shipment_id_value));
  return jsonb_build_object('payment_id', payment_id_value,
    'submitted_prices', submitted_count);
end $$;
revoke all on function private.collect_cod_advance(jsonb)
from public, anon, authenticated;
grant execute on function private.collect_cod_advance(jsonb) to authenticated;

create or replace function public.collect_cod_advance(data jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.collect_cod_advance(data)
$$;
revoke all on function public.collect_cod_advance(jsonb) from public, anon;
grant execute on function public.collect_cod_advance(jsonb) to authenticated;

-- A later price or discount may be lower than the amount already allocated.
-- Move only the excess back to the original payment as unallocated credit.
create or replace function private.guard_invoice_total_after_payments()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  already_paid numeric;
  excess numeric;
  allocation_row record;
begin
  select coalesce(sum(amount), 0) into already_paid
  from public.payment_allocations where invoice_id = new.id;
  if new.total_amount < already_paid then
    if not exists (
      select 1 from public.shipments s
      where s.id = new.shipment_id and s.payment_mode = 'CASH_DESTINATION'
    ) then
      raise exception 'ยอดบิลใหม่ต่ำกว่าเงินที่รับแล้ว กรุณาตรวจสอบส่วนต่างก่อนยืนยันราคา';
    end if;
    excess := already_paid - new.total_amount;
    for allocation_row in
      select a.id, a.amount from public.payment_allocations a
      join public.payments p on p.id = a.payment_id
      where a.invoice_id = new.id
      order by p.received_at desc, p.id desc
      for update of a
    loop
      if allocation_row.amount <= excess then
        delete from public.payment_allocations where id = allocation_row.id;
        excess := excess - allocation_row.amount;
      else
        update public.payment_allocations
        set amount = amount - excess where id = allocation_row.id;
        excess := 0;
      end if;
      exit when excess <= 0;
    end loop;
  end if;
  return new;
end $$;
revoke all on function private.guard_invoice_total_after_payments()
from public, anon, authenticated;

-- When approved prices raise the invoice amount, consume advances in receipt
-- order. An excess stays unallocated on the payment for accounting review.
create or replace function private.allocate_cod_advances()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  payment_row record;
  capacity numeric;
  use_amount numeric;
begin
  if new.total_amount <= old.total_amount then return new; end if;
  if not exists (
    select 1 from public.shipments s
    where s.id = new.shipment_id and s.payment_mode = 'CASH_DESTINATION'
  ) then return new; end if;
  select greatest(new.total_amount - coalesce(sum(amount), 0), 0)
  into capacity from public.payment_allocations where invoice_id = new.id;
  if capacity <= 0 then return new; end if;
  for payment_row in
    select p.id, p.amount - coalesce(a.allocated, 0) as available
    from public.payments p
    left join lateral (
      select sum(amount) allocated from public.payment_allocations
      where payment_id = p.id
    ) a on true
    where p.shipment_id = new.shipment_id
      and p.amount > coalesce(a.allocated, 0)
    order by p.received_at, p.id
    for update of p
  loop
    use_amount := least(capacity, payment_row.available);
    if use_amount > 0 then
      insert into public.payment_allocations(payment_id, invoice_id, amount)
      values(payment_row.id, new.id, use_amount)
      on conflict (payment_id) do update
      set amount = public.payment_allocations.amount + excluded.amount;
      capacity := capacity - use_amount;
    end if;
    exit when capacity <= 0;
  end loop;
  return new;
end $$;
revoke all on function private.allocate_cod_advances()
from public, anon, authenticated;
create trigger allocate_cod_advances
after update of total_amount on public.invoices
for each row when (new.total_amount > old.total_amount)
execute function private.allocate_cod_advances();

-- COD screens show all cash actually received, including the unallocated part.
-- Other payment modes retain their invoice allocation based display.
create or replace view public.shipment_register
with (security_invoker = true) as
select s.*, i.id invoice_id, i.due_date,
  case when s.payment_mode = 'CASH_DESTINATION'
    then coalesce(p.received, 0) else coalesce(a.paid, 0)
  end::numeric(18,2) paid_amount,
  case when s.shipment_status = 'CANCELLED' then 0
    when s.payment_mode = 'CASH_DESTINATION'
      then greatest(i.total_amount - coalesce(p.received, 0), 0)
    else greatest(i.total_amount - coalesce(a.paid, 0), 0)
  end::numeric(18,2) outstanding_amount
from public.shipments s
join public.invoices i on i.shipment_id = s.id
left join (
  select invoice_id, sum(amount) paid
  from public.payment_allocations group by invoice_id
) a on a.invoice_id = i.id
left join lateral (
  select sum(amount) received from public.payments
  where shipment_id = s.id
) p on s.payment_mode = 'CASH_DESTINATION';
create index if not exists payments_shipment_id_received_at
  on public.payments(shipment_id, received_at, id);

notify pgrst, 'reload schema';
