import { describe, expect, it } from "vitest";
import { destinationBranches } from "./branchRoutes";
import { demoBranches, demoZones } from "./demo";

describe("destinationBranches", () => {
  it("uses configured branches, including new and renamed routes", () => {
    const branches = structuredClone(demoBranches);
    branches.find((branch) => branch.code === "KPT")!.code = "KPP";
    branches.push({
      id: "branch-new",
      code: "NEW",
      document_code: "N01",
      name: "สาขาใหม่",
      branch_kind: "DESTINATION",
      province_name: "จังหวัดใหม่",
      can_issue_bills: false,
      is_active: true,
    });
    const result = destinationBranches(branches, demoZones);
    expect(result.map((branch) => branch.code)).toContain("KPP");
    expect(result.map((branch) => branch.code)).toContain("NEW");
    expect(result.map((branch) => branch.code)).not.toContain("KPT");
    expect(result.map((branch) => branch.code)).not.toContain("BKK");
  });
});
