create or replace function private.normalize_shipment_district()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if btrim(coalesce(new.receiver_snapshot->>'district', '')) = '' then
    if new.destination_branch_code = 'SWL' then
      select id, name into new.district_id, new.district_name
      from public.districts
      where zone_id = new.zone_id and is_active and name = 'สวรรคโลก'
      limit 1;
    else
      select id, name into new.district_id, new.district_name
      from public.districts
      where zone_id = new.zone_id and is_active and name like 'เมือง%'
      order by name
      limit 1;
    end if;

    if new.district_id is null then
      select id, name into new.district_id, new.district_name
      from public.districts
      where zone_id = new.zone_id and name = 'ไม่ระบุอำเภอ'
      limit 1;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists normalize_shipment_district on public.shipments;
create trigger normalize_shipment_district
before insert or update of receiver_snapshot, zone_id, district_id, district_name,
  destination_branch_code
on public.shipments
for each row execute function private.normalize_shipment_district();

with district_defaults as (
  select shipment.id as shipment_id, district.id as district_id,
    district.name as district_name
  from public.shipments as shipment
  join lateral (
    select candidate.id, candidate.name
    from public.districts as candidate
    where candidate.zone_id = shipment.zone_id
      and candidate.is_active
      and (
        (shipment.destination_branch_code = 'SWL' and candidate.name = 'สวรรคโลก')
        or
        (shipment.destination_branch_code <> 'SWL' and candidate.name like 'เมือง%')
      )
    order by candidate.name
    limit 1
  ) as district on true
  where btrim(coalesce(shipment.receiver_snapshot->>'district', '')) = ''
)
update public.shipments as shipment
set district_id = district_defaults.district_id,
    district_name = district_defaults.district_name
from district_defaults
where shipment.id = district_defaults.shipment_id;
