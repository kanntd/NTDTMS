import type { CatalogItem, IntakeParty } from "./intakeEntryData";

export const INTAKE_STORAGE_KEY = "ntdtms-reception-local-v5";

export interface IntakeRegistrySnapshot {
  raw: Record<string, unknown>;
  parties: IntakeParty[];
  catalog: CatalogItem[];
  defaults: Record<string, string>;
  partyRoles: Record<string, { receiver: boolean; sender: boolean }>;
}

function seedSnapshot(): IntakeRegistrySnapshot {
  return { raw: {}, parties: [], catalog: [], defaults: {}, partyRoles: {} };
}

export function loadIntakeRegistry(): IntakeRegistrySnapshot {
  const seed = seedSnapshot();
  try {
    const raw = JSON.parse(
      localStorage.getItem(INTAKE_STORAGE_KEY) || "null",
    ) as Record<string, unknown> | null;
    if (raw && Array.isArray(raw.parties) && Array.isArray(raw.catalog)) {
      const storedRoles =
        (raw.partyRoles as IntakeRegistrySnapshot["partyRoles"]) || {};
      const storedRelations =
        (raw.relations as Record<string, string[]> | undefined) || {};
      const storedDefaults =
        (raw.defaults as Record<string, string> | undefined) || seed.defaults;
      const partyRoles = Object.fromEntries(
        (raw.parties as IntakeParty[]).map((party) => {
          const inferredReceiver =
            party.id in storedDefaults || party.id in storedRelations;
          const inferredSender = Object.values(storedRelations).some((ids) =>
            ids.includes(party.id),
          );
          return [
            party.id,
            storedRoles[party.id] || {
              receiver: inferredReceiver || !inferredSender,
              sender: inferredSender,
            },
          ];
        }),
      );
      return {
        raw,
        parties: raw.parties as IntakeParty[],
        catalog: raw.catalog as CatalogItem[],
        defaults: storedDefaults,
        partyRoles,
      };
    }
  } catch {
    /* The intake page will rebuild its demo state if storage is damaged. */
  }
  return seed;
}

export function saveIntakeRegistry(snapshot: IntakeRegistrySnapshot) {
  const merchandise = {};
  const relations = {};
  const draft = {
    receiverId: "",
    senderId: "",
    branch: "",
    payment: "",
    days: 30,
    billingCycle: "MONTH_END",
    lines: [
      {
        id: crypto.randomUUID(),
        catalogId: "",
        quantity: 1,
        price: null,
        requestPrice: false,
      },
    ],
    discount: 0,
    reason: "",
    withholding: false,
    taxOverride: null,
    roundCash: false,
    collect: false,
    note: "",
  };
  const next = {
    version: 5,
    rates: {},
    drafts: draft,
    bills: [],
    merchandise,
    relations,
    ...snapshot.raw,
    parties: snapshot.parties,
    catalog: snapshot.catalog,
    defaults: snapshot.defaults,
    partyRoles: snapshot.partyRoles,
  };
  localStorage.setItem(INTAKE_STORAGE_KEY, JSON.stringify(next));
}

export function partyName(
  parties: IntakeParty[],
  id: string,
  fallback = "ไม่พบชื่อ",
) {
  return parties.find((party) => party.id === id)?.display_name || fallback;
}

export function catalogName(catalog: CatalogItem[], id: string) {
  const item = catalog.find((row) => row.id === id);
  return item ? `${item.name} · ${item.unit}` : "ไม่พบสินค้า";
}
