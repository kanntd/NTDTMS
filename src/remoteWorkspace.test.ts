import { describe, expect, it } from "vitest";
import { pairRateKey } from "./intakeEntryData";
import { mapRemoteWorkspace } from "./remoteWorkspace";

describe("shared reception workspace", () => {
  it("maps customer relationships, nicknames, and current price history", () => {
    const workspace = mapRemoteWorkspace({
      parties: [
        {
          id: "receiver",
          display_name: "ร้าน ก",
          legal_name: "ร้าน ก",
          default_branch_code: "STI",
          is_active: true,
        },
        {
          id: "sender",
          display_name: "ร้าน ข",
          legal_name: "ร้าน ข",
          is_active: true,
        },
      ],
      party_roles: [
        { party_id: "receiver", role: "RECEIVER", is_active: true },
        { party_id: "sender", role: "SENDER", is_active: true },
      ],
      catalog: [
        {
          id: "shoe-bag",
          product_id: "shoe",
          name: "รองเท้า",
          unit: "กระสอบ",
          is_active: true,
        },
      ],
      relations: [
        {
          id: "relation",
          receiver_id: "receiver",
          sender_id: "sender",
          default_payment_mode: "CREDIT_DESTINATION",
          billing_cycle: "MONTH_END",
          credit_days: 30,
          is_active: true,
        },
      ],
      relation_products: [
        {
          id: "relation-product",
          receiver_id: "receiver",
          sender_id: "sender",
          product_unit_id: "shoe-bag",
          is_active: true,
        },
      ],
      agreements: [
        {
          id: "agreement",
          receiver_id: "receiver",
          sender_id: "sender",
          product_unit_id: "shoe-bag",
          payment_mode: "CREDIT_DESTINATION",
          branch_code: "STI",
          current_version_id: "version",
          is_active: true,
        },
      ],
      price_versions: [
        {
          id: "version",
          agreement_id: "agreement",
          version_no: 1,
          unit_price: 100,
          effective_from: "2026-09-15",
          source: "INITIAL",
          reason: "ราคาเริ่มต้น",
          created_at: "2026-09-15T00:00:00Z",
          approved_by_name: "ผู้ดูแล",
        },
      ],
      employees: [
        {
          id: "employee",
          employee_code: "EMP-001",
          display_name: "สมชาย ใจดี",
          nickname: "ชาย",
          branch_code: "BKK",
          is_active: true,
        },
      ],
    });

    expect(workspace.registry.defaults.receiver).toBe("STI");
    expect(workspace.registry.partyRoles.sender.sender).toBe(true);
    expect(workspace.operations.relationProducts[0]).toMatchObject({
      receiverId: "receiver",
      senderId: "sender",
      catalogId: "shoe-bag",
    });
    expect(workspace.operations.employees[0].nickname).toBe("ชาย");
    expect(workspace.operations.agreements[0].key).toBe(
      pairRateKey(
        "receiver",
        "sender",
        "shoe-bag",
        "CREDIT_DESTINATION",
        "STI",
      ),
    );
    expect(workspace.operations.priceVersions[0].price).toBe(100);
  });
});
