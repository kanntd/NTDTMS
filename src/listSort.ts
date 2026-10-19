export type ListSort =
  "RECEIVER" | "SENDER" | "PRODUCT" | "UNIT" | "PRICE_ASC" | "PRICE_DESC";

export const SORT_ALL = "__SORT_ALL__";
export const SORT_ALL_LABEL = "แสดงทั้งหมด เรียง ก-ฮ";

export const listSortOptions: { id: ListSort; label: string }[] = [
  { id: "RECEIVER", label: "ผู้รับ ก-ฮ" },
  { id: "SENDER", label: "ผู้ส่ง ก-ฮ" },
  { id: "PRODUCT", label: "สินค้า ก-ฮ" },
  { id: "UNIT", label: "หน่วยนับ ก-ฮ" },
  { id: "PRICE_ASC", label: "ราคา ต่ำ-สูง" },
  { id: "PRICE_DESC", label: "ราคา สูง-ต่ำ" },
];

type SortValues = {
  receiver: string;
  sender: string;
  product: string;
  unit: string;
  price: number | null;
};

const collator = new Intl.Collator("th", {
  numeric: true,
  sensitivity: "base",
});

export function compareListSort(a: SortValues, b: SortValues, sort: ListSort) {
  if (sort === "PRICE_ASC" || sort === "PRICE_DESC") {
    if (a.price === null) return b.price === null ? 0 : 1;
    if (b.price === null) return -1;
    return sort === "PRICE_ASC" ? a.price - b.price : b.price - a.price;
  }
  const field = sort.toLowerCase() as
    "receiver" | "sender" | "product" | "unit";
  return collator.compare(a[field], b[field]);
}

export function firstItemName(
  items: { description: string; unit: string }[],
  field: "description" | "unit",
) {
  let first = "";
  for (const item of items) {
    const value = item[field];
    if (value && (!first || collator.compare(value, first) < 0)) first = value;
  }
  return first;
}
