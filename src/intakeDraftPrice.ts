export type EditablePriceLine = {
  price: number | null;
  requestPrice: boolean;
  priceTouched: boolean;
};

export function refreshDraftLinePrice<T extends EditablePriceLine>(
  line: T,
  calculatedPrice: number | null,
  pendingRequest: boolean,
): T {
  if (line.priceTouched) return line;
  return {
    ...line,
    price: pendingRequest ? null : calculatedPrice,
    requestPrice: pendingRequest || line.requestPrice,
  };
}
