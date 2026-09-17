create index if not exists load_manifests_company
  on public.load_manifests(company_id);
create index if not exists load_manifests_origin_branch
  on public.load_manifests(origin_branch_id);
create index if not exists load_manifests_destination_branch
  on public.load_manifests(destination_branch_id);
create index if not exists load_manifests_trip_run
  on public.load_manifests(trip_run_id);
create index if not exists load_manifests_vehicle
  on public.load_manifests(vehicle_id);
create index if not exists load_manifests_driver
  on public.load_manifests(driver_employee_id);
create index if not exists load_manifests_created_by
  on public.load_manifests(created_by);
create index if not exists load_manifests_updated_by
  on public.load_manifests(updated_by);

create index if not exists load_manifest_items_company
  on public.load_manifest_items(company_id);
create index if not exists load_manifest_items_created_by
  on public.load_manifest_items(created_by);

create index if not exists delivery_attempts_company
  on public.delivery_attempts(company_id);
create index if not exists delivery_attempts_created_by
  on public.delivery_attempts(created_by);

create index if not exists shipment_events_company
  on public.shipment_events(company_id);
create index if not exists shipment_events_branch
  on public.shipment_events(branch_id);
create index if not exists shipment_events_manifest
  on public.shipment_events(manifest_id);
create index if not exists shipment_events_created_by
  on public.shipment_events(created_by);

create index if not exists bill_revisions_company
  on public.bill_revisions(company_id);
create index if not exists bill_revisions_revised_by
  on public.bill_revisions(revised_by);

create index if not exists print_logs_company
  on public.print_logs(company_id);
create index if not exists print_logs_printed_by
  on public.print_logs(printed_by);
