import Decimal from "decimal.js";
import type { Item, Shipment } from "./types";

export type CodPaymentMethod = "CASH" | "TRANSFER" | "QR";

export interface CodPaymentMethodOption {
  id: string;
  label: string;
  base_method: CodPaymentMethod;
}

export interface CodItemPrice {
  item_id: string;
  unit_price: number;
}

export interface CodCollectionInput {
  shipment_id: string;
  request_id: string;
  advance?: boolean;
  amount: number;
  method: CodPaymentMethod;
  method_option_id: string | null;
  note: string;
  discount: number;
  expected_discount: number;
  items: CodItemPrice[];
}

const cents = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(2);

export function isCurrencyAmount(value: number) {
  return Number.isFinite(value) && new Decimal(value).decimalPlaces() <= 2;
}

export function adjustedCodAmounts(shipment: Shipment, discount: number) {
  const difference = cents(shipment.discount).minus(discount);
  return {
    total: cents(shipment.total_amount).plus(difference).toNumber(),
    outstanding: cents(shipment.outstanding_amount).plus(difference).toNumber(),
  };
}

export function codLineTotal(item: Item, price: number) {
  return cents(new Decimal(item.quantity).times(price)).toNumber();
}

export function knownCodPrices(
  items: Item[],
  prices: Record<string, string>,
): { lines: CodItemPrice[]; knownTotal: number; unknownCount: number } {
  const lines: CodItemPrice[] = [];
  let knownTotal = new Decimal(0);
  let unknownCount = 0;
  for (const item of items) {
    const raw = prices[item.id]?.trim() || "";
    if (!raw) {
      unknownCount += 1;
      continue;
    }
    const price = Number(raw);
    if (!isCurrencyAmount(price) || price < 0) {
      throw new Error(
        `ราคาต่อหน่วยของ ${item.description} ต้องเป็นบาทและสตางค์`,
      );
    }
    lines.push({ item_id: item.id, unit_price: price });
    knownTotal = knownTotal.plus(codLineTotal(item, price));
  }
  return { lines, knownTotal: knownTotal.toNumber(), unknownCount };
}
