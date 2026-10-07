# NTD TMS Next Steps

ไฟล์นี้เป็นรายการส่งต่องานระหว่างเครื่องและแชต อัปเดตทุกครั้งที่จบงานสำคัญ โดยย้ายงานที่เสร็จแล้วออกหรือทำเครื่องหมายพร้อมวันที่

## สถานะล่าสุด

- Branch หลัก: `main`
- Production: `https://ntdtms.pages.dev/`
- Supabase migrations ล่าสุดครอบคลุม concurrent bill issuance, destination receiving, delivery batch selection และการป้องกันบิลซ้ำในเที่ยวรถที่ยังเปิด
- Automated suite ล่าสุดที่ Cloud Environment ตรวจพบ: 79 tests ใน 24 files พร้อม TypeScript และ production build ผ่าน
- Codex Cloud Environment `NTDTMS` ถูกสร้างและ publish แล้วสำหรับ demo development
- Live Supabase และ Cloudflare R2 secrets ยังไม่ได้เพิ่มใน Codex Cloud Environment

## งานเร่งด่วนก่อนพัฒนาฟีเจอร์ถัดไป

1. ตรวจ production หลัง migration ล่าสุดด้วยผู้ใช้จริงอย่างน้อย 2 browser sessions
2. เปิดบิลพร้อมกันสองเครื่องและยืนยันว่า:
   - เลขบิลไม่ซ้ำ
   - ฟอร์มเครื่องหนึ่งไม่เด้งหรือถูกล้างเมื่ออีกเครื่องบันทึก
   - บันทึกไม่เกิด timeout หรือ duplicate master error
3. ทดสอบงานขึ้นรถ:
   - บิลเดิมห้ามเพิ่มซ้ำในเที่ยวเดียว
   - บิลที่ขึ้นบางส่วนเพิ่มส่วนคงเหลือในเที่ยวอื่นได้
   - จำนวนบิลและจำนวนสินค้าของแต่ละเที่ยวถูกต้อง
4. ทดสอบงานส่งสินค้าแบบพิมพ์เลขบิลต่อเนื่องและแบบส่งบางส่วน
5. ตรวจ Dashboard จัดของขึ้นรถและ Dashboard สาขาปลายทางกับข้อมูลจริง โดยเฉพาะยอดบิลรวม จำนวนสินค้า และ error `Bad Request`

## งานด้านประสิทธิภาพ

- วัดเวลาของ RPC เปิดบิล สร้าง/แก้เที่ยวรถ ปิดรถ รับรถ และยืนยันส่งสินค้า
- ตรวจ query ที่โตตามจำนวนบิลว่ามี date limit, branch filter, pagination และ index ครบ
- ตรวจ Realtime subscriptions ให้จำกัดเฉพาะตาราง/สาขาที่หน้าปัจจุบันใช้
- ตัด full workspace refresh และ duplicate refresh หลัง save ที่ยังเหลือ
- เพิ่ม regression test สำหรับ stale response และ form preservation ระหว่าง Realtime events
- ตรวจ bundle-size warnings และแยกโหลดหน้าหนักเมื่อคุ้มค่ากับเวลาใช้งานจริง

## งานระบบและการปฏิบัติการ

- ตั้งค่า Supabase และ R2 secrets ใน Codex Cloud อย่างปลอดภัยเมื่อจำเป็นต้องทดสอบ live mode ห้ามเขียนค่าลงเอกสารหรือ Git
- เปิดและ bind Cloudflare R2 private bucket `IMAGES` ก่อนใช้ upload เอกสารจริง
- วางแผน backup รายวัน; Supabase Free ไม่มี automatic backup
- ปรับ `docs/operations.md` ซึ่งมีตัวเลขผลทดสอบเก่า ให้ตรงกับชุดทดสอบปัจจุบัน
- ตรวจ role/module permissions และ branch scoping ก่อนเพิ่มบัญชีพนักงานจริง

## โมดูลธุรกิจถัดไป

- ทำ workflow เงินสดปลายทางให้ครบ: ยอดต้องเก็บ, รับเงินจริง, ส่งเงิน, กระทบยอด และผู้บันทึก
- ทำรอบวางบิลเครดิตต้นทาง/ปลายทางรายเดือน
- ทำรายงานปฏิบัติการและบัญชีจากข้อมูลจริง
- พัฒนาใบคลุมรถ/การพิมพ์และตรวจรูปแบบกับกระดาษจริง
- วาง export/backup สำหรับ master data และธุรกรรม

## Checklist ก่อน Deploy ทุกครั้ง

```bash
pnpm test
pnpm build
```

- ทดสอบ workflow ที่แก้ด้วยข้อมูลใกล้เคียงของจริง
- ทดสอบ concurrent use อย่างน้อยสอง browser sessions เมื่อแตะ workflow ร่วม
- ตรวจว่า save ไม่เรียก full reload ซ้ำ
- ตรวจ migration กับ Supabase ก่อน deploy frontend ที่พึ่งพา schema ใหม่
- commit และ push เฉพาะไฟล์ที่เกี่ยวข้อง
- ตรวจ Cloudflare deployment และ smoke test production หลัง deploy

