-- Expose the first product and unit in Thai alphabetical order so the
-- register can sort the full result set before applying pagination.
create view public.shipment_register_sorted
with (security_invoker = true)
as
select r.*, names.sort_product, names.sort_unit
from public.shipment_register r
left join lateral (
  select
    min(item.description collate "th-x-icu") as sort_product,
    min(item.unit collate "th-x-icu") as sort_unit
  from public.shipment_items item
  where item.shipment_id = r.id
) names on true;

revoke all on public.shipment_register_sorted from anon;
grant select on public.shipment_register_sorted to authenticated;
