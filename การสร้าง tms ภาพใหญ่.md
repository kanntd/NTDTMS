# NTD TMS  แบบ ERP ธุรกิจขนส่งฉบับรวมและตรวจทานแล้ว
ผมตรวจสอบคำตอบทั้งสองครั้งแล้ว โครงสร้างเดิม ถูกทิศทางประมาณ 80% แต่ยังไม่ควรนำไปเขียนโปรแกรมทันที เพราะมีจุดที่ต้องแก้เพื่อป้องกันปัญหาในงานจริง เช่น การเปลี่ยนที่อยู่ย้อนหลัง ยอดลูกหนี้คลาดเคลื่อน การถ่ายสินค้าระหว่างรถ การส่งบางส่วน และการแก้ราคาโดยไม่มีหลักฐาน
ฉบับนี้รวม:
* ภาพใหญ่ของ ERP
* Workflow ธุรกิจ
* Module ทั้งหมด
* โครงสร้างฐานข้อมูลและ Column
* การควบคุมราคา เครดิต และสิทธิ์
* การบริหารงานรายย่อย งานเหมา รถขากลับ GPS การเงิน ซ่อมบำรุง จัดซื้อ และ HR
## 1. ผลการตรวจสอบและสิ่งที่แก้ไข
### จุดที่ออกแบบเดิมถูกต้อง
* ใช้ party กลางแทนการสร้างผู้ส่งและผู้รับแยกกัน
* แยกสินค้าออกจากราคา
* ราคาผูกกับผู้ส่ง ผู้รับ สินค้า หน่วย เส้นทาง และรูปแบบชำระเงิน
* แยก Sales, Shipment, Operation และ Finance
* รองรับเงินสด/เครดิต ต้นทาง/ปลายทาง
* รองรับรายย่อย เหมาเต็มคัน เหมาครึ่งคัน และแชร์รถ
* แยกสถานะส่งสินค้ากับสถานะชำระเงิน
* มี Approval และ Audit Log
* รองรับ GPS ซ่อมบำรุง คลังอะไหล่ จัดซื้อ และ HR
### จุดที่ต้องแก้จากแบบเดิม
1. ห้ามเก็บ credit_used และ outstanding_amount เป็นค่าหลักที่ผู้ใช้แก้ได้: ต้องคำนวณจาก Invoice และ Payment Allocation หรือทำเป็น Cached Value ที่ระบบควบคุม
2. ต้อง Snapshot ที่อยู่: ถ้าแก้ที่อยู่ลูกค้าในอนาคต เอกสารขนส่งเก่าต้องไม่เปลี่ยนตาม
3. ต้องรองรับหลายช่วงการขนส่ง: ใบขนส่งเดียวอาจขึ้นรถกรุงเทพฯ แล้วถ่ายไปอีกคันที่พิษณุโลก จึงต้องมี shipment_legs
4. ต้องรองรับส่งบางส่วน: Shipment หนึ่งใบอาจแบ่งขึ้นหลายเที่ยว หรือส่งไม่ครบ
5. รถหนึ่งเที่ยวอาจมีหัวลาก/รถพ่วง/เปลี่ยนรถ: จึงไม่ควรมีเพียง vehicle_id ในตาราง Trip
6. POD ต้องผูกกับจุดส่ง: ไม่ใช่มี POD เดียวต่อ Shipment เสมอไป
7. ต้องมีบัญชีคู่: Invoice และ Payment อย่างเดียวไม่ใช่ระบบบัญชี ต้องมี Chart of Accounts, Journal Entry และ Journal Lines
8. ต้องมี Claims: สำหรับสินค้าเสียหาย สูญหาย ขาด และการชดเชย
9. ต้องมี Document Number Control: เพื่อไม่ให้เลขใบขนส่ง ใบเสร็จ หรือ Invoice ซ้ำ
10. กฎราคาต้องมีเวอร์ชันและลำดับความเฉพาะเจาะจง: ป้องกันระบบเลือกราคาผิดเมื่อหลายกฎตรงกัน
11. ต้องแยกเงินสดที่ต้องเก็บกับเงินที่เก็บแล้ว: โดยเฉพาะเงินสดปลายทาง
12. ไม่ควรใช้ Province เป็นข้อความอย่างเดียว: ควรมี Master จังหวัด อำเภอ ตำบล และ Zone
13. ห้าม Hard Delete เอกสารธุรกิจ: ต้อง Cancel หรือ Reverse
14. ควรเริ่มด้วย Modular Monolith: ยังไม่ควรเริ่มด้วย Microservices เพราะซับซ้อนเกินความจำเป็น
## 2. ภาพรวมโมดูล ERP

| Module | หน้าที่ |
| --- | --- |
| Organization | บริษัท สาขา จุดกระจายสินค้า และเลขที่เอกสาร |
| Customer & CRM | ลูกค้า ผู้ส่ง ผู้รับ ผู้ชำระเงิน ที่อยู่ เครดิต และประวัติ |
| Product & UOM | สินค้า หมวดสินค้า หน่วยนับ น้ำหนัก และปริมาตร |
| Sales & Contract | ใบเสนอราคา สัญญา และเงื่อนไขลูกค้า |
| Pricing Engine | คำนวณราคาตามคู่ค้า สินค้า หน่วย เส้นทาง และบริการ |
| Transport Order | รับคำสั่งขนส่งและกำหนดผู้รับผิดชอบค่าขนส่ง |
| Shipment/Waybill | ใบรับสินค้า รายการสินค้า ค่าขนส่ง และสถานะ |
| Transport Operation | จัดเที่ยวรถ จุดรับ–ส่ง Manifest และการถ่ายสินค้า |
| Charter Management | เหมาเต็มคัน ครึ่งคัน แชร์รถ และหลายจุดส่ง |
| Fleet & GPS | รถ คนขับ GPS ระยะทาง และสถานะรถ |
| Finance & AR | วางบิล ใบแจ้งหนี้ รับชำระ เครดิตเทอม และลูกหนี้ |
| Accounting | ผังบัญชี รายการบัญชี รายได้ ต้นทุน เงินสด และภาษี |
| Claims | สินค้าเสียหาย สูญหาย ขาด และการชดเชย |
| Maintenance | แจ้งซ่อม แผนบำรุง อะไหล่ ยาง และค่าใช้จ่าย |
| Procurement | ขอซื้อ อนุมัติ PO รับสินค้า และเจ้าหนี้ |
| Inventory | คลังอะไหล่ รับเข้า เบิก คืน โอน และปรับยอด |
| Asset | รถ GPS เครื่องมือ ค่าเสื่อมราคา และทะเบียนทรัพย์สิน |
| HR & Payroll | พนักงาน คนขับ พนักงานยกของ ค่าเที่ยว OT และเงินเดือน |
| BI & CRM Automation | ยอดขาย กำไร ลูกค้าหาย รถขากลับ และโอกาสขาย |
| Security | User, Role, Approval, Audit Log และขอบเขตสาขา |
## 3. Workflow หลัก
### ลูกค้ารายย่อย

_ไฟล์แนบจาก Notes ไม่ถูกคัดลอกเป็นข้อความ_

### งานเหมาเต็มคัน/ครึ่งคัน

_ไฟล์แนบจาก Notes ไม่ถูกคัดลอกเป็นข้อความ_

### รถขากลับหลายลูกค้า

ค้นหารถขากลับ→ ตรวจพื้นที่และน้ำหนักคงเหลือ→ จับคู่ลูกค้าตามเส้นทาง→ ตรวจเวลานัดและความเข้ากันได้ของสินค้า→ รวมหลาย Shipment ใน Trip เดียว→ กระจายต้นทุนต่อ Shipment→ วิเคราะห์กำไรต่อเที่ยวและต่อลูกค้า
## 4. มาตรฐาน Database
### 4.1 Data Type

| Type | การใช้งาน |
| --- | --- |
| uuid | Primary Key และ Foreign Key |
| varchar(n) | ข้อความสั้น |
| text | รายละเอียด |
| numeric(18,2) | จำนวนเงิน |
| numeric(18,4) | จำนวน น้ำหนัก ปริมาตร และราคา |
| date | วันที่ |
| time | เวลา |
| timestamptz | วันเวลาพร้อม Time Zone |
| boolean | true/false |
| jsonb | Payload จาก GPS/API |
| inet | IP Address |
### 4.2 Column มาตรฐาน
Master Data ใช้:

| Column | Type | รายละเอียด |
| --- | --- | --- |
| id | uuid PK | รหัสหลัก |
| company_id | uuid FK | บริษัทเจ้าของข้อมูล |
| created_at | timestamptz | เวลาสร้าง |
| created_by | uuid FK users.id | ผู้สร้าง |
| updated_at | timestamptz | เวลาแก้ไข |
| updated_by | uuid FK users.id | ผู้แก้ไข |
| version_no | integer | ป้องกันแก้ข้อมูลชนกัน |
| is_active | boolean | สถานะใช้งาน |
| deleted_at | timestamptz null | Soft Delete |
เอกสารธุรกรรมใช้:

