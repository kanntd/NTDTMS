import { pairRateKey } from "./intakeEntryData";
import { INTAKE_STORAGE_KEY } from "./intakeRegistry";
import type { PaymentMode } from "./types";

export type BillingCycle = "MONTH_END" | "NET_DAYS";
export type DocumentOwner = "EMPLOYEE" | "VEHICLE";
export type DocumentKind =
  "ID_CARD" | "DRIVER_LICENSE" | "VEHICLE_REGISTRATION" | "INSURANCE" | "OTHER";

export interface CustomerRelation {
  id: string;
  receiverId: string;
  senderId: string;
  defaultPayment: PaymentMode;
  billingCycle: BillingCycle;
  creditDays: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiverProductLink {
  id: string;
  receiverId: string;
  catalogId: string;
  active: boolean;
  createdAt: string;
}

export interface RelationProductLink {
  id: string;
  receiverId: string;
  senderId: string;
  catalogId: string;
  active: boolean;
  createdAt: string;
}

export interface PriceAgreement {
  id: string;
  key: string;
  receiverId: string;
  senderId: string;
  catalogId: string;
  payment: PaymentMode;
  branch: string;
  currentVersionId: string | null;
  active: boolean;
}

export interface PriceVersion {
  id: string;
  agreementId: string;
  version: number;
  price: number;
  effectiveFrom: string;
  reason: string;
  source: "INITIAL" | "PRICE_REQUEST" | "MANUAL" | "BATCH";
  createdAt: string;
  approvedBy: string;
}

export interface PriceRequest {
  id: string;
  key: string;
  receiverId: string;
  senderId: string;
  catalogId: string;
  payment: PaymentMode;
  branch: string;
  billNumber: string;
  quantity: number;
  collectedPrice: number | null;
  actualCollectedAmount: number | null;
  status:
    | "PENDING_PRICE"
    | "PENDING_APPROVAL"
    | "RETURNED"
    | "RESOLVED"
    | "CANCELLED";
  resolutionType?: "STANDARD" | "BILL_ONLY";
  requestedAt: string;
  submittedAt?: string;
  submittedBy?: string;
  returnedAt?: string;
  returnedBy?: string;
  returnReason?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  note: string;
}

type LegacyPriceRequest = Omit<
  PriceRequest,
  "status" | "quantity" | "actualCollectedAmount"
> & {
  status: PriceRequest["status"] | "PENDING";
  quantity?: number;
  actualCollectedAmount?: number | null;
};

export interface Employee {
  id: string;
  code: string;
  name: string;
  phone: string;
  position: string;
  branch: string;
  licenseNo: string;
  licenseExpiry: string;
  active: boolean;
}

export interface Vehicle {
  id: string;
  internalNo: string;
  plateNo: string;
  vehicleType: string;
  branch: string;
  ownership: "OWNED" | "LEASED" | "SUBCONTRACT";
  note: string;
  active: boolean;
}

export interface VehicleDriverAssignment {
  id: string;
  vehicleId: string;
  employeeId: string;
  startsAt: string;
  endsAt: string | null;
}

export interface MasterDocument {
  id: string;
  ownerType: DocumentOwner;
  ownerId: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  byteSize: number;
  objectKey: string;
  expiresOn: string;
  uploadedAt: string;
  previewUrl?: string;
}

export interface OperationsState {
  version: 1;
  relationProductScopeVersion: 1;
  relations: CustomerRelation[];
  receiverProducts: ReceiverProductLink[];
  relationProducts: RelationProductLink[];
  agreements: PriceAgreement[];
  priceVersions: PriceVersion[];
  priceRequests: PriceRequest[];
  employees: Employee[];
  vehicles: Vehicle[];
  driverAssignments: VehicleDriverAssignment[];
  documents: MasterDocument[];
}

const STORAGE_KEY = "ntdtms-operations-v2";
const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

type LegacyBill = {
  date?: string;
  draft?: {
    receiverId?: string;
    senderId?: string;
    payment?: PaymentMode | "";
    branch?: string;
  };
  items?: {
    catalogId?: string;
    price?: number | null;
    requestPrice?: boolean;
  }[];
};

function legacyBills(): LegacyBill[] {
  try {
    const bills = JSON.parse(
      localStorage.getItem(INTAKE_STORAGE_KEY) || "null",
    )?.bills;
    return Array.isArray(bills) ? bills : [];
  } catch {
    return [];
  }
}

function legacyBilledRelationProducts(bills: LegacyBill[]) {
  return bills.flatMap((bill) =>
    (bill.items || [])
      .filter(
        (item) =>
          bill.draft?.receiverId && bill.draft?.senderId && item.catalogId,
      )
      .map((item) => ({
        id: newId(),
        receiverId: bill.draft!.receiverId!,
        senderId: bill.draft!.senderId!,
        catalogId: item.catalogId!,
        active: true,
        createdAt: bill.date || now(),
      })),
  );
}

function migrateLegacyBillPrices(state: OperationsState, bills: LegacyBill[]) {
  for (const bill of bills) {
    const { receiverId, senderId, payment, branch } = bill.draft || {};
    if (!receiverId || !senderId || !payment || !branch) continue;
    for (const item of bill.items || []) {
      if (
        !item.catalogId ||
        item.requestPrice ||
        item.price === null ||
        item.price === undefined ||
        !Number.isFinite(item.price) ||
        item.price < 0
      )
        continue;
      addInitialPriceIfMissing(state, {
        receiverId,
        senderId,
        catalogId: item.catalogId,
        payment,
        branch,
        price: item.price,
        reason: "ย้ายราคามาตรฐานจากบิลเดิม",
      });
    }
  }
}

function initialState(): OperationsState {
  return {
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
}

export function loadOperations(): OperationsState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (
      value?.version === 1 &&
      Array.isArray(value.relations) &&
      Array.isArray(value.agreements) &&
      Array.isArray(value.priceVersions)
    ) {
      const seed = initialState();
      const receiverProducts = [
        ...seed.receiverProducts.map(
          (seedRow) =>
            value.receiverProducts?.find(
              (row: ReceiverProductLink) =>
                row.receiverId === seedRow.receiverId &&
                row.catalogId === seedRow.catalogId,
            ) || seedRow,
        ),
        ...(value.receiverProducts || []).filter(
          (row: ReceiverProductLink) =>
            !seed.receiverProducts.some(
              (seedRow) =>
                seedRow.receiverId === row.receiverId &&
                seedRow.catalogId === row.catalogId,
            ),
        ),
      ];
      const storedRelationProducts: RelationProductLink[] =
        value.relationProductScopeVersion === 1 &&
        Array.isArray(value.relationProducts)
          ? value.relationProducts
          : [];
      const billedHistory = legacyBills();
      const migratedRelationProducts: RelationProductLink[] = [
        ...(value.priceRequests || []),
        ...legacyBilledRelationProducts(billedHistory),
      ].reduce(
        (
          rows: RelationProductLink[],
          source: PriceAgreement | PriceRequest,
        ) => {
          if (
            !rows.some(
              (row) =>
                row.receiverId === source.receiverId &&
                row.senderId === source.senderId &&
                row.catalogId === source.catalogId,
            )
          ) {
            rows.push({
              id: newId(),
              receiverId: source.receiverId,
              senderId: source.senderId,
              catalogId: source.catalogId,
              active: true,
              createdAt: now(),
            });
          }
          return rows;
        },
        [],
      );
      const candidates = [
        ...seed.relationProducts.map(
          (seedRow) =>
            storedRelationProducts.find(
              (row) =>
                row.receiverId === seedRow.receiverId &&
                row.senderId === seedRow.senderId &&
                row.catalogId === seedRow.catalogId,
            ) || seedRow,
        ),
        ...storedRelationProducts,
        ...migratedRelationProducts,
      ];
      const relationProducts = candidates.filter(
        (row, index) =>
          candidates.findIndex(
            (candidate) =>
              candidate.receiverId === row.receiverId &&
              candidate.senderId === row.senderId &&
              candidate.catalogId === row.catalogId,
          ) === index,
      );
      const next = {
        ...seed,
        ...value,
        relationProductScopeVersion: 1,
        receiverProducts,
        relationProducts,
        priceRequests: (value.priceRequests || []).map(
          (row: LegacyPriceRequest) => ({
            ...row,
            quantity: row.quantity ?? 1,
            actualCollectedAmount: row.actualCollectedAmount ?? null,
            status:
              row.status === "PENDING"
                ? row.collectedPrice === null
                  ? "PENDING_PRICE"
                  : "PENDING_APPROVAL"
                : row.status,
          }),
        ),
        employees: value.employees || [],
        vehicles: (value.vehicles || []).map((row: Vehicle) => ({
          ...row,
          note: row.note || "",
        })),
        driverAssignments: value.driverAssignments || [],
        documents: value.documents || [],
      };
      migrateLegacyBillPrices(next, billedHistory);
      return next;
    }
  } catch {
    /* A damaged demo snapshot is replaced without touching production data. */
  }
  const state = initialState();
  saveOperations(state);
  return state;
}

