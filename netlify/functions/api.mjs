// A honlap kis "háttérszervere" (Netlify Function + Netlify Blobs).
// Itt tárolódik a szerkesztőben elmentett tartalom, az előzmények és a feltöltött médiafájlok.
//
//   GET  /api/content             a közzétett tartalom (ha még nincs mentés: 404 → a honlap a content.json-t tölti)
//   PUT  /api/content             mentés (jelszó kell)
//   POST /api/login               jelszó ellenőrzése
//   GET  /api/history             az utolsó mentések listája (jelszó kell)
//   GET  /api/history/<kulcs>     egy korábbi mentés (jelszó kell)
//   POST /api/media?name=<fájl>   kép- vagy hangfájl feltöltése (jelszó kell)
//   GET  /api/media/<fájl>        a feltöltött fájl
//
// A jelszót a Netlify felületén kell megadni: Site configuration → Environment variables → ADMIN_PASSWORD.

import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const HISTORY_KEEP = 40;
const MAX_CONTENT = 3 * 1024 * 1024;
const MAX_MEDIA = 5.5 * 1024 * 1024;
const MEDIA_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|audio\/(mpeg|mp3|ogg|wav|x-wav|webm|aac|mp4|x-m4a|flac)|video\/(mp4|webm)|application\/pdf)$/;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const fail = (status, message) => json({ error: message }, status);

const sha = (s) => createHash("sha256").update(String(s)).digest();
function passwordFromEnv() {
  try { if (globalThis.Netlify?.env?.get) return Netlify.env.get("ADMIN_PASSWORD") || ""; } catch {}
  return process.env.ADMIN_PASSWORD || "";
}
async function authorized(req) {
  const expected = passwordFromEnv();
  if (!expected) return { ok: false, status: 503, message: "A szerkesztés nincs bekapcsolva: a Netlify-on add meg az ADMIN_PASSWORD környezeti változót." };
  const header = req.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (given && timingSafeEqual(sha(given), sha(expected))) return { ok: true };
  await new Promise((r) => setTimeout(r, 700)); // a próbálgatás lassítása
  return { ok: false, status: 401, message: "Hibás jelszó." };
}

function validContent(c) {
  return c && typeof c === "object" && Array.isArray(c.categories) && c.site && typeof c.site === "object";
}
const safeName = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9.\-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);

export default async (req) => {
  const url = new URL(req.url);
  // "/api/…" és "/.netlify/functions/api/…" alakban is érkezhet
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  const store = getStore({ name: "site", consistency: "strong" });
  const media = getStore({ name: "media", consistency: "strong" });

  try {
    if (path === "/content" && req.method === "GET") {
      const data = await store.get("content", { type: "json" });
      if (!data) return fail(404, "Még nincs mentett tartalom.");
      return json(data);
    }

    if (path === "/content" && req.method === "PUT") {
      const a = await authorized(req);
      if (!a.ok) return fail(a.status, a.message);
      const text = await req.text();
      if (text.length > MAX_CONTENT) return fail(413, "A tartalom túl nagy.");
      let data;
      try { data = JSON.parse(text); } catch { return fail(400, "Hibás JSON."); }
      if (!validContent(data)) return fail(400, "Ez nem a honlap tartalma (hiányzik a site vagy a categories).");
      const savedAt = new Date().toISOString();
      // a korábbi változat az előzményekbe kerül
      const prev = await store.getWithMetadata("content", { type: "text" });
      if (prev && prev.data) {
        const at = (prev.metadata && prev.metadata.savedAt) || savedAt;
        await store.set(`history/${at}`, prev.data, { metadata: { savedAt: at } });
      }
      await store.set("content", JSON.stringify(data), { metadata: { savedAt } });
      // régi előzmények törlése
      const { blobs } = await store.list({ prefix: "history/" });
      const old = blobs.map((b) => b.key).sort().reverse().slice(HISTORY_KEEP);
      await Promise.all(old.map((k) => store.delete(k)));
      return json({ ok: true, savedAt });
    }

    if (path === "/login" && req.method === "POST") {
      const a = await authorized(req);
      return a.ok ? json({ ok: true }) : fail(a.status, a.message);
    }

    if (path === "/history" && req.method === "GET") {
      const a = await authorized(req);
      if (!a.ok) return fail(a.status, a.message);
      const { blobs } = await store.list({ prefix: "history/" });
      const items = blobs.map((b) => ({ key: b.key.slice(8), savedAt: b.key.slice(8) })).sort((x, y) => (x.key < y.key ? 1 : -1));
      return json({ items });
    }

    if (path.startsWith("/history/") && req.method === "GET") {
      const a = await authorized(req);
      if (!a.ok) return fail(a.status, a.message);
      const key = decodeURIComponent(path.slice(9));
      const data = await store.get(`history/${key}`, { type: "json" });
      return data ? json(data) : fail(404, "Nincs ilyen mentés.");
    }

    if (path === "/media" && req.method === "POST") {
      const a = await authorized(req);
      if (!a.ok) return fail(a.status, a.message);
      const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!MEDIA_TYPES.test(type)) return fail(415, "Ez a fájltípus nem tölthető fel (kép, hang, videó vagy PDF lehet).");
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_MEDIA) return fail(413, "A fájl túl nagy (legfeljebb 5 MB).");
      let name = safeName(url.searchParams.get("name")) || "fajl";
      // ne írjunk felül meglévő fájlt
      if (await media.getMetadata(name)) {
        const dot = name.lastIndexOf(".");
        name = `${dot > 0 ? name.slice(0, dot) : name}-${Date.now().toString(36)}${dot > 0 ? name.slice(dot) : ""}`;
      }
      await media.set(name, buf, { metadata: { type, size: buf.byteLength, uploadedAt: new Date().toISOString() } });
      return json({ ok: true, url: `/api/media/${encodeURIComponent(name)}` });
    }

    if (path.startsWith("/media/") && req.method === "GET") {
      const name = decodeURIComponent(path.slice(7));
      const r = await media.getWithMetadata(name, { type: "arrayBuffer" });
      if (!r) return fail(404, "Nincs ilyen fájl.");
      return new Response(r.data, { headers: { "content-type": r.metadata?.type || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
    }

    return fail(404, "Ismeretlen kérés.");
  } catch (err) {
    console.error(err);
    return fail(500, "Szerverhiba: " + (err && err.message ? err.message : String(err)));
  }
};