| Column | Type | รายละเอียด |
| --- | --- | --- |
| id | uuid PK | รหัสหลัก |
| company_id | uuid FK | บริษัท |
| document_status | varchar(30) | สถานะเอกสาร |
| created_at | timestamptz | เวลาสร้าง |
| created_by | uuid FK | ผู้สร้าง |
| updated_at | timestamptz | เวลาแก้ไข |
| updated_by | uuid FK | ผู้แก้ไข |
| version_no | integer | Optimistic Lock |
| cancelled_at | timestamptz null | เวลายกเลิก |
| cancelled_by | uuid null FK | ผู้ยกเลิก |
| cancel_reason | text null | เหตุผลยกเลิก |
## 5. Organization และข้อมูลพื้นที่
### 5.1 companies

| Column | Type | รายละเอียด |
| --- | --- | --- |
| company_code | varchar(20) unique | รหัสบริษัท |
| company_name_th | varchar(255) | ชื่อภาษาไทย |
| company_name_en | varchar(255) | ชื่อภาษาอังกฤษ |
| tax_id | varchar(20) | เลขผู้เสียภาษี |
| registered_address | text | ที่อยู่จดทะเบียน |
| phone | varchar(30) | โทรศัพท์ |
| email | varchar(255) | อีเมล |
| vat_registered | boolean | จด VAT |
| default_vat_rate | numeric(5,2) | VAT เริ่มต้น |
| base_currency | varchar(3) | THB |
| timezone | varchar(50) | Asia/Bangkok |
### 5.2 branches

| Column | Type | รายละเอียด |
| --- | --- | --- |
| branch_code | varchar(20) | รหัสสาขา |
| branch_name | varchar(255) | ชื่อสาขา |
| branch_type | varchar(30) | HEAD_OFFICE, HUB, DESTINATION |
| tax_branch_no | varchar(10) | รหัสสาขาภาษี |
| address_text | text | ที่อยู่ |
| subdistrict_id | uuid null FK | ตำบล |
| district_id | uuid null FK | อำเภอ |
| province_id | uuid FK | จังหวัด |
| postal_code | varchar(10) | รหัสไปรษณีย์ |
| latitude | numeric(10,7) | Latitude |
| longitude | numeric(10,7) | Longitude |
| phone | varchar(30) | โทรศัพท์ |
| manager_employee_id | uuid null FK | ผู้จัดการ |
Unique: (company_id, branch_code)
### 5.3 service_zones

| Column | Type | รายละเอียด |
| --- | --- | --- |
| zone_code | varchar(20) | รหัสโซน |
| zone_name | varchar(100) | เช่น กรุงเทพฯ ตอนเหนือ |
| zone_type | varchar(20) | ORIGIN, DESTINATION, BOTH |
| description | text | รายละเอียด |
### 5.4 service_zone_areas

| Column | Type | รายละเอียด |
| --- | --- | --- |
| service_zone_id | uuid FK | โซน |
| province_id | uuid FK | จังหวัด |
| district_id | uuid null FK | อำเภอ |
| subdistrict_id | uuid null FK | ตำบล |
### 5.5 document_sequences

| Column | Type | รายละเอียด |
| --- | --- | --- |
| branch_id | uuid FK | สาขา |
| document_type | varchar(30) | SHIPMENT, INVOICE, RECEIPT, TRIP |
| prefix | varchar(20) | คำนำหน้าเลข |
| year_format | varchar(10) | YYYY, YY |
| month_format | varchar(10) | MM หรือ NONE |
| running_length | smallint | จำนวนหลัก |
| last_running_no | bigint | เลขล่าสุด |
| reset_policy | varchar(20) | YEARLY, MONTHLY, NEVER |
## 6. Customer, Sender, Receiver และ Payer
### 6.1 parties
บุคคลหรือบริษัทหนึ่งรายสามารถเป็นผู้ส่ง ผู้รับ ผู้ชำระเงิน และ Supplier พร้อมกันได้

| Column | Type | รายละเอียด |
| --- | --- | --- |
| party_code | varchar(30) unique | รหัส |
| party_type | varchar(20) | PERSON, ORGANIZATION |
| display_name | varchar(255) | ชื่อแสดง |
| legal_name | varchar(255) | ชื่อตามกฎหมาย |
| tax_id | varchar(20) null | เลขผู้เสียภาษี |
| tax_branch_no | varchar(10) null | สาขาภาษี |
| phone | varchar(30) | โทรศัพท์ |
| email | varchar(255) null | อีเมล |
| line_id | varchar(100) null | LINE ID |
| customer_segment | varchar(30) | RETAIL, CHARTER, BOTH |
| customer_grade | varchar(10) | A, B, C, D |
| party_status | varchar(20) | ACTIVE, SUSPENDED, BLOCKED |
| first_service_date | date null | ใช้บริการครั้งแรก |
| last_service_date | date null | ใช้บริการล่าสุด |
| remark | text null | หมายเหตุ |
### 6.2 party_roles

| Column | Type | รายละเอียด |
| --- | --- | --- |
| party_id | uuid FK parties.id | บุคคล/บริษัท |
| role_code | varchar(30) | CUSTOMER, SENDER, RECEIVER, PAYER, SUPPLIER |
| effective_from | date | วันที่เริ่ม |
| effective_to | date null | วันที่สิ้นสุด |
Unique: (party_id, role_code, effective_from)
### 6.3 party_contacts

| Column | Type | รายละเอียด |
| --- | --- | --- |
| party_id | uuid FK | เจ้าของผู้ติดต่อ |
| contact_name | varchar(255) | ชื่อ |
| position_name | varchar(100) null | ตำแหน่ง |
| phone | varchar(30) | โทรศัพท์ |
| email | varchar(255) null | อีเมล |
| line_id | varchar(100) null | LINE |
| contact_type | varchar(30) | GENERAL, BILLING, PICKUP, DELIVERY |
| is_primary | boolean | ผู้ติดต่อหลัก |
| remark | text null | หมายเหตุ |
### 6.4 party_addresses

| Column | Type | รายละเอียด |
| --- | --- | --- |
| party_id | uuid FK | เจ้าของที่อยู่ |
| address_code | varchar(30) | รหัสที่อยู่ |
| address_name | varchar(255) | เช่น โกดัง A |
| address_type | varchar(30) | REGISTERED, BILLING, PICKUP, DELIVERY |
| address_line | text | บ้านเลขที่ ถนน |
| subdistrict_id | uuid null FK | ตำบล |
| district_id | uuid null FK | อำเภอ |
| province_id | uuid FK | จังหวัด |
| postal_code | varchar(10) | รหัสไปรษณีย์ |
| latitude | numeric(10,7) null | Latitude |
| longitude | numeric(10,7) null | Longitude |
| contact_name | varchar(255) null | ผู้ติดต่อ |
| contact_phone | varchar(30) null | โทรศัพท์ |
| service_time_from | time null | เวลาเปิดรับ |
| service_time_to | time null | เวลาปิดรับ |
| is_default | boolean | ค่าเริ่มต้น |
| delivery_instruction | text null | วิธีเข้าพื้นที่ |
### 6.5 customer_accounts

| Column | Type | รายละเอียด |
| --- | --- | --- |
| party_id | uuid FK unique | ลูกค้า |
| account_status | varchar(20) | ACTIVE, ON_HOLD, BLOCKED |
| default_branch_id | uuid FK | สาขาหลัก |
| default_payment_term_id | uuid null FK | เครดิตเทอม |
| credit_limit | numeric(18,2) | วงเงินเครดิต |
| credit_hold | boolean | ระงับเครดิต |
| credit_hold_reason | text null | เหตุผล |
| billing_cycle | varchar(30) | PER_JOB, WEEKLY, MONTHLY |
| billing_day | smallint null | วันวางบิล |
| payment_day | smallint null | วันรับชำระ |
| require_customer_po | boolean | ต้องมี PO |
| tax_invoice_required | boolean | ต้องการใบกำกับ |
| minimum_margin_percent | numeric(5,2) | กำไรขั้นต่ำ |
| risk_level | varchar(20) | LOW, MEDIUM, HIGH |
| collection_note | text null | หมายเหตุติดตามหนี้ |
ยอดใช้เครดิตไม่ควรให้ User แก้ แต่คำนวณดังนี้:

Credit Used =Invoice ค้างชำระ+ งานเครดิตที่ส่งแล้วแต่ยังไม่ออก Invoice- เงินรับล่วงหน้าที่ยังไม่จัดสรร
### 6.6 customer_relationships

