create index if not exists audit_logs_actor_id_fk on public.audit_logs(actor_id);
create index if not exists invoices_payer_party_id_fk on public.invoices(payer_party_id);
create index if not exists parties_created_by_fk on public.parties(created_by);
create index if not exists payments_received_by_fk on public.payments(received_by);
create index if not exists price_rules_created_by_fk on public.price_rules(created_by);
create index if not exists price_rules_product_company_fk on public.price_rules(product_id, company_id);
create index if not exists price_rules_zone_company_fk on public.price_rules(zone_id, company_id);
create index if not exists profiles_branch_company_fk on public.profiles(branch_id, company_id);
create index if not exists shipment_files_created_by_fk on public.shipment_files(created_by);
create index if not exists shipment_items_price_rule_id_fk on public.shipment_items(price_rule_id);
create index if not exists shipment_items_product_id_fk on public.shipment_items(product_id);
create index if not exists shipments_branch_company_fk on public.shipments(branch_id, company_id);
create index if not exists shipments_created_by_fk on public.shipments(created_by);
create index if not exists shipments_district_zone_fk on public.shipments(district_id, zone_id);
create index if not exists shipments_payer_company_fk on public.shipments(payer_party_id, company_id);
create index if not exists shipments_receiver_company_fk on public.shipments(receiver_party_id, company_id);
create index if not exists shipments_sender_company_fk on public.shipments(sender_party_id, company_id);
create index if not exists shipments_zone_company_fk on public.shipments(zone_id, company_id);
create index if not exists staff_invites_branch_company_fk on public.staff_invites(branch_id, company_id);
create index if not exists staff_invites_company_fk on public.staff_invites(company_id);

drop policy if exists no_direct_client_access on private.document_sequences;
create policy no_direct_client_access
  on private.document_sequences
  for all
  to public
  using (false)
  with check (false);
