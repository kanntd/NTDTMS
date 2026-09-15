import { downloadBlob } from "./domain";
import type { IntakeRegistrySnapshot } from "./intakeRegistry";
import {
  DOCUMENT_LABELS,
  OWNERSHIP_LABELS,
  type OperationsState,
} from "./operationsStore";
import { PAYMENT_LABELS, type Zone } from "./types";

export type ExportAuditLevel = "error" | "warning" | "info";

export interface ExportAuditIssue {
  level: ExportAuditLevel;
  category: string;
  message: string;
  recordId?: string;
}

export interface MasterDataExportBundle {
  schema: "ntdtms-master-data";
  schemaVersion: 1;
  generatedAt: string;
  generatedBy: string;
  source: "DEMO" | "PRODUCTION";
  summary: {
    parties: number;
    relations: number;
    products: number;
    currentPrices: number;
    priceVersions: number;
    pendingPriceRequests: number;
    employees: number;
    vehicles: number;
    documentReferences: number;
  };
  audit: ExportAuditIssue[];
  data: {
    parties: IntakeRegistrySnapshot["parties"];
    partyRoles: IntakeRegistrySnapshot["partyRoles"];
    partyBranchDefaults: IntakeRegistrySnapshot["defaults"];
    catalog: IntakeRegistrySnapshot["catalog"];
    catalogActive: Record<string, boolean>;
    zones: Zone[];
    relations: OperationsState["relations"];
    receiverProducts: OperationsState["receiverProducts"];
    relationProducts: OperationsState["relationProducts"];
    priceAgreements: OperationsState["agreements"];
    priceVersions: OperationsState["priceVersions"];
    priceRequests: OperationsState["priceRequests"];
    employees: OperationsState["employees"];
    vehicles: OperationsState["vehicles"];
    driverAssignments: OperationsState["driverAssignments"];
    documents: Omit<OperationsState["documents"][number], "previewUrl">[];
  };
}

type ExportInput = {
  registry: IntakeRegistrySnapshot;
  operations: OperationsState;
  zones: Zone[];
  generatedBy: string;
  source: MasterDataExportBundle["source"];
  generatedAt?: string;
};

const normalize = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase("th")
    .replace(/[\s.,()\-/]/g, "");

