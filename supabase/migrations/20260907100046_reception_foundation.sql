-- NTD TMS reception module. Remote migration history is managed by Supabase MCP.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.companies (
 id uuid primary key default gen_random_uuid(), code text not null unique,
 name text not null, created_at timestamptz not null default now()
);
create table public.branches (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies,
 code text not null, name text not null, unique(company_id, code), unique(id, company_id)
);
create table public.profiles (
 id uuid primary key references auth.users on delete restrict,
 company_id uuid not null references public.companies, branch_id uuid not null,
 display_name text not null, email text not null,
 role text not null check(role in ('owner','admin','clerk','accountant','viewer')),
 is_active boolean not null default true, created_at timestamptz not null default now(),
 foreign key(branch_id, company_id) references public.branches(id, company_id)
);
create table public.staff_invites (
 email text primary key check(email=lower(trim(email))), display_name text not null,
 company_id uuid not null references public.companies, branch_id uuid not null,
 role text not null check(role in ('owner','admin','clerk','accountant','viewer')),
 is_active boolean not null default true, created_at timestamptz not null default now(),
 foreign key(branch_id, company_id) references public.branches(id, company_id)
);
create table public.service_zones (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies,
 code text not null, name text not null, color text not null check(color ~ '^#[0-9a-fA-F]{6}$'),
 sort_order integer not null default 0, unique(company_id,code), unique(id, company_id)
);
create table public.districts (
 id uuid primary key default gen_random_uuid(), zone_id uuid not null references public.service_zones,
 name text not null, unique(zone_id,name), unique(id,zone_id)
);
create table public.parties (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies,
 display_name text not null check(length(trim(display_name)) between 1 and 255),
 phone text not null check(length(phone) between 8 and 30), address text not null check(length(address) between 1 and 1500),
 tax_id text not null default '', credit_limit numeric(18,2) not null default 0 check(credit_limit >= 0),
 credit_days integer not null default 30 check(credit_days between 0 and 365),
 is_active boolean not null default true, version_no integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references auth.users, unique(id, company_id)
);
create table public.products (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies,
 name text not null, unit text not null, unique(company_id,name,unit), unique(id,company_id)
);
create table public.price_rules (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies,
 product_id uuid not null, zone_id uuid, unit_price numeric(18,2) not null check(unit_price>=0),
 version_no integer not null check(version_no>0), created_at timestamptz not null default now(),
 created_by uuid not null references auth.users,
 foreign key(product_id, company_id) references public.products(id,company_id),
 foreign key(zone_id,company_id) references public.service_zones(id,company_id)
);
create table private.document_sequences (
 branch_id uuid not null references public.branches, document_type text not null,
 period text not null, last_number bigint not null, primary key(branch_id,document_type,period)
);
create table public.shipments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies,
 branch_id uuid not null, request_id uuid not null, shipment_no text not null,
 sender_party_id uuid not null, receiver_party_id uuid not null, payer_party_id uuid not null,
 sender_snapshot jsonb not null, receiver_snapshot jsonb not null,
 zone_id uuid not null, district_id uuid not null,
 zone_name text not null, district_name text not null, zone_color text not null,
 payment_mode text not null check(payment_mode in ('CASH_ORIGIN','CASH_DESTINATION','CREDIT_ORIGIN','CREDIT_DESTINATION')),
 credit_days integer not null check(credit_days between 0 and 365),
 total_quantity numeric(18,4) not null check(total_quantity>0), total_weight numeric(18,4) not null default 0 check(total_weight>=0),
 subtotal numeric(18,2) not null check(subtotal>=0), extra_charge numeric(18,2) not null default 0 check(extra_charge>=0),
 discount numeric(18,2) not null default 0 check(discount>=0), total_amount numeric(18,2) not null check(total_amount>0),
 shipment_status text not null default 'RECEIVED' check(shipment_status in ('RECEIVED','IN_TRANSIT','DELIVERED','CANCELLED')),
 received_at timestamptz not null default now(), note text not null default '',
 dropoff_name text not null default '', dropoff_phone text not null default '', price_reason text not null default '',
 created_by uuid not null references auth.users, version_no integer not null default 1,
 cancelled_at timestamptz, cancel_reason text,
 foreign key(branch_id,company_id) references public.branches(id,company_id),
 foreign key(sender_party_id,company_id) references public.parties(id,company_id),
 foreign key(receiver_party_id,company_id) references public.parties(id,company_id),
 foreign key(payer_party_id,company_id) references public.parties(id,company_id),
 foreign key(zone_id,company_id) references public.service_zones(id,company_id),
 foreign key(district_id,zone_id) references public.districts(id,zone_id),
 unique(company_id,request_id), unique(branch_id,shipment_no),
 check(total_amount=subtotal+extra_charge-discount),
 check(payment_mode not like 'CREDIT%' or credit_days>0)
);
create table public.shipment_items (
 id uuid primary key default gen_random_uuid(), shipment_id uuid not null references public.shipments,
 line_no integer not null, product_id uuid references public.products,
 description text not null check(length(description) between 1 and 255),
 quantity numeric(18,4) not null check(quantity>0 and quantity<=1000000), unit text not null,
 unit_price numeric(18,2) not null check(unit_price>=0),
 line_total numeric(18,2) generated always as (round(quantity*unit_price,2)) stored,
 weight numeric(18,4) not null default 0 check(weight>=0), fragile boolean not null default false,
 price_rule_id uuid references public.price_rules, unique(shipment_id,line_no)
);
create table public.shipment_stops (
 id uuid primary key default gen_random_uuid(), shipment_id uuid not null references public.shipments,
 sequence integer not null, kind text not null check(kind in ('PICKUP','DELIVERY')),
 contact_snapshot jsonb not null, unique(shipment_id,sequence)
);
create table public.invoices (
 id uuid primary key default gen_random_uuid(), shipment_id uuid not null unique references public.shipments,
 invoice_no text not null, payer_party_id uuid not null references public.parties,
 total_amount numeric(18,2) not null check(total_amount>0),
 invoice_date date not null default (now() at time zone 'Asia/Bangkok')::date,
 due_date date not null, status text not null default 'ISSUED' check(status in ('ISSUED','VOID'))
);
create table public.payments (
 id uuid primary key default gen_random_uuid(), shipment_id uuid not null references public.shipments,
 request_id uuid not null unique, payment_no text not null,
 amount numeric(18,2) not null check(amount>0),
 method text not null check(method in ('CASH','TRANSFER','QR')),
 reference_no text not null default '', received_at timestamptz not null default now(),
 received_by uuid not null references auth.users
);
create table public.payment_allocations (
 id uuid primary key default gen_random_uuid(), payment_id uuid not null unique references public.payments,
 invoice_id uuid not null references public.invoices, amount numeric(18,2) not null check(amount>0)
);
create table public.shipment_files (
 id uuid primary key default gen_random_uuid(), shipment_id uuid not null references public.shipments,
 object_key text not null unique, filename text not null,
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 byte_size integer not null check(byte_size between 1 and 5242880),
 created_at timestamptz not null default now(), created_by uuid not null references auth.users
);
create table public.audit_logs (
 id bigint generated always as identity primary key, company_id uuid not null references public.companies,
 actor_id uuid not null references auth.users, action text not null, entity_type text not null,
 record_id uuid not null, detail jsonb not null default '{}', occurred_at timestamptz not null default now()
);

