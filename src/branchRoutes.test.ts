import { describe, expect, it } from "vitest";
import {
  configuredDestinationBranchCode,
  destinationBranchAliases,
  destinationBranches,
  isDestinationBranch,
} from "./branchRoutes";
import { demoBranches, demoDestinationCode, demoZones } from "./demo";

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

  it("keeps old records connected after a branch code is changed", () => {
    const branches = structuredClone(demoBranches);
    branches.find((branch) => branch.code === "KPT")!.code = "KP";

    expect(destinationBranchAliases("KP", branches, demoZones)).toEqual(
      expect.arrayContaining(["KP", "KPT"]),
    );
    expect(isDestinationBranch("KPT", "KP", branches, demoZones)).toBe(true);
    expect(configuredDestinationBranchCode("KPT", branches, demoZones)).toBe(
      "KP",
    );
  });

  it("infers the destination of older demo bills that have no branch code", () => {
    expect(demoDestinationCode("z-plk", "plk-1", demoBranches)).toBe("PLK");
    expect(demoDestinationCode("z-plk", "plk-2", demoBranches)).toBe("PLK");
    expect(demoDestinationCode("z-sti", "sti-2", demoBranches)).toBe("SWL");
    expect(demoDestinationCode("z-sti", "sti-3", demoBranches)).toBe("STI");
  });
});
