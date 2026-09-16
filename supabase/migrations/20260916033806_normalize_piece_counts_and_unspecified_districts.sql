insert into public.districts(zone_id, name, is_active)
select id, 'ไม่ระบุอำเภอ', true
from public.service_zones
on conflict (zone_id, name) do update set is_active = true;

create or replace function private.normalize_shipment_district()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if btrim(coalesce(new.receiver_snapshot->>'district', '')) = '' then
    select id into new.district_id
    from public.districts
    where zone_id = new.zone_id and name = 'ไม่ระบุอำเภอ';
    new.district_name := 'ไม่ระบุอำเภอ';
  end if;
  return new;
end
$$;

drop trigger if exists normalize_shipment_district on public.shipments;
create trigger normalize_shipment_district
before insert or update of receiver_snapshot, zone_id, district_id, district_name
on public.shipments
for each row execute function private.normalize_shipment_district();

update public.shipments as shipment
set district_id = district.id,
    district_name = 'ไม่ระบุอำเภอ'
from public.districts as district
where district.zone_id = shipment.zone_id
  and district.name = 'ไม่ระบุอำเภอ'
  and btrim(coalesce(shipment.receiver_snapshot->>'district', '')) = '';

update public.shipment_items as item
set quantity = 10
from public.shipments as shipment
where shipment.id = item.shipment_id
  and shipment.shipment_no = 'NTD-BKK-202609-00055'
  and shipment.destination_branch_code = 'KPT'
  and item.quantity = 9.9999;

update public.shipments as shipment
set total_quantity = totals.quantity
from (
  select shipment_id, sum(quantity) as quantity
  from public.shipment_items
  group by shipment_id
) as totals
where shipment.id = totals.shipment_id
  and shipment.shipment_no = 'NTD-BKK-202609-00055'
  and shipment.destination_branch_code = 'KPT';

revoke all on function private.normalize_shipment_district() from public, anon;
grant execute on function private.normalize_shipment_district() to authenticated;