create index profiles_company on public.profiles(company_id,branch_id);
create index parties_search on public.parties(company_id,display_name);
create index parties_phone on public.parties(company_id,phone);
create index rules_lookup on public.price_rules(company_id,product_id,zone_id,created_at desc);
create index shipments_reception on public.shipments(company_id,branch_id,received_at desc,id);
create index shipments_payer on public.shipments(payer_party_id);
create index shipments_sender on public.shipments(sender_party_id);
create index shipments_receiver on public.shipments(receiver_party_id);
create index shipments_zone on public.shipments(zone_id,district_id);
create index payments_shipment on public.payments(shipment_id);
create index allocations_invoice on public.payment_allocations(invoice_id);
create index files_shipment on public.shipment_files(shipment_id);
create index audit_company_time on public.audit_logs(company_id,occurred_at desc);

-- Authorization reads trusted profile rows, never user-editable JWT metadata.
create function private.member() returns public.profiles language sql stable security definer set search_path='' as $$
 select p from public.profiles p where p.id=(select auth.uid()) and p.is_active
$$;
create function private.can_read_document(doc uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.shipments s, private.member() m where s.id=doc and s.company_id=m.company_id and (m.role in ('owner','admin','accountant') or s.branch_id=m.branch_id))
$$;
create function private.require_role(allowed text[]) returns public.profiles language plpgsql stable security definer set search_path='' as $$
 declare m public.profiles; begin m:=private.member();
 if m.id is null or not(m.role=any(allowed)) then raise exception 'ไม่มีสิทธิ์ทำรายการนี้'; end if;
 return m; end $$;
