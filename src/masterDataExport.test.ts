import { describe, expect, it } from "vitest";
import type { IntakeRegistrySnapshot } from "./intakeRegistry";
import {
  auditMasterData,
  buildMasterDataExport,
  createMasterDataWorkbook,
} from "./masterDataExport";
import type { OperationsState } from "./operationsStore";

function sampleData() {
  const registry: IntakeRegistrySnapshot = {
    raw: { catalogActive: { "shoe:box": true } },
    parties: [
      {
        id: "receiver",
        display_name: "ร้านรองเท้า",
        phone: "0810000000",
        address: "เมืองสุโขทัย",
        tax_id: "",
        credit_limit: 0,
        credit_days: 30,
        is_active: true,
        province: "สุโขทัย",
      },
      {
        id: "sender",
        display_name: "โรงงานรองเท้า",
        phone: "0820000000",
        address: "กรุงเทพฯ",
        tax_id: "",
        credit_limit: 0,
        credit_days: 30,
        is_active: true,
        province: "กรุงเทพมหานคร",
      },
    ],
    catalog: [
      {
        id: "shoe:box",
        productId: "shoe",
        name: "รองเท้า",
        unit: "กล่อง",
      },
    ],
    defaults: { receiver: "STI" },
    partyRoles: {
      receiver: { receiver: true, sender: false },
      sender: { receiver: false, sender: true },
    },
  };
  const operations: OperationsState = {
    version: 1,
    relationProductScopeVersion: 1,
    relations: [
      {
        id: "relation",
        receiverId: "receiver",
        senderId: "sender",
        defaultPayment: "CREDIT_DESTINATION",
        billingCycle: "MONTH_END",
        creditDays: 30,
        active: true,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    receiverProducts: [
      {
        id: "receiver-product",
        receiverId: "receiver",
        catalogId: "shoe:box",
        active: true,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    relationProducts: [
      {
        id: "relation-product",
        receiverId: "receiver",
        senderId: "sender",
        catalogId: "shoe:box",
        active: true,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    agreements: [
      {
        id: "agreement",
        key: "price-key",
        receiverId: "receiver",
        senderId: "sender",
        catalogId: "shoe:box",
        payment: "CREDIT_DESTINATION",
        branch: "STI",
        currentVersionId: "version-1",
        active: true,
      },
    ],
    priceVersions: [
      {
        id: "version-1",
        agreementId: "agreement",
        version: 1,
        price: 85,
        effectiveFrom: "2026-09-01",
        reason: "ราคาเริ่มต้น",
        source: "INITIAL",
        createdAt: "2026-09-01T00:00:00.000Z",
        approvedBy: "ผู้ดูแล NTD",
      },
    ],
    priceRequests: [],
    employees: [],
    vehicles: [],
    driverAssignments: [],
    documents: [
      {
        id: "document",
        ownerType: "EMPLOYEE",
        ownerId: "employee",
        kind: "ID_CARD",
        filename: "id-card.pdf",
        mimeType: "application/pdf",
        byteSize: 100,
        objectKey: "private/id-card.pdf",
        expiresOn: "",
        uploadedAt: "2026-09-01T00:00:00.000Z",
        previewUrl: "blob:private-preview",
      },
    ],
  };
  return { registry, operations };
}

describe("master data export", () => {
  it("keeps stable IDs and removes temporary document previews", () => {
    const { registry, operations } = sampleData();
    const bundle = buildMasterDataExport({
      registry,
      operations,
      zones: [],
      generatedBy: "ผู้ดูแล NTD",
      source: "DEMO",
      generatedAt: "2026-09-12T10:30:00.000Z",
    });

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.data.relations[0].receiverId).toBe("receiver");
    expect(bundle.summary.currentPrices).toBe(1);
    expect(bundle.data.documents[0]).not.toHaveProperty("previewUrl");
  });

  it("reports duplicate and broken references before download", () => {
    const { registry, operations } = sampleData();
    registry.parties.push({ ...registry.parties[0], id: "duplicate" });
    operations.agreements[0].currentVersionId = "missing-version";

    const issues = auditMasterData(registry, operations);

    expect(issues.some((row) => row.category === "ชื่อซ้ำ")).toBe(true);
    expect(
      issues.some((row) => row.message.includes("เวอร์ชันราคาที่ไม่พบ")),
    ).toBe(true);
  });

  it("creates a multi-sheet workbook with numeric prices", async () => {
    const { registry, operations } = sampleData();
    const bundle = buildMasterDataExport({
      registry,
      operations,
      zones: [],
      generatedBy: "ผู้ดูแล NTD",
      source: "DEMO",
      generatedAt: "2026-09-12T10:30:00.000Z",
    });

    const workbook = await createMasterDataWorkbook(bundle);
    const serialized = await workbook.xlsx.writeBuffer();
    const { default: ExcelJS } = await import("exceljs");
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(serialized);

    expect(reopened.worksheets.map((sheet) => sheet.name)).toContain(
      "ประวัติราคา",
    );
    expect(reopened.getWorksheet("ราคาปัจจุบัน")?.getCell("J2").value).toBe(85);
    expect(serialized.byteLength).toBeGreaterThan(1_000);
  });
});
