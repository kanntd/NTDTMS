# Operation Notes

## ก่อนใช้งานจริง

1. Supabase Auth
   - ตั้ง Site URL เป็น URL production ของ Cloudflare Pages
   - เพิ่ม Redirect URLs สำหรับ production และ local development
   - ให้พนักงานสมัครด้วยอีเมลที่ admin เพิ่มในหน้า `ตั้งค่าบริษัท`

2. Cloudflare Pages
   - Project ชื่อ `ntdtms`
   - Build output คือ `dist`
   - ไฟล์ `_headers`, `_redirects`, `_routes.json`, `_worker.js` เตรียมไว้แล้ว

3. Cloudflare R2
   - ต้องเปิด R2 ใน dashboard ก่อน
   - สร้าง bucket สำหรับรูปสินค้า เช่น `ntdtms-images`
   - bind bucket เข้า Pages Function ด้วยชื่อ binding `IMAGES`
   - หลัง binding สำเร็จ หน้า `ตั้งค่าบริษัท > ข้อมูลระบบ` จะขึ้นว่า R2 พร้อมใช้

4. Backup
   - Supabase Free ไม่มี automatic backups
   - ควร export database อย่างน้อยวันละครั้งเมื่อเริ่มใช้จริง
   - หากข้อมูลเริ่มเป็นบัญชีงานประจำ ควรอัปเกรด Supabase Pro เพื่อ daily backups และพื้นที่ database มากขึ้น

## ตรวจระบบ

```bash
pnpm test
pnpm build
```

ผลล่าสุด:

- TypeScript ผ่าน
- Vite production build ผ่าน
- Test ผ่าน 3 ไฟล์ 6 เคส
- Supabase security advisor ไม่มี warning
- Supabase performance advisor เหลือเฉพาะ unused index เพราะฐานเพิ่งสร้างและยังไม่มี traffic จริง
- Supabase V2 foundation ขึ้นแล้ว: 21 modules, public schema 51 tables/views
- Supabase foreign key index ตรวจแล้วครบ 194/194 constraints
- Auth users ยังเป็น 0 ตามคำสั่งรอบนี้ที่ให้เก็บงาน user/RLS หลายคนไว้เดือนหน้า

## ขอบเขตเฟสนี้

เฟสนี้เป็น reception/billing slice:

- ออกบิลรับสินค้า
- ใบรับสินค้า/พิมพ์
- ลูกค้าและเครดิตเบื้องต้น
- รับเงินบางส่วน
- สถานะรับสินค้า > กำลังขนส่ง > ส่งสำเร็จ
- ตั้งค่าอำเภอ จังหวัด ราคา และพนักงาน

ยังไม่ใช่ ERP เต็มชุด เช่น GPS, HR, บัญชีแยกประเภท, ซ่อมบำรุงรถ, ซื้อขายอะไหล่ หรือเอกสารภาษีเต็มระบบ

## ขอบเขต V2 ที่เพิ่มแล้ว

เพิ่ม database foundation สำหรับ ERP ภาพใหญ่:

- Price book / tier
- Shipment collection / remittance
- Branch receiving
- Billing batch
- AP / payout
- Chart of accounts / journal entry / journal lines
- Trip profit foundation
- Fleet / driver / fuel / maintenance
- Inventory
- Approval workflow
- Report snapshots
- Integration status
