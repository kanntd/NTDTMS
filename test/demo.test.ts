import { describe, expect, it } from "vitest";
import {
  createDemoShipment,
  demoParties,
  demoProducts,
  demoZones,
  type DemoState,
} from "../src/demo";

function state(): DemoState {
  return {
    shipments: [],
    parties: structuredClone(demoParties),
    zones: structuredClone(demoZones),
    rules: [],
  };
}

describe("demo data", () => {
  it("uses the corrected 3 main provinces and 3 Sukhothai districts", () => {
    expect(demoZones.map((z) => z.name)).toEqual([
      "พิษณุโลก",
      "สุโขทัย",
      "กำแพงเพชร",
    ]);
    expect(
      demoZones.find((z) => z.name === "สุโขทัย")?.districts.map((d) => d.name),
    ).toEqual(["เมืองสุโขทัย", "สวรรคโลก", "ศรีสำโรง"]);
  });

  it("creates a cash-origin shipment and marks collect-now as paid", () => {
    const demo = state();
    const shipment = createDemoShipment(demo, {
      request_id: crypto.randomUUID(),
      sender: demoParties[0],
      receiver: demoParties[3],
      zone_id: demoZones[1].id,
      district_id: demoZones[1].districts[0].id,
      payment_mode: "CASH_ORIGIN",
      credit_days: 0,
      items: [
        {
          id: crypto.randomUUID(),
          product_id: demoProducts[0].id,
          description: demoProducts[0].name,
          quantity: 2,
          unit: demoProducts[0].unit,
          unit_price: 40,
          weight: 0,
          fragile: false,
        },
      ],
      note: "",
      dropoff_name: "",
      dropoff_phone: "",
      extra_charge: 20,
      discount: 0,
      price_reason: "",
      collect_now: true,
    });

    expect(shipment.zone_name).toBe("สุโขทัย");
    expect(shipment.total_amount).toBe(100);
    expect(shipment.paid_amount).toBe(100);
    expect(shipment.outstanding_amount).toBe(0);
  });
});
