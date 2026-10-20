-- Keep COD payment, bill discount, and item price evidence in one transaction.
create table public.cod_payment_methods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  label text not null check (length(trim(label)) between 1 and 80),
  base_method text not null check (base_method in ('CASH', 'TRANSFER', 'QR')),
  is_active boolean not null default true,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now()
);

create unique index cod_payment_methods_company_label
  on public.cod_payment_methods(company_id, (lower(btrim(label))));

create index price_requests_cod_open_shipment
  on public.price_requests(company_id, shipment_id, requested_at, id)
  where status in ('PENDING_PRICE','PENDING_APPROVAL','RETURNED');
create index price_requests_cod_open_item
  on public.price_requests(shipment_item_id, requested_at desc, id desc)
  where status in ('PENDING_PRICE','PENDING_APPROVAL','RETURNED');

alter table public.cod_payment_methods enable row level security;
create policy cod_payment_methods_read on public.cod_payment_methods
  for select to authenticated
  using (company_id = (select (private.member()).company_id));
revoke all on public.cod_payment_methods from public, anon;
grant select on public.cod_payment_methods to authenticated;

alter table public.payments
  add column payment_method_option_id uuid references public.cod_payment_methods(id);

-- A later price approval must not silently create an overpaid invoice.
create or replace function private.guard_invoice_total_after_payments()
returns trigger language plpgsql security definer set search_path = '' as $$
declare already_paid numeric;
begin
  select coalesce(sum(amount), 0) into already_paid
  from public.payment_allocations where invoice_id = new.id;
  if new.total_amount < already_paid then
    raise exception 'ยอดบิลใหม่ต่ำกว่าเงินที่รับแล้ว กรุณาตรวจสอบส่วนต่างก่อนยืนยันราคา';
  end if;
  return new;
end $$;
revoke all on function private.guard_invoice_total_after_payments()
from public, anon, authenticated;
create trigger guard_invoice_total_after_payments
before update of total_amount on public.invoices
for each row when (new.total_amount is distinct from old.total_amount)
execute function private.guard_invoice_total_after_payments();

create table public.cod_payment_details (
  payment_id uuid primary key references public.payments(id),
  company_id uuid not null references public.companies,
  discount_total numeric(18,2) not null check (discount_total >= 0),
  item_prices jsonb not null default '[]'::jsonb check (jsonb_typeof(item_prices) = 'array'),
  request_payload jsonb not null
);
alter table public.cod_payment_details enable row level security;
revoke all on public.cod_payment_details from public, anon, authenticated;