export function saveOperations(state: OperationsState) {
  const persisted = {
    ...state,
    documents: state.documents.map(
      ({ previewUrl: _previewUrl, ...document }) => document,
    ),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

export function activeRelation(
  state: OperationsState,
  receiverId: string,
  senderId: string,
) {
  return state.relations.find(
    (row) =>
      row.active && row.receiverId === receiverId && row.senderId === senderId,
  );
}

export function activeReceiverProduct(
  state: OperationsState,
  receiverId: string,
  catalogId: string,
) {
  return state.receiverProducts.some(
    (row) =>
      row.active &&
      row.receiverId === receiverId &&
      row.catalogId === catalogId,
  );
}

export function activeRelationProduct(
  state: OperationsState,
  receiverId: string,
  senderId: string,
  catalogId: string,
) {
  return state.relationProducts.some(
    (row) =>
      row.active &&
      row.receiverId === receiverId &&
      row.senderId === senderId &&
      row.catalogId === catalogId,
  );
}

export function currentPrice(state: OperationsState, key: string) {
  const agreement = state.agreements.find(
    (row) => row.active && row.key === key,
  );
  if (!agreement?.currentVersionId) return null;
  return (
    state.priceVersions.find((row) => row.id === agreement.currentVersionId)
      ?.price ?? null
  );
}

export function pendingPriceRequest(state: OperationsState, key: string) {
  return state.priceRequests.find(
    (row) =>
      row.key === key &&
      row.status !== "RESOLVED" &&
      row.status !== "CANCELLED",
  );
}

export function addPriceVersion(
  state: OperationsState,
  input: Omit<PriceAgreement, "id" | "key" | "currentVersionId" | "active"> & {
    price: number;
    reason: string;
    source: PriceVersion["source"];
    approvedBy?: string;
    effectiveFrom?: string;
  },
) {
  const key = pairRateKey(
    input.receiverId,
    input.senderId,
    input.catalogId,
    input.payment,
    input.branch,
  );
  let agreement = state.agreements.find((row) => row.key === key);
  if (!agreement) {
    agreement = {
      id: newId(),
      key,
      receiverId: input.receiverId,
      senderId: input.senderId,
      catalogId: input.catalogId,
      payment: input.payment,
      branch: input.branch,
      currentVersionId: null,
      active: true,
    };
    state.agreements.push(agreement);
  }
  agreement.active = true;
  const version: PriceVersion = {
    id: newId(),
    agreementId: agreement.id,
    version:
      Math.max(
        0,
        ...state.priceVersions
          .filter((row) => row.agreementId === agreement!.id)
          .map((row) => row.version),
      ) + 1,
    price: Math.round(input.price * 100) / 100,
    effectiveFrom: input.effectiveFrom || new Date().toISOString().slice(0, 10),
    reason: input.reason.trim(),
    source: input.source,
    createdAt: now(),
    approvedBy: input.approvedBy || "ผู้ดูแล NTD",
  };
  state.priceVersions.push(version);
  agreement.currentVersionId = version.id;
  return version;
}

export function addInitialPriceIfMissing(
  state: OperationsState,
  input: Omit<PriceAgreement, "id" | "key" | "currentVersionId" | "active"> & {
    price: number;
    reason: string;
    approvedBy?: string;
  },
) {
  const key = pairRateKey(
    input.receiverId,
    input.senderId,
    input.catalogId,
    input.payment,
    input.branch,
  );
  if (currentPrice(state, key) !== null || pendingPriceRequest(state, key))
    return false;
  addPriceVersion(state, {
    ...input,
    source: "INITIAL",
  });
  return true;
}

export function currentDriver(state: OperationsState, vehicleId: string) {
  const assignment = state.driverAssignments.find(
    (row) => row.vehicleId === vehicleId && row.endsAt === null,
  );
  return state.employees.find((row) => row.id === assignment?.employeeId);
}

function nextCode(values: string[], prefix: string) {
  const maximum = values.reduce((current, value) => {
    const match = value.match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return `${prefix}-${String(maximum + 1).padStart(3, "0")}`;
}

export function nextEmployeeCode(state: OperationsState) {
  return nextCode(
    state.employees.map((row) => row.code),
    "EMP",
  );
}

export function nextVehicleCode(state: OperationsState) {
  return nextCode(
    state.vehicles.map((row) => row.internalNo),
    "TRUCK",
  );
}

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  ID_CARD: "บัตรประชาชน",
  DRIVER_LICENSE: "ใบขับขี่",
  VEHICLE_REGISTRATION: "เล่มทะเบียนรถ",
  INSURANCE: "ประกันรถ",
  OTHER: "เอกสารอื่น",
};

export const OWNERSHIP_LABELS: Record<Vehicle["ownership"], string> = {
  OWNED: "รถบริษัท",
  LEASED: "รถเช่า",
  SUBCONTRACT: "รถร่วม",
};
