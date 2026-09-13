# ภาพรวมสถาปัตยกรรม NTD TMS

## ทางเลือก frontend

เลือก React + Vite แทน Next.js สำหรับเฟสแรก เพราะงานหลักเป็น internal desktop app ที่อ่าน/เขียนข้อมูลผ่าน Supabase โดยตรง ไม่ได้ต้องการ server rendering, SEO, หรือ route server จำนวนมาก

ข้อดีของทางนี้:

- deploy ง่ายบน Cloudflare Pages เป็น static asset
- ดูแลระยะยาวง่ายกว่า มี dependency ฝั่ง server น้อย
- หน้าออกบิลเร็ว เหมาะกับพนักงานใช้บนคอม 100%
- API เฉพาะที่จำเป็น เช่น รูปภาพ ใช้ Cloudflare Pages Worker แยกเป็นจุดเล็ก ๆ

ถ้าวันหน้าระบบขยายเป็น customer portal, API ซับซ้อน, เอกสารภาษี, หรือ workflow backend หนักขึ้น ค่อยย้ายบางส่วนไป Next.js หรือ Worker service แยกได้โดยไม่ต้องทิ้ง database เดิม

## Supabase

ใช้ Supabase Auth + PostgreSQL + RLS เป็นแกนกลาง

- ทุกตาราง public เปิด Row Level Security
- แยกข้อมูลพนักงานออกจากบัญชีเข้าใช้ระบบ พนักงานหนึ่งคนอาจไม่มีบัญชี และบัญชีที่มีสิทธิ์จะกำหนดการเข้าใช้เป็นรายโมดูล
- role เป็นค่าเริ่มต้นของสิทธิ์ ส่วน `module_permissions` ใช้ปรับเฉพาะคน เช่น ราคา การเงิน รายงาน และตั้งค่าบริษัท
- การเขียนข้อมูลหลักผ่าน RPC ที่ validate ฝั่งฐานข้อมูล
- เลขบิล/ใบแจ้งหนี้/ใบรับเงินออกแบบ atomic ด้วย sequence ต่อสาขาและเดือน
- snapshot ผู้ส่ง/ผู้รับถูกเก็บใน shipment เพื่อให้ประวัติบิลไม่เปลี่ยนเมื่อแก้ข้อมูลลูกค้า

## V2 Modular Monolith

V2 ใช้ Modular Monolith คือแยก module ชัดเจนบน PostgreSQL ฐานเดียว ไม่แยก microservice ตั้งแต่ต้น เพราะทีมเล็ก ใช้งานในบริษัท และต้องให้ข้อมูลบัญชี/ขนส่ง/ลูกหนี้เชื่อมกันตรง

สร้าง registry `erp_modules` และ `erp_module_tables` แล้ว 21 modules:

1. Organization & Branch
2. Identity & Access
3. Customer & CRM
4. Pricing Engine
5. Shipment & Waybill
6. Branch Receiving
7. Cash Collection
8. Billing & AR
9. Payable & Payout
10. Financials GL
11. Trip Management
12. Fleet & Vehicle
13. Driver & Contractor
14. Fuel & Expense
15. Maintenance
16. Inventory
17. Document Control
18. Approval Workflow
19. Audit & Compliance
20. Reporting & BI
21. Integration & API

ตาราง V2 foundation ที่เพิ่มแล้ว:

- `price_books`, `price_book_lines`, `price_tiers`
- `customer_relations`, `receiver_product_links`
- `contract_price_agreements`, `contract_price_versions`, `price_requests`
- `shipment_collections`, `remittance_slips`
- `branch_receiving_transactions`, `branch_receiving_items`
- `billing_batches`, `billing_batch_lines`
- `payable_bills`, `payout_batches`, `payout_batch_lines`
- `chart_of_accounts`, `journal_entries`, `journal_lines`
- `trip_runs`, `trip_run_shipments`, `v2_trip_profit`
- `vehicle_assets`, `drivers`, `fuel_logs`, `maintenance_orders`
- `employees`, `vehicle_driver_assignments`, `master_documents`
- `module_permissions` บนบัญชีพนักงาน และเลขพนักงาน/เลขรถที่สร้างแบบ atomic ต่อบริษัท
- `inventory_locations`, `inventory_items`, `inventory_movements`
- `approval_workflows`, `approval_requests`, `document_reversals`
- `report_snapshots`, `integration_connections`, `v2_module_overview`

ตาราง V2 ใหม่มี column มาตรฐาน `company_id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `version_no`, `is_active`, `deleted_at` และเอกสารธุรกรรมมี `status`, `reverse_of`, `cancel_reason` เพื่อรองรับ cancel/reverse แทน hard delete

Supabase Free มีพื้นที่ database 500 MB และไม่มี automatic backups ดังนั้นใช้จริงควรตั้ง export/backup ภายนอก หรืออัปเกรด Pro เมื่อข้อมูลเริ่มสำคัญ

## Cloudflare

ใช้ Cloudflare Pages สำหรับ frontend และ Pages Worker สำหรับ API รูปภาพ

- `/api/status` เช็คว่า R2 binding พร้อมไหม
- `/api/photos` upload รูปสินค้าเมื่อ login แล้วเท่านั้น
- `/api/photos/:id` อ่านรูปผ่าน RLS และ Worker ไม่เปิด public bucket
- `/api/master-documents` อัปโหลดเอกสารพนักงาน/รถหลายไฟล์ โดย owner/admin เท่านั้น
- `/api/master-documents/:id` อ่านเอกสารผ่าน Worker หลังตรวจบริษัทและสิทธิ์
- R2 bucket ยังต้องเปิดใน Cloudflare Dashboard ก่อนใช้งานจริง เพราะบัญชีนี้ยังตอบว่า R2 ยังไม่ enabled

## Data Growth

เพื่อให้อยู่ได้นาน:

- เก็บรูปใน R2 ไม่เก็บใน Supabase database
- จำกัดรูป 5 MB และรับเฉพาะ JPG/PNG/WebP
- เอกสารหลักจำกัด 15 MB ต่อไฟล์ รองรับ JPG/PNG/WebP/PDF และเก็บเฉพาะ metadata ใน Supabase
- ประวัติราคาห้ามแก้ย้อนหลัง ราคาปัจจุบันชี้ไปยังเวอร์ชันล่าสุด
- table รายการบิลทำ index ตาม FK/วัน/ลูกค้า/พื้นที่ไว้แล้ว
- foreign key ทุกจุดมี index รองรับแล้ว 194 constraints
- เก็บ audit log แยกสำหรับตรวจย้อนหลัง
- export CSV จากหน้าเว็บได้สำหรับงานบัญชีเบื้องต้น

เมื่อจำนวนบิลโตขึ้น ควรเพิ่ม archive policy รายปี, backup รายวัน, และ dashboard storage usage แยกตามตาราง