function duplicateValues<T>(
  rows: T[],
  value: (row: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = normalize(value(row));
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return new Map([...groups].filter(([, matches]) => matches.length > 1));
}

export function auditMasterData(
  registry: IntakeRegistrySnapshot,
  operations: OperationsState,
): ExportAuditIssue[] {
  const issues: ExportAuditIssue[] = [];
  const partyIds = new Set(registry.parties.map((row) => row.id));
  const catalogIds = new Set(registry.catalog.map((row) => row.id));
  const agreementIds = new Set(operations.agreements.map((row) => row.id));
  const versionIds = new Set(operations.priceVersions.map((row) => row.id));

  for (const party of registry.parties) {
    if (!party.display_name.trim())
      issues.push({
        level: "error",
        category: "คู่ค้า",
        message: "ไม่มีชื่อคู่ค้า",
        recordId: party.id,
      });
    if (!party.province?.trim())
      issues.push({
        level: "warning",
        category: "คู่ค้า",
        message: `${party.display_name || party.id} ยังไม่ได้ระบุจังหวัด`,
        recordId: party.id,
      });
    if (
      registry.partyRoles[party.id]?.receiver &&
      !registry.defaults[party.id] &&
      !party.branch_code
    )
      issues.push({
        level: "error",
        category: "คู่ค้า",
        message: `${party.display_name || party.id} ยังไม่ได้ระบุสาขาปลายทาง`,
        recordId: party.id,
      });
  }

  for (const matches of duplicateValues(
    registry.parties,
    (row) => row.display_name,
  ).values()) {
    issues.push({
      level: "warning",
      category: "ชื่อซ้ำ",
      message: `พบชื่อคู่ค้าซ้ำ ${matches[0].display_name} จำนวน ${matches.length} รายการ`,
      recordId: matches.map((row) => row.id).join(", "),
    });
  }
  for (const matches of duplicateValues(
    registry.parties.filter((row) => row.tax_id?.trim()),
    (row) => row.tax_id,
  ).values()) {
    issues.push({
      level: "error",
      category: "เลขผู้เสียภาษีซ้ำ",
      message: `เลขผู้เสียภาษี ${matches[0].tax_id} ถูกใช้ ${matches.length} รายการ`,
      recordId: matches.map((row) => row.id).join(", "),
    });
  }

  for (const product of registry.catalog) {
    if (!product.name.trim() || !product.unit.trim())
      issues.push({
        level: "error",
        category: "สินค้า",
        message: `สินค้า ${product.id} ไม่มีชื่อหรือหน่วยนับ`,
        recordId: product.id,
      });
  }
  for (const matches of duplicateValues(
    registry.catalog,
    (row) => `${row.name}|${row.unit}`,
  ).values()) {
    issues.push({
      level: "warning",
      category: "สินค้าซ้ำ",
      message: `พบสินค้า ${matches[0].name} · ${matches[0].unit} ซ้ำ ${matches.length} รายการ`,
      recordId: matches.map((row) => row.id).join(", "),
    });
  }

  for (const matches of duplicateValues(
    operations.relations,
    (row) => `${row.receiverId}|${row.senderId}`,
  ).values()) {
    issues.push({
      level: "warning",
      category: "ความสัมพันธ์ซ้ำ",
      message: `พบความสัมพันธ์ผู้รับ–ผู้ส่งซ้ำ ${matches.length} รายการ`,
      recordId: matches.map((row) => row.id).join(", "),
    });
  }
  for (const relation of operations.relations) {
    if (!partyIds.has(relation.receiverId) || !partyIds.has(relation.senderId))
      issues.push({
        level: "error",
        category: "ความสัมพันธ์",
        message: "ความสัมพันธ์อ้างถึงคู่ค้าที่ไม่มีในข้อมูลหลัก",
        recordId: relation.id,
      });
  }
  for (const link of operations.relationProducts) {
    if (
      !partyIds.has(link.receiverId) ||
      !partyIds.has(link.senderId) ||
      !catalogIds.has(link.catalogId)
    )
      issues.push({
        level: "error",
        category: "สินค้าของคู่ค้า",
        message:
          "รายการสินค้าอ้างถึงผู้รับ ผู้ส่ง หรือสินค้าที่ไม่มีในข้อมูลหลัก",
        recordId: link.id,
      });
  }
  for (const agreement of operations.agreements) {
    if (
      !partyIds.has(agreement.receiverId) ||
      !partyIds.has(agreement.senderId) ||
      !catalogIds.has(agreement.catalogId)
    )
      issues.push({
        level: "error",
        category: "ราคา",
        message: "ข้อตกลงราคาอ้างถึงคู่ค้าหรือสินค้าที่ไม่มีในข้อมูลหลัก",
        recordId: agreement.id,
      });
    if (
      agreement.currentVersionId &&
      !versionIds.has(agreement.currentVersionId)
    )
      issues.push({
        level: "error",
        category: "ราคา",
        message: "ราคาปัจจุบันอ้างถึงเวอร์ชันราคาที่ไม่พบ",
        recordId: agreement.id,
      });
  }
  for (const version of operations.priceVersions) {
    if (!agreementIds.has(version.agreementId))
      issues.push({
        level: "error",
        category: "ประวัติราคา",
        message: "ประวัติราคาอ้างถึงข้อตกลงราคาที่ไม่พบ",
        recordId: version.id,
      });
  }

  const pending = operations.priceRequests.filter(
    (row) => row.status !== "RESOLVED" && row.status !== "CANCELLED",
  );
  if (pending.length)
    issues.push({
      level: "info",
      category: "คำขอราคา",
      message: `มีคำขอราคาที่ยังไม่จบ ${pending.length} รายการ`,
    });
  return issues;
}

export function buildMasterDataExport({
  registry,
  operations,
  zones,
  generatedBy,
  source,
  generatedAt = new Date().toISOString(),
}: ExportInput): MasterDataExportBundle {
  const documents = operations.documents.map(
    ({ previewUrl: _previewUrl, ...document }) => document,
  );
  return {
    schema: "ntdtms-master-data",
    schemaVersion: 1,
    generatedAt,
    generatedBy,
    source,
    summary: {
      parties: registry.parties.length,
      relations: operations.relations.length,
      products: registry.catalog.length,
      currentPrices: operations.agreements.filter(
        (row) => row.active && row.currentVersionId,
      ).length,
      priceVersions: operations.priceVersions.length,
      pendingPriceRequests: operations.priceRequests.filter(
        (row) => row.status !== "RESOLVED" && row.status !== "CANCELLED",
      ).length,
      employees: operations.employees.length,
      vehicles: operations.vehicles.length,
      documentReferences: documents.length,
    },
    audit: auditMasterData(registry, operations),
    data: {
      parties: structuredClone(registry.parties),
      partyRoles: structuredClone(registry.partyRoles),
      partyBranchDefaults: structuredClone(registry.defaults),
      catalog: structuredClone(registry.catalog),
      catalogActive: structuredClone(
        (registry.raw.catalogActive as Record<string, boolean> | undefined) ||
          {},
      ),
      zones: structuredClone(zones),
      relations: structuredClone(operations.relations),
      receiverProducts: structuredClone(operations.receiverProducts),
      relationProducts: structuredClone(operations.relationProducts),
      priceAgreements: structuredClone(operations.agreements),
      priceVersions: structuredClone(operations.priceVersions),
      priceRequests: structuredClone(operations.priceRequests),
      employees: structuredClone(operations.employees),
      vehicles: structuredClone(operations.vehicles),
      driverAssignments: structuredClone(operations.driverAssignments),
      documents: structuredClone(documents),
    },
  };
}

type TableColumn = {
  header: string;
  key: string;
  width?: number;
  numberFormat?: string;
};

type TableRow = Record<string, string | number | boolean | null | undefined>;

const TRUE_FALSE = (value: boolean) => (value ? "ใช้งาน" : "หยุดใช้");

function workbookFilename(bundle: MasterDataExportBundle, extension: string) {
  const stamp = bundle.generatedAt
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  return `NTDTMS-master-data-${stamp}.${extension}`;
}

export async function createMasterDataWorkbook(bundle: MasterDataExportBundle) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NTD TMS";
  workbook.created = new Date(bundle.generatedAt);
  workbook.modified = new Date(bundle.generatedAt);
  workbook.subject = "ข้อมูลหลัก NTD TMS";

  const partyById = new Map(
    bundle.data.parties.map((row) => [row.id, row.display_name]),
  );
  const productById = new Map(bundle.data.catalog.map((row) => [row.id, row]));
  const agreementById = new Map(
    bundle.data.priceAgreements.map((row) => [row.id, row]),
  );
  const versionById = new Map(
    bundle.data.priceVersions.map((row) => [row.id, row]),
  );
  const employeeById = new Map(
    bundle.data.employees.map((row) => [row.id, row.name]),
  );
  const vehicleById = new Map(
    bundle.data.vehicles.map((row) => [row.id, row.plateNo]),
  );
  const zoneByCode = new Map(
    bundle.data.zones.map((row) => [row.code, row.name]),
  );
  zoneByCode.set("BKK", "กรุงเทพฯ");
  const branchName = (code: string) => zoneByCode.get(code) || code;
  const partyName = (id: string) => partyById.get(id) || "ไม่พบชื่อ";
  const productName = (id: string) =>
    productById.get(id)?.name || "ไม่พบสินค้า";
  const productUnit = (id: string) => productById.get(id)?.unit || "";

  const addTableSheet = (
    name: string,
    columns: TableColumn[],
    rows: TableRow[],
  ) => {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
      properties: { defaultRowHeight: 21 },
    });
    sheet.columns = columns.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width || Math.max(12, column.header.length + 4),
    }));
    sheet.addRows(rows);
    const header = sheet.getRow(1);
    header.height = 26;
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF008F72" },
    };
    header.alignment = { vertical: "middle", horizontal: "left" };
    header.eachCell((cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: "FF00735C" } },
      };
    });
    for (const column of columns) {
      if (column.numberFormat)
        sheet.getColumn(column.key).numFmt = column.numberFormat;
    }
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.alignment = { vertical: "top", wrapText: true };
      if (rowNumber % 2 === 0)
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF3FAF7" },
        };
    });
    return sheet;
  };

  const check = workbook.addWorksheet("ตรวจสอบ", {
    views: [{ state: "frozen", ySplit: 8 }],
  });
  check.columns = [{ width: 18 }, { width: 24 }, { width: 72 }, { width: 42 }];
  check.mergeCells("A1:D1");
  check.getCell("A1").value = "ตรวจสอบข้อมูลหลัก NTD TMS";
  check.getCell("A1").font = {
    size: 16,
    bold: true,
    color: { argb: "FFFFFFFF" },
  };
  check.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF008F72" },
  };
  check.getCell("A1").alignment = { vertical: "middle" };
  check.getRow(1).height = 32;
  check.addRow(["วันที่ส่งออก", bundle.generatedAt]);
  check.addRow(["ผู้ส่งออก", bundle.generatedBy]);
  check.addRow([
    "แหล่งข้อมูล",
    bundle.source === "DEMO" ? "พื้นที่ทดลอง" : "ระบบจริง",
  ]);
  check.addRow([
    "คู่ค้า",
    bundle.summary.parties,
    "สินค้า",
    bundle.summary.products,
  ]);
  check.addRow([
    "ความสัมพันธ์",
    bundle.summary.relations,
    "ราคาปัจจุบัน",
    bundle.summary.currentPrices,
  ]);
  check.addRow([
    "คำขอราคาค้าง",
    bundle.summary.pendingPriceRequests,
    "ข้อควรตรวจ",
    bundle.audit.length,
  ]);
  check.addRow(["ระดับ", "หมวด", "รายการที่ควรตรวจ", "รหัสข้อมูล"]);
  const auditHeader = check.getRow(8);
  auditHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  auditHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF00A984" },
  };
  if (bundle.audit.length === 0)
    check.addRow(["ผ่าน", "ทั้งหมด", "ไม่พบข้อมูลผิดปกติ", ""]);
  else
    for (const issue of bundle.audit)
      check.addRow([
        issue.level === "error"
          ? "ต้องแก้"
          : issue.level === "warning"
            ? "ควรตรวจ"
            : "ข้อมูล",
        issue.category,
        issue.message,
        issue.recordId || "",
      ]);
  check.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber > 8) {
      const level = String(row.getCell(1).value || "");
      row.getCell(1).font = {
        bold: true,
        color: {
          argb:
            level === "ต้องแก้"
              ? "FFB42318"
              : level === "ควรตรวจ"
                ? "FF9A6700"
                : "FF2869A6",
        },
      };
    }
  });

  addTableSheet(
    "คู่ค้า",
    [
      { header: "รหัสคู่ค้า", key: "id", width: 38 },
      { header: "บทบาท", key: "role", width: 17 },
      { header: "คำนำหน้า", key: "prefix", width: 13 },
      { header: "ชื่อ", key: "name", width: 30 },
      { header: "ชื่อที่แสดง", key: "displayName", width: 35 },
      { header: "เลขผู้เสียภาษี", key: "taxId", width: 20 },
      { header: "เบอร์โทร", key: "phone", width: 18 },
      { header: "ที่อยู่", key: "address", width: 42 },
      { header: "อำเภอ", key: "district", width: 20 },
      { header: "จังหวัด", key: "province", width: 20 },
      { header: "รหัสสาขาเริ่มต้น", key: "branch", width: 20 },
      { header: "สาขาเริ่มต้น", key: "branchName", width: 20 },
      {
        header: "วงเงินเครดิต",
        key: "creditLimit",
        width: 17,
        numberFormat: "#,##0.00",
      },
      {
        header: "เครดิต (วัน)",
        key: "creditDays",
        width: 15,
        numberFormat: "#,##0",
      },
      { header: "หมายเหตุ", key: "note", width: 36 },
      { header: "สถานะ", key: "status", width: 13 },
    ],
    bundle.data.parties.map((row) => {
      const roles = bundle.data.partyRoles[row.id];
      const branch =
        bundle.data.partyBranchDefaults[row.id] || row.branch_code || "";
      return {
        id: row.id,
        role:
          roles?.receiver && roles?.sender
            ? "ผู้รับและผู้ส่ง"
            : roles?.sender
              ? "ผู้ส่ง"
              : "ผู้รับ",
        prefix: row.prefix || "",
        name: row.name || "",
        displayName: row.display_name,
        taxId: row.tax_id,
        phone: row.phone,
        address: row.address_detail || row.address,
        district: row.district || "",
        province: row.province || "",
        branch,
        branchName: branchName(branch),
        creditLimit: row.credit_limit,
        creditDays: row.credit_days,
        note: row.note || "",
        status: TRUE_FALSE(row.is_active),
      };
    }),
  );

  addTableSheet(
    "ความสัมพันธ์",
    [
      { header: "รหัสความสัมพันธ์", key: "id", width: 38 },
      { header: "รหัสผู้รับ", key: "receiverId", width: 38 },
      { header: "ผู้รับ", key: "receiver", width: 34 },
      { header: "รหัสผู้ส่ง", key: "senderId", width: 38 },
      { header: "ผู้ส่ง", key: "sender", width: 34 },
      { header: "รหัสการชำระเงิน", key: "paymentCode", width: 22 },
      { header: "การชำระเงินเริ่มต้น", key: "payment", width: 23 },
      { header: "รอบเครดิต", key: "billingCycle", width: 16 },
      {
        header: "เครดิต (วัน)",
        key: "creditDays",
        width: 15,
        numberFormat: "#,##0",
      },
      { header: "สถานะ", key: "status", width: 13 },
      { header: "สร้างเมื่อ", key: "createdAt", width: 24 },
      { header: "แก้ไขเมื่อ", key: "updatedAt", width: 24 },
    ],
    bundle.data.relations.map((row) => ({
      id: row.id,
      receiverId: row.receiverId,
      receiver: partyName(row.receiverId),
      senderId: row.senderId,
      sender: partyName(row.senderId),
      paymentCode: row.defaultPayment,
      payment: PAYMENT_LABELS[row.defaultPayment],
      billingCycle: row.billingCycle === "MONTH_END" ? "สิ้นเดือน" : "กำหนดวัน",
      creditDays: row.creditDays,
      status: TRUE_FALSE(row.active),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  );

  addTableSheet(
    "สินค้า",
    [
      { header: "รหัสรายการ", key: "id", width: 38 },
      { header: "รหัสสินค้า", key: "productId", width: 24 },
      { header: "ชื่อสินค้า", key: "name", width: 32 },
      { header: "หน่วยนับ", key: "unit", width: 16 },
      {
        header: "น้ำหนัก (กก.)",
        key: "weight",
        width: 17,
        numberFormat: "#,##0.00",
      },
      {
        header: "กว้าง (ซม.)",
        key: "width",
        width: 16,
        numberFormat: "#,##0.00",
      },
      {
        header: "ยาว (ซม.)",
        key: "length",
        width: 16,
        numberFormat: "#,##0.00",
      },
      {
        header: "สูง (ซม.)",
        key: "height",
        width: 16,
        numberFormat: "#,##0.00",
      },
      { header: "สถานะ", key: "status", width: 13 },
    ],
    bundle.data.catalog.map((row) => ({
      id: row.id,
      productId: row.productId,
      name: row.name,
      unit: row.unit,
      weight: row.weight ? Number(row.weight) : null,
      width: row.width ? Number(row.width) : null,
      length: row.length ? Number(row.length) : null,
      height: row.height ? Number(row.height) : null,
      status: TRUE_FALSE(bundle.data.catalogActive[row.id] !== false),
    })),
  );

  addTableSheet(
    "สินค้าของผู้รับ",
    [
      { header: "รหัส", key: "id", width: 38 },
      { header: "รหัสผู้รับ", key: "receiverId", width: 38 },
      { header: "ผู้รับ", key: "receiver", width: 34 },
      { header: "รหัสรายการสินค้า", key: "catalogId", width: 38 },
      { header: "สินค้า", key: "product", width: 30 },
      { header: "หน่วยนับ", key: "unit", width: 16 },
      { header: "สถานะ", key: "status", width: 13 },
      { header: "สร้างเมื่อ", key: "createdAt", width: 24 },
    ],
    bundle.data.receiverProducts.map((row) => ({
      id: row.id,
      receiverId: row.receiverId,
      receiver: partyName(row.receiverId),
      catalogId: row.catalogId,
      product: productName(row.catalogId),
      unit: productUnit(row.catalogId),
      status: TRUE_FALSE(row.active),
      createdAt: row.createdAt,
    })),
  );

  addTableSheet(
    "สินค้าของคู่ค้า",
    [
      { header: "รหัส", key: "id", width: 38 },
      { header: "รหัสผู้รับ", key: "receiverId", width: 38 },
      { header: "ผู้รับ", key: "receiver", width: 34 },
      { header: "รหัสผู้ส่ง", key: "senderId", width: 38 },
      { header: "ผู้ส่ง", key: "sender", width: 34 },
      { header: "รหัสรายการสินค้า", key: "catalogId", width: 38 },
      { header: "สินค้า", key: "product", width: 30 },
      { header: "หน่วยนับ", key: "unit", width: 16 },
      { header: "สถานะ", key: "status", width: 13 },
      { header: "สร้างเมื่อ", key: "createdAt", width: 24 },
    ],
    bundle.data.relationProducts.map((row) => ({
      id: row.id,
      receiverId: row.receiverId,
      receiver: partyName(row.receiverId),
      senderId: row.senderId,
      sender: partyName(row.senderId),
      catalogId: row.catalogId,
      product: productName(row.catalogId),
      unit: productUnit(row.catalogId),
      status: TRUE_FALSE(row.active),
      createdAt: row.createdAt,
    })),
  );

  addTableSheet(
    "ราคาปัจจุบัน",
    [
      { header: "รหัสข้อตกลง", key: "agreementId", width: 38 },
      { header: "ผู้รับ", key: "receiver", width: 34 },
      { header: "ผู้ส่ง", key: "sender", width: 34 },
      { header: "สินค้า", key: "product", width: 30 },
      { header: "หน่วยนับ", key: "unit", width: 16 },
      { header: "รหัสสาขา", key: "branchCode", width: 15 },
      { header: "สาขา", key: "branch", width: 18 },
      { header: "รหัสการชำระเงิน", key: "paymentCode", width: 22 },
      { header: "การชำระเงิน", key: "payment", width: 22 },
      {
        header: "ราคา/หน่วย",
        key: "price",
        width: 17,
        numberFormat: "#,##0.00",
      },
      { header: "เวอร์ชัน", key: "version", width: 12, numberFormat: "#,##0" },
      { header: "เริ่มใช้", key: "effectiveFrom", width: 16 },
      { header: "เหตุผล", key: "reason", width: 36 },
      { header: "ผู้อนุมัติ", key: "approvedBy", width: 22 },
      { header: "สถานะ", key: "status", width: 13 },
    ],
    bundle.data.priceAgreements.map((row) => {
      const version = row.currentVersionId
        ? versionById.get(row.currentVersionId)
        : undefined;
      return {
        agreementId: row.id,
        receiver: partyName(row.receiverId),
        sender: partyName(row.senderId),
        product: productName(row.catalogId),
        unit: productUnit(row.catalogId),
        branchCode: row.branch,
        branch: branchName(row.branch),
        paymentCode: row.payment,
        payment: PAYMENT_LABELS[row.payment],
        price: version?.price ?? null,
        version: version?.version ?? null,
        effectiveFrom: version?.effectiveFrom || "",
        reason: version?.reason || "",
        approvedBy: version?.approvedBy || "",
        status: TRUE_FALSE(row.active),
      };
    }),
  );

  addTableSheet(
    "ประวัติราคา",
    [
      { header: "รหัสเวอร์ชัน", key: "id", width: 38 },
      { header: "รหัสข้อตกลง", key: "agreementId", width: 38 },
      { header: "ผู้รับ", key: "receiver", width: 34 },
      { header: "ผู้ส่ง", key: "sender", width: 34 },
      { header: "สินค้า", key: "product", width: 30 },
      { header: "หน่วยนับ", key: "unit", width: 16 },
      { header: "สาขา", key: "branch", width: 18 },
      { header: "การชำระเงิน", key: "payment", width: 22 },
      { header: "เวอร์ชัน", key: "version", width: 12, numberFormat: "#,##0" },
      {
        header: "ราคา/หน่วย",
        key: "price",
        width: 17,
        numberFormat: "#,##0.00",
      },
      { header: "เริ่มใช้", key: "effectiveFrom", width: 16 },
      { header: "ที่มา", key: "source", width: 17 },
      { header: "เหตุผล", key: "reason", width: 36 },
      { header: "ผู้อนุมัติ", key: "approvedBy", width: 22 },
      { header: "สร้างเมื่อ", key: "createdAt", width: 24 },
    ],
    bundle.data.priceVersions.map((row) => {
      const agreement = agreementById.get(row.agreementId);
      return {
        id: row.id,
        agreementId: row.agreementId,
        receiver: agreement ? partyName(agreement.receiverId) : "ไม่พบชื่อ",
        sender: agreement ? partyName(agreement.senderId) : "ไม่พบชื่อ",
        product: agreement ? productName(agreement.catalogId) : "ไม่พบสินค้า",
        unit: agreement ? productUnit(agreement.catalogId) : "",
        branch: agreement ? branchName(agreement.branch) : "",
        payment: agreement ? PAYMENT_LABELS[agreement.payment] : "",
        version: row.version,
        price: row.price,
        effectiveFrom: row.effectiveFrom,
        source: row.source,
        reason: row.reason,
        approvedBy: row.approvedBy,
        createdAt: row.createdAt,
      };
    }),
  );

  addTableSheet(
    "คำขอราคา",
    [
      { header: "รหัสคำขอ", key: "id", width: 38 },
      { header: "เลขบิล", key: "billNumber", width: 20 },
      { header: "ผู้รับ", key: "receiver", width: 34 },
      { header: "ผู้ส่ง", key: "sender", width: 34 },
      { header: "สินค้า", key: "product", width: 30 },
      { header: "หน่วยนับ", key: "unit", width: 16 },
      { header: "สาขา", key: "branch", width: 18 },
      { header: "การชำระเงิน", key: "payment", width: 22 },
      { header: "จำนวน", key: "quantity", width: 12, numberFormat: "#,##0.00" },
      {
        header: "ราคาเสนอ/หน่วย",
        key: "proposedPrice",
        width: 20,
        numberFormat: "#,##0.00",
      },
      {
        header: "ราคาที่อนุมัติ/หน่วย",
        key: "approvedPrice",
        width: 20,
        numberFormat: "#,##0.00",
      },
      {
        header: "ยอดเก็บจริง",
        key: "actualCollectedAmount",
        width: 18,
        numberFormat: "#,##0.00",
      },
      { header: "สถานะ", key: "status", width: 20 },
      { header: "ผลการอนุมัติ", key: "resolutionType", width: 18 },
      { header: "วันที่ขอ", key: "requestedAt", width: 24 },
      { header: "วันที่จบ", key: "resolvedAt", width: 24 },
      { header: "หมายเหตุผู้เสนอ", key: "note", width: 36 },
      { header: "หมายเหตุผู้อนุมัติ", key: "approvalNote", width: 36 },
    ],
    bundle.data.priceRequests.map((row) => ({
      id: row.id,
      billNumber: row.billNumber,
      receiver: partyName(row.receiverId),
      sender: partyName(row.senderId),
      product: productName(row.catalogId),
      unit: productUnit(row.catalogId),
      branch: branchName(row.branch),
      payment: PAYMENT_LABELS[row.payment],
      quantity: row.quantity,
      proposedPrice: row.proposedPrice,
      approvedPrice: row.approvedPrice,
      actualCollectedAmount: row.actualCollectedAmount,
      status: row.status,
      resolutionType: row.resolutionType || "",
      requestedAt: row.requestedAt,
      resolvedAt: row.resolvedAt || "",
      note: row.note,
      approvalNote: row.approvalNote || "",
    })),
  );

  addTableSheet(
    "พนักงาน",
    [
      { header: "รหัสข้อมูล", key: "id", width: 38 },
      { header: "รหัสพนักงาน", key: "code", width: 18 },
      { header: "ชื่อ", key: "name", width: 32 },
      { header: "ชื่อเล่น", key: "nickname", width: 18 },
      { header: "ตำแหน่ง", key: "position", width: 24 },
      { header: "เบอร์โทร", key: "phone", width: 18 },
      { header: "รหัสสาขา", key: "branchCode", width: 15 },
      { header: "สาขา", key: "branch", width: 18 },
      { header: "เลขใบขับขี่", key: "licenseNo", width: 22 },
      { header: "หมดอายุใบขับขี่", key: "licenseExpiry", width: 20 },
      { header: "สถานะ", key: "status", width: 13 },
    ],
    bundle.data.employees.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      nickname: row.nickname,
      position: row.position,
      phone: row.phone,
      branchCode: row.branch,
      branch: branchName(row.branch),
      licenseNo: row.licenseNo,
      licenseExpiry: row.licenseExpiry,
      status: TRUE_FALSE(row.active),
    })),
  );

  addTableSheet(
    "ทะเบียนรถ",
    [
      { header: "รหัสข้อมูล", key: "id", width: 38 },
      { header: "รหัสรถ", key: "internalNo", width: 18 },
      { header: "ทะเบียนรถ", key: "plateNo", width: 28 },
      { header: "ประเภทรถ", key: "vehicleType", width: 24 },
      { header: "รหัสสาขา", key: "branchCode", width: 15 },
      { header: "สาขา", key: "branch", width: 18 },
      { header: "กรรมสิทธิ์", key: "ownership", width: 17 },
      { header: "หมายเหตุ", key: "note", width: 36 },
      { header: "สถานะ", key: "status", width: 13 },
    ],
    bundle.data.vehicles.map((row) => ({
      id: row.id,
      internalNo: row.internalNo,
      plateNo: row.plateNo,
      vehicleType: row.vehicleType,
      branchCode: row.branch,
      branch: branchName(row.branch),
      ownership: OWNERSHIP_LABELS[row.ownership],
      note: row.note,
      status: TRUE_FALSE(row.active),
    })),
  );

  addTableSheet(
    "ประวัติคนขับรถ",
    [
      { header: "รหัส", key: "id", width: 38 },
      { header: "รหัสรถ", key: "vehicleId", width: 38 },
      { header: "ทะเบียนรถ", key: "vehicle", width: 28 },
      { header: "รหัสพนักงาน", key: "employeeId", width: 38 },
      { header: "พนักงานขับรถ", key: "employee", width: 32 },
      { header: "เริ่มวันที่", key: "startsAt", width: 18 },
      { header: "สิ้นสุดวันที่", key: "endsAt", width: 18 },
      { header: "สถานะ", key: "status", width: 15 },
    ],
    bundle.data.driverAssignments.map((row) => ({
      id: row.id,
      vehicleId: row.vehicleId,
      vehicle: vehicleById.get(row.vehicleId) || "ไม่พบรถ",
      employeeId: row.employeeId,
      employee: employeeById.get(row.employeeId) || "ไม่พบพนักงาน",
      startsAt: row.startsAt,
      endsAt: row.endsAt || "",
      status: row.endsAt ? "สิ้นสุดแล้ว" : "ปัจจุบัน",
    })),
  );

  addTableSheet(
    "พื้นที่บริการ",
    [
      { header: "รหัสพื้นที่", key: "zoneId", width: 38 },
      { header: "รหัส", key: "code", width: 16 },
      { header: "จังหวัด", key: "zone", width: 24 },
      { header: "สี", key: "color", width: 14 },
      { header: "ลำดับ", key: "sortOrder", width: 12, numberFormat: "#,##0" },
      { header: "รหัสอำเภอ", key: "districtId", width: 38 },
      { header: "อำเภอ", key: "district", width: 24 },
      { header: "สถานะพื้นที่", key: "zoneStatus", width: 16 },
      { header: "สถานะอำเภอ", key: "districtStatus", width: 16 },
    ],
    bundle.data.zones.flatMap((zone) =>
      zone.districts.length
        ? zone.districts.map((district) => ({
            zoneId: zone.id,
            code: zone.code,
            zone: zone.name,
            color: zone.color,
            sortOrder: zone.sort_order,
            districtId: district.id,
            district: district.name,
            zoneStatus: TRUE_FALSE(zone.is_active !== false),
            districtStatus: TRUE_FALSE(district.is_active !== false),
          }))
        : [
            {
              zoneId: zone.id,
              code: zone.code,
              zone: zone.name,
              color: zone.color,
              sortOrder: zone.sort_order,
              districtId: "",
              district: "",
              zoneStatus: TRUE_FALSE(zone.is_active !== false),
              districtStatus: "ไม่ระบุอำเภอ",
            },
          ],
    ),
  );

  addTableSheet(
    "เอกสารอ้างอิง",
    [
      { header: "รหัสเอกสาร", key: "id", width: 38 },
      { header: "เจ้าของเอกสาร", key: "ownerType", width: 18 },
      { header: "รหัสเจ้าของ", key: "ownerId", width: 38 },
      { header: "ชื่อเจ้าของ", key: "owner", width: 32 },
      { header: "ประเภทเอกสาร", key: "kind", width: 24 },
      { header: "ชื่อไฟล์", key: "filename", width: 38 },
      { header: "ชนิดไฟล์", key: "mimeType", width: 24 },
      {
        header: "ขนาด (ไบต์)",
        key: "byteSize",
        width: 18,
        numberFormat: "#,##0",
      },
      { header: "รหัสไฟล์ใน R2", key: "objectKey", width: 48 },
      { header: "วันหมดอายุ", key: "expiresOn", width: 18 },
      { header: "อัปโหลดเมื่อ", key: "uploadedAt", width: 24 },
    ],
    bundle.data.documents.map((row) => ({
      id: row.id,
      ownerType: row.ownerType === "EMPLOYEE" ? "พนักงาน" : "รถ",
      ownerId: row.ownerId,
      owner:
        row.ownerType === "EMPLOYEE"
          ? employeeById.get(row.ownerId) || "ไม่พบพนักงาน"
          : vehicleById.get(row.ownerId) || "ไม่พบรถ",
      kind: DOCUMENT_LABELS[row.kind],
      filename: row.filename,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      objectKey: row.objectKey,
      expiresOn: row.expiresOn,
      uploadedAt: row.uploadedAt,
    })),
  );

  return workbook;
}

export async function downloadMasterDataExcel(bundle: MasterDataExportBundle) {
  const workbook = await createMasterDataWorkbook(bundle);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    workbookFilename(bundle, "xlsx"),
    new Blob([buffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}

export function downloadMasterDataJson(bundle: MasterDataExportBundle) {
  downloadBlob(
    workbookFilename(bundle, "json"),
    new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
}