| Column | Type | รายละเอียด |
| --- | --- | --- |
| from_party_id | uuid FK | ผู้ส่งหรือคู่ค้าต้นทาง |
| to_party_id | uuid FK | ผู้รับหรือคู่ค้าปลายทาง |
| relationship_type | varchar(30) | REGULAR_RECEIVER, AFFILIATE, BILL_TO |
| default_product_id | uuid null FK | สินค้าประจำ |
| frequency_level | varchar(20) | LOW, MEDIUM, HIGH |
| remark | text null | หมายเหตุ |
## 7. Product และหน่วยนับ
### 7.1 product_categories

| Column | Type | รายละเอียด |
| --- | --- | --- |
| category_code | varchar(30) unique | รหัสหมวด |
| category_name | varchar(255) | ชื่อหมวด |
| parent_category_id | uuid null FK | หมวดแม่ |
| is_fragile | boolean | แตกง่าย |
| is_hazardous | boolean | สินค้าควบคุม |
| requires_weighing | boolean | ต้องชั่ง |
| is_stackable | boolean | วางซ้อนได้ |
### 7.2 units_of_measure

| Column | Type | รายละเอียด |
| --- | --- | --- |
| uom_code | varchar(20) unique | BAG, BOX, KG, TON |
| uom_name | varchar(100) | กระสอบ กล่อง กิโลกรัม |
| uom_category | varchar(20) | COUNT, WEIGHT, VOLUME |
| decimal_allowed | boolean | ใช้ทศนิยม |
| decimal_places | smallint | ตำแหน่งทศนิยม |
### 7.3 products

| Column | Type | รายละเอียด |
| --- | --- | --- |
| product_code | varchar(30) unique | รหัสสินค้า |
| product_name | varchar(255) | ชื่อสินค้า |
| category_id | uuid FK | หมวด |
| default_uom_id | uuid FK | หน่วยเริ่มต้น |
| default_weight_kg | numeric(18,4) null | น้ำหนักต่อหน่วย |
| default_volume_m3 | numeric(18,4) null | ปริมาตรต่อหน่วย |
| requires_actual_weight | boolean | ต้องกรอกน้ำหนักจริง |
| handling_instruction | text null | วิธีขนย้าย |
| description | text null | รายละเอียด |
### 7.4 product_uoms

| Column | Type | รายละเอียด |
| --- | --- | --- |
| product_id | uuid FK | สินค้า |
| uom_id | uuid FK | หน่วย |
| conversion_to_base | numeric(18,6) null | อัตราแปลง |
| standard_weight_kg | numeric(18,4) null | น้ำหนักมาตรฐาน |
| standard_volume_m3 | numeric(18,4) null | ปริมาตรมาตรฐาน |
| is_default | boolean | หน่วยหลัก |
Unique: (product_id, uom_id)
## 8. Payment และเครดิต
### 8.1 payment_terms

| Column | Type | รายละเอียด |
| --- | --- | --- |
| term_code | varchar(20) unique | CASH, NET15, NET30 |
| term_name | varchar(100) | ชื่อ |
| credit_days | integer | จำนวนวัน |
| due_date_basis | varchar(30) | INVOICE_DATE, DELIVERY_DATE, BILLING_DATE |
| is_credit | boolean | เป็นเครดิต |
| description | text null | รายละเอียด |
### 8.2 customer_payment_rules

| Column | Type | รายละเอียด |
| --- | --- | --- |
| sender_party_id | uuid FK | ผู้ส่ง |
| receiver_party_id | uuid null FK | ผู้รับ |
| service_type | varchar(30) null | RETAIL, FULL_TRUCK, HALF_TRUCK |
| origin_zone_id | uuid null FK | โซนต้นทาง |
| destination_zone_id | uuid null FK | โซนปลายทาง |
| payer_role | varchar(20) | SENDER, RECEIVER, THIRD_PARTY |
| payer_party_id | uuid null FK | ผู้จ่ายจริง |
| settlement_type | varchar(20) | CASH, CREDIT |
| collection_point | varchar(30) | ORIGIN, DESTINATION, BILLING_OFFICE |
| payment_term_id | uuid null FK | เครดิตเทอม |
| default_payment_method | varchar(20) | CASH, TRANSFER, QR, CHEQUE |
| priority_no | integer | ลำดับ |
| effective_from | date | เริ่มใช้ |
| effective_to | date null | สิ้นสุด |
| approval_status | varchar(20) | DRAFT, APPROVED |
| approved_by | uuid null FK | ผู้อนุมัติ |
| approved_at | timestamptz null | เวลาอนุมัติ |
ตัวอย่าง:
* ผู้ส่ง A + ผู้รับ B → ผู้ส่งจ่ายแบบเครดิต 30 วัน
* ผู้ส่ง A + ผู้รับ C → ผู้รับจ่ายเงินสดปลายทาง
## 9. Sales, Contract และ Pricing
### 9.1 quotations

| Column | Type | รายละเอียด |
| --- | --- | --- |
| quotation_no | varchar(30) unique | เลขเสนอราคา |
| customer_party_id | uuid FK | ลูกค้า |
| quotation_date | date | วันที่ |
| valid_until | date | ใช้ได้ถึง |
| service_type | varchar(30) | RETAIL, FULL_TRUCK, HALF_TRUCK |
| payment_term_id | uuid null FK | เครดิตเทอม |
| quotation_status | varchar(20) | DRAFT, SENT, ACCEPTED, EXPIRED |
| subtotal_amount | numeric(18,2) | ยอดก่อนภาษี |
| vat_amount | numeric(18,2) | VAT |
| total_amount | numeric(18,2) | รวม |
| remark | text null | หมายเหตุ |
### 9.2 quotation_lines

| Column | Type | รายละเอียด |
| --- | --- | --- |
| quotation_id | uuid FK | ใบเสนอราคา |
| line_no | integer | ลำดับ |
| product_id | uuid null FK | สินค้า |
| uom_id | uuid null FK | หน่วย |
| origin_zone_id | uuid null FK | ต้นทาง |
| destination_zone_id | uuid null FK | ปลายทาง |
| charge_basis | varchar(30) | PER_UNIT, PER_KG, PER_TON, FLAT |
| quantity | numeric(18,4) | จำนวน |
| unit_price | numeric(18,4) | ราคา |
| total_amount | numeric(18,2) | รวม |
### 9.3 price_books

| Column | Type | รายละเอียด |
| --- | --- | --- |
| price_book_code | varchar(30) unique | รหัสชุดราคา |
| price_book_name | varchar(255) | ชื่อ |
| price_book_type | varchar(20) | STANDARD, CUSTOMER, CONTRACT |
| customer_party_id | uuid null FK | ลูกค้าเฉพาะ |
| effective_from | date | เริ่มใช้ |
| effective_to | date null | สิ้นสุด |
| currency_code | varchar(3) | THB |
| approval_status | varchar(20) | DRAFT, APPROVED |
### 9.4 price_rules

| Column | Type | รายละเอียด |
| --- | --- | --- |
| price_book_id | uuid FK | ชุดราคา |
| rule_code | varchar(30) | รหัสกฎ |
| sender_party_id | uuid null FK | ผู้ส่ง |
| receiver_party_id | uuid null FK | ผู้รับ |
| payer_party_id | uuid null FK | ผู้จ่าย |
| product_id | uuid null FK | สินค้า |
| product_category_id | uuid null FK | หมวด |
| uom_id | uuid null FK | หน่วยราคา |
| service_type | varchar(30) | RETAIL, FULL_TRUCK, HALF_TRUCK |
| origin_zone_id | uuid null FK | ต้นทาง |
| destination_zone_id | uuid null FK | ปลายทาง |
| vehicle_type_id | uuid null FK | ประเภทรถ |
| settlement_type | varchar(20) null | CASH, CREDIT |
| charge_basis | varchar(30) | PER_UNIT, PER_KG, PER_TON, FLAT |
| minimum_charge | numeric(18,2) | ราคาขั้นต่ำ |
| specificity_score | integer | ความเฉพาะเจาะจง |
| priority_no | integer | ลำดับค้นหา |
| effective_from | date | เริ่มใช้ |
| effective_to | date null | สิ้นสุด |
| approval_status | varchar(20) | DRAFT, APPROVED, REJECTED |
| approved_by | uuid null FK | ผู้อนุมัติ |
| approved_at | timestamptz null | เวลาอนุมัติ |
### 9.5 price_rule_tiers

