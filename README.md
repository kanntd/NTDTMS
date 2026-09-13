# NTD TMS

เว็บแอป TMS สำหรับรับสินค้า ออกบิล และติดตามยอดค้างของ NTD Logistics

## สถานะตอนนี้

- Frontend: React + Vite + TypeScript สำหรับ Cloudflare Pages
- Database/Auth/RLS: Supabase project `ntdtms`
- Database V2: เพิ่ม ERP foundation 21 modules แล้วใน Supabase
- Database indexes: เพิ่ม index ให้ foreign key ครบ 194 จุดแล้ว
- รูปภาพสินค้าและเอกสารพนักงาน/รถ: เตรียม Cloudflare Pages Worker สำหรับ R2 แบบ private แล้ว
- หน้าแรก: โต๊ะ admin สำหรับรับลูกค้าและออกบิลบนคอมพิวเตอร์
- ข้อมูลหลัก: ผู้รับ ผู้ส่ง สินค้า/หน่วย ความสัมพันธ์ พนักงาน ทะเบียนรถ และเอกสารหลายไฟล์
- ราคา: ราคาเฉพาะคู่ลูกค้า คำขอราคา ประวัติเวอร์ชัน และปรับราคาหลายรายการ
- พื้นที่ปลายทางหลัก: สุโขทัย, กำแพงเพชร, พิษณุโลก

## ลองใช้งานบนเครื่องนี้

Dev server เปิดอยู่ที่:

```text
http://127.0.0.1:5176/?demo=1
```

โหมด demo ไม่เขียนข้อมูลลง Supabase จริง และเริ่มต้นโดยไม่มีผู้รับ ผู้ส่ง สินค้า พนักงาน หรือรถตัวอย่าง ข้อมูลที่พนักงานกรอกจะเก็บแยกในเบราว์เซอร์ของเครื่องนั้นเพื่อทดลอง workflow และส่งออกข้อมูลหลักภายหลัง

## ใช้งานจริง

1. เปิดเว็บแบบไม่ใส่ `?demo=1`
2. สมัครด้วยอีเมลที่ได้รับสิทธิ์ในหน้า `ตั้งค่าบริษัท`
3. ยืนยันอีเมลจาก Supabase
4. กลับมา login เพื่อออกบิลจริง

บัญชีเจ้าของที่ seed ไว้:

```text
ntdlogistics@gmail.com
```

## คำสั่งตรวจระบบ

```bash
pnpm test
pnpm build
```

## ไฟล์สำคัญ

- `src/Intake.tsx` หน้าออกบิลหลัก
- `src/Receipt.tsx` ใบรับสินค้า/รับเงิน/สถานะขนส่ง
- `src/Settings.tsx` จังหวัด อำเภอ ราคา พนักงาน และสถานะระบบ
- `src/MasterData.tsx` ข้อมูลหลักและการผูกคนขับกับรถ
- `src/Pricing.tsx` ราคาปัจจุบัน คำขอราคา ประวัติ และการปรับแบบกลุ่ม
- `src/operationsStore.ts` ข้อมูลจำลองและกฎร่วมของโมดูลใหม่
- `database/reception.sql` schema หลัก
- `supabase/migrations/` migration ที่ส่งขึ้น Supabase แล้ว
- `public/_worker.js` API รูปภาพผ่าน Cloudflare Worker/R2

## V2 ERP Foundation

เพิ่มโครงฐานข้อมูล V2 จากไฟล์ `v2ที่อัพเพิ่มจากv1.md` แล้ว โดยแยกเป็น 21 modules:

- Organization & Branch
- Identity & Access
- Customer & CRM
- Pricing Engine
- Shipment & Waybill
- Branch Receiving
- Cash Collection
- Billing & AR
- Payable & Payout
- Financials GL
- Trip Management
- Fleet & Vehicle
- Driver & Contractor
- Fuel & Expense
- Maintenance
- Inventory
- Document Control
- Approval Workflow
- Audit & Compliance
- Reporting & BI
- Integration & API

ตาราง V2 ที่เพิ่มแล้วครอบคลุม price book/tier, shipment collections, branch receiving, billing, AP/payout, journal entry, trip profit, fleet, driver, fuel, maintenance, inventory, report snapshots และ integration status

Migration ล่าสุดสร้าง index ให้ foreign key ครบทุก constraint เพื่อรองรับข้อมูลโตระยะยาว และลดปัญหา query ช้าเมื่อเริ่มใช้งานจริง
