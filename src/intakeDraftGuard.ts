export interface IntakeDraftGuardInput {
  receiverId: string;
  senderId: string;
  branch: string;
  payment: string;
  discount: number;
  reason: string;
  withholding: boolean;
  taxOverride: number | null;
  roundCash: boolean;
  paymentReference: string;
  note: string;
  lines: Array<{
    catalogId: string;
    quantity: number;
    price: number | null;
    requestPrice: boolean;
    weight?: string;
    width?: string;
    length?: string;
    height?: string;
  }>;
}

export function hasIntakeDraftData(draft: IntakeDraftGuardInput) {
  return Boolean(
    draft.receiverId ||
    draft.senderId ||
    draft.branch ||
    draft.payment ||
    draft.discount ||
    draft.reason.trim() ||
    draft.withholding ||
    draft.taxOverride !== null ||
    draft.roundCash ||
    draft.paymentReference.trim() ||
    draft.note.trim() ||
    draft.lines.some(
      (line) =>
        line.catalogId ||
        line.quantity !== 1 ||
        line.price !== null ||
        line.requestPrice ||
        line.weight ||
        line.width ||
        line.length ||
        line.height,
    ),
  );
}