create function private.next_number(b uuid, typ text) returns text language plpgsql security definer set search_path='' as $$
 declare n bigint; period text:=to_char(now() at time zone 'Asia/Bangkok','YYYYMM'); branch_code text;
 begin
 insert into private.document_sequences values(b,typ,period,1)
 on conflict(branch_id,document_type,period) do update set last_number=private.document_sequences.last_number+1 returning last_number into n;
 select code into branch_code from public.branches where id=b;
 return typ||'-'||branch_code||'-'||period||'-'||lpad(n::text,greatest(5,length(n::text)),'0');
 end $$;
create function private.provision_staff() returns trigger language plpgsql security definer set search_path='' as $$
 declare invitation public.staff_invites; begin
 if new.email_confirmed_at is null then return new; end if;
 select * into invitation from public.staff_invites where email=lower(new.email) and is_active;
 if found then
 insert into public.profiles(id,company_id,branch_id,display_name,email,role)
 values(new.id,invitation.company_id,invitation.branch_id,invitation.display_name,lower(new.email),invitation.role)
 on conflict(id) do nothing;
 end if;
 return new; end $$;
create trigger provision_ntd_staff after insert or update of email_confirmed_at on auth.users for each row execute function private.provision_staff();

do $$ declare t text; begin
 foreach t in array array['companies','branches','profiles','staff_invites','service_zones','districts','parties','products','price_rules','shipments','shipment_items','shipment_stops','invoices','payments','payment_allocations','shipment_files','audit_logs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
 end $$;
alter table private.document_sequences enable row level security;
create policy member_company on public.companies for select to authenticated using(id=(select (private.member()).company_id));
create policy member_branches on public.branches for select to authenticated using(company_id=(select (private.member()).company_id));
create policy member_profiles on public.profiles for select to authenticated using(id=(select auth.uid()) or (company_id=(select (private.member()).company_id) and (select (private.member()).role) in ('owner','admin')));
create policy manager_invites on public.staff_invites for select to authenticated using(company_id=(select (private.member()).company_id) and (select (private.member()).role) in ('owner','admin'));
create policy member_zones on public.service_zones for select to authenticated using(company_id=(select (private.member()).company_id));
create policy member_districts on public.districts for select to authenticated using(exists(select 1 from public.service_zones z where z.id=zone_id));
create policy member_parties on public.parties for select to authenticated using(company_id=(select (private.member()).company_id));
create policy member_products on public.products for select to authenticated using(company_id=(select (private.member()).company_id));
create policy member_prices on public.price_rules for select to authenticated using(company_id=(select (private.member()).company_id));
create policy member_shipments on public.shipments for select to authenticated using(company_id=(select (private.member()).company_id) and (branch_id=(select (private.member()).branch_id) or (select (private.member()).role) in ('owner','admin','accountant')));
do $$ declare t text; begin
 foreach t in array array['shipment_items','shipment_stops','invoices','payments','shipment_files'] loop
 execute format('create policy document_read on public.%I for select to authenticated using(private.can_read_document(shipment_id))',t);
 end loop; end $$;
create policy allocation_read on public.payment_allocations for select to authenticated using(exists(select 1 from public.invoices i where i.id=invoice_id));
create policy audit_read on public.audit_logs for select to authenticated using(company_id=(select (private.member()).company_id) and (select (private.member()).role) in ('owner','admin'));

create view public.shipment_register with (security_invoker=true) as
 select s.*, i.id invoice_id, i.due_date,
 coalesce(a.paid,0)::numeric(18,2) paid_amount,
 case when s.shipment_status='CANCELLED' then 0 else s.total_amount-coalesce(a.paid,0) end::numeric(18,2) outstanding_amount
 from public.shipments s join public.invoices i on i.shipment_id=s.id
 left join (select invoice_id,sum(amount) paid from public.payment_allocations group by invoice_id) a on a.invoice_id=i.id;
revoke all on public.shipment_register from anon;
grant select on public.shipment_register to authenticated;

create function private.save_party(data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
 declare m public.profiles:=private.require_role(array['owner','admin','clerk','accountant']); pid uuid:=nullif(data->>'id','')::uuid; old public.parties;
 begin
 if pid is null then
 insert into public.parties(company_id,display_name,phone,address,tax_id,created_by)
 values(m.company_id,trim(data->>'display_name'),trim(data->>'phone'),trim(data->>'address'),coalesce(data->>'tax_id',''),m.id) returning id into pid;
 else
 select * into old from public.parties where id=pid and company_id=m.company_id for update;
 if not found then raise exception 'ไม่พบลูกค้า'; end if;
 if m.role not in ('owner','admin') and (data ? 'credit_limit' or data ? 'is_active') then raise exception 'ต้องให้ผู้ดูแลแก้ไขวงเงินและสถานะ'; end if;
 update public.parties set display_name=trim(data->>'display_name'), phone=trim(data->>'phone'),address=trim(data->>'address'),
 tax_id=coalesce(data->>'tax_id',old.tax_id),
 credit_limit=coalesce((data->>'credit_limit')::numeric,old.credit_limit),
 credit_days=coalesce((data->>'credit_days')::integer,old.credit_days),
 is_active=coalesce((data->>'is_active')::boolean,old.is_active),version_no=version_no+1,updated_at=now() where id=pid;
 end if;
 insert into public.audit_logs(company_id,actor_id,action,entity_type,record_id,detail)
 values(m.company_id,m.id,'SAVE','party',pid,jsonb_build_object('previous_credit_limit',old.credit_limit,'credit_limit',data->'credit_limit'));
 return pid; end $$;
create function public.save_party(data jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.save_party(data) $$;

create function private.receive_payment(doc uuid, amount numeric, method text, reference text, request uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare m public.profiles:=private.require_role(array['owner','admin','clerk','accountant']); s public.shipments; inv public.invoices; paid numeric; pid uuid; existing public.payments;
 begin
 select * into s from public.shipments where id=doc for update;
 if not found or not private.can_read_document(doc) then raise exception 'ไม่พบเอกสารหรือไม่มีสิทธิ์'; end if;
 select * into existing from public.payments where request_id=request;
 if found then
 if existing.shipment_id<>doc or existing.amount<>amount or existing.method<>method then raise exception 'คำขอซ้ำมีข้อมูลไม่ตรงกัน'; end if;
 return existing.id; end if;
 if s.shipment_status='CANCELLED' then raise exception 'เอกสารถูกยกเลิก'; end if;
 select * into inv from public.invoices where shipment_id=doc;
 select coalesce(sum(a.amount),0) into paid from public.payment_allocations a where invoice_id=inv.id;
 if amount is null or amount<=0 or amount<>round(amount,2) or amount>inv.total_amount-paid then raise exception 'ยอดรับเงินต้องมากกว่า 0 และไม่เกินยอดค้างชำระ'; end if;
 insert into public.payments(shipment_id,request_id,payment_no,amount,method,reference_no,received_by)
 values(doc,request,private.next_number(s.branch_id,'RC'),amount,method,coalesce(reference,''),m.id) returning id into pid;
 insert into public.payment_allocations(payment_id,invoice_id,amount) values(pid,inv.id,amount);
 insert into public.audit_logs(company_id,actor_id,action,entity_type,record_id,detail) values(m.company_id,m.id,'COLLECT','payment',pid,jsonb_build_object('amount',amount,'shipment_id',doc));
 return pid; end $$;
create function public.receive_payment(doc uuid, amount numeric, method text, reference text, request uuid) returns uuid language sql security invoker set search_path='' as $$ select private.receive_payment(doc,amount,method,reference,request) $$;

create function private.issue_shipment(data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
 declare m public.profiles:=private.require_role(array['owner','admin','clerk']);
 sid uuid; sender uuid; receiver uuid; payer uuid; z public.service_zones; d public.districts; customer public.parties;
 line jsonb; product public.products; rule public.price_rules; total numeric:=0; qty numeric:=0; weight numeric:=0;
 extra numeric:=coalesce((data->>'extra_charge')::numeric,0); disc numeric:=coalesce((data->>'discount')::numeric,0);
 price numeric; quantity numeric; mode text:=data->>'payment_mode'; days integer:=0; override_needed boolean:=false;
 req uuid:=(data->>'request_id')::uuid; no text; line_no integer:=0; debt numeric;
 begin
 -- Serialize retries before any customer or document writes.
 perform pg_advisory_xact_lock(hashtextextended(m.company_id::text||req::text,0));
 select id into sid from public.shipments where company_id=m.company_id and request_id=req;
 if found then if not private.can_read_document(sid) then raise exception 'ไม่มีสิทธิ์'; end if; return sid; end if;
 if jsonb_typeof(data->'items')<>'array' or jsonb_array_length(data->'items') not between 1 and 100 then raise exception 'ต้องมีสินค้า 1 ถึง 100 รายการ'; end if;
 select * into z from public.service_zones where id=(data->>'zone_id')::uuid and company_id=m.company_id;
 if not found then raise exception 'จังหวัดไม่ถูกต้อง'; end if;
 select * into d from public.districts where id=(data->>'district_id')::uuid and zone_id=z.id;
 if not found then raise exception 'อำเภอไม่อยู่ในจังหวัดที่เลือก'; end if;
 foreach mode in array array[data->>'payment_mode'] loop
 if mode is null or mode not in ('CASH_ORIGIN','CASH_DESTINATION','CREDIT_ORIGIN','CREDIT_DESTINATION') then raise exception 'ประเภทชำระเงินไม่ถูกต้อง'; end if;
 end loop;
 if length(coalesce(data->>'note',''))>2000 or length(coalesce(data->>'price_reason',''))>1000 then raise exception 'ข้อความยาวเกินกำหนด'; end if;
 for line in select value from jsonb_array_elements(data->'items') loop
 quantity:=(line->>'quantity')::numeric; price:=(line->>'unit_price')::numeric;
 if quantity is null or quantity<=0 or quantity>1000000 or quantity<>round(quantity,4) or price is null or price<0 or price>99999999 or price<>round(price,2) then raise exception 'จำนวนหรือราคาไม่ถูกต้อง'; end if;
 select * into product from public.products where id=nullif(line->>'product_id','')::uuid and company_id=m.company_id;
 if product.id is null or product.unit<>line->>'unit' then override_needed:=true; end if;
 select * into rule from public.price_rules where company_id=m.company_id and product_id=product.id and (zone_id=z.id or zone_id is null)
 order by (zone_id is not null) desc, created_at desc,version_no desc limit 1;
 if rule.id is null or price<>rule.unit_price then override_needed:=true; end if;
 total:=total+round(quantity*price,2); qty:=qty+quantity; weight:=weight+coalesce((line->>'weight')::numeric,0);
 end loop;
 if extra<0 or disc<0 or extra<>round(extra,2) or disc<>round(disc,2) or total+extra-disc<=0 then raise exception 'ค่าขนส่งรวมไม่ถูกต้อง'; end if;
 override_needed:=override_needed or extra<>0 or disc<>0;
 if override_needed and (m.role not in ('owner','admin') or length(trim(coalesce(data->>'price_reason','')))<3) then raise exception 'ราคานอกตารางต้องให้ผู้ดูแลระบุเหตุผลอนุมัติ'; end if;
 -- Existing parties are referenced without overwriting the master address.
 sender:=nullif(data->'sender'->>'id','')::uuid;
 if sender is null then sender:=private.save_party(data->'sender'); end if;
 receiver:=nullif(data->'receiver'->>'id','')::uuid;
 if receiver is null then receiver:=private.save_party(data->'receiver'); end if;
 if not exists(select 1 from public.parties where id=sender and company_id=m.company_id and is_active) or not exists(select 1 from public.parties where id=receiver and company_id=m.company_id and is_active) then raise exception 'ลูกค้าไม่พร้อมใช้งาน'; end if;
 if length(trim(coalesce(data->'sender'->>'display_name','')))=0 or length(trim(coalesce(data->'receiver'->>'display_name','')))=0 or length(trim(coalesce(data->'sender'->>'address','')))=0 or length(trim(coalesce(data->'receiver'->>'address','')))=0 then raise exception 'ชื่อและที่อยู่ต้องครบ'; end if;
 payer:=case when mode like '%ORIGIN' then sender else receiver end;
 select * into customer from public.parties where id=payer for update;
 if mode like 'CREDIT%' then
 days:=(data->>'credit_days')::integer;
 if days is null or days<=0 or days>customer.credit_days then raise exception 'เครดิตเทอมเกินที่ลูกค้าได้รับอนุมัติ'; end if;
 select coalesce(sum(i.total_amount-coalesce(a.paid,0)),0) into debt from public.invoices i
 left join (select invoice_id,sum(amount) paid from public.payment_allocations group by invoice_id) a on a.invoice_id=i.id where i.payer_party_id=payer and i.status<>'VOID';
 if debt+total+extra-disc>customer.credit_limit then raise exception 'วงเงินเครดิตไม่เพียงพอ กรุณาให้ผู้ดูแลตรวจสอบ'; end if;
 end if;
 no:=private.next_number(m.branch_id,'NTD');
 insert into public.shipments(company_id,branch_id,request_id,shipment_no,sender_party_id,receiver_party_id,payer_party_id,sender_snapshot,receiver_snapshot,zone_id,district_id,zone_name,district_name,zone_color,payment_mode,credit_days,total_quantity,total_weight,subtotal,extra_charge,discount,total_amount,note,dropoff_name,dropoff_phone,price_reason,created_by)
 values(m.company_id,m.branch_id,req,no,sender,receiver,payer,data->'sender',data->'receiver',z.id,d.id,z.name,d.name,z.color,mode,days,qty,weight,total,extra,disc,total+extra-disc,coalesce(data->>'note',''),coalesce(data->>'dropoff_name',''),coalesce(data->>'dropoff_phone',''),coalesce(data->>'price_reason',''),m.id) returning id into sid;
 for line in select value from jsonb_array_elements(data->'items') loop
 line_no:=line_no+1;
 select * into rule from public.price_rules where company_id=m.company_id and product_id=nullif(line->>'product_id','')::uuid and (zone_id=z.id or zone_id is null) order by (zone_id is not null) desc,created_at desc,version_no desc limit 1;
 insert into public.shipment_items(shipment_id,line_no,product_id,description,quantity,unit,unit_price,weight,fragile,price_rule_id)
 values(sid,line_no,nullif(line->>'product_id','')::uuid,trim(line->>'description'),(line->>'quantity')::numeric,line->>'unit',(line->>'unit_price')::numeric,coalesce((line->>'weight')::numeric,0),coalesce((line->>'fragile')::boolean,false),rule.id);
 end loop;
 insert into public.shipment_stops(shipment_id,sequence,kind,contact_snapshot) values(sid,1,'PICKUP',data->'sender'),(sid,2,'DELIVERY',data->'receiver');
 insert into public.invoices(shipment_id,invoice_no,payer_party_id,total_amount,due_date) values(sid,private.next_number(m.branch_id,'INV'),payer,total+extra-disc,(now() at time zone 'Asia/Bangkok')::date+days);
 if coalesce((data->>'collect_now')::boolean,false) then
 if mode<>'CASH_ORIGIN' then raise exception 'รับเงินพร้อมออกบิลได้เฉพาะเงินสดต้นทาง'; end if;
 perform private.receive_payment(sid,total+extra-disc,'CASH','',req);
 end if;
 insert into public.audit_logs(company_id,actor_id,action,entity_type,record_id,detail) values(m.company_id,m.id,'ISSUE','shipment',sid,jsonb_build_object('total',total+extra-disc,'price_override',override_needed,'reason',data->>'price_reason'));
 return sid; end $$;
create function public.issue_shipment(data jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.issue_shipment(data) $$;

create function private.set_shipment_status(doc uuid, status text, reason text default '') returns void language plpgsql security definer set search_path='' as $$
 declare m public.profiles:=private.require_role(array['owner','admin','clerk']); s public.shipments;
 begin
 select * into s from public.shipments where id=doc for update;
 if not found or not private.can_read_document(doc) then raise exception 'ไม่พบเอกสาร'; end if;
 if status='CANCELLED' then
 if m.role not in ('owner','admin') or length(trim(reason))<3 then raise exception 'ต้องให้ผู้ดูแลระบุเหตุผลยกเลิก'; end if;
 if s.shipment_status<>'RECEIVED' or exists(select 1 from public.payments where shipment_id=doc) then raise exception 'ยกเลิกได้เฉพาะบิลที่ยังไม่จัดส่งและไม่มีรายการรับเงิน'; end if;
 update public.invoices set status='VOID' where shipment_id=doc;
 elsif not ((s.shipment_status='RECEIVED' and status='IN_TRANSIT') or (s.shipment_status='IN_TRANSIT' and status='DELIVERED')) then raise exception 'ลำดับสถานะไม่ถูกต้อง';
 end if;
 update public.shipments set shipment_status=status,version_no=version_no+1,cancelled_at=case when status='CANCELLED' then now() else null end,cancel_reason=nullif(reason,'') where id=doc;
 insert into public.audit_logs(company_id,actor_id,action,entity_type,record_id,detail) values(m.company_id,m.id,'STATUS','shipment',doc,jsonb_build_object('from',s.shipment_status,'to',status,'reason',reason));
 end $$;
create function public.set_shipment_status(doc uuid,status text,reason text default '') returns void language sql security invoker set search_path='' as $$ select private.set_shipment_status(doc,status,reason) $$;

create function private.manage_setting(kind text,data jsonb) returns void language plpgsql security definer set search_path='' as $$
 declare m public.profiles:=private.require_role(array['owner','admin']); rec uuid; email_value text; target public.staff_invites; version integer;
 begin
 if kind='invite' then
 email_value:=lower(trim(data->>'email'));
 select * into target from public.staff_invites where email=email_value for update;
 if target.email is not null and target.company_id<>m.company_id then raise exception 'อีเมลนี้อยู่ในบริษัทอื่น'; end if;
 if (data->>'role')='owner' or target.role='owner' or email_value=m.email then raise exception 'ไม่สามารถแก้สิทธิ์เจ้าของหรือบัญชีตนเองจากหน้านี้'; end if;
 if email_value !~ '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'อีเมลไม่ถูกต้อง'; end if;
 insert into public.staff_invites(email,display_name,company_id,branch_id,role,is_active) values(email_value,trim(data->>'display_name'),m.company_id,m.branch_id,data->>'role',coalesce((data->>'is_active')::boolean,true))
 on conflict(email) do update set display_name=excluded.display_name,role=excluded.role,is_active=excluded.is_active;
 update public.profiles set role=data->>'role',display_name=data->>'display_name',is_active=coalesce((data->>'is_active')::boolean,true) where email=email_value and company_id=m.company_id;
 rec:=m.id;
 elsif kind='zone' then
 rec:=(data->>'id')::uuid;
 update public.service_zones set name=trim(data->>'name'),color=data->>'color' where id=rec and company_id=m.company_id;
 if not found then raise exception 'ไม่พบจังหวัด'; end if;
 elsif kind='district' then
 rec:=(data->>'id')::uuid;
 update public.districts set name=trim(data->>'name') where id=rec and zone_id in(select id from public.service_zones where company_id=m.company_id);
 if not found then raise exception 'ไม่พบอำเภอ'; end if;
 elsif kind='price' then
 perform pg_advisory_xact_lock(hashtextextended(m.company_id::text||(data->>'product_id'),0));
 select coalesce(max(version_no),0)+1 into version from public.price_rules where company_id=m.company_id and product_id=(data->>'product_id')::uuid and zone_id is not distinct from nullif(data->>'zone_id','')::uuid;
 insert into public.price_rules(company_id,product_id,zone_id,unit_price,version_no,created_by) values(m.company_id,(data->>'product_id')::uuid,nullif(data->>'zone_id','')::uuid,(data->>'unit_price')::numeric,version,m.id) returning id into rec;
 else raise exception 'ประเภทตั้งค่าไม่ถูกต้อง'; end if;
 insert into public.audit_logs(company_id,actor_id,action,entity_type,record_id,detail) values(m.company_id,m.id,'CONFIGURE',kind,rec,data);
 end $$;
create function public.manage_setting(kind text,data jsonb) returns void language sql security invoker set search_path='' as $$ select private.manage_setting(kind,data) $$;

create function private.register_file(data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
 declare m public.profiles:=private.require_role(array['owner','admin','clerk']); doc uuid:=(data->>'shipment_id')::uuid; fid uuid;
 begin
 if not private.can_read_document(doc) then raise exception 'ไม่มีสิทธิ์'; end if;
 if (data->>'object_key') not like m.company_id::text||'/'||doc::text||'/%' then raise exception 'ตำแหน่งไฟล์ไม่ถูกต้อง'; end if;
 insert into public.shipment_files(shipment_id,object_key,filename,mime_type,byte_size,created_by) values(doc,data->>'object_key',left(data->>'filename',255),data->>'mime_type',(data->>'byte_size')::integer,m.id) returning id into fid;
 return fid; end $$;
create function public.register_file(data jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.register_file(data) $$;

create function public.reception_stats(day date) returns jsonb language sql stable security invoker set search_path='' as $$
 with today as (select * from public.shipment_register where received_at>=day::timestamp at time zone 'Asia/Bangkok' and received_at<(day+1)::timestamp at time zone 'Asia/Bangkok' and shipment_status<>'CANCELLED'), zones as (select zone_id,count(*) count,sum(total_quantity) quantity from today group by zone_id)
 select jsonb_build_object('count',count(*),'quantity',coalesce(sum(total_quantity),0),'total',coalesce(sum(total_amount),0),'collected',coalesce(sum(paid_amount),0),'pending',coalesce(sum(outstanding_amount),0),'zones',coalesce((select jsonb_object_agg(zone_id,jsonb_build_object('count',count,'quantity',quantity)) from zones),'{}'::jsonb)) from today
$$;
create function private.database_health() returns jsonb language plpgsql security definer set search_path='' as $$
 begin perform private.require_role(array['owner','admin']); return jsonb_build_object('bytes',pg_database_size(current_database()),'tables',(select count(*) from pg_catalog.pg_tables where schemaname='public'),'checked_at',now()); end $$;
create function public.database_health() returns jsonb language sql security invoker set search_path='' as $$ select private.database_health() $$;

-- Internal helpers are not callable via the public API. Only guarded entrypoints
-- and RLS predicates receive authenticated EXECUTE privileges.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.member(),private.can_read_document(uuid),private.save_party(jsonb),private.receive_payment(uuid,numeric,text,text,uuid),private.issue_shipment(jsonb),private.set_shipment_status(uuid,text,text),private.manage_setting(text,jsonb),private.register_file(jsonb),private.database_health() to authenticated;
revoke all on function public.save_party(jsonb),public.receive_payment(uuid,numeric,text,text,uuid),public.issue_shipment(jsonb),public.set_shipment_status(uuid,text,text),public.manage_setting(text,jsonb),public.register_file(jsonb),public.reception_stats(date),public.database_health() from public,anon;
grant execute on function public.save_party(jsonb),public.receive_payment(uuid,numeric,text,text,uuid),public.issue_shipment(jsonb),public.set_shipment_status(uuid,text,text),public.manage_setting(text,jsonb),public.register_file(jsonb),public.reception_stats(date),public.database_health() to authenticated;

do $$ declare c uuid; b uuid; z uuid; begin
 insert into public.companies(code,name) values('NTD','NTD Logistics') returning id into c;
 insert into public.branches(company_id,code,name) values(c,'BKK','สำนักงานใหญ่ กรุงเทพฯ') returning id into b;
 insert into public.staff_invites(email,display_name,company_id,branch_id,role) values('ntdlogistics@gmail.com','ผู้ดูแล NTD',c,b,'owner');
 insert into public.service_zones(company_id,code,name,color,sort_order) values(c,'PLK','พิษณุโลก','#3174c6',1) returning id into z;
 insert into public.districts(zone_id,name) values(z,'เมืองพิษณุโลก'),(z,'วังทอง'),(z,'บางระกำ');
 insert into public.service_zones(company_id,code,name,color,sort_order) values(c,'STI','สุโขทัย','#b67c15',2) returning id into z;
 insert into public.districts(zone_id,name) values(z,'เมืองสุโขทัย'),(z,'สวรรคโลก'),(z,'ศรีสำโรง');
 insert into public.service_zones(company_id,code,name,color,sort_order) values(c,'KPT','กำแพงเพชร','#9870b4',3) returning id into z;
 insert into public.districts(zone_id,name) values(z,'เมืองกำแพงเพชร'),(z,'คลองขลุง'),(z,'ขาณุวรลักษบุรี');
 insert into public.products(company_id,name,unit) values(c,'สินค้าทั่วไป','กล่อง'),(c,'สินค้าอุปโภคบริโภค','ลัง'),(c,'วัสดุและอุปกรณ์','มัด'),(c,'สินค้ากระสอบ','กระสอบ'),(c,'พาเลทสินค้า','พาเลท');
 end $$;
