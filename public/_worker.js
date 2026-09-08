const DEFAULT_SUPABASE_URL = "https://giejnvnnbgzlqfzvfzzf.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_pjWjOPt2dsun2ZdXu1vYAg_4H0mDVrX";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function safeName(value) {
  const decoded = decodeURIComponent(value || "photo");
  return decoded.replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 160) || "photo";
}

function supabaseHeaders(env, token) {
  const key = env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_KEY;
  return {
    apikey: key,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

function requireToken(request) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw json({ error: "กรุณาเข้าสู่ระบบอีกครั้ง" }, 401);
  return match[1];
}

async function readProfile(env, token) {
  const url = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const user = await fetch(`${url}/auth/v1/user`, {
    headers: supabaseHeaders(env, token),
  });
  if (!user.ok)
    throw json({ error: "Session หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง" }, 401);
  const { id } = await user.json();
  const profiles = await fetch(
    `${url}/rest/v1/profiles?select=id,company_id,role,is_active&id=eq.${encodeURIComponent(id)}&is_active=eq.true`,
    { headers: supabaseHeaders(env, token) },
  );
  if (!profiles.ok) throw json({ error: "ตรวจสิทธิ์พนักงานไม่สำเร็จ" }, 403);
  const rows = await profiles.json();
  if (!rows[0])
    throw json({ error: "อีเมลนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน" }, 403);
  return rows[0];
}

async function readShipment(env, token, shipmentId) {
  const url = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const response = await fetch(
    `${url}/rest/v1/shipments?select=id,company_id,shipment_status&id=eq.${encodeURIComponent(shipmentId)}&limit=1`,
    { headers: supabaseHeaders(env, token) },
  );
  if (!response.ok) throw json({ error: "ตรวจเอกสารไม่สำเร็จ" }, 403);
  const rows = await response.json();
  if (!rows[0]) throw json({ error: "ไม่พบเอกสารหรือไม่มีสิทธิ์" }, 404);
  return rows[0];
}

async function registerFile(env, token, payload) {
  const url = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const response = await fetch(`${url}/rest/v1/rpc/register_file`, {
    method: "POST",
    headers: supabaseHeaders(env, token),
    body: JSON.stringify({ data: payload }),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = "บันทึกข้อมูลรูปไม่สำเร็จ";
    try {
      message = JSON.parse(text).message || message;
    } catch {}
    throw json({ error: message }, 400);
  }
  return JSON.parse(text);
}

async function readFileRow(env, token, id) {
  const url = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const response = await fetch(
    `${url}/rest/v1/shipment_files?select=id,object_key,filename,mime_type,byte_size&id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: supabaseHeaders(env, token) },
  );
  if (!response.ok) throw json({ error: "เปิดข้อมูลรูปไม่สำเร็จ" }, 403);
  const rows = await response.json();
  if (!rows[0]) throw json({ error: "ไม่พบรูปหรือไม่มีสิทธิ์" }, 404);
  return rows[0];
}

async function cappedBody(request) {
  const size = Number(request.headers.get("content-length") || "0");
  if (size > MAX_IMAGE_BYTES) throw json({ error: "รูปต้องไม่เกิน 5 MB" }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) throw json({ error: "ไม่พบไฟล์รูป" }, 400);
  if (body.byteLength > MAX_IMAGE_BYTES)
    throw json({ error: "รูปต้องไม่เกิน 5 MB" }, 413);
  return body;
}

function assertImageMagic(mime, body) {
  const bytes = new Uint8Array(body.slice(0, 12));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const webp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  if (
    (mime === "image/jpeg" && jpeg) ||
    (mime === "image/png" && png) ||
    (mime === "image/webp" && webp)
  )
    return;
  throw json({ error: "ชนิดไฟล์รูปไม่ตรงกับไฟล์จริง" }, 415);
}

async function uploadPhoto(request, env) {
  if (!env.IMAGES)
    return json({ error: "R2 ยังไม่ได้เปิดในบัญชี Cloudflare" }, 503);
  const token = requireToken(request);
  const profile = await readProfile(env, token);
  if (!["owner", "admin", "clerk"].includes(profile.role)) {
    return json({ error: "ไม่มีสิทธิ์แนบรูป" }, 403);
  }
  const url = new URL(request.url);
  const shipmentId = url.searchParams.get("shipment") || "";
  if (!/^[0-9a-f-]{36}$/i.test(shipmentId))
    return json({ error: "เลขเอกสารไม่ถูกต้อง" }, 400);
  const shipment = await readShipment(env, token, shipmentId);
  if (shipment.shipment_status === "CANCELLED")
    return json({ error: "เอกสารถูกยกเลิก" }, 400);
  if (shipment.company_id !== profile.company_id)
    return json({ error: "ไม่มีสิทธิ์แนบรูป" }, 403);

  const mime = request.headers.get("content-type") || "";
  const ext = IMAGE_TYPES.get(mime);
  if (!ext) return json({ error: "รองรับเฉพาะ JPG, PNG, WebP" }, 415);

  const body = await cappedBody(request);
  assertImageMagic(mime, body);
  const filename = safeName(request.headers.get("x-filename"));
  const objectKey = `${profile.company_id}/${shipmentId}/${crypto.randomUUID()}.${ext}`;

  await env.IMAGES.put(objectKey, body, {
    httpMetadata: { contentType: mime },
    customMetadata: { filename, shipment_id: shipmentId },
  });

  try {
    const id = await registerFile(env, token, {
      shipment_id: shipmentId,
      object_key: objectKey,
      filename,
      mime_type: mime,
      byte_size: body.byteLength,
    });
    return json({ id, filename });
  } catch (error) {
    await env.IMAGES.delete(objectKey);
    throw error;
  }
}

async function downloadPhoto(request, env, id) {
  if (!env.IMAGES)
    return json({ error: "R2 ยังไม่ได้เปิดในบัญชี Cloudflare" }, 503);
  const token = requireToken(request);
  const row = await readFileRow(env, token, id);
  const object = await env.IMAGES.get(row.object_key);
  if (!object) return json({ error: "ไม่พบไฟล์ใน R2" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": row.mime_type,
      "content-length": String(row.byte_size),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/status") {
        return json({ r2Configured: Boolean(env.IMAGES) });
      }
      if (url.pathname === "/api/photos" && request.method === "POST") {
        return uploadPhoto(request, env);
      }
      const photoMatch = url.pathname.match(
        /^\/api\/photos\/([0-9a-f-]{36})$/i,
      );
      if (photoMatch && request.method === "GET") {
        return downloadPhoto(request, env, photoMatch[1]);
      }
      return json({ error: "ไม่พบ API" }, 404);
    } catch (error) {
      if (error instanceof Response) return error;
      return json({ error: "ระบบรูปภาพขัดข้อง" }, 500);
    }
  },
};
