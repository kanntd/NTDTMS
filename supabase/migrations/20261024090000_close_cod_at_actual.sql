-- Keep the approved item prices unchanged when a customer settles a COD bill
-- for a different amount. Record the bill-level adjustment separately.
create table public.cod_bill_closures (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  company_id uuid not null references public.companies,
  shipment_id uuid not null unique references public.shipments,
  shipment_no text not null,
  destination_branch_code text not null,
  receiver_name text not null,
  approved_total numeric(18,2) not null check (approved_total >= 0),
  received_total numeric(18,2) not null check (received_total > 0),
  variance numeric(18,2) not null check (variance <> 0),
  added_discount numeric(18,2) not null default 0 check (added_discount >= 0),
  added_surcharge numeric(18,2) not null default 0 check (added_surcharge >= 0),
  reason text not null default '' check (length(reason) <= 500),
  payment_id uuid references public.payments,
  request_payload jsonb not null,
  closed_by uuid not null references auth.users,
  closed_by_name text not null,
  closed_at timestamptz not null default now(),
  check (variance = received_total - approved_total),
  check ((variance > 0 and added_surcharge = variance and added_discount = 0)
      or (variance < 0 and added_discount = -variance and added_surcharge = 0))
);
create index cod_bill_closures_branch_date
  on public.cod_bill_closures(company_id, destination_branch_code, closed_at desc, id);
create index cod_bill_closures_company_date
  on public.cod_bill_closures(company_id, closed_at desc, id);
alter table public.cod_bill_closures enable row level security;
create policy cod_bill_closures_read on public.cod_bill_closures
  for select to authenticated using (
    company_id = (select (private.member()).company_id)
    and private.can_read_document(shipment_id)
    and (
      (select (private.member()).role) in ('owner','admin','accountant')
      or exists (
        select 1 from public.branches b
        where b.id = (select (private.member()).branch_id)
          and b.code = destination_branch_code
      )
    )
  );
revoke all on public.cod_bill_closures from public, anon, authenticated;
grant select on public.cod_bill_closures to authenticated;