| Column | Type | รายละเอียด |
| --- | --- | --- |
| price_rule_id | uuid FK | กฎราคา |
| minimum_quantity | numeric(18,4) | จำนวนเริ่ม |
| maximum_quantity | numeric(18,4) null | จำนวนสิ้นสุด |
| unit_price | numeric(18,4) null | ราคาต่อหน่วย |
| flat_amount | numeric(18,2) null | ราคาเหมา |
| minimum_charge | numeric(18,2) | ขั้นต่ำ |
| maximum_charge | numeric(18,2) null | สูงสุด |
ลำดับค้นหาราคา
1. ผู้ส่ง + ผู้รับ + สินค้า + หน่วย + เส้นทาง
2. ผู้ส่ง + ผู้รับ + สินค้า
3. ลูกค้า + สินค้า + เส้นทาง
4. ลูกค้า + เส้นทาง
5. สินค้า + เส้นทาง
6. ราคามาตรฐาน
7. หากไม่พบราคา ต้องขออนุมัติ
## 10. Transport Order และ Shipment
### 10.1 transport_orders

| Column | Type | รายละเอียด |
| --- | --- | --- |
| order_no | varchar(30) unique | เลขคำสั่งขนส่ง |
| branch_id | uuid FK | สาขารับงาน |
| order_date | date | วันที่ |
| service_type | varchar(30) | RETAIL, FULL_TRUCK, HALF_TRUCK, SHARED |
| customer_party_id | uuid FK | ผู้สั่งงาน |
| sender_party_id | uuid FK | ผู้ส่ง |
| receiver_party_id | uuid FK | ผู้รับ |
| payer_party_id | uuid FK | ผู้จ่าย |
| payer_role | varchar(20) | SENDER, RECEIVER, THIRD_PARTY |
| settlement_type | varchar(20) | CASH, CREDIT |
| collection_point | varchar(30) | ORIGIN, DESTINATION, BILLING_OFFICE |
| payment_term_id | uuid null FK | เครดิตเทอม |
| customer_po_no | varchar(100) null | PO ลูกค้า |
| requested_pickup_at | timestamptz null | เวลารับ |
| requested_delivery_at | timestamptz null | เวลาส่ง |
| order_status | varchar(30) | DRAFT, CONFIRMED, IN_PROGRESS, COMPLETED |
| remark | text null | หมายเหตุ |
### 10.2 shipments

| Column | Type | รายละเอียด |
| --- | --- | --- |
| shipment_no | varchar(30) unique | เลขใบขนส่ง |
| transport_order_id | uuid FK | Order |
| branch_id | uuid FK | สาขารับ |
| sender_party_id | uuid FK | ผู้ส่ง |
| receiver_party_id | uuid FK | ผู้รับ |
| payer_party_id | uuid FK | ผู้จ่าย |
| payer_role_snapshot | varchar(20) | บทบาทผู้จ่าย ณ วันเปิด |
| settlement_type_snapshot | varchar(20) | CASH/CREDIT |
| collection_point_snapshot | varchar(30) | จุดเก็บเงิน |
| credit_days_snapshot | integer | เครดิต ณ วันเปิด |
| dropoff_party_id | uuid null FK | ผู้นำมาส่ง |
| dropoff_contact_name | varchar(255) null | ชื่อผู้นำส่ง |
| dropoff_contact_phone | varchar(30) null | โทรศัพท์ |
| received_at | timestamptz | เวลารับของ |
| expected_delivery_at | timestamptz null | คาดว่าส่ง |
| total_quantity | numeric(18,4) | จำนวนรวม |
| total_weight_kg | numeric(18,4) | น้ำหนักรวม |
| total_volume_m3 | numeric(18,4) | ปริมาตรรวม |
| goods_value | numeric(18,2) null | มูลค่าสินค้า |
| shipment_status | varchar(30) | สถานะขนส่ง |
| billing_status | varchar(30) | UNBILLED, BILLED, PARTIAL, PAID |
| special_instruction | text null | คำสั่งพิเศษ |
### 10.3 shipment_stops
เก็บทั้งจุดรับและจุดส่ง พร้อม Snapshot ที่อยู่

| Column | Type | รายละเอียด |
| --- | --- | --- |
| shipment_id | uuid FK | ใบขนส่ง |
| stop_sequence | integer | ลำดับ |
| stop_type | varchar(20) | PICKUP, DELIVERY |
| party_id | uuid null FK | บุคคล/บริษัท |
| party_address_id | uuid null FK | Master Address |
| address_name_snapshot | varchar(255) | ชื่อสถานที่ ณ วันเปิด |
| address_snapshot | text | ที่อยู่ Snapshot |
| province_id_snapshot | uuid null | จังหวัด |
| latitude_snapshot | numeric(10,7) null | Latitude |
| longitude_snapshot | numeric(10,7) null | Longitude |
| contact_name_snapshot | varchar(255) null | ผู้ติดต่อ |
| contact_phone_snapshot | varchar(30) null | โทรศัพท์ |
| planned_at | timestamptz null | เวลานัด |
| actual_arrival_at | timestamptz null | ถึงจริง |
| actual_departure_at | timestamptz null | ออกจริง |
| stop_status | varchar(20) | PENDING, ARRIVED, COMPLETED, FAILED |
### 10.4 shipment_items

| Column | Type | รายละเอียด |
| --- | --- | --- |
| shipment_id | uuid FK | ใบขนส่ง |
| line_no | integer | ลำดับ |
| product_id | uuid FK | สินค้า |
| product_name_snapshot | varchar(255) | ชื่อสินค้า ณ วันเปิด |
| quantity | numeric(18,4) | จำนวน |
| uom_id | uuid FK | หน่วย |
| uom_name_snapshot | varchar(100) | ชื่อหน่วย Snapshot |
| actual_weight_kg | numeric(18,4) null | น้ำหนักจริง |
| chargeable_weight_kg | numeric(18,4) null | น้ำหนักคิดราคา |
| volume_m3 | numeric(18,4) null | ปริมาตร |
| package_count | numeric(18,4) null | จำนวนหีบห่อ |
| unit_goods_value | numeric(18,2) null | มูลค่าต่อหน่วย |
| is_fragile | boolean | แตกง่าย |
| remark | text null | หมายเหตุ |
### 10.5 shipment_charges

| Column | Type | รายละเอียด |
| --- | --- | --- |
| shipment_id | uuid FK | ใบขนส่ง |
| shipment_item_id | uuid null FK | รายการสินค้า |
| charge_type | varchar(30) | FREIGHT, HANDLING, WAITING, EXTRA_STOP |
| price_rule_id | uuid null FK | กฎราคา |
| charge_basis | varchar(30) | PER_UNIT, PER_KG, PER_TON, FLAT |
| charge_quantity | numeric(18,4) | จำนวนคิดราคา |
| unit_price_snapshot | numeric(18,4) | ราคาที่ใช้จริง |
| amount_before_discount | numeric(18,2) | ก่อนลด |
| discount_amount | numeric(18,2) | ส่วนลด |
| amount_before_tax | numeric(18,2) | ก่อน VAT |
| vat_rate_snapshot | numeric(5,2) | VAT ณ วันทำรายการ |
| vat_amount | numeric(18,2) | VAT |
| total_amount | numeric(18,2) | สุทธิ |
| is_price_override | boolean | แก้ราคาหรือไม่ |
| override_reason | text null | เหตุผล |
| override_approved_by | uuid null FK | ผู้อนุมัติ |
| override_approved_at | timestamptz null | เวลาอนุมัติ |
### 10.6 shipment_status_history

| Column | Type | รายละเอียด |
| --- | --- | --- |
| shipment_id | uuid FK | ใบขนส่ง |
| old_status | varchar(30) null | สถานะเดิม |
| new_status | varchar(30) | สถานะใหม่ |
| status_at | timestamptz | เวลา |
| branch_id | uuid null FK | สาขา |
| latitude | numeric(10,7) null | พิกัด |
| longitude | numeric(10,7) null | พิกัด |
| remark | text null | หมายเหตุ |
| changed_by | uuid FK | ผู้เปลี่ยน |
### 10.7 proofs_of_delivery

| Column | Type | รายละเอียด |
| --- | --- | --- |
| shipment_id | uuid FK | ใบขนส่ง |
| shipment_stop_id | uuid FK | จุดส่ง |
| delivery_status | varchar(30) | DELIVERED, PARTIAL, FAILED |
| delivered_at | timestamptz | เวลาส่ง |
| received_by_name | varchar(255) | ผู้รับจริง |
| received_by_phone | varchar(30) null | โทรศัพท์ |
| signature_file_key | text null | ที่เก็บลายเซ็น |
| photo_file_key | text null | ที่เก็บรูป |
| latitude | numeric(10,7) null | พิกัด |
| longitude | numeric(10,7) null | พิกัด |
| actual_quantity | numeric(18,4) | ส่งจริง |
| shortage_quantity | numeric(18,4) | ขาด |
| damage_quantity | numeric(18,4) | เสียหาย |
| failure_reason | text null | เหตุผลส่งไม่สำเร็จ |
| recorded_by_employee_id | uuid FK | ผู้บันทึก |
## 11. งานเหมาเต็มคัน/ครึ่งคัน
### 11.1 charter_orders

