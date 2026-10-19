import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingPrices } from "./Pricing";
import type { OperationsState } from "./operationsStore";

describe("pending price table", () => {
  it("keeps the shared column headers visible when there are no requests", () => {
    const operations: OperationsState = {
      version: 1,
      relationProductScopeVersion: 1,
      relations: [],
      receiverProducts: [],
      relationProducts: [],
      agreements: [],
      priceVersions: [],
      priceRequests: [],
      employees: [],
      vehicles: [],
      driverAssignments: [],
      documents: [],
    };
    const html = renderToStaticMarkup(
      <PendingPrices
        rows={[]}
        recommendations={new Map()}
        operations={operations}
        registry={{
          raw: {},
          parties: [],
          catalog: [],
          defaults: {},
          partyRoles: {},
        }}
        onResolve={() => {}}
      />,
    );

    expect(html).toContain("<table");
    expect(html).toContain("<th>ลำดับ</th>");
    expect(html).toContain("<th>ผู้ส่ง</th>");
    expect(html).toContain("<th>ผู้รับ</th>");
    expect(html).toContain("<th>สินค้า</th>");
    expect(html).toContain("<th>หน่วย</th>");
    expect(html).toContain('colSpan="14"');
    expect(html).toContain("ไม่มีรายการรอตรวจราคา");
  });
});
