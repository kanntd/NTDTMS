export const POSTGREST_IN_CHUNK_SIZE = 100;

export function chunkValues<T>(
  values: T[],
  size = POSTGREST_IN_CHUNK_SIZE,
): T[][] {
  if (!Number.isInteger(size) || size < 1)
    throw new Error("Chunk size must be a positive integer");
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size)
    chunks.push(values.slice(start, start + size));
  return chunks;
}
