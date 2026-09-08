create function private.validate_snapshot(data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if data is null or jsonb_typeof(data)<>'object' or length(trim(coalesce(data->>'display_name',''))) not between 1 and 255 or length(trim(coalesce(data->>'address',''))) not between 1 and 1500 or coalesce(data->>'phone','') !~ '^[0-9+ ()-]{8,20}$' then raise exception 'ชื่อ ที่อยู่ หรือเบอร์โทรศัพท์ไม่ถูกต้อง'; end if;
end $$;
revoke all on function private.validate_snapshot(jsonb) from public,anon,authenticated;
create or replace function private.next_number(b uuid, typ text) returns text language plpgsql security definer set search_path='' as $$
 declare n bigint; period text:=to_char(now() at time zone 'Asia/Bangkok','YYYYMM'); branch_code text;
 begin
 insert into private.document_sequences values(b,typ,period,1)
 on conflict on constraint document_sequences_pkey do update set last_number=private.document_sequences.last_number+1 returning last_number into n;
 select code into branch_code from public.branches where id=b;
 return typ||'-'||branch_code||'-'||period||'-'||lpad(n::text,greatest(5,length(n::text)),'0');
 end $$;

create or replace function private.save_party(data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
 declare m public.profiles:=private.require_role(array['owner','admin','clerk','accountant']); pid uuid:=nullif(data->>'id','')::uuid; old public.parties;
 begin
 if pid is null then
 insert into public.parties(company_id,display_name,phone,address,tax_id,created_by)
 values(m.company_id,trim(data->>'display_name'),trim(data->>'phone'),trim(data->>'address'),coalesce(data->>'tax_id',''),m.id) returning id into pid;
 else
 select * into old from public.parties where id=pid and company_id=m.company_id for update;
 if not found then raise exception 'ไม่พบลูกค้า'; end if;
 if m.role not in ('owner','admin') and (data ? 'credit_limit' or data ? 'credit_days' or data ? 'is_active') then raise exception 'ต้องให้ผู้ดูแลแก้ไขวงเงินและสถานะ'; end if;
 update public.parties set display_name=trim(data->>'display_name'), phone=trim(data->>'phone'),address=trim(data->>'address'),
 tax_id=coalesce(data->>'tax_id',old.tax_id),
 credit_limit=coalesce((data->>'credit_limit')::numeric,old.credit_limit),
 credit_days=coalesce((data->>'credit_days')::integer,old.credit_days),
 is_active=coalesce((data->>'is_active')::boolean,old.is_active),version_no=version_no+1,updated_at=now() where id=pid;
 end if;
 insert into public.audit_logs(company_id,actor_id,action,entity_type,record_id,detail)
 values(m.company_id,m.id,'SAVE','party',pid,jsonb_build_object('previous_credit_limit',old.credit_limit,'credit_limit',data->'credit_limit'));
 return pid; end $$;

create or replace function private.issue_shipment(data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
 perform private.validate_snapshot(data->'sender'); perform private.validate_snapshot(data->'receiver');
 if coalesce(jsonb_typeof(data->'items'),'null')<>'array' or jsonb_array_length(data->'items') not between 1 and 100 then raise exception 'ต้องมีสินค้า 1 ถึง 100 รายการ'; end if;
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
 if nullif(line->>'product_id','') is not null and product.id is null then raise exception 'สินค้าไม่อยู่ในบริษัท'; end if;
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

create or replace function private.provision_invited_confirmed_staff(target_email text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  invitation public.staff_invites;
  user_row auth.users;
begin
  select *
    into invitation
    from public.staff_invites
   where email = lower(trim(target_email))
     and is_active;

  if not found then
    return;
  end if;

  for user_row in
    select *
      from auth.users
     where lower(email) = invitation.email
       and email_confirmed_at is not null
  loop
    insert into public.profiles(id, company_id, branch_id, display_name, email, role, is_active)
    values (
      user_row.id,
      invitation.company_id,
      invitation.branch_id,
      invitation.display_name,
      invitation.email,
      invitation.role,
      invitation.is_active
    )
    on conflict (id) do update
      set branch_id = excluded.branch_id,
          display_name = excluded.display_name,
          email = excluded.email,
          role = excluded.role,
          is_active = excluded.is_active,
          updated_at = now()
    where public.profiles.company_id = excluded.company_id
      and public.profiles.role <> 'owner';
  end loop;
end
$$;

revoke all on function private.provision_invited_confirmed_staff(text) from public, anon, authenticated;

create or replace function private.provision_staff()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  perform private.provision_invited_confirmed_staff(new.email);
  return new;
end
$$;

create or replace function private.manage_setting(kind text, data jsonb)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  m public.profiles := private.require_role(array['owner','admin']);
  rec uuid;
  email_value text;
  target public.staff_invites;
  version integer;
begin
  if kind = 'invite' then
    email_value := lower(trim(data->>'email'));

    select *
      into target
      from public.staff_invites
     where email = email_value
       for update;

    if target.email is not null and target.company_id <> m.company_id then
      raise exception 'อีเมลนี้อยู่ในบริษัทอื่น';
    end if;

    if (data->>'role') = 'owner' or target.role = 'owner' or email_value = m.email then
      raise exception 'ไม่สามารถแก้สิทธิ์เจ้าของหรือบัญชีตนเองจากหน้านี้';
    end if;

    if email_value !~ '^[^@ ]+@[^@ ]+\.[^@ ]+$' then
      raise exception 'อีเมลไม่ถูกต้อง';
    end if;

    insert into public.staff_invites(email, display_name, company_id, branch_id, role, is_active)
    values (email_value, trim(data->>'display_name'), m.company_id, m.branch_id, data->>'role', coalesce((data->>'is_active')::boolean, true))
    on conflict(email) do update
      set display_name = excluded.display_name,
          role = excluded.role,
          is_active = excluded.is_active;

    update public.profiles
       set role = data->>'role',
           display_name = data->>'display_name',
           is_active = coalesce((data->>'is_active')::boolean, true),
           updated_at = now()
     where email = email_value
       and company_id = m.company_id
       and role <> 'owner';

    perform private.provision_invited_confirmed_staff(email_value);
    rec := m.id;
  elsif kind = 'zone' then
    rec := (data->>'id')::uuid;
    update public.service_zones set name = trim(data->>'name'), color = data->>'color' where id = rec and company_id = m.company_id;
    if not found then raise exception 'ไม่พบจังหวัด'; end if;
  elsif kind = 'district' then
    rec := (data->>'id')::uuid;
    update public.districts set name = trim(data->>'name') where id = rec and zone_id in(select id from public.service_zones where company_id = m.company_id);
    if not found then raise exception 'ไม่พบอำเภอ'; end if;
  elsif kind = 'price' then
    perform pg_advisory_xact_lock(hashtextextended(m.company_id::text || (data->>'product_id'), 0));
    select coalesce(max(version_no), 0) + 1 into version from public.price_rules where company_id = m.company_id and product_id = (data->>'product_id')::uuid and zone_id is not distinct from nullif(data->>'zone_id', '')::uuid;
    insert into public.price_rules(company_id, product_id, zone_id, unit_price, version_no, created_by)
    values(m.company_id, (data->>'product_id')::uuid, nullif(data->>'zone_id', '')::uuid, (data->>'unit_price')::numeric, version, m.id)
    returning id into rec;
  else
    raise exception 'ประเภทตั้งค่าไม่ถูกต้อง';
  end if;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, record_id, detail) values(m.company_id, m.id, 'CONFIGURE', kind, rec, data);
end
$$;
