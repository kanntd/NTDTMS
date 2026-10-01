import { BRANCH_OPTIONS } from "./intakeData";
import type { CompanyBranch, Zone } from "./types";

export function destinationBranches(branches: CompanyBranch[], zones: Zone[]) {
  return branches
    .filter(
      (branch) =>
        branch.is_active &&
        ["DESTINATION", "BOTH"].includes(branch.branch_kind),
    )
    .map((branch) => {
      const zone = zones.find(
        (item) =>
          item.name === branch.province_name || item.code === branch.code,
      );
      const legacy = BRANCH_OPTIONS.find(
        (item) =>
          item.name === branch.name.replace(/^สาขา/, "") ||
          item.code === branch.code,
      );
      return {
        code: branch.code,
        name: branch.name.replace(/^สาขา/, ""),
        color: zone?.color || legacy?.color || "#5f7369",
      };
    });
}

function branchName(value: string) {
  return value.replace(/^สาขา\s*/, "").trim();
}

export function destinationBranchAliases(
  code: string,
  branches: CompanyBranch[],
  zones: Zone[],
) {
  if (!code) return [];
  const aliases = new Set([code]);
  const configured = branches.find((branch) => branch.code === code);
  if (!configured) return [...aliases];

  const name = branchName(configured.name);
  const idCode = configured.id.startsWith("branch-")
    ? configured.id.slice("branch-".length).toUpperCase()
    : "";
  const legacy = BRANCH_OPTIONS.find(
    (item) =>
      item.code === code ||
      item.code === idCode ||
      branchName(item.name) === name,
  );
  if (legacy) aliases.add(legacy.code);

  for (const zone of zones) {
    if (
      zone.code === code ||
      zone.code === legacy?.code ||
      branchName(zone.name) === name
    ) {
      aliases.add(zone.code);
    }
  }
  return [...aliases];
}

export function isDestinationBranch(
  value: string | null | undefined,
  selectedCode: string,
  branches: CompanyBranch[],
  zones: Zone[],
) {
  return (
    !selectedCode ||
    destinationBranchAliases(selectedCode, branches, zones).includes(
      value || "",
    )
  );
}

export function configuredDestinationBranchCode(
  value: string | null | undefined,
  branches: CompanyBranch[],
  zones: Zone[],
) {
  if (!value) return "";
  return (
    destinationBranches(branches, zones).find((branch) =>
      destinationBranchAliases(branch.code, branches, zones).includes(value),
    )?.code || value
  );
}

export function destinationCodeForDistrict(
  districtId: string | null | undefined,
  branches: CompanyBranch[],
) {
  const legacy = BRANCH_OPTIONS.find((item) => item.districtId === districtId);
  return (
    branches.find(
      (branch) => branch.id === `branch-${legacy?.code.toLowerCase()}`,
    )?.code ||
    branches.find((branch) => branch.name.includes(legacy?.name || "\u0000"))
      ?.code ||
    ""
  );
}