create or replace function private.add_cod_payment_method(method_label text, category text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  member public.profiles := private.require_role(array['owner','admin','clerk','accountant']);
  method_id uuid;
  clean_label text := trim(coalesce(method_label, ''));
begin
  if length(clean_label) not between 1 and 80
     or category is null or category not in ('CASH','TRANSFER','QR') then
    raise exception 'ชื่อหรือประเภทวิธีรับเงินไม่ถูกต้อง';
  end if;
  if lower(clean_label) in ('เงินสด', 'โอน', 'qr payment') then
    raise exception 'วิธีรับเงินนี้มีอยู่แล้ว';
  end if;
  insert into public.cod_payment_methods(company_id, label, base_method, created_by)
  values(member.company_id, clean_label, category, member.id)
  on conflict (company_id, (lower(btrim(label)))) do update
    set is_active = true
  returning id into method_id;
  return method_id;
end $$;

create or replace function public.add_cod_payment_method(method_label text, category text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.add_cod_payment_method(method_label, category)
$$;
revoke all on function private.add_cod_payment_method(text,text) from public, anon, authenticated;
grant execute on function private.add_cod_payment_method(text,text) to authenticated;
revoke all on function public.add_cod_payment_method(text,text) from public, anon;
grant execute on function public.add_cod_payment_method(text,text) to authenticated;

create or replace function private.collect_cod_payment(data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member public.profiles := private.require_role(array['owner','admin','clerk','accountant']);
  shipment public.shipments;
  invoice public.invoices;
  payment public.payments;
  method_option public.cod_payment_methods;
  shipment_item public.shipment_items;
  price_request public.price_requests;
  item_data jsonb;
  seen_items uuid[] := '{}';
  request_id_value uuid := (data->>'request_id')::uuid;
  shipment_id_value uuid := (data->>'shipment_id')::uuid;
  option_id_value uuid := nullif(data->>'method_option_id', '')::uuid;
  method_value text := data->>'method';
  note_value text := trim(coalesce(data->>'note', ''));
  amount_value numeric := (data->>'amount')::numeric;
  discount_value numeric := (data->>'discount')::numeric;
  item_price numeric;
  paid numeric;
  invoice_total numeric;
  shipment_total numeric;
  destination_branch_id uuid;
  payment_id_value uuid;
  submitted_count integer := 0;
  saved_payload jsonb;
begin
  if jsonb_typeof(data) <> 'object' or request_id_value is null
     or shipment_id_value is null then
    raise exception 'ข้อมูลรับเงินไม่ครบ';
  end if;
  if jsonb_typeof(coalesce(data->'items', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(data->'items', '[]'::jsonb)) > 100 then
    raise exception 'ข้อมูลราคาสินค้าไม่ถูกต้อง';
  end if;
  if length(note_value) > 500 then raise exception 'หมายเหตุยาวเกิน 500 ตัวอักษร'; end if;
  if amount_value is null or amount_value <= 0 or amount_value <> round(amount_value, 2)
     or discount_value is null or discount_value < 0 or discount_value <> round(discount_value, 2) then
    raise exception 'ยอดรับเงินหรือส่วนลดไม่ถูกต้อง';
  end if;

  -- Price approval locks requests before the shipment; use the same order.
  perform id from public.price_requests
  where company_id = member.company_id and shipment_id = shipment_id_value
    and status in ('PENDING_PRICE','PENDING_APPROVAL','RETURNED')
  order by requested_at, id for update;
  select * into shipment from public.shipments where id = shipment_id_value for update;
  if shipment.id is null or shipment.company_id <> member.company_id
     or shipment.payment_mode <> 'CASH_DESTINATION'
     or shipment.shipment_status = 'CANCELLED'
     or not private.can_read_document(shipment_id_value) then
    raise exception 'ไม่พบบิลเงินสดปลายทางหรือไม่มีสิทธิ์';
  end if;
  select id into destination_branch_id from public.branches
  where company_id = member.company_id
    and code = shipment.destination_branch_code;
  destination_branch_id := coalesce(destination_branch_id, shipment.branch_id);

  select * into payment from public.payments where request_id = request_id_value;
  if payment.id is not null then
    select request_payload into saved_payload from public.cod_payment_details
    where payment_id = payment.id;
    if payment.shipment_id <> shipment_id_value or saved_payload is distinct from data then
      raise exception 'คำขอรับเงินซ้ำมีข้อมูลไม่ตรงกัน';
    end if;
    return jsonb_build_object('payment_id', payment.id, 'submitted_prices', 0);
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
  if invoice.id is null then raise exception 'ไม่พบใบแจ้งหนี้ของบิล'; end if;
  select coalesce(sum(amount), 0) into paid from public.payment_allocations
  where invoice_id = invoice.id;
  if (data->>'expected_discount')::numeric is distinct from shipment.discount then
    raise exception 'ส่วนลดของบิลเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่';
  end if;
  shipment_total := shipment.total_amount + shipment.discount - discount_value;
  invoice_total := invoice.total_amount + shipment.discount - discount_value;
  if shipment_total <= 0 or invoice_total <= 0
     or invoice_total < paid + amount_value then
    raise exception 'ยอดรับเงินเกินยอดค้างหลังหักส่วนลด';
  end if;

  if discount_value <> shipment.discount then
    update public.shipments set discount = discount_value,
      total_amount = shipment_total, version_no = version_no + 1
    where id = shipment_id_value;
    update public.invoices set total_amount = invoice_total where id = invoice.id;
  end if;

  payment_id_value := private.receive_payment(
    shipment_id_value, amount_value, method_value, note_value, request_id_value
  );
  update public.payments set payment_method_option_id = option_id_value
  where id = payment_id_value;
  insert into public.cod_payment_details(
    payment_id, company_id, discount_total, item_prices, request_payload
  ) values (
    payment_id_value, member.company_id, discount_value,
    coalesce(data->'items', '[]'::jsonb), data
  );

  for item_data in select value from jsonb_array_elements(coalesce(data->'items', '[]'::jsonb)) loop
    item_price := (item_data->>'unit_price')::numeric;
    if item_data->>'item_id' is null
       or (item_data->>'item_id')::uuid = any(seen_items)
       or item_price is null or item_price < 0 or item_price > 99999999
       or item_price <> round(item_price, 2) then
      raise exception 'ราคาต่อหน่วยไม่ถูกต้องหรือมีรายการซ้ำ';
    end if;
    seen_items := array_append(seen_items, (item_data->>'item_id')::uuid);
    select * into shipment_item from public.shipment_items
    where id = (item_data->>'item_id')::uuid and shipment_id = shipment_id_value;
    if shipment_item.id is null then raise exception 'ไม่พบรายการสินค้าในบิล'; end if;

    if shipment_item.product_unit_id is not null
       and (shipment_item.price_pending or shipment_item.unit_price <> item_price) then
      select * into price_request from public.price_requests
      where shipment_item_id = shipment_item.id
        and status in ('PENDING_PRICE','PENDING_APPROVAL','RETURNED')
      order by requested_at desc, id desc limit 1 for update;
      if price_request.id is not null then
        if price_request.status = 'PENDING_APPROVAL'
           and price_request.proposed_price is distinct from item_price then
          raise exception 'รายการสินค้านี้มีราคาเสนอรอบัญชีแล้ว';
        end if;
        update public.price_requests set proposed_price = item_price,
          status = 'PENDING_APPROVAL', submitted_at = now(), submitted_by = member.id,
          returned_at = null, returned_by = null, return_reason = null,
          note = 'ราคาแจ้งจากหน้าเก็บเงิน COD'
        where id = price_request.id;
      else
        insert into public.price_requests(
          company_id, shipment_id, shipment_item_id, receiver_id, sender_id,
          product_unit_id, branch_id, payment_mode, bill_number, quantity,
          proposed_price, status, note, requested_by, submitted_at, submitted_by
        ) values (
          member.company_id, shipment.id, shipment_item.id,
          shipment.receiver_party_id, shipment.sender_party_id,
          shipment_item.product_unit_id, destination_branch_id,
          shipment.payment_mode, shipment.shipment_no, shipment_item.quantity,
          item_price, 'PENDING_APPROVAL', 'ราคาแจ้งจากหน้าเก็บเงิน COD',
          member.id, now(), member.id
        );
      end if;
      submitted_count := submitted_count + 1;
    end if;
  end loop;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, record_id, detail)
  values(member.company_id, member.id, 'COD_DETAILS', 'payment', payment_id_value,
    jsonb_build_object('old_discount', shipment.discount, 'new_discount', discount_value,
      'submitted_prices', submitted_count, 'method_option_id', option_id_value));

  return jsonb_build_object('payment_id', payment_id_value,
    'submitted_prices', submitted_count);
end $$;

create or replace function public.collect_cod_payment(data jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.collect_cod_payment(data)
$$;
revoke all on function private.collect_cod_payment(jsonb) from public, anon, authenticated;
grant execute on function private.collect_cod_payment(jsonb) to authenticated;
revoke all on function public.collect_cod_payment(jsonb) from public, anon;
grant execute on function public.collect_cod_payment(jsonb) to authenticated;

notify pgrst, 'reload schema';