| Column | Type | รายละเอียด |
| --- | --- | --- |
| transport_order_id | uuid FK unique | Order หลัก |
| charter_type | varchar(20) | FULL, HALF, SHARED |
| vehicle_type_id | uuid FK | ประเภทรถ |
| pricing_method | varchar(20) | FLAT, PER_KG, PER_TON |
| agreed_amount | numeric(18,2) | ราคาเหมา |
| minimum_weight_kg | numeric(18,4) null | น้ำหนักขั้นต่ำ |
| included_weight_kg | numeric(18,4) null | น้ำหนักในราคา |
| excess_price_per_kg | numeric(18,4) null | ราคาส่วนเกิน |
| included_stop_count | integer | จำนวนจุดรวม |
| extra_stop_charge | numeric(18,2) | ค่าจุดเพิ่ม |
| waiting_free_minutes | integer | เวลารอฟรี |
| waiting_charge_per_hour | numeric(18,2) | ค่ารอ |
| overnight_charge | numeric(18,2) | ค่าค้างคืน |
## 12. รถ เที่ยวรถ และการถ่ายสินค้า
### 12.1 vehicle_types

| Column | Type | รายละเอียด |
| --- | --- | --- |
| vehicle_type_code | varchar(20) unique | รหัส |
| vehicle_type_name | varchar(100) | รถสิบล้อ |
| maximum_weight_kg | numeric(18,2) | น้ำหนักสูงสุด |
| maximum_volume_m3 | numeric(18,2) | ปริมาตรสูงสุด |
| default_fuel_rate_km_l | numeric(10,2) | กม./ลิตร |
### 12.2 vehicles

| Column | Type | รายละเอียด |
| --- | --- | --- |
| vehicle_code | varchar(30) unique | รหัสรถ |
| registration_no | varchar(30) | ทะเบียน |
| registration_province_id | uuid FK | จังหวัดทะเบียน |
| vehicle_type_id | uuid FK | ประเภทรถ |
| ownership_type | varchar(20) | COMPANY, PARTNER, RENTAL |
| owner_party_id | uuid null FK | เจ้าของรถร่วม |
| brand | varchar(100) null | ยี่ห้อ |
| model | varchar(100) null | รุ่น |
| model_year | integer null | ปี |
| chassis_no | varchar(100) null | เลขตัวถัง |
| engine_no | varchar(100) null | เลขเครื่อง |
| current_odometer_km | numeric(18,2) | ไมล์ล่าสุด |
| gps_device_id | varchar(100) null | GPS |
| vehicle_status | varchar(30) | AVAILABLE, IN_TRIP, MAINTENANCE |
| tax_expiry_date | date null | ภาษีหมด |
| insurance_expiry_date | date null | ประกันหมด |
| inspection_expiry_date | date null | ตรวจสภาพหมด |
Unique: (registration_no, registration_province_id)
### 12.3 trips

| Column | Type | รายละเอียด |
| --- | --- | --- |
| trip_no | varchar(30) unique | เลขเที่ยว |
| branch_id | uuid FK | สาขาต้นทาง |
| trip_type | varchar(30) | OUTBOUND, RETURN, CHARTER, TRANSFER |
| planned_departure_at | timestamptz | ออกตามแผน |
| actual_departure_at | timestamptz null | ออกจริง |
| planned_arrival_at | timestamptz null | ถึงตามแผน |
| actual_arrival_at | timestamptz null | ถึงจริง |
| start_odometer_km | numeric(18,2) null | ไมล์เริ่ม |
| end_odometer_km | numeric(18,2) null | ไมล์จบ |
| planned_distance_km | numeric(18,2) null | ระยะทางแผน |
| actual_distance_km | numeric(18,2) null | ระยะจริง |
| trip_status | varchar(30) | PLANNED, LOADING, IN_TRANSIT, COMPLETED |
| remark | text null | หมายเหตุ |
### 12.4 trip_vehicles

| Column | Type | รายละเอียด |
| --- | --- | --- |
| trip_id | uuid FK | เที่ยว |
| vehicle_id | uuid FK | รถ |
| assignment_type | varchar(20) | MAIN, TRAILER, REPLACEMENT |
| assigned_from | timestamptz | เริ่มใช้ |
| assigned_to | timestamptz null | สิ้นสุด |
| is_primary | boolean | รถหลัก |
### 12.5 trip_employees

| Column | Type | รายละเอียด |
| --- | --- | --- |
| trip_id | uuid FK | เที่ยว |
| employee_id | uuid FK | พนักงาน |
| assignment_role | varchar(30) | MAIN_DRIVER, ASSISTANT, LOADER |
| assigned_from | timestamptz | เริ่มงาน |
| assigned_to | timestamptz null | สิ้นสุด |
| trip_allowance | numeric(18,2) | ค่าเที่ยว |
| daily_allowance | numeric(18,2) | เบี้ยเลี้ยง |
### 12.6 trip_stops

| Column | Type | รายละเอียด |
| --- | --- | --- |
| trip_id | uuid FK | เที่ยว |
| stop_sequence | integer | ลำดับ |
| stop_type | varchar(20) | PICKUP, DELIVERY, HUB, REST, FUEL |
| branch_id | uuid null FK | สาขา |
| party_address_id | uuid null FK | ที่อยู่ |
| stop_name_snapshot | varchar(255) | ชื่อจุด |
| address_snapshot | text | ที่อยู่ |
| latitude | numeric(10,7) | พิกัด |
| longitude | numeric(10,7) | พิกัด |
| planned_arrival_at | timestamptz null | ถึงตามแผน |
| actual_arrival_at | timestamptz null | ถึงจริง |
| actual_departure_at | timestamptz null | ออกจริง |
| stop_status | varchar(20) | PENDING, ARRIVED, COMPLETED |
### 12.7 shipment_legs
รองรับ Shipment เดียวขึ้นหลายรถหรือผ่านหลาย Hub

| Column | Type | รายละเอียด |
| --- | --- | --- |
| shipment_id | uuid FK | ใบขนส่ง |
| leg_sequence | integer | ลำดับช่วง |
| from_trip_stop_id | uuid FK | จุดเริ่ม |
| to_trip_stop_id | uuid FK | จุดจบ |
| trip_id | uuid FK | เที่ยวรถ |
| leg_status | varchar(20) | PLANNED, LOADED, IN_TRANSIT, COMPLETED |
| loaded_at | timestamptz null | ขึ้นรถ |
| unloaded_at | timestamptz null | ลงรถ |
### 12.8 trip_load_allocations

| Column | Type | รายละเอียด |
| --- | --- | --- |
| trip_id | uuid FK | เที่ยว |
| shipment_id | uuid FK | ใบขนส่ง |
| shipment_item_id | uuid null FK | รายการ |
| allocated_quantity | numeric(18,4) | จำนวนขึ้นรถ |
| allocated_weight_kg | numeric(18,4) | น้ำหนัก |
| allocated_volume_m3 | numeric(18,4) | ปริมาตร |
| load_sequence | integer | ลำดับขึ้น |
| unload_sequence | integer | ลำดับลง |
| revenue_amount | numeric(18,2) | รายได้ |
| allocated_trip_cost | numeric(18,2) | ต้นทุนที่เฉลี่ย |
## 13. GPS
### 13.1 gps_positions
ควร Partition รายเดือน

| Column | Type | รายละเอียด |
| --- | --- | --- |
| vehicle_id | uuid FK | รถ |
| trip_id | uuid null FK | เที่ยว |
| device_id | varchar(100) | GPS |
| recorded_at | timestamptz | เวลาจาก GPS |
| received_at | timestamptz | เวลารับข้อมูล |
| latitude | numeric(10,7) | Latitude |
| longitude | numeric(10,7) | Longitude |
| speed_kph | numeric(10,2) | ความเร็ว |
| heading_degree | numeric(6,2) | ทิศ |
| engine_on | boolean | เครื่องยนต์ |
| odometer_km | numeric(18,2) null | เลขไมล์ |
| raw_payload | jsonb | ข้อมูลต้นฉบับ |
### 13.2 vehicle_latest_positions

| Column | Type | รายละเอียด |
| --- | --- | --- |
| vehicle_id | uuid PK/FK | รถ |
| gps_position_id | uuid FK | ตำแหน่งล่าสุด |
| recorded_at | timestamptz | เวลา |
| latitude | numeric(10,7) | Latitude |
| longitude | numeric(10,7) | Longitude |
| speed_kph | numeric(10,2) | ความเร็ว |
| engine_on | boolean | เครื่องยนต์ |
## 14. Finance และลูกหนี้
### 14.1 billing_notes

