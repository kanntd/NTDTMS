import { supabase } from "./api";
import { pairRateKey } from "./intakeEntryData";
import type { IntakeRegistrySnapshot } from "./intakeRegistry";
import type { OperationsState } from "./operationsStore";
import type { PaymentMode } from "./types";

type JsonRecord = Record<string, unknown>;

export type RemoteWorkspace = {
  registry: IntakeRegistrySnapshot;
  operations: OperationsState;
};

const text = (value: unknown) => (value == null ? "" : String(value));
const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const rows = (value: unknown) =>
  (Array.isArray(value) ? value : []) as JsonRecord[];

export function mapRemoteWorkspace(value: unknown): RemoteWorkspace {
  const data = (value || {}) as JsonRecord;
  const parties = rows(data.parties).map((row) => ({
    id: text(row.id),
    display_name: text(row.display_name),
    phone: text(row.phone),
    address: text(row.address),
    tax_id: text(row.tax_id),
    credit_limit: number(row.credit_limit),
    credit_days: number(row.credit_days, 30),
    is_active: row.is_active !== false,
    prefix: text(row.prefix),
    name: text(row.legal_name),
    address_detail: text(row.address),
    district: text(row.district),
    province: text(row.province),
    branch_code: text(row.default_branch_code),
    note: text(row.note),
  }));
  const partyRoles: IntakeRegistrySnapshot["partyRoles"] = {};
  for (const row of rows(data.party_roles)) {
    const id = text(row.party_id);
    partyRoles[id] ||= { receiver: false, sender: false };
    if (row.role === "RECEIVER")
      partyRoles[id].receiver = row.is_active !== false;
    if (row.role === "SENDER") partyRoles[id].sender = row.is_active !== false;
  }
  const catalogRows = rows(data.catalog);
  const catalog = catalogRows.map((row) => ({
    id: text(row.id),
    productId: text(row.product_id),
    name: text(row.name),
    unit: text(row.unit),
    weight: text(row.weight),
    width: text(row.width),
    length: text(row.length),
    height: text(row.height),
  }));
  const catalogActive = Object.fromEntries(
    catalogRows.map((row) => [text(row.id), row.is_active !== false]),
  );
  const defaults = Object.fromEntries(
    rows(data.parties)
      .filter((row) => row.default_branch_code)
      .map((row) => [text(row.id), text(row.default_branch_code)]),
  );

  const relations = rows(data.relations).map((row) => ({
    id: text(row.id),
    receiverId: text(row.receiver_id),
    senderId: text(row.sender_id),
    defaultPayment: text(row.default_payment_mode) as PaymentMode,
    billingCycle: text(row.billing_cycle) as "MONTH_END" | "NET_DAYS",
    creditDays: number(row.credit_days, 30),
    active: row.is_active !== false,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  }));
  const agreements = rows(data.agreements).map((row) => {
    const payment = text(row.payment_mode) as PaymentMode;
    const receiverId = text(row.receiver_id);
    const senderId = text(row.sender_id);
    const catalogId = text(row.product_unit_id);
    const branch = text(row.branch_code);
    return {
      id: text(row.id),
      key: pairRateKey(receiverId, senderId, catalogId, payment, branch),
      receiverId,
      senderId,
      catalogId,
      payment,
      branch,
      currentVersionId: row.current_version_id
        ? text(row.current_version_id)
        : null,
      active: row.is_active !== false,
    };
  });
  const priceRequests = rows(data.price_requests).map((row) => {
    const payment = text(row.payment_mode) as PaymentMode;
    const receiverId = text(row.receiver_id);
    const senderId = text(row.sender_id);
    const catalogId = text(row.product_unit_id);
    const branch = text(row.branch_code);
    return {
      id: text(row.id),
      key: pairRateKey(receiverId, senderId, catalogId, payment, branch),
      receiverId,
      senderId,
      catalogId,
      payment,
      branch,
      billNumber: text(row.bill_number),
      quantity: number(row.quantity, 1),
      proposedPrice:
        row.proposed_price == null ? null : number(row.proposed_price),
      approvedPrice:
        row.approved_price == null ? null : number(row.approved_price),
      actualCollectedAmount:
        row.actual_collected_amount == null
          ? null
          : number(row.actual_collected_amount),
      status: text(
        row.status,
      ) as OperationsState["priceRequests"][number]["status"],
      resolutionType: row.resolution_type
        ? (text(row.resolution_type) as "STANDARD" | "BILL_ONLY")
        : undefined,
      requestedAt: text(row.requested_at),
      submittedAt: row.submitted_at ? text(row.submitted_at) : undefined,
      returnedAt: row.returned_at ? text(row.returned_at) : undefined,
      returnReason: row.return_reason ? text(row.return_reason) : undefined,
      resolvedAt: row.resolved_at ? text(row.resolved_at) : undefined,
      note: text(row.note),
      approvalNote: text(row.approval_note),
    };
  });

  return {
    registry: {
      raw: { catalogActive },
      parties,
      catalog,
      defaults,
      partyRoles,
    },
    operations: {
      version: 1,
      relationProductScopeVersion: 1,
      relations,
      receiverProducts: rows(data.receiver_products).map((row) => ({
        id: text(row.id),
        receiverId: text(row.receiver_id),
        catalogId: text(row.product_unit_id),
        active: row.is_active !== false,
        createdAt: text(row.created_at),
      })),
      relationProducts: rows(data.relation_products).map((row) => ({
        id: text(row.id),
        receiverId: text(row.receiver_id),
        senderId: text(row.sender_id),
        catalogId: text(row.product_unit_id),
        active: row.is_active !== false,
        createdAt: text(row.created_at),
      })),
      agreements,
      priceVersions: rows(data.price_versions).map((row) => ({
        id: text(row.id),
        agreementId: text(row.agreement_id),
        version: number(row.version_no),
        price: number(row.unit_price),
        effectiveFrom: text(row.effective_from),
        reason: text(row.reason),
        source: text(
          row.source,
        ) as OperationsState["priceVersions"][number]["source"],
        createdAt: text(row.created_at),
        approvedBy: text(row.approved_by_name) || "ผู้ดูแล",
      })),
      priceRequests,
      employees: rows(data.employees).map((row) => ({
        id: text(row.id),
        code: text(row.employee_code),
        name: text(row.display_name),
        nickname: text(row.nickname),
        phone: text(row.phone),
        position: text(row.position_name),
        branch: text(row.branch_code),
        licenseNo: text(row.driver_license_no),
        licenseExpiry: text(row.driver_license_expires_on),
        active: row.is_active !== false,
      })),
      vehicles: rows(data.vehicles).map((row) => ({
        id: text(row.id),
        internalNo: text(row.vehicle_no),
        plateNo: text(row.plate_no),
        vehicleType: text(row.vehicle_type),
        branch: text(row.branch_code),
        ownership: text(
          row.ownership_type,
        ) as OperationsState["vehicles"][number]["ownership"],
        note: text(row.note),
        active: row.is_active !== false,
      })),
      driverAssignments: rows(data.driver_assignments).map((row) => ({
        id: text(row.id),
        vehicleId: text(row.vehicle_id),
        employeeId: text(row.employee_id),
        startsAt: text(row.starts_on),
        endsAt: row.ends_on ? text(row.ends_on) : null,
      })),
      documents: rows(data.documents).map((row) => ({
        id: text(row.id),
        ownerType: text(
          row.owner_type,
        ) as OperationsState["documents"][number]["ownerType"],
        ownerId: text(row.owner_id),
        kind: text(
          row.document_kind,
        ) as OperationsState["documents"][number]["kind"],
        filename: text(row.filename),
        mimeType: text(row.mime_type),
        byteSize: number(row.byte_size),
        objectKey: text(row.object_key),
        expiresOn: text(row.expires_on),
        uploadedAt: text(row.created_at),
      })),
    },
  };
}