create or replace function private.close_cod_at_actual(data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member public.profiles := private.require_role(array['owner','admin','clerk','accountant']);
  shipment public.shipments;
  invoice public.invoices;
  existing public.cod_bill_closures;
  method_option public.cod_payment_methods;
  request_id_value uuid := (data->>'request_id')::uuid;
  shipment_id_value uuid := (data->>'shipment_id')::uuid;
  option_id_value uuid := nullif(data->>'method_option_id', '')::uuid;
  method_value text := data->>'method';
  note_value text := trim(coalesce(data->>'note', ''));
  amount_value numeric := (data->>'amount')::numeric;
  paid_value numeric;
  final_total numeric;
  difference numeric;
  new_shipment_total numeric;
  payment_id_value uuid;
  closure_id_value uuid;
begin
  if jsonb_typeof(data) <> 'object' or request_id_value is null
     or shipment_id_value is null or amount_value is null
     or amount_value < 0 or amount_value <> round(amount_value, 2)
     or length(note_value) > 500 then
    raise exception 'ข้อมูลปิดบิลไม่ถูกต้อง';
  end if;

  -- Match collection and price-approval lock order.
  perform id from public.price_requests
  where company_id = member.company_id and shipment_id = shipment_id_value
    and status in ('PENDING_PRICE','PENDING_APPROVAL','RETURNED')
  order by requested_at, id for update;
  select * into shipment from public.shipments
  where id = shipment_id_value for update;
  if shipment.id is null or shipment.company_id <> member.company_id
     or shipment.payment_mode <> 'CASH_DESTINATION'
     or shipment.shipment_status = 'CANCELLED'
     or not private.can_read_document(shipment_id_value) then
    raise exception 'ไม่พบบิล COD หรือไม่มีสิทธิ์';
  end if;
  if member.role = 'clerk' and not exists (
    select 1 from public.branches b
    where b.id = member.branch_id and b.code = shipment.destination_branch_code
  ) then
    raise exception 'รับเงิน COD ได้เฉพาะสาขาปลายทาง';
  end if;

  select * into existing from public.cod_bill_closures
  where request_id = request_id_value or shipment_id = shipment_id_value
  order by (request_id = request_id_value) desc limit 1;
  if existing.id is not null then
    if existing.request_id = request_id_value
       and existing.shipment_id = shipment_id_value
       and existing.request_payload = data then
      return jsonb_build_object('closure_id', existing.id,
        'payment_id', existing.payment_id, 'variance', existing.variance);
    end if;
    raise exception 'บิลนี้ปิดตามยอดรับจริงแล้วหรือคำขอซ้ำมีข้อมูลไม่ตรงกัน';
  end if;
  if shipment.price_pending or exists (
    select 1 from public.price_requests
    where shipment_id = shipment_id_value
      and status in ('PENDING_PRICE','PENDING_APPROVAL','RETURNED')
  ) then
    raise exception 'บิลนี้ยังรอราคายืนยัน กรุณาให้บัญชียืนยันก่อนปิดบิล';
  end if;

  select * into invoice from public.invoices
  where shipment_id = shipment_id_value for update;
  if invoice.id is null or invoice.status <> 'ISSUED' then
    raise exception 'ไม่พบใบแจ้งหนี้ที่ปิดได้';
  end if;
  select coalesce(sum(amount), 0) into paid_value
  from public.payments where shipment_id = shipment_id_value;
  if (data->>'expected_total')::numeric is distinct from shipment.total_amount
     or (data->>'expected_paid')::numeric is distinct from paid_value
     or (data->>'expected_discount')::numeric is distinct from shipment.discount then
    raise exception 'ยอดบิลหรือเงินรับเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่';
  end if;
  final_total := paid_value + amount_value;
  difference := final_total - invoice.total_amount;
  new_shipment_total := shipment.total_amount + difference;
  if final_total <= 0 or final_total <> round(final_total, 2)
     or new_shipment_total < 0 or difference = 0 then
    raise exception 'ปิดบิลได้เมื่อยอดรับจริงต่างจากยอดบิลและมีเงินรับแล้ว';
  end if;
  if amount_value > 0 then
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
  end if;

  update public.shipments
  set discount = shipment.discount + greatest(-difference, 0),
      extra_charge = shipment.extra_charge + greatest(difference, 0),
      total_amount = new_shipment_total,
      version_no = version_no + 1
  where id = shipment_id_value;
  update public.invoices set total_amount = final_total where id = invoice.id;
  if amount_value > 0 then
    payment_id_value := private.receive_payment(
      shipment_id_value, amount_value, method_value, note_value, request_id_value
    );
    update public.payments set payment_method_option_id = option_id_value
    where id = payment_id_value;
  end if;

  insert into public.cod_bill_closures(
    request_id, company_id, shipment_id, shipment_no, destination_branch_code,
    receiver_name, approved_total, received_total, variance,
    added_discount, added_surcharge, reason, payment_id, request_payload,
    closed_by, closed_by_name
  ) values (
    request_id_value, member.company_id, shipment_id_value,
    shipment.shipment_no, coalesce(shipment.destination_branch_code, ''),
    coalesce(shipment.receiver_snapshot->>'display_name', ''),
    invoice.total_amount, final_total, difference,
    greatest(-difference, 0), greatest(difference, 0), note_value,
    payment_id_value, data, member.id, member.display_name
  ) returning id into closure_id_value;
  insert into public.audit_logs(company_id, actor_id, action, entity_type,
    record_id, detail)
  values(member.company_id, member.id, 'COD_CLOSE_AT_ACTUAL', 'shipment',
    shipment_id_value, jsonb_build_object(
      'closure_id', closure_id_value, 'approved_total', invoice.total_amount,
      'received_total', final_total, 'variance', difference,
      'payment_id', payment_id_value, 'reason', note_value));
  return jsonb_build_object('closure_id', closure_id_value,
    'payment_id', payment_id_value, 'variance', difference);
end $$;
revoke all on function private.close_cod_at_actual(jsonb)
from public, anon, authenticated;
grant execute on function private.close_cod_at_actual(jsonb) to authenticated;

create or replace function public.close_cod_at_actual(data jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.close_cod_at_actual(data)
$$;
revoke all on function public.close_cod_at_actual(jsonb) from public, anon;
grant execute on function public.close_cod_at_actual(jsonb) to authenticated;

-- Expose the invoice amount actually owed, which may differ from the shipment
-- total when withholding or invoice rounding applies.
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
  end::numeric(18,2) outstanding_amount,
  i.total_amount::numeric(18,2) invoice_total
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

notify pgrst, 'reload schema';
