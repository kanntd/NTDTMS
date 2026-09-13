import type { Party, PaymentMode } from "./types";

export type Measurements = {
  weight?: string;
  width?: string;
  length?: string;
  height?: string;
};
export type IntakeParty = Party & {
  prefix?: string;
  name?: string;
  address_detail?: string;
  district?: string;
  province?: string;
  branch_code?: string;
  note?: string;
};
export type CatalogItem = Measurements & {
  id: string;
  productId: string;
  name: string;
  unit: string;
};
export type ProductEntry = {
  item: CatalogItem;
  price: number | null;
  requestPrice: boolean;
};
export const normalizeEntry = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase("th")
    .replace(/[\s.-]/g, "");
export const entryId = (id: string, unit: string) => `${id}:${unit}`;
export const measurementFields = [
  ["weight", "น้ำหนัก (กก.)"],
  ["width", "กว้าง (ซม.)"],
  ["length", "ยาว (ซม.)"],
  ["height", "สูง (ซม.)"],
] as const;
export const validMeasurements = (value: Measurements) =>
  measurementFields.every(
    ([key]) =>
      !value[key] ||
      (Number.isFinite(Number(value[key])) && Number(value[key]) >= 0),
  );
export const pairRateKey = (
  receiver: string,
  sender: string,
  catalog: string,
  payment: PaymentMode,
  branch: string,
) => JSON.stringify([receiver, sender, catalog, payment, branch]);
export function monthlyBillingPeriod(date: Date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const month = `${y}-${String(m).padStart(2, "0")}`;
  return {
    month,
    start: `${month}-01`,
    end: `${month}-${new Date(y, m, 0).getDate()}`,
  };
}