export async function loadRemoteWorkspace() {
  const result = await supabase.rpc("load_reception_workspace");
  if (result.error) throw result.error;
  return mapRemoteWorkspace(result.data);
}

export async function syncRemoteWorkspace(
  registry: IntakeRegistrySnapshot,
  operations: OperationsState,
) {
  const result = await supabase.rpc("sync_reception_workspace", {
    registry: {
      parties: registry.parties.map((party) => ({
        ...party,
        legal_name: party.name || "",
        address: party.address_detail || party.address || "",
        branch_code: registry.defaults[party.id] || party.branch_code || "",
      })),
      catalog: registry.catalog,
      catalogActive:
        (registry.raw.catalogActive as Record<string, boolean> | undefined) ||
        {},
      party_roles: registry.partyRoles,
    },
    operations: {
      ...operations,
      documents: operations.documents.map(
        ({ previewUrl: _previewUrl, ...document }) => document,
      ),
    },
  });
  if (result.error) throw result.error;
}

export type RemoteBillInput = {
  id: string;
  sender_id: string;
  receiver_id: string;
  destination_branch_code: string;
  payment_mode: PaymentMode;
  credit_days: number;
  billing_cycle: "MONTH_END" | "NET_DAYS";
  billing_period_end?: string;
  discount: number;
  discount_reason: string;
  withholding_amount: number;
  rounding: number;
  collect_now: boolean;
  note: string;
  opened_by_employee_id: string;
  items: Array<{
    id: string;
    catalog_id: string;
    name: string;
    unit: string;
    quantity: number;
    price: number | null;
    request_price: boolean;
    weight?: string;
    width?: string;
    length?: string;
    height?: string;
  }>;
};

export function sanitizeRemoteBillItems(items: RemoteBillInput["items"]) {
  return items.map((item) => ({
    ...item,
    weight: item.weight?.trim() || undefined,
    width: item.width?.trim() || undefined,
    length: item.length?.trim() || undefined,
    height: item.height?.trim() || undefined,
  }));
}

export async function issueRemoteReceptionBill(data: RemoteBillInput) {
  const result = await supabase.rpc("issue_reception_bill_v2", {
    data: {
      ...data,
      items: sanitizeRemoteBillItems(data.items),
    },
  });
  if (result.error) throw result.error;
  return result.data as { id: string; number: string };
}

export async function resolveRemotePriceRequest(
  requestId: string,
  approvedPrice: number,
  resolutionType: "STANDARD" | "BILL_ONLY",
  approvalNote: string,
) {
  const result = await supabase.rpc("resolve_shared_price_request", {
    request_id: requestId,
    approved_price: approvedPrice,
    resolution_type: resolutionType,
    approval_note: approvalNote,
  });
  if (result.error) throw result.error;
  return result.data as {
    request_id: string;
    affected_requests: number;
    price_version_id: string | null;
  };
}
