import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({
  tables: [] as string[],
  orders: [] as string[],
  ranges: [] as [number, number][],
  batches: [] as string[][],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      requests.tables.push(table);
      const query = {
        select: () => query,
        order: (column: string) => {
          requests.orders.push(column);
          return query;
        },
        range: (start: number, end: number) => {
          requests.ranges.push([start, end]);
          return Promise.resolve({ data: [], count: 42, error: null });
        },
        in: (_column: string, ids: string[]) => {
          requests.batches.push(ids);
          return Promise.resolve({
            data: ids.map((id) => ({ id })),
            error: null,
          });
        },
      };
      return query;
    },
  }),
}));

import { getShipmentSummaries, listShipments } from "./api";

beforeEach(() => {
  requests.tables.length = 0;
  requests.orders.length = 0;
  requests.ranges.length = 0;
  requests.batches.length = 0;
});

describe("shipment queries", () => {
  it.each([
    ["PRODUCT", "sort_product"],
    ["UNIT", "sort_unit"],
  ] as const)("sorts %s across all pages", async (sort, column) => {
    const result = await listShipments({ sort, page: 1, pageSize: 20 });

    expect(result.count).toBe(42);
    expect(requests.tables).toEqual(["shipment_register_sorted"]);
    expect(requests.orders).toEqual([column, "received_at", "id"]);
    expect(requests.ranges).toEqual([[20, 39]]);
  });

  it("fetches the requested delivery bills in bounded batches", async () => {
    const ids = Array.from({ length: 205 }, (_, index) => String(index));
    const rows = await getShipmentSummaries([...ids, ids[0]]);

    expect(rows).toHaveLength(205);
    expect(requests.tables).toEqual(Array(3).fill("shipments"));
    expect(requests.batches.map((batch) => batch.length)).toEqual([
      100, 100, 5,
    ]);
  });
});
