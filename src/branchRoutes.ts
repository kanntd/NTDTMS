import { BRANCH_OPTIONS } from "./intakeData";
import type { CompanyBranch, Zone } from "./types";

export function destinationBranches(branches: CompanyBranch[], zones: Zone[]) {
  return branches
    .filter((branch) => branch.is_active && ["DESTINATION", "BOTH"].includes(branch.branch_kind))
    .map((branch) => {
      const zone = zones.find((item) => item.name === branch.province_name || item.code === branch.code);
      const legacy = BRANCH_OPTIONS.find((item) => item.name === branch.name.replace(/^สาขา/, "") || item.code === branch.code);
      return {
        code: branch.code,
        name: branch.name.replace(/^สาขา/, ""),
        color: zone?.color || legacy?.color || "#5f7369",
      };
    });
}

export function destinationCodeForDistrict(districtId: string | null | undefined, branches: CompanyBranch[]) {
  const legacy = BRANCH_OPTIONS.find((item) => item.districtId === districtId);
  return branches.find((branch) => branch.id === `branch-${legacy?.code.toLowerCase()}`)?.code ||
    branches.find((branch) => branch.name.includes(legacy?.name || "\u0000"))?.code || "";
}
