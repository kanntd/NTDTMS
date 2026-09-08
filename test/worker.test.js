import { describe, expect, it } from "vitest";
import worker from "../public/_worker.js";

describe("Cloudflare Pages Worker", () => {
  it("reports R2 as disabled when the bucket binding is missing", async () => {
    const response = await worker.fetch(
      new Request("https://ntdtms.pages.dev/api/status"),
      {},
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ r2Configured: false });
  });

  it("blocks photo upload when R2 is not enabled yet", async () => {
    const response = await worker.fetch(
      new Request(
        "https://ntdtms.pages.dev/api/photos?shipment=00000000-0000-0000-0000-000000000000",
        {
          method: "POST",
          headers: { "content-type": "image/png" },
          body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        },
      ),
      {},
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "R2 ยังไม่ได้เปิดในบัญชี Cloudflare",
    });
  });
});
