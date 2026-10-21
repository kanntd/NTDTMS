-- A COD bill can be delivered before its item prices are known. Submit those
-- prices for accounting review without inventing a payment on a zero bill.
create or replace function private.submit_cod_item_prices(data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member public.profiles := private.require_role(array['owner','admin','clerk','accountant']);
  shipment public.shipments;
  shipment_item public.shipment_items;
  price_request public.price_requests;
  item_data jsonb;
  shipment_id_value uuid := (data->>'shipment_id')::uuid;
  destination_branch_id uuid;
  seen_items uuid[] := '{}';
  item_id_value uuid;
  item_price numeric;
  submitted_count integer := 0;
begin
  if shipment_id_value is null
     or jsonb_typeof(data->'items') is distinct from 'array' then
    raise exception 'กรุณาระบุราคาสินค้าอย่างน้อยหนึ่งรายการ';
  end if;
  if jsonb_array_length(data->'items') not between 1 and 100 then
    raise exception 'กรุณาระบุราคาสินค้าอย่างน้อยหนึ่งรายการ';
  end if;

  -- Price approval takes these locks in the same order.
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
    raise exception 'ไม่พบบิลเงินสดปลายทางหรือไม่มีสิทธิ์';
  end if;
  if not shipment.price_pending then
    raise exception 'บิลนี้ไม่มีรายการรอราคา กรุณาโหลดข้อมูลใหม่';
  end if;
  select id into destination_branch_id from public.branches
  where company_id = member.company_id
    and code = shipment.destination_branch_code;
  destination_branch_id := coalesce(destination_branch_id, shipment.branch_id);

  for item_data in select value from jsonb_array_elements(data->'items') loop
    item_id_value := (item_data->>'item_id')::uuid;
    item_price := (item_data->>'unit_price')::numeric;
    if item_id_value is null or item_id_value = any(seen_items)
       or item_price is null or item_price < 0 or item_price > 99999999
       or item_price <> round(item_price, 2) then
      raise exception 'ราคาต่อหน่วยไม่ถูกต้องหรือมีรายการซ้ำ';
    end if;
    seen_items := array_append(seen_items, item_id_value);
    select * into shipment_item from public.shipment_items
    where id = item_id_value and shipment_id = shipment.id;
    if shipment_item.id is null or shipment_item.product_unit_id is null then
      raise exception 'ไม่พบรายการสินค้าที่เสนอราคาได้';
    end if;
    if not shipment_item.price_pending
       and shipment_item.unit_price = item_price then
      continue;
    end if;

    select * into price_request from public.price_requests
    where shipment_item_id = item_id_value
      and status in ('PENDING_PRICE','PENDING_APPROVAL','RETURNED')
    order by requested_at desc, id desc limit 1 for update;
    if price_request.id is not null then
      if price_request.status = 'PENDING_APPROVAL' then
        if price_request.proposed_price is distinct from item_price then
          raise exception 'รายการสินค้านี้มีราคาเสนอรอบัญชีแล้ว';
        end if;
        continue;
      end if;
      update public.price_requests set proposed_price = item_price,
        status = 'PENDING_APPROVAL', submitted_at = now(),
        submitted_by = member.id, returned_at = null, returned_by = null,
        return_reason = null, note = 'ราคาแจ้งจากหน้าเก็บเงิน COD'
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
  end loop;

  if submitted_count > 0 then
    insert into public.audit_logs(company_id, actor_id, action, entity_type,
      record_id, detail)
    values(member.company_id, member.id, 'SUBMIT_COD_PRICES', 'shipment',
      shipment.id, jsonb_build_object('submitted_prices', submitted_count));
  end if;
  return jsonb_build_object('submitted_prices', submitted_count);
end $$;

create or replace function public.submit_cod_item_prices(data jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.submit_cod_item_prices(data)
$$;
revoke all on function private.submit_cod_item_prices(jsonb)
from public, anon, authenticated;
grant execute on function private.submit_cod_item_prices(jsonb)
to authenticated;
revoke all on function public.submit_cod_item_prices(jsonb) from public, anon;
grant execute on function public.submit_cod_item_prices(jsonb) to authenticated;

notify pgrst, 'reload schema';