| Column | Type | รายละเอียด |
| --- | --- | --- |
| billing_note_no | varchar(30) unique | เลขวางบิล |
| customer_party_id | uuid FK | ลูกค้า |
| billing_date | date | วันที่ |
| appointment_date | date null | วันนัดรับเงิน |
| total_amount | numeric(18,2) | ยอด |
| billing_status | varchar(20) | DRAFT, SUBMITTED, ACCEPTED, PAID |
| received_by_name | varchar(255) null | ผู้รับวางบิล |
| remark | text null | หมายเหตุ |
### 14.2 invoices

| Column | Type | รายละเอียด |
| --- | --- | --- |
| invoice_no | varchar(30) unique | เลข Invoice |
| invoice_type | varchar(20) | INVOICE, TAX_INVOICE |
| branch_id | uuid FK | สาขา |
| customer_party_id | uuid FK | ลูกหนี้ |
| invoice_date | date | วันที่ |
| payment_term_id | uuid FK | เครดิตเทอม |
| credit_days_snapshot | integer | วันเครดิต |
| due_date | date | ครบกำหนด |
| subtotal_amount | numeric(18,2) | ก่อนส่วนลด |
| discount_amount | numeric(18,2) | ส่วนลด |
| amount_before_tax | numeric(18,2) | ก่อนภาษี |
| vat_amount | numeric(18,2) | VAT |
| withholding_tax_amount | numeric(18,2) | หัก ณ ที่จ่าย |
| total_amount | numeric(18,2) | รวม |
| invoice_status | varchar(20) | DRAFT, ISSUED, PARTIAL, PAID, VOID |
| remark | text null | หมายเหตุ |
paid_amount และ outstanding_amount ควรคำนวณจาก Payment Allocation ไม่ให้ User แก้เอง
### 14.3 invoice_lines

| Column | Type | รายละเอียด |
| --- | --- | --- |
| invoice_id | uuid FK | Invoice |
| line_no | integer | ลำดับ |
| shipment_id | uuid null FK | ใบขนส่ง |
| shipment_charge_id | uuid null FK | ค่าบริการ |
| description_snapshot | varchar(500) | รายละเอียด |
| quantity | numeric(18,4) | จำนวน |
| unit_price | numeric(18,4) | ราคา |
| discount_amount | numeric(18,2) | ส่วนลด |
| amount_before_tax | numeric(18,2) | ก่อน VAT |
| vat_rate | numeric(5,2) | VAT |
| vat_amount | numeric(18,2) | VAT |
| total_amount | numeric(18,2) | รวม |
### 14.4 payments

| Column | Type | รายละเอียด |
| --- | --- | --- |
| payment_no | varchar(30) unique | เลขรับเงิน |
| payer_party_id | uuid FK | ผู้จ่าย |
| payment_date | date | วันที่ |
| payment_method | varchar(20) | CASH, TRANSFER, QR, CHEQUE |
| bank_account_id | uuid null FK | บัญชีรับ |
| reference_no | varchar(100) null | อ้างอิง |
| cheque_no | varchar(50) null | เลขเช็ค |
| cheque_date | date null | วันที่เช็ค |
| payment_amount | numeric(18,2) | ยอดรับ |
| payment_status | varchar(20) | PENDING, CONFIRMED, BOUNCED, VOID |
| received_by | uuid FK | ผู้รับเงิน |
| remark | text null | หมายเหตุ |
### 14.5 payment_allocations

| Column | Type | รายละเอียด |
| --- | --- | --- |
| payment_id | uuid FK | เงินรับ |
| invoice_id | uuid FK | Invoice |
| allocated_amount | numeric(18,2) | ยอดตัดหนี้ |
| allocated_at | timestamptz | เวลา |
| allocated_by | uuid FK | ผู้ตัดหนี้ |
### 14.6 shipment_collections
ใช้ควบคุมเงินสดต้นทางและปลายทาง

| Column | Type | รายละเอียด |
| --- | --- | --- |
| shipment_id | uuid FK | ใบขนส่ง |
| payer_party_id | uuid FK | ผู้ต้องจ่าย |
| collection_point | varchar(20) | ORIGIN, DESTINATION |
| expected_amount | numeric(18,2) | ต้องเก็บ |
| collected_amount | numeric(18,2) | เก็บแล้ว |
| collection_status | varchar(20) | PENDING, PARTIAL, COLLECTED, WAIVED |
| collected_at | timestamptz null | เวลาเก็บ |
| collected_by_employee_id | uuid null FK | ผู้เก็บ |
| payment_id | uuid null FK | รายการรับเงิน |
| remark | text null | หมายเหตุ |
### 14.7 Dashboard ลูกหนี้

| สถานะ | เงื่อนไข |
| --- | --- |
| ยังไม่ถึงกำหนด | ยอดคงเหลือมากกว่า 0 และ due_date > วันนี้ |
| ครบกำหนดวันนี้ | ยอดคงเหลือมากกว่า 0 และ due_date = วันนี้ |
| เกินกำหนด | ยอดคงเหลือมากกว่า 0 และ due_date < วันนี้ |
| ชำระบางส่วน | Payment Allocation น้อยกว่า Invoice |
| ชำระครบ | ยอดจัดสรรเท่ากับ Invoice |
| ข้อพิพาท | Invoice ถูก Hold จาก Dispute |
AR Aging:
* ยังไม่ถึงกำหนด
* 1–30 วัน
* 31–60 วัน
* 61–90 วัน
* มากกว่า 90 วัน
## 15. Accounting
### 15.1 chart_of_accounts

| Column | Type | รายละเอียด |
| --- | --- | --- |
| account_code | varchar(30) unique | รหัสบัญชี |
| account_name | varchar(255) | ชื่อบัญชี |
| account_type | varchar(20) | ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE |
| parent_account_id | uuid null FK | บัญชีแม่ |
| normal_balance | varchar(10) | DEBIT, CREDIT |
| allow_posting | boolean | ลงรายการได้ |
| is_control_account | boolean | บัญชีคุม |
### 15.2 journal_entries

| Column | Type | รายละเอียด |
| --- | --- | --- |
| journal_no | varchar(30) unique | เลข Journal |
| journal_date | date | วันที่ |
| source_module | varchar(30) | AR, AP, CASH, TRIP, MAINTENANCE |
| reference_type | varchar(30) | INVOICE, PAYMENT, EXPENSE |
| reference_id | uuid null | เอกสารอ้างอิง |
| description | text | รายละเอียด |
| posting_status | varchar(20) | DRAFT, POSTED, REVERSED |
| posted_at | timestamptz null | เวลาผ่านบัญชี |
| posted_by | uuid null FK | ผู้ผ่าน |
### 15.3 journal_lines

| Column | Type | รายละเอียด |
| --- | --- | --- |
| journal_entry_id | uuid FK | Journal |
| line_no | integer | ลำดับ |
| account_id | uuid FK | บัญชี |
| party_id | uuid null FK | ลูกค้า/Supplier |
| branch_id | uuid FK | สาขา |
| trip_id | uuid null FK | เที่ยว |
| shipment_id | uuid null FK | ใบขนส่ง |
| debit_amount | numeric(18,2) | Debit |
| credit_amount | numeric(18,2) | Credit |
| description | varchar(500) | รายละเอียด |
ข้อบังคับ:
∑
D
e
b
i
t
=
∑
C
r
e
d
i
t
\sum Debit = \sum Credit
∑Debit=∑Credit
## 16. ค่าใช้จ่ายและกำไรเที่ยว
### 16.1 trip_expenses

| Column | Type | รายละเอียด |
| --- | --- | --- |
| trip_id | uuid FK | เที่ยว |
| expense_type | varchar(30) | FUEL, TOLL, DRIVER, REPAIR, OTHER |
| expense_date | date | วันที่ |
| supplier_party_id | uuid null FK | ผู้ขาย |
| description | varchar(500) | รายละเอียด |
| quantity | numeric(18,4) | จำนวน |
| unit_price | numeric(18,4) | ราคา |
| amount | numeric(18,2) | รวม |
| receipt_no | varchar(100) null | ใบเสร็จ |
| approval_status | varchar(20) | PENDING, APPROVED, REJECTED |
| approved_by | uuid null FK | ผู้อนุมัติ |
### 16.2 fuel_transactions

| Column | Type | รายละเอียด |
| --- | --- | --- |
| vehicle_id | uuid FK | รถ |
| trip_id | uuid null FK | เที่ยว |
| fuel_date | timestamptz | เวลา |
| odometer_km | numeric(18,2) | ไมล์ |
| fuel_type | varchar(30) | DIESEL |
| quantity_litre | numeric(18,4) | ลิตร |
| price_per_litre | numeric(18,4) | ราคาลิตร |
| total_amount | numeric(18,2) | รวม |
| station_party_id | uuid null FK | ปั๊ม |
| receipt_no | varchar(100) null | ใบเสร็จ |
| full_tank | boolean | เต็มถัง |
กำไรเที่ยว:

