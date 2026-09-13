import Decimal from "decimal.js";

export function intakeAmounts(
  prices: { price: number | null; quantity: number }[],
  discount: number,
  withheld: number,
  roundCash: boolean,
) {
  const subtotal = prices.reduce(
    (sum, row) =>
      sum.plus(
        new Decimal(row.price ?? 0).times(row.quantity).toDecimalPlaces(2),
      ),
    new Decimal(0),
  );
  const total = subtotal.minus(discount).toDecimalPlaces(2);
  const afterTax = total.minus(withheld).toDecimalPlaces(2);
  const due = roundCash
    ? afterTax.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    : afterTax;
  return {
    subtotal: subtotal.toNumber(),
    total: total.toNumber(),
    due: due.toNumber(),
    rounding: due.minus(afterTax).toNumber(),
    pending: prices.some((row) => row.price === null),
  };
}

export const onePercent = (value: number) =>
  new Decimal(value)
    .times(0.01)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
