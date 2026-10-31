// Szövegbetöltő: egy közlés (vers, műfordítás) szövege a forrásból – weboldalról vagy PDF-ből –,
// természetes sor- és versszaktördeléssel, a közlés címei szerint versekre bontva.
// A szerkesztő hívja (POST /api/import); az eredményt a szerkesztő átnézi, javítja és menti.

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { getDocumentProxy } from "unpdf";

const MAX_BYTES = 40 * 1024 * 1024;
const UA = "Mozilla/5.0 (compatible; BordasMateHonlap/1.0; +https://bordasmate-honlap.netlify.app)";

// csak nyilvános webcímek (a saját hálózat felé nem kérdezünk)
function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Érvénytelen webcím."); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Csak http(s) webcím tölthető be.");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.includes(":") || /^\d+$/.test(h)) {
    throw new Error("Ez a cím nem tölthető be.");
  }
  return u;
}

async function download(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  let r;
  try { r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/pdf,*/*;q=0.8" }, redirect: "follow", signal: ctl.signal }); }
  catch (e) { throw new Error(e.name === "AbortError" ? "A forrás nem válaszolt időben." : "A forrás nem érhető el."); }
  finally { clearTimeout(t); }
  if (!r.ok) throw new Error(`A forrás hibát adott (${r.status}).`);
  const len = +r.headers.get("content-length") || 0;
  if (len > MAX_BYTES) throw new Error("A forrásfájl túl nagy a betöltéshez.");
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error("A forrásfájl túl nagy a betöltéshez.");
  return { buf, type: (r.headers.get("content-type") || "").toLowerCase(), finalUrl: r.url || String(url) };
}

/* ---------- weboldal ---------- */
function decodeHtml(buf, type) {
  let cs = (type.match(/charset=([\w-]+)/) || [])[1];
  if (!cs) {
    const head = new TextDecoder("latin1").decode(buf.subarray(0, 4096));
    cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  try { return new TextDecoder(cs || "utf-8").decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}
const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL", "PRE", "TABLE", "TR", "FIGURE", "HEADER", "FOOTER"]);
// HTML → szöveg: <br> = sortörés, bekezdés (blokk) = üres sor (versszakhatár)
function htmlToLines(root) {
  const out = [];
  let cur = "";
  const flush = (gap) => { const t = cur.replace(/[ \t ]+/g, " ").trim(); if (t) out.push(t); cur = ""; if (gap && out.length && out[out.length - 1] !== "") out.push(""); };
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { cur += c.textContent.replace(/\s*\n\s*/g, " "); continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
      if (tag === "BR") { flush(false); continue; }
      if (BLOCK.has(tag)) { flush(true); if (tag === "PRE") { c.textContent.split("\n").forEach((l) => out.push(l.replace(/\s+$/, ""))); out.push(""); } else walk(c); flush(true); continue; }
      walk(c);
    }
  };
  walk(root);
  flush(false);
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}
function fromHtml(buf, type, url) {
  const html = decodeHtml(buf, type);
  const { document } = parseHTML(html);
  let root = null, title = "";
  try {
    const art = new Readability(document.cloneNode(true), { charThreshold: 100, keepClasses: false }).parse();
    if (art && art.content) { root = parseHTML(`<html><body>${art.content}</body></html>`).document.body; title = art.title || ""; }
  } catch {}
  if (!root) root = document.querySelector("article, main, .entry-content, .post-content, #content") || document.body;
  return { lines: htmlToLines(root), title, kind: "html" };
}

/* ---------- PDF ---------- */
async function fromPdf(buf, names) {
  const pdf = await getDocumentProxy(buf);
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    // sorok a függőleges helyzet szerint
    const rows = [];
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || it.height || 10;
      let row = rows.find((r) => Math.abs(r.y - y) < h * 0.45);
      if (!row) { row = { y, h, parts: [] }; rows.push(row); }
      row.parts.push({ x, s: it.str, w: it.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines = [];
    let prevY = null;
    const gaps = [];
    rows.forEach((r) => { if (prevY !== null) gaps.push(prevY - r.y); prevY = r.y; });
    // a jellemző sorköz: az alsó harmad (a versszak- és címközök nagyobbak)
    const med = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.3)] : 12;
    prevY = null;
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let t = "", end = null;
      for (const pt of r.parts) {
        if (end !== null && pt.x - end > r.h * 0.15 && !t.endsWith(" ") && !pt.s.startsWith(" ")) t += " ";
        t += pt.s; end = pt.x + pt.w;
      }
      t = t.replace(/\s+/g, " ").trim();
      if (prevY !== null && prevY - r.y > med * 1.55 && lines.length && lines[lines.length - 1] !== "") lines.push("");
      if (t) lines.push(t);
      prevY = r.y;
    }
    pages.push(lines);
  }
  // fej- és lábléc: oldalszámok, és a több oldalon azonosan ismétlődő sorok
  const count = new Map();
  pages.forEach((ls) => new Set(ls.filter(Boolean)).forEach((l) => count.set(l, (count.get(l) || 0) + 1)));
  const junk = (l) => /^\d{1,4}$/.test(l) || (pages.length >= 2 && count.get(l) >= Math.max(2, pages.length * 0.5) && l.length < 80);
  // egész lapszám esetén csak a szerzőt / fordítót említő oldalak (és a rákövetkezők)
  let keep = pages.map(() => true);
  if (pages.length > 6 && names.length) {
    const hit = pages.map((ls) => ls.some((l) => names.some((n) => l.toLowerCase().includes(n))));
    keep = pages.map((_, i) => hit[i] || hit[i - 1]);
    if (!keep.some(Boolean)) keep = pages.map(() => true);
  }
  const lines = [];
  pages.forEach((ls, i) => { if (!keep[i]) return; ls.forEach((l) => { if (!junk(l)) lines.push(l); }); if (lines.length && lines[lines.length - 1] !== "") lines.push(""); });
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return { lines, title: "", kind: "pdf", pages: pdf.numPages, keptPages: keep.filter(Boolean).length };
}

/* ---------- versekre bontás a közlés címei alapján ---------- */
const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/[„”"“'’«»\[\]{}()*#.,:;!?–—\-_/\\|]/g, " ").replace(/\s+/g, " ").trim();
export function splitPoems(lines, titles) {
  const T = titles.map((t) => ({ t, n: norm(t) })).filter((x) => x.n);
  const at = [];
  let from = 0;
  for (const x of T) {
    let idx = -1;
    for (let i = from; i < lines.length; i++) {
      const n = norm(lines[i]);
      if (n && (n === x.n || (n.startsWith(x.n) && n.length - x.n.length < 4))) { idx = i; break; }
    }
    if (idx >= 0) { at.push({ title: x.t, i: idx }); from = idx + 1; }
  }
  const tidy = (ls) => { const a = [...ls]; while (a.length && !a[0].trim()) a.shift(); while (a.length && !a[a.length - 1].trim()) a.pop(); return a.join("\n").replace(/\n{3,}/g, "\n\n"); };
  if (!at.length) return [{ title: "", text: tidy(lines) }];
  return at.map((p, k) => ({ title: p.title, text: tidy(lines.slice(p.i + 1, k + 1 < at.length ? at[k + 1].i : lines.length)) }));
}

export async function importText({ url, titles = [], names = ["bordás"] }) {
  const u = checkUrl(url);
  const { buf, type, finalUrl } = await download(u);
  const isPdf = type.includes("pdf") || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
  const res = isPdf ? await fromPdf(buf, names.map((n) => n.toLowerCase())) : fromHtml(buf, type, finalUrl);
  if (!res.lines.length) throw new Error("A forrásban nem találtam szöveget (lehet, hogy beszkennelt kép).");
  const poems = splitPoems(res.lines, titles);
  return { ok: true, kind: res.kind, pages: res.pages, keptPages: res.keptPages, found: poems.filter((p) => p.title).length, poems, raw: res.lines.join("\n") };
}