Trip Gross Profit= รายได้ของ Shipment ทั้งหมดใน Trip- น้ำมัน- ค่าแรงและค่าเที่ยว- ค่าทางด่วน- ค่ารถร่วม- ค่าใช้จ่ายระหว่างทาง- ต้นทุนซ่อมและค่าเสื่อมที่จัดสรร
## 17. Claims และสินค้าเสียหาย
### 17.1 shipment_claims

| Column | Type | รายละเอียด |
| --- | --- | --- |
| claim_no | varchar(30) unique | เลข Claim |
| shipment_id | uuid FK | ใบขนส่ง |
| shipment_item_id | uuid null FK | รายการ |
| claim_type | varchar(20) | DAMAGE, LOSS, SHORTAGE, DELAY |
| reported_at | timestamptz | เวลาแจ้ง |
| reported_by_party_id | uuid null FK | ผู้แจ้ง |
| claimed_quantity | numeric(18,4) | จำนวน |
| claimed_amount | numeric(18,2) | ยอดเรียกร้อง |
| approved_amount | numeric(18,2) | ยอดอนุมัติ |
| claim_status | varchar(20) | OPEN, INVESTIGATING, APPROVED, REJECTED, SETTLED |
| responsible_party | varchar(20) | COMPANY, DRIVER, PARTNER, CUSTOMER |
| cause_description | text | สาเหตุ |
| resolution_description | text null | วิธีแก้ |
| approved_by | uuid null FK | ผู้อนุมัติ |
## 18. Maintenance
### 18.1 maintenance_plans

| Column | Type | รายละเอียด |
| --- | --- | --- |
| vehicle_type_id | uuid null FK | ประเภทรถ |
| vehicle_id | uuid null FK | รถเฉพาะคัน |
| plan_name | varchar(255) | ชื่อแผน |
| maintenance_type | varchar(30) | OIL, BRAKE, TIRE, INSPECTION |
| interval_km | numeric(18,2) null | รอบกิโลเมตร |
| interval_days | integer null | รอบวัน |
| last_service_date | date null | ล่าสุด |
| last_service_odometer | numeric(18,2) null | ไมล์ล่าสุด |
| next_due_date | date null | ครบกำหนด |
| next_due_odometer | numeric(18,2) null | ไมล์ครบกำหนด |
### 18.2 maintenance_work_orders

| Column | Type | รายละเอียด |
| --- | --- | --- |
| work_order_no | varchar(30) unique | เลขใบซ่อม |
| vehicle_id | uuid FK | รถ |
| reported_by_employee_id | uuid FK | ผู้แจ้ง |
| reported_at | timestamptz | เวลาแจ้ง |
| problem_description | text | อาการ |
| maintenance_type | varchar(30) | PREVENTIVE, CORRECTIVE, EMERGENCY |
| odometer_km | numeric(18,2) | ไมล์ |
| supplier_party_id | uuid null FK | อู่ |
| scheduled_date | date null | นัดซ่อม |
| started_at | timestamptz null | เริ่ม |
| completed_at | timestamptz null | เสร็จ |
| labour_cost | numeric(18,2) | ค่าแรง |
| parts_cost | numeric(18,2) | อะไหล่ |
| other_cost | numeric(18,2) | อื่น ๆ |
| total_cost | numeric(18,2) | รวม |
| work_order_status | varchar(20) | OPEN, APPROVED, IN_PROGRESS, COMPLETED |
| approved_by | uuid null FK | ผู้อนุมัติ |
## 19. Procurement และ Inventory
### 19.1 inventory_items

| Column | Type | รายละเอียด |
| --- | --- | --- |
| item_code | varchar(30) unique | รหัส |
| item_name | varchar(255) | ชื่อ |
| item_category | varchar(50) | PART, TIRE, TOOL, SUPPLY |
| uom_id | uuid FK | หน่วย |
| minimum_stock | numeric(18,4) | ขั้นต่ำ |
| reorder_point | numeric(18,4) | จุดสั่ง |
| standard_cost | numeric(18,4) | ทุนมาตรฐาน |
| serial_controlled | boolean | คุม Serial |
| lot_controlled | boolean | คุม Lot |
ราคาทุนเฉลี่ยควรคำนวณจาก Inventory Transaction ไม่เปิดให้แก้ตรง ๆ
### 19.2 warehouses

| Column | Type | รายละเอียด |
| --- | --- | --- |
| warehouse_code | varchar(20) unique | รหัสคลัง |
| warehouse_name | varchar(255) | ชื่อ |
| branch_id | uuid FK | สาขา |
| warehouse_type | varchar(30) | PARTS, TOOLS, GENERAL |
| responsible_employee_id | uuid null FK | ผู้รับผิดชอบ |
### 19.3 purchase_orders

| Column | Type | รายละเอียด |
| --- | --- | --- |
| po_no | varchar(30) unique | เลข PO |
| branch_id | uuid FK | สาขา |
| supplier_party_id | uuid FK | Supplier |
| po_date | date | วันที่ |
| expected_date | date null | คาดว่าจะรับ |
| subtotal_amount | numeric(18,2) | ก่อนภาษี |
| vat_amount | numeric(18,2) | VAT |
| total_amount | numeric(18,2) | รวม |
| po_status | varchar(20) | DRAFT, APPROVED, PARTIAL, CLOSED |
| approved_by | uuid null FK | ผู้อนุมัติ |
| approved_at | timestamptz null | เวลาอนุมัติ |
### 19.4 purchase_order_lines

| Column | Type | รายละเอียด |
| --- | --- | --- |
| purchase_order_id | uuid FK | PO |
| line_no | integer | ลำดับ |
| inventory_item_id | uuid FK | รายการ |
| description | varchar(500) | รายละเอียด |
| ordered_quantity | numeric(18,4) | จำนวนสั่ง |
| received_quantity | numeric(18,4) | รับแล้ว |
| unit_price | numeric(18,4) | ราคา |
| discount_amount | numeric(18,2) | ส่วนลด |
| vat_amount | numeric(18,2) | VAT |
| total_amount | numeric(18,2) | รวม |
### 19.5 inventory_transactions

| Column | Type | รายละเอียด |
| --- | --- | --- |
| warehouse_id | uuid FK | คลัง |
| inventory_item_id | uuid FK | สินค้า |
| transaction_type | varchar(30) | RECEIVE, ISSUE, RETURN, TRANSFER, ADJUST |
| transaction_date | timestamptz | เวลา |
| quantity | numeric(18,4) | จำนวนบวก/ลบ |
| unit_cost | numeric(18,4) | ทุน |
| total_cost | numeric(18,2) | รวม |
| reference_type | varchar(30) | PO, WORK_ORDER, ADJUSTMENT |
| reference_id | uuid null | เอกสาร |
| lot_no | varchar(100) null | Lot |
| serial_no | varchar(100) null | Serial |
## 20. HR
### 20.1 departments

| Column | Type | รายละเอียด |
| --- | --- | --- |
| department_code | varchar(20) unique | รหัส |
| department_name | varchar(255) | แผนก |
| parent_department_id | uuid null FK | แผนกแม่ |
| manager_employee_id | uuid null FK | หัวหน้า |
### 20.2 positions

| Column | Type | รายละเอียด |
| --- | --- | --- |
| position_code | varchar(20) unique | รหัส |
| position_name | varchar(255) | ตำแหน่ง |
| position_group | varchar(30) | DRIVER, ADMIN, LOADER, MANAGER |
| department_id | uuid FK | แผนก |
### 20.3 employees

| Column | Type | รายละเอียด |
| --- | --- | --- |
| employee_code | varchar(30) unique | รหัส |
| title | varchar(30) | คำนำหน้า |
| first_name | varchar(100) | ชื่อ |
| last_name | varchar(100) | นามสกุล |
| nickname | varchar(100) null | ชื่อเล่น |
| branch_id | uuid FK | สาขา |
| department_id | uuid FK | แผนก |
| position_id | uuid FK | ตำแหน่ง |
| manager_employee_id | uuid null FK | หัวหน้า |
| employment_type | varchar(20) | PERMANENT, DAILY, CONTRACT |
| hire_date | date | เริ่มงาน |
| termination_date | date null | สิ้นสุด |
| employment_status | varchar(20) | ACTIVE, SUSPENDED, TERMINATED |
| phone | varchar(30) | โทรศัพท์ |
| driver_license_no | varchar(100) null | ใบขับขี่ |
| driver_license_type | varchar(30) null | ประเภท |
| driver_license_expiry | date null | หมดอายุ |
| default_trip_allowance | numeric(18,2) | ค่าเที่ยวเริ่มต้น |
เงินเดือนควรแยกไปตารางที่เข้ารหัสและจำกัดสิทธิ์ ไม่ควรใส่ใน Employee Master ที่ผู้ดูแลทั่วไปเข้าถึงได้
## 21. Security, Approval และ Audit
### 21.1 users

