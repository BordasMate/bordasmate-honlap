// PDF-olvasó a honlapon: folyóiratszámok (pl. ROST) lapozása, olvasása.
// A PDF.js a honlap saját tárhelyéről töltődik (public/vendor/pdfjs), csak amikor először kell.
// Forrás lehet: /api/doc/<id> (a szerkesztőben darabokban feltöltött nagy PDF – csak a látott lapokhoz kellő
// darabok töltődnek le), vagy bármilyen PDF-cím (/api/media/…, /media/…, https://…).

const PDFJS = "/vendor/pdfjs/";
let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) pdfjsP = import(PDFJS + "pdf.min.mjs").then((m) => { m.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs"; return m; });
  return pdfjsP;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isDoc = (src) => /^\/api\/doc\/[^/]+$/.test(src);

/* ---------- darabolt dokumentum (Netlify Blobs) ---------- */
function makeChunkTransport(pdfjs, src, manifest) {
  const ps = manifest.partSize;
  const partLen = (n) => Math.min(ps, manifest.size - n * ps);
  const full = new Map();     // teljes darabok (letöltéshez)
  const slices = new Map();   // darabszeletek (olvasáshoz)
  const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error("Hiányzó darab."); return r.arrayBuffer(); }).then((b) => new Uint8Array(b));
  const part = (n) => { if (!full.has(n)) full.set(n, getJSON(`${src}/${n}`)); return full.get(n); };
  const slice = (n, s, e) => {
    if (s === 0 && e === partLen(n)) return part(n);
    if (full.has(n)) return full.get(n).then((b) => b.subarray(s, e));
    const k = `${n}:${s}-${e}`;
    if (!slices.has(k)) slices.set(k, getJSON(`${src}/${n}?from=${s}&to=${e}`));
    return slices.get(k);
  };
  class ChunkTransport extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin, end) {
      const a = Math.floor(begin / ps), b = Math.floor((end - 1) / ps);
      const list = [];
      for (let n = a; n <= b; n++) list.push(slice(n, Math.max(begin, n * ps) - n * ps, Math.min(end, (n + 1) * ps) - n * ps));
      Promise.all(list).then((chunks) => {
        const out = new Uint8Array(end - begin);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        this.onDataRange(begin, out);
      }).catch((err) => console.error(err));
    }
  }
  const t = new ChunkTransport(manifest.size, null);
  t.allParts = async (onProgress) => {
    const bufs = [];
    for (let n = 0; n < manifest.parts; n++) { bufs.push(await part(n)); onProgress && onProgress((n + 1) / manifest.parts); }
    return new Blob(bufs, { type: "application/pdf" });
  };
  return t;
}

async function openDocument(src) {
  const pdfjs = await loadPdfjs();
  const common = { cMapUrl: PDFJS + "cmaps/", cMapPacked: true, standardFontDataUrl: PDFJS + "standard_fonts/", isEvalSupported: false };
  if (isDoc(src)) {
    const manifest = await fetch(src).then((r) => { if (!r.ok) throw new Error("A lapszám nem található."); return r.json(); });
    const transport = makeChunkTransport(pdfjs, src, manifest);
    const doc = await pdfjs.getDocument({ ...common, range: transport, length: manifest.size, rangeChunkSize: 256 * 1024, disableAutoFetch: true, disableStream: true }).promise;
    return { doc, download: (p) => transport.allParts(p), filename: manifest.name || "lapszam.pdf" };
  }
  const doc = await pdfjs.getDocument({ ...common, url: src, disableAutoFetch: true }).promise;
  return { doc, download: async () => (await fetch(src)).blob(), filename: decodeURIComponent(src.split("/").pop() || "lapszam.pdf") };
}

/* ---------- felület ---------- */
let R = null;   // a nyitott olvasó állapota

function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function isOpen() { return !!R; }

export function closeReader() {
  if (!R) return;
  const r = R; R = null;
  r.tasks.forEach((t) => { try { t.cancel(); } catch (e) {} });
  try { r.loaded && r.loaded.doc.destroy(); } catch (e) {}
  window.removeEventListener("keydown", r.onKey, true);
  window.removeEventListener("resize", r.onResize);
  r.root.remove();
  document.documentElement.classList.remove("reader-open");
  if (r.onClose) r.onClose();
}

