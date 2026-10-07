import { describe, expect, it } from "vitest";
import { chunkValues, POSTGREST_IN_CHUNK_SIZE } from "./queryChunks";

describe("chunkValues", () => {
  it("keeps PostgREST in filters below the configured batch size", () => {
    const values = Array.from(
      { length: POSTGREST_IN_CHUNK_SIZE * 2 + 7 },
      (_, index) => `id-${index}`,
    );

    const chunks = chunkValues(values);

    expect(chunks.map((chunk) => chunk.length)).toEqual([
      POSTGREST_IN_CHUNK_SIZE,
      POSTGREST_IN_CHUNK_SIZE,
      7,
    ]);
    expect(chunks.flat()).toEqual(values);
  });

  it("returns no requests for an empty id list", () => {
    expect(chunkValues([])).toEqual([]);
  });
});
