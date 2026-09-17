-- Edit reception bills atomically while preserving financial and audit history.
create or replace function private.update_reception_bill_v2(
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
  m public.profiles := private.require_role(array['owner', 'admin', 'clerk']);
  shipment_row public.shipments;
  sender_row public.parties;
  receiver_row public.parties;
  destination_branch public.branches;
  zone_row public.service_zones;
  district_row public.districts;
  invoice_row public.invoices;
  product_unit_row public.product_units;
  product_family_row public.product_families;
  line_data jsonb;
  item_id_value uuid;
  relation_id_value uuid;
  shipment_item_id_value uuid;
  payment_value text := data->>'payment_mode';
  credit_days_value integer := coalesce((data->>'credit_days')::integer, 0);
  discount_value numeric := coalesce((data->>'discount')::numeric, 0);
  withholding_value numeric := coalesce((data->>'withholding_amount')::numeric, 0);
  quantity_value numeric;
  price_value numeric;
  subtotal_value numeric := 0;
  total_quantity_value numeric := 0;
  total_weight_value numeric := 0;
  total_value numeric;
  invoice_total_value numeric;
  paid_value numeric := 0;
  saved_rounding numeric := 0;
  pending_value boolean := false;
  item_no integer := 0;
  revision_value integer;
  before_value jsonb;
  after_value jsonb;
  edit_reason text := trim(coalesce(reason, ''));
begin
  select * into shipment_row
  from public.shipments
  where id = doc and company_id = m.company_id
  for update;

  if shipment_row.id is null then raise exception 'ไม่พบบิล'; end if;
  if shipment_row.shipment_status = 'CANCELLED' then
    raise exception 'บิลที่ยกเลิกแล้วไม่สามารถแก้ไขได้';
  end if;
  if shipment_row.shipment_status <> 'RECEIVED' and m.role not in ('owner', 'admin') then
    raise exception 'บิลขึ้นรถแล้ว ต้องใช้บัญชีเจ้าของหรือผู้ดูแลระบบจึงจะแก้ไขได้';
  end if;
  if shipment_row.shipment_status <> 'RECEIVED' and length(edit_reason) < 3 then
    raise exception 'กรุณาระบุเหตุผลแก้ไขบิลหลังขึ้นรถอย่างน้อย 3 ตัวอักษร';
  end if;
  if nullif(data->>'version_no', '') is not null
    and (data->>'version_no')::integer <> shipment_row.version_no
  then
    raise exception 'บิลนี้มีการแก้ไขจากเครื่องอื่นแล้ว กรุณาเปิดใหม่อีกครั้ง';
  end if;

  select * into sender_row from public.parties
  where id = (data->>'sender_id')::uuid
    and company_id = m.company_id and is_active;
  select * into receiver_row from public.parties
  where id = (data->>'receiver_id')::uuid
    and company_id = m.company_id and is_active;
  if sender_row.id is null or receiver_row.id is null then
    raise exception 'ไม่พบผู้รับหรือผู้ส่งในข้อมูลกลาง';
  end if;

  select * into destination_branch from public.branches
  where company_id = m.company_id
    and code = data->>'destination_branch_code' and is_active;
  if destination_branch.id is null then raise exception 'ไม่พบสาขาปลายทาง'; end if;

  if destination_branch.code = 'SWL' then
    select * into zone_row from public.service_zones
    where company_id = m.company_id and code = 'STI' and is_active;
    select * into district_row from public.districts
    where zone_id = zone_row.id and name = 'สวรรคโลก' and is_active;
  else
    select * into zone_row from public.service_zones
    where company_id = m.company_id and code = destination_branch.code and is_active;
    select * into district_row from public.districts
    where zone_id = zone_row.id and is_active
      and name = nullif(receiver_row.district, '');
    if district_row.id is null then
      select * into district_row from public.districts
      where zone_id = zone_row.id and is_active
      order by case when name = 'เมือง' then 0 else 1 end, name
      limit 1;
    end if;
  end if;
  if zone_row.id is null or district_row.id is null then
    raise exception 'ยังไม่ได้ตั้งค่าพื้นที่ปลายทาง';
  end if;

  if payment_value not in (
    'CASH_ORIGIN', 'CASH_DESTINATION', 'CREDIT_ORIGIN', 'CREDIT_DESTINATION'
  ) then
    raise exception 'ประเภทการชำระเงินไม่ถูกต้อง';
  end if;
  if payment_value not like 'CREDIT%' then credit_days_value := 0; end if;
  if payment_value like 'CREDIT%' and credit_days_value <= 0 then credit_days_value := 30; end if;

  if jsonb_typeof(coalesce(data->'items', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(data->'items', '[]'::jsonb)) not between 1 and 100
  then
    raise exception 'ต้องมีสินค้า 1 ถึง 100 รายการ';
  end if;
  if discount_value < 0 or withholding_value < 0 then
    raise exception 'ส่วนลดหรือยอดหัก ณ ที่จ่ายไม่ถูกต้อง';
  end if;

  for line_data in select value from jsonb_array_elements(data->'items')
  loop
    quantity_value := (line_data->>'quantity')::numeric;
    price_value := coalesce((line_data->>'price')::numeric, 0);
    if quantity_value <= 0 or quantity_value > 1000000
      or price_value < 0 or price_value > 99999999
    then
      raise exception 'จำนวนหรือราคาไม่ถูกต้อง';
    end if;
    select * into product_unit_row from public.product_units
    where id = (line_data->>'catalog_id')::uuid
      and company_id = m.company_id and is_active;
    if product_unit_row.id is null then raise exception 'ไม่พบสินค้าในข้อมูลกลาง'; end if;
    subtotal_value := subtotal_value + round(quantity_value * price_value, 2);
    total_quantity_value := total_quantity_value + quantity_value;
    total_weight_value := total_weight_value + coalesce((line_data->>'weight')::numeric, 0);
    pending_value := pending_value or coalesce((line_data->>'request_price')::boolean, false);
  end loop;

  total_value := subtotal_value + shipment_row.extra_charge - discount_value;
  if total_value < 0 or withholding_value > total_value then
    raise exception 'ยอดรวมบิลไม่ถูกต้อง';
  end if;

  select * into invoice_row from public.invoices
  where shipment_id = doc for update;
  select coalesce(sum(amount), 0) into paid_value
  from public.payments where shipment_id = doc;
  if invoice_row.id is not null then
    saved_rounding := invoice_row.total_amount
      - (shipment_row.total_amount - shipment_row.withholding_amount);
  end if;
  invoice_total_value := total_value - withholding_value + saved_rounding;
  if invoice_total_value < paid_value then
    raise exception 'ยอดใหม่ต่ำกว่าเงินที่รับแล้ว กรุณาให้ผู้ดูแลตรวจสอบการรับเงินก่อน';
  end if;

  before_value := jsonb_build_object(
    'shipment', to_jsonb(shipment_row),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.line_no)
      from public.shipment_items item where item.shipment_id = doc
    ), '[]'::jsonb),
    'invoice', to_jsonb(invoice_row)
  );

  update public.price_requests
  set shipment_item_id = null,
      status = case
        when status in ('PENDING_PRICE', 'PENDING_APPROVAL', 'RETURNED') then 'CANCELLED'
        else status
      end,
      note = case
        when status in ('PENDING_PRICE', 'PENDING_APPROVAL', 'RETURNED')
          then concat_ws(' · ', nullif(note, ''), 'ยกเลิกอัตโนมัติเนื่องจากแก้ไขบิล')
        else note
      end
  where shipment_id = doc;

  delete from public.shipment_items where shipment_id = doc;

  update public.shipments
  set sender_party_id = sender_row.id,
      receiver_party_id = receiver_row.id,
      payer_party_id = case when payment_value like '%ORIGIN' then sender_row.id else receiver_row.id end,
      sender_snapshot = to_jsonb(sender_row),
      receiver_snapshot = to_jsonb(receiver_row),
      zone_id = zone_row.id,
      district_id = district_row.id,
      zone_name = zone_row.name,
      district_name = district_row.name,
      zone_color = zone_row.color,
      payment_mode = payment_value,
      credit_days = credit_days_value,
      total_quantity = total_quantity_value,
      total_weight = total_weight_value,
      subtotal = subtotal_value,
      discount = discount_value,
      total_amount = total_value,
      note = coalesce(data->>'note', ''),
      price_reason = coalesce(data->>'discount_reason', ''),
      destination_branch_code = destination_branch.code,
      withholding_amount = withholding_value,
      price_pending = pending_value,
      version_no = version_no + 1
  where id = doc;

  insert into public.customer_relations(
    company_id, receiver_id, sender_id, default_payment_mode, billing_cycle,
    credit_days, is_active, created_by, updated_by
  ) values (
    m.company_id, receiver_row.id, sender_row.id, payment_value,
    coalesce(data->>'billing_cycle', 'MONTH_END'), credit_days_value,
    true, m.id, m.id
  ) on conflict (company_id, receiver_id, sender_id) do nothing;

  select id into relation_id_value from public.customer_relations
  where company_id = m.company_id
    and receiver_id = receiver_row.id and sender_id = sender_row.id;

  for line_data in select value from jsonb_array_elements(data->'items')
  loop
    item_no := item_no + 1;
    item_id_value := coalesce(nullif(line_data->>'id', '')::uuid, gen_random_uuid());
    quantity_value := (line_data->>'quantity')::numeric;
    price_value := coalesce((line_data->>'price')::numeric, 0);
    select * into product_unit_row from public.product_units
    where id = (line_data->>'catalog_id')::uuid
      and company_id = m.company_id and is_active;
    select * into product_family_row from public.product_families
    where id = product_unit_row.product_family_id and company_id = m.company_id;

    insert into public.shipment_items(
      id, shipment_id, line_no, product_id, product_unit_id, description,
      quantity, unit, unit_price, weight, price_pending, width, length, height
    ) values (
      item_id_value, doc, item_no, product_unit_row.id, product_unit_row.id,
      product_family_row.name, quantity_value, product_unit_row.unit_name,
      price_value, coalesce((line_data->>'weight')::numeric, product_unit_row.default_weight, 0),
      coalesce((line_data->>'request_price')::boolean, false),
      coalesce(nullif(line_data->>'width', '')::numeric, product_unit_row.default_width),
      coalesce(nullif(line_data->>'length', '')::numeric, product_unit_row.default_length),
      coalesce(nullif(line_data->>'height', '')::numeric, product_unit_row.default_height)
    ) returning id into shipment_item_id_value;

    insert into public.receiver_product_links(
      company_id, receiver_id, product_unit_id, is_active, created_by, updated_by
    ) values (
      m.company_id, receiver_row.id, product_unit_row.id, true, m.id, m.id
    ) on conflict (company_id, receiver_id, product_unit_id) do update
      set is_active = true, updated_at = now(), updated_by = m.id;

    insert into public.customer_relation_products(
      company_id, customer_relation_id, product_unit_id, is_active, created_by, updated_by
    ) values (
      m.company_id, relation_id_value, product_unit_row.id, true, m.id, m.id
    ) on conflict (company_id, customer_relation_id, product_unit_id) do update
      set is_active = true, updated_at = now(), updated_by = m.id;

    if coalesce((line_data->>'request_price')::boolean, false) then
      insert into public.price_requests(
        company_id, shipment_id, shipment_item_id, receiver_id, sender_id,
        product_unit_id, branch_id, payment_mode, bill_number, quantity,
        status, note, requested_by
      ) values (
        m.company_id, doc, shipment_item_id_value, receiver_row.id, sender_row.id,
        product_unit_row.id, destination_branch.id, payment_value,
        shipment_row.shipment_no, quantity_value, 'PENDING_PRICE',
        'สร้างใหม่จากการแก้ไขบิล', m.id
      );
    end if;
  end loop;

  update public.shipment_stops
  set contact_snapshot = to_jsonb(sender_row)
  where shipment_id = doc and kind = 'PICKUP';
  update public.shipment_stops
  set contact_snapshot = to_jsonb(receiver_row)
  where shipment_id = doc and kind = 'DELIVERY';

  update public.invoices
  set payer_party_id = case when payment_value like '%ORIGIN' then sender_row.id else receiver_row.id end,
      total_amount = invoice_total_value,
      due_date = case
        when payment_value not like 'CREDIT%' then (now() at time zone 'Asia/Bangkok')::date
        when coalesce(data->>'billing_cycle', 'MONTH_END') = 'MONTH_END'
          then (date_trunc('month', now() at time zone 'Asia/Bangkok') + interval '1 month - 1 day')::date
        else (now() at time zone 'Asia/Bangkok')::date + credit_days_value
      end
  where shipment_id = doc;

  select coalesce(max(revision_no), 0) + 1 into revision_value
  from public.bill_revisions where shipment_id = doc;
  select jsonb_build_object(
    'shipment', to_jsonb(updated_shipment),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.line_no)
      from public.shipment_items item where item.shipment_id = doc
    ), '[]'::jsonb),
    'invoice', to_jsonb(updated_invoice)
  ) into after_value
  from public.shipments updated_shipment
  left join public.invoices updated_invoice on updated_invoice.shipment_id = updated_shipment.id
  where updated_shipment.id = doc;

  insert into public.bill_revisions(
    company_id, shipment_id, revision_no, reason, before_data, after_data, revised_by
  ) values (
    m.company_id, doc, revision_value,
    coalesce(nullif(edit_reason, ''), 'แก้ไขก่อนขึ้นรถ'),
    before_value, after_value, m.id
  );
  insert into public.shipment_events(
    company_id, shipment_id, event_type, branch_id, detail, created_by
  ) values (
    m.company_id, doc, 'EDITED', m.branch_id,
    jsonb_build_object(
      'revision_no', revision_value,
      'reason', coalesce(nullif(edit_reason, ''), 'แก้ไขก่อนขึ้นรถ'),
      'status', shipment_row.shipment_status
    ), m.id
  );
  insert into public.audit_logs(
    company_id, actor_id, action, entity_type, record_id, detail
  ) values (
    m.company_id, m.id, 'EDIT', 'shipment', doc,
    jsonb_build_object(
      'revision_no', revision_value,
      'reason', coalesce(nullif(edit_reason, ''), 'แก้ไขก่อนขึ้นรถ'),
      'status', shipment_row.shipment_status
    )
  );

  return jsonb_build_object(
    'id', doc,
    'number', shipment_row.shipment_no,
    'version_no', shipment_row.version_no + 1,
    'revision_no', revision_value
  );
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