/**
 * @param {{issues: Array<{title:string,note?:string,pdf:string}>, index:number, page?:number, workTitle?:string, onClose?:Function, onPage?:Function}} o
 */
export async function openReader(o) {
  closeReader();
  const issue = o.issues[o.index];
  const root = el(`<div class="reader" role="dialog" aria-modal="true" aria-label="${esc(issue.title)}">
    <div class="rd-bar">
      <div class="rd-title"><b>${esc(issue.title)}</b>${issue.note ? `<span>${esc(issue.note)}</span>` : ""}</div>
      <div class="rd-tools">
        <span class="rd-pages"><input class="rd-num" type="text" inputmode="numeric" aria-label="Oldal" value="1"><span class="rd-of">/ …</span></span>
        <button type="button" class="rd-btn" data-act="zoom-out" title="Kicsinyítés (−)">−</button>
        <button type="button" class="rd-btn rd-zoomlabel" data-act="fit" title="Teljes oldal">100%</button>
        <button type="button" class="rd-btn" data-act="zoom-in" title="Nagyítás (+)">+</button>
        <button type="button" class="rd-btn rd-spread" data-act="spread" title="Egy oldal / két oldal">▯▯</button>
        <button type="button" class="rd-btn" data-act="download" title="Letöltés">⤓</button>
        ${o.issues.length > 1 ? `<select class="rd-issue" aria-label="Lapszám">${o.issues.map((x, i) => `<option value="${i}"${i === o.index ? " selected" : ""}>${esc(x.title)}</option>`).join("")}</select>` : ""}
        <button type="button" class="rd-btn rd-close" data-act="close" title="Bezárás (Esc)">✕</button>
      </div>
    </div>
    <div class="rd-view" tabindex="-1"><div class="rd-spreadbox"></div></div>
    <button type="button" class="rd-nav rd-prev" data-act="prev" aria-label="Előző oldal">‹</button>
    <button type="button" class="rd-nav rd-next" data-act="next" aria-label="Következő oldal">›</button>
    <div class="rd-foot"><input class="rd-slider" type="range" min="1" max="1" value="1" aria-label="Lapozás"></div>
    <div class="rd-status">Betöltés…</div>
  </div>`);
  document.body.append(root);
  document.documentElement.classList.add("reader-open");

  const view = root.querySelector(".rd-view"), box = root.querySelector(".rd-spreadbox");
  const status = root.querySelector(".rd-status"), num = root.querySelector(".rd-num"), of = root.querySelector(".rd-of");
  const slider = root.querySelector(".rd-slider"), zoomLabel = root.querySelector(".rd-zoomlabel");
  const r = R = {
    root, tasks: new Set(), loaded: null, onClose: o.onClose,
    page: Math.max(1, o.page || 1), count: 0, zoom: 1,
    spread: matchMedia("(min-aspect-ratio: 1/1)").matches && window.innerWidth >= 700,
    sizes: [], gen: 0,
  };
  const setStatus = (t) => { status.textContent = t || ""; status.hidden = !t; };

  // ---- elrendezés: borító külön, utána párosával (mint egy nyomtatott lapszámnál)
  const viewOf = (p) => {
    if (!r.spread || r.count < 3) return [p];
    if (p === 1) return [1];
    const a = p % 2 === 0 ? p : p - 1;
    return a + 1 <= r.count ? [a, a + 1] : [a];
  };
  const step = (dir) => {
    const v = viewOf(r.page);
    let p = dir > 0 ? v[v.length - 1] + 1 : v[0] - 1;
    if (p < 1 || p > r.count) return;
    go(viewOf(p)[0]);
  };
  function go(p) {
    p = Math.min(r.count, Math.max(1, p | 0));
    r.page = viewOf(p)[0];
    draw();
  }

  async function pageSize(n) {
    if (r.sizes[n]) return r.sizes[n];
    const pg = await r.loaded.doc.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    return (r.sizes[n] = { w: vp.width, h: vp.height, pg });
  }

  async function draw() {
    if (!r.loaded || R !== r) return;
    const gen = ++r.gen;
    r.tasks.forEach((t) => { try { t.cancel(); } catch (e) {} });
    r.tasks.clear();
    const pages = viewOf(r.page);
    const last = pages[pages.length - 1];
    num.value = pages.length > 1 ? `${pages[0]}–${last}` : String(pages[0]);
    slider.value = String(r.page);
    root.querySelector(".rd-prev").disabled = pages[0] <= 1;
    root.querySelector(".rd-next").disabled = last >= r.count;
    if (o.onPage) o.onPage(r.page);
    const sizes = await Promise.all(pages.map(pageSize));
    if (gen !== r.gen) return;
    // illesztés: a teljes nézet (egy vagy két oldal) beférjen a képernyőbe
    const gap = pages.length > 1 ? 2 : 0;
    const availW = view.clientWidth - 24, availH = view.clientHeight - 24;
    const totalW = sizes.reduce((s, x) => s + x.w, 0), maxH = Math.max(...sizes.map((x) => x.h));
    const fit = Math.min((availW - gap) / totalW, availH / maxH);
    const scale = fit * r.zoom;
    zoomLabel.textContent = Math.round(r.zoom * 100) + "%";
    view.classList.toggle("zoomed", r.zoom > 1.001);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const frag = document.createDocumentFragment();
    const jobs = [];
    sizes.forEach((sz, i) => {
      const vp = sz.pg.getViewport({ scale });
      const wrap = document.createElement("div");
      wrap.className = "rd-page";
      wrap.style.width = Math.floor(vp.width) + "px"; wrap.style.height = Math.floor(vp.height) + "px";
      wrap.style.setProperty("--scale-factor", String(scale));
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      wrap.append(c);
      const tl = document.createElement("div"); tl.className = "textLayer"; wrap.append(tl);
      frag.append(wrap);
      jobs.push({ sz, vp, c, tl, dpr });
    });
    const keepScroll = r.zoom > 1.001 ? [view.scrollLeft, view.scrollTop] : null;
    box.replaceChildren(frag);
    if (keepScroll && r.keepScroll) { view.scrollLeft = keepScroll[0]; view.scrollTop = keepScroll[1]; }
    else { view.scrollLeft = 0; view.scrollTop = 0; }
    r.keepScroll = false;
    setStatus("");
    const pdfjs = await loadPdfjs();
    await Promise.all(jobs.map(async ({ sz, vp, c, tl, dpr }) => {
      const task = sz.pg.render({ canvasContext: c.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      r.tasks.add(task);
      try { await task.promise; } catch (e) { if (e && e.name !== "RenderingCancelledException") console.error(e); return; }
      r.tasks.delete(task);
      if (gen !== r.gen) return;
      try { await new pdfjs.TextLayer({ textContentSource: sz.pg.streamTextContent(), container: tl, viewport: vp }).render(); } catch (e) {}
    }));
    // a következő oldalak előkészítése (letöltés, elemzés), hogy a lapozás gyors legyen
    if (gen === r.gen) { const nv = viewOf(Math.min(r.count, last + 1)); nv.forEach((n) => n > last && pageSize(n).catch(() => {})); }
  }

  // ---- kezelők
  const zoomBy = (f) => { r.zoom = Math.min(6, Math.max(1, +(r.zoom * f).toFixed(3))); r.keepScroll = true; draw(); };
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "close") closeReader();
    else if (act === "prev") step(-1);
    else if (act === "next") step(1);
    else if (act === "zoom-in") zoomBy(1.25);
    else if (act === "zoom-out") zoomBy(0.8);
    else if (act === "fit") { r.zoom = 1; draw(); }
    else if (act === "spread") { r.spread = !r.spread; root.classList.toggle("single", !r.spread); go(r.page); }
    else if (act === "download" && r.loaded) {
      b.disabled = true;
      try {
        const blob = await r.loaded.download((p) => setStatus(`Letöltés… ${Math.round(p * 100)}%`));
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = r.loaded.filename.replace(/(\.pdf)?$/i, ".pdf");
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      } catch (err) { console.error(err); }
      setStatus(""); b.disabled = false;
    }
  });
  root.classList.toggle("single", !r.spread);
  const sel = root.querySelector(".rd-issue");
  if (sel) sel.addEventListener("change", () => openReader({ ...o, index: +sel.value, page: 1 }));
  num.addEventListener("focus", () => num.select());
  num.addEventListener("keydown", (e) => { if (e.key === "Enter") { const n = parseInt(num.value, 10); if (n) go(n); num.blur(); } e.stopPropagation(); });
  num.addEventListener("blur", () => draw());
  slider.addEventListener("input", () => { num.value = slider.value; });
  slider.addEventListener("change", () => go(+slider.value));
  r.onKey = (e) => {
    if (R !== r || e.target.closest?.("input, select, textarea")) { if (e.key === "Escape") closeReader(); return; }
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); closeReader(); }
    else if (k === "ArrowRight" || k === "PageDown" || (k === " " && r.zoom <= 1.001)) { e.preventDefault(); step(1); }
    else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); step(-1); }
    else if (k === "Home") { e.preventDefault(); go(1); }
    else if (k === "End") { e.preventDefault(); go(r.count); }
    else if (k === "+" || k === "=") { e.preventDefault(); zoomBy(1.25); }
    else if (k === "-") { e.preventDefault(); zoomBy(0.8); }
    else if (k === "0") { e.preventDefault(); r.zoom = 1; draw(); }
  };
  window.addEventListener("keydown", r.onKey, true);
  let rt;
  r.onResize = () => { clearTimeout(rt); rt = setTimeout(draw, 120); };
  window.addEventListener("resize", r.onResize);
  // érintés: vízszintes húzás lapoz (nagyítás nélkül); kattintás a lap melletti üres részre is lapoz
  let tx = null;
  view.addEventListener("touchstart", (e) => { if (e.touches.length === 1) tx = [e.touches[0].clientX, e.touches[0].clientY, Date.now()]; else tx = null; }, { passive: true });
  view.addEventListener("touchend", (e) => {
    if (!tx || r.zoom > 1.001) return;
    const t = e.changedTouches[0], dx = t.clientX - tx[0], dy = t.clientY - tx[1];
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - tx[2] < 800) step(dx < 0 ? 1 : -1);
    tx = null;
  });
  view.addEventListener("click", (e) => {
    if (e.target.closest(".rd-page") || r.zoom > 1.001) return;
    step(e.clientX > view.getBoundingClientRect().left + view.clientWidth / 2 ? 1 : -1);
  });
  view.addEventListener("dblclick", (e) => { if (e.target.closest(".rd-page") && !getSelection().toString()) { r.zoom = r.zoom > 1.001 ? 1 : 2; draw(); } });
  // nagyított lapon egérrel húzható
  let drag = null;
  view.addEventListener("pointerdown", (e) => {
    if (r.zoom <= 1.001 || e.pointerType !== "mouse" || e.button !== 0 || e.altKey) return;
    if (e.target.closest(".textLayer span")) return;   // szövegkijelölés
    drag = [e.clientX, e.clientY, view.scrollLeft, view.scrollTop];
    view.classList.add("dragging");
  });
  window.addEventListener("pointermove", (e) => { if (!drag) return; view.scrollLeft = drag[2] - (e.clientX - drag[0]); view.scrollTop = drag[3] - (e.clientY - drag[1]); });
  window.addEventListener("pointerup", () => { drag = null; view.classList.remove("dragging"); });
  view.focus();

  // ---- betöltés
  try {
    setStatus("Lapszám betöltése…");
    const loaded = await openDocument(issue.pdf);
    if (R !== r) { loaded.doc.destroy(); return; }
    r.loaded = loaded;
    r.count = loaded.doc.numPages;
    of.textContent = "/ " + r.count;
    slider.max = String(r.count);
    if (r.count < 3) root.querySelector(".rd-spread").hidden = true;
    r.page = viewOf(Math.min(r.count, r.page))[0];
    await draw();
  } catch (err) {
    console.error(err);
    if (R === r) setStatus("A lapszám nem tölthető be. " + (err && err.message ? err.message : ""));
  }
}