| Column | Type | รายละเอียด |
| --- | --- | --- |
| username | varchar(100) unique | Username |
| password_hash | text | Password Hash |
| employee_id | uuid null FK | พนักงาน |
| email | varchar(255) | อีเมล |
| user_status | varchar(20) | ACTIVE, LOCKED, DISABLED |
| last_login_at | timestamptz null | Login ล่าสุด |
| failed_login_count | integer | จำนวนผิด |
| password_changed_at | timestamptz | เปลี่ยนรหัส |
| mfa_enabled | boolean | MFA |
### 21.2 roles

| Column | Type | รายละเอียด |
| --- | --- | --- |
| role_code | varchar(30) unique | รหัส Role |
| role_name | varchar(100) | ชื่อ |
| role_level | integer | ระดับ |
| description | text null | รายละเอียด |
### 21.3 permissions

| Column | Type | รายละเอียด |
| --- | --- | --- |
| permission_code | varchar(100) unique | เช่น PRICE.OVERRIDE |
| module_code | varchar(30) | Module |
| permission_name | varchar(255) | ชื่อ |
| action_type | varchar(20) | VIEW, CREATE, EDIT, APPROVE, CANCEL |
### 21.4 user_roles

| Column | Type | รายละเอียด |
| --- | --- | --- |
| user_id | uuid FK | User |
| role_id | uuid FK | Role |
| branch_id | uuid null FK | จำกัดสาขา |
| effective_from | date | เริ่ม |
| effective_to | date null | สิ้นสุด |
### 21.5 approval_requests

| Column | Type | รายละเอียด |
| --- | --- | --- |
| request_type | varchar(30) | PRICE_OVERRIDE, CREDIT_CHANGE, CANCEL |
| reference_type | varchar(100) | ประเภทเอกสาร |
| reference_id | uuid | รหัสเอกสาร |
| old_value | jsonb null | ค่าเดิม |
| new_value | jsonb null | ค่าใหม่ |
| reason | text | เหตุผล |
| requested_by | uuid FK | ผู้ขอ |
| requested_at | timestamptz | เวลาขอ |
| approval_status | varchar(20) | PENDING, APPROVED, REJECTED |
| approved_by | uuid null FK | ผู้อนุมัติ |
| approved_at | timestamptz null | เวลาอนุมัติ |
| approval_remark | text null | ความเห็น |
### 21.6 audit_logs

| Column | Type | รายละเอียด |
| --- | --- | --- |
| user_id | uuid null FK | User |
| action_type | varchar(30) | CREATE, UPDATE, APPROVE, CANCEL, LOGIN |
| entity_type | varchar(100) | ประเภทข้อมูล |
| record_id | uuid null | Record |
| old_value | jsonb null | ค่าเดิม |
| new_value | jsonb null | ค่าใหม่ |
| ip_address | inet null | IP |
| user_agent | text null | อุปกรณ์ |
| occurred_at | timestamptz | เวลา |
## 22. Dashboard ที่ทำยอดขายและรักษาลูกค้า
### Customer 360
* ยอดขายเดือนนี้และย้อนหลัง
* กำไรขั้นต้น
* จำนวน Shipment
* เส้นทางประจำ
* คู่ผู้ส่ง–ผู้รับที่ใช้บ่อย
* ราคาปัจจุบัน
* ยอดหนี้และจำนวนวันค้าง
* วันที่ใช้บริการล่าสุด
* สินค้าเสียหายหรือร้องเรียน
* แนวโน้มเลิกใช้บริการ
* งานที่ควรติดต่อกลับ
### ระบบสร้างยอดขายโดยไม่มี Sales Representative
* แจ้งเตือนลูกค้าที่เคยส่งประจำแต่หายไป 14, 30 หรือ 60 วัน
* แนะนำงานเดิมจากผู้ส่ง–ผู้รับเดิม
* แสดงรถขากลับที่มีพื้นที่เหลือ
* จับคู่ลูกค้าที่มีปลายทางใกล้กัน
* แนะนำราคาโดยดูทั้งราคาประวัติและต้นทุน
* ห้ามขายต่ำกว่ากำไรขั้นต่ำโดยไม่มี Approval
* วิเคราะห์ลูกค้าจากยอดขาย กำไร ความถี่ และวินัยการชำระเงิน
* วัด Repeat Customer และ Customer Retention
* ส่งข้อเสนอผ่านช่องทางที่ลูกค้ายินยอมไว้
## 23. Index สำคัญ

## 23. Index สำคัญ
## 24. Constraint สำคัญ
* quantity > 0
* unit_price >= 0
* credit_days >= 0
* maximum_quantity >= minimum_quantity
* effective_to >= effective_from
* Debit และ Credit ใน Journal Line ต้องไม่ติดลบ
* Journal Entry ต้อง Debit เท่ากับ Credit ก่อน Post
* Shipment ต้องมีผู้ส่ง ผู้รับ และผู้ชำระเงิน
* Credit Shipment ต้องมี Payment Term
* Third-party payer ต้องมี payer_party_id
* Trip ที่ออกเดินทางต้องมีรถและคนขับหลัก
* น้ำหนักที่จัดเข้ารถต้องไม่เกินความจุ เว้นแต่มี Approval
* Payment Allocation รวมกันต้องไม่เกิน Payment
* Payment Allocation ต้องไม่เกินยอด Invoice คงเหลือ
* ห้าม Invoice Shipment เดิมซ้ำเกินยอดค่าบริการ
* ห้ามแก้ราคาเมื่อออก Invoice แล้ว
* ห้ามแก้ Shipment หลังปิดงาน นอกจากทำ Reopen ผ่าน Approval
* ห้าม Hard Delete Shipment, Invoice, Payment, Journal และ Trip
## 25. สิทธิ์ที่ต้องขออนุมัติ
* เปลี่ยนผู้ชำระเงิน
* เปลี่ยนเงินสดเป็นเครดิต
* เพิ่มเครดิตเทอม
* เพิ่มวงเงินเครดิต
* ใช้ราคาไม่ตรง Price Rule
* ลดราคาต่ำกว่ากำไรขั้นต่ำ
* ยกเลิก Shipment หลังรับสินค้า
* แก้จำนวนหลังโหลดขึ้นรถ
* เปลี่ยนรถหลังออกเดินทาง
* ย้อนรับชำระ
* ยกเลิก Invoice
* ลดหนี้
* ปรับ Stock
* อนุมัติซ่อมเกินวงเงิน
* เปิดใช้งานลูกค้าที่ถูกระงับเครดิต
## 26. สถาปัตยกรรมระบบแนะนำ
* Backend: Modular Monolith แยก Module ชัดเจน
* Database: PostgreSQL
* Frontend: Web Application สำหรับสำนักงาน
* Driver Application: Mobile App หรือ PWA
* File Storage: Object Storage สำหรับ POD เอกสาร และรูป
* GPS: Integration Service เชื่อมผู้ให้บริการ GPS
* Notification: LINE, SMS หรืออีเมล
* Reporting: Read Replica หรือ Reporting Database
* Integration: REST API/Webhook
* Reliability: Outbox Pattern สำหรับเหตุการณ์สำคัญ
* Security: MFA, Encryption, RBAC และ Audit Log
* Backup: Daily Backup พร้อม Point-in-Time Recovery
## 27. ลำดับพัฒนา

| Phase | ขอบเขต |
| --- | --- |
| Phase 1 | Customer, Product, UOM, Pricing, Shipment, เงินสด/เครดิต, Permission |
| Phase 2 | Trip, รถ, คนขับ, Shipment Legs, POD, GPS |
| Phase 3 | Invoice, Payment, AR Aging, Accounting และต้นทุนเที่ยว |
| Phase 4 | งานเหมา แชร์รถ รถขากลับ และการจัดสรรต้นทุน |
| Phase 5 | Maintenance, Procurement, Inventory และ Asset |
| Phase 6 | HR, Payroll, Customer 360 และระบบแนะนำยอดขาย |
## ข้อสรุป
แบบเดิมมีพื้นฐานดี แต่ฉบับนี้แก้จุดเสี่ยงสำคัญแล้ว โดยเฉพาะ:
* Snapshot ราคาและที่อยู่
* Shipment หลายช่วงและหลายเที่ยว
* ส่งบางส่วน
* เงินสดปลายทาง
* ลูกหนี้ที่คำนวณจากธุรกรรมจริง
* บัญชีคู่
* Claims
* การเปลี่ยนรถและรถพ่วง
* Approval และ Audit
* การวิเคราะห์กำไรต่อ Shipment, Trip, Vehicle, Route และ Customer
ขั้นต่อไปควรเปลี่ยนแบบนี้เป็น PostgreSQL DDL จริง พร้อม PK, FK, CHECK, UNIQUE, Trigger และ Seed Data โดยเริ่มจาก Customer → Product → Pricing → Shipment ก่อนครับ
