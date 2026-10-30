import { createOrganism, TINTS, applySettings } from "./organism.js";

/* ---------- tartalom (content.json; az admin előnézetében a piszkozat) ---------- */

let site = { name: "", categories: [], shared: [], contact: {} };
let settings = {};
const PREVIEW = new URLSearchParams(location.search).has("preview");

async function loadContent() {
  if (PREVIEW) {
    try { const d = localStorage.getItem("bm-draft"); if (d) return JSON.parse(d); } catch {}
  }
  // a szerkesztőben elmentett tartalom (Netlify Blobs); ha még nincs, a kezdő content.json
  try {
    const r = await fetch("/api/content", { cache: "no-store" });
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) return await r.json();
  } catch {}
  const r = await fetch("/content.json", { cache: "no-cache" });
  return r.json();
}

const hexRgb = (h) => { const n = parseInt(String(h || "#ffffff").replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const FONT_STACK = { display: "system-ui, sans-serif", body: "Georgia, serif" };

function applyContent(data) {
  site = { ...(data.site || {}), categories: data.categories || [], shared: data.shared || [] };
  settings = data.settings || {};
  shared = site.shared;
  applySettings(settings);
  const f = settings.fonts || {};
  const root = document.documentElement.style;
  root.setProperty("--display", `"${f.display || "Syne"}", ${FONT_STACK.display}`);
  root.setProperty("--body", `"${f.body || "Literata"}", ${FONT_STACK.body}`);
  renderFooter();
  return Promise.race([
    Promise.all([document.fonts.load(`700 30px "${f.display || "Syne"}"`), document.fonts.load(`400 18px "${f.body || "Literata"}"`)]),
    new Promise((r) => setTimeout(r, 1500)),
  ]).catch(() => {});
}

/* ---------- útvonalak ---------- */

const HASH = location.protocol === "file:" || window.SITE_HASH_ROUTING === true;
const link = (path) => (HASH ? "#" + path : path);
const currentPath = () => {
  const raw = HASH ? location.hash.replace(/^#/, "") || "/" : location.pathname;
  return decodeURI(raw).replace(/\/+$/, "") || "/";
};

// egy kategória alkategóriái: a sajátjai és a vele közös (metszetbeli) alkategóriák
let shared = [];
const childrenOf = (cat) => [...cat.children, ...shared.filter((s) => s.in.includes(cat.slug))];
const isShared = (sub) => Array.isArray(sub.in) && sub.in.length > 1;
const catBySlug = (slug) => site.categories.find((c) => c.slug === slug);

function resolve(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { type: "home" };
  const cat = catBySlug(parts[0]);
  if (!cat) return { type: "notfound" };
  if (parts.length === 1) return { type: "category", cat };
  const sub = childrenOf(cat).find((s) => s.slug === parts[1]);
  if (!sub) return { type: "notfound" };
  if (parts.length === 2) return { type: "sub", cat, sub };
  const work = (sub.works || []).find((w) => w.slug === parts[2]);
  if (!work || parts.length > 3) return { type: "notfound" };
  return { type: "work", cat, sub, work };
}

const tintOf = (palette) => TINTS[palette] ?? 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- jelenetek ---------- */

function sizes(W) {
  const narrow = W < 640;
  return {
    narrow,
    name: narrow ? clamp(W / 11, 26, 36) : clamp(W / 25, 36, 64),
    center: narrow ? 23 : 34,
    child: narrow ? 17 : 22,
    nav: narrow ? 12 : 14,
    minChild: narrow ? 56 : 84,
    minNav: narrow ? 38 : 50,
  };
}

// lebegő kristályok különböző mélységben (a mélységet a sorszám adja, l. organism.js)
function drifters(tint, W, multi = false) {
  const n = W < 640 ? 6 : 9;
  return Array.from({ length: n }, (_, i) => ({ key: "drift" + i, kind: "drift", tint: multi ? [0, 1, 2][i % 3] : tint, r: (W < 640 ? 15 : 20) + ((i * 37) % 21) }));
}

// az almenük egyszínű árnyalata (a beállításokból)
const paletteOf = (name) => (settings.palettes || {})[name] || {};
const monoOf = (cat, sub) => hexRgb(sub && isShared(sub) ? settings.sharedMono || "#eb5ce0" : paletteOf(cat.palette).mono || paletteOf("titan").mono || "#d1dbf2");

// állandó kulcsok: ugyanaz a sejt oldalváltáskor átúszik az új helyére
const subKey = (cat, sub) => (isShared(sub) ? "~" + sub.slug : `/${cat.slug}/${sub.slug}`);
const subHref = (cat, sub) => link(`/${cat.slug}/${sub.slug}`);


// halmazközéppontok: két halmaz egymás mellett (mobilon egymás alatt), több esetén körben
function setCenters(n, W, H, z, cy) {
  if (n === 1) return [{ x: W / 2, y: cy }];
  if (n === 2) return z.narrow
    ? [{ x: W / 2, y: H * 0.38 }, { x: W / 2, y: H * 0.8 }]
    : [{ x: W * 0.3, y: cy }, { x: W * 0.7, y: cy }];
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: W / 2 + Math.cos(a) * W * 0.24, y: cy + Math.sin(a) * H * 0.24 };
  });
}

function sceneFor(r, W, H) {
  const z = sizes(W);
  if (r.type === "home") {
    const t = tintOf(site.palette);
    const cats = site.categories;
    const C = setCenters(cats.length, W, H, z, H * 0.6);
    const items = [{ key: "/", label: site.name, kind: "name", tint: t, size: z.name * 0.72, minR: z.narrow ? 70 : 90 }];
    cats.forEach((c, k) => {
      items.push({ key: "/" + c.slug, label: c.title, href: link("/" + c.slug), kind: "center", tint: tintOf(c.palette), size: z.center * 0.85, minR: z.minChild * 1.1, sets: [k], nucleus: k });
      c.children.forEach((s) => items.push({ key: subKey(c, s), label: s.title, href: subHref(c, s), kind: "child", tint: tintOf(c.palette), size: z.child * 0.9, minR: z.minChild * 0.85, sets: [k] }));
    });
    shared.forEach((s) => {
      const ks = s.in.map((slug) => cats.findIndex((c) => c.slug === slug)).filter((k) => k >= 0);
      if (ks.length) items.push({ key: "~" + s.slug, label: s.title, href: subHref(cats[ks[0]], s), kind: "child", tint: 0, size: z.child * 0.9, minR: z.minChild * 0.9, sets: ks });
    });
    items.push(...drifters(t, W, true));
    return {
      title: site.name, h1: site.name, items,
      sets: cats.map((c, k) => ({ ...C[k], tint: tintOf(c.palette) })),
      anchors: { "/": z.narrow ? { x: W / 2, y: H * 0.1 } : { x: W / 2, y: H * 0.15 } },
      comp: { x: W / 2, y: H * 0.56 }, maxGrow: 1.15,
    };
  }
  // menükben: a menü neve a felső útvonalsávba kerül (Bordás Máté › Irodalom › …),
  // a térben csak az almenük maradnak, egy tömör csoportban
  const top = z.narrow ? 74 : 64;
  if (r.type === "category") {
    const { cat } = r, t = tintOf(cat.palette);
    // a kategória halmaza középen, a vele metsző halmazok a szélén
    const others = site.categories.filter((c) => c !== cat && shared.some((s) => s.in.includes(cat.slug) && s.in.includes(c.slug)));
    const sets = [{ x: z.narrow ? W / 2 : W * (others.length ? 0.42 : 0.5), y: H * (z.narrow ? (others.length ? 0.44 : 0.52) : 0.54), tint: t }];
    others.forEach((c, i) => sets.push(z.narrow
      ? { x: W / 2, y: H * 0.93, tint: tintOf(c.palette) }
      : { x: W * 0.9, y: H * (0.54 + (i - (others.length - 1) / 2) * 0.35), tint: tintOf(c.palette) }));
    const items = [
      ...cat.children.map((s) => ({ key: subKey(cat, s), label: s.title, href: subHref(cat, s), kind: "child", tint: t, size: z.child, minR: z.minChild, sets: [0] })),
      ...shared.filter((s) => s.in.includes(cat.slug)).map((s) => ({
        key: "~" + s.slug, label: s.title, href: subHref(cat, s), kind: "child", tint: t, size: z.child, minR: z.minChild,
        sets: [0, ...others.map((c, i) => (s.in.includes(c.slug) ? i + 1 : -1)).filter((k) => k > 0)],
      })),
      ...others.map((c, i) => ({ key: "/" + c.slug, label: c.title, href: link("/" + c.slug), kind: "nav", tint: tintOf(c.palette), size: z.nav, minR: z.minNav * 1.1, sets: [i + 1], nucleus: i + 1 })),
      ...drifters(t, W),
    ];
    return { title: `${cat.title} — ${site.name}`, h1: cat.title, items, sets, monoTint: monoOf(cat), startAngle: -Math.PI / 2, topInset: top, maxGrow: 1.15 };
  }
  if (r.type === "sub") {
    const { cat, sub } = r, t = tintOf(cat.palette), key = subKey(cat, sub);
    const works = sub.works || [];
    const workItems = (sets) => works.map((w) => ({ key: `${key}/${w.slug}`, label: w.title, href: link(`/${cat.slug}/${sub.slug}/${w.slug}`), kind: "child", tint: t, size: z.child, minR: z.minChild, sets }));
    if (isShared(sub)) {
      // közös alkategória: a művek a metszetben, a két kategória a két szélen
      const cats = sub.in.map(catBySlug).filter(Boolean);
      const C = setCenters(cats.length, W, H, z, H * 0.56).map((c) => (z.narrow ? c : { x: c.x < W / 2 ? W * 0.14 : W * 0.86, y: c.y }));
      const items = [
        ...workItems(cats.map((_, k) => k)),
        ...cats.map((c, k) => ({ key: "/" + c.slug, label: c.title, href: link("/" + c.slug), kind: "nav", tint: tintOf(c.palette), size: z.nav, minR: z.minNav * 1.1, sets: [k], nucleus: k })),
        ...drifters(t, W),
      ];
      return { title: `${sub.title} — ${site.name}`, h1: sub.title, items, sets: cats.map((c, k) => ({ ...C[k], tint: tintOf(c.palette) })), monoTint: monoOf(cat, sub), topInset: top };
    }
    return {
      title: `${sub.title} — ${site.name}`, h1: sub.title, items: [...workItems([0]), ...drifters(t, W)],
      sets: [{ x: W / 2, y: H * 0.55, tint: t }], monoTint: monoOf(cat, sub), startAngle: -Math.PI / 2, topInset: top, maxGrow: 1.2,
    };
  }
  if (r.type === "work") {
    const { cat, sub, work } = r, t = tintOf(cat.palette), key = subKey(cat, sub);
    const panel = z.narrow
      ? (() => { const hh = (H * 0.54 - 12) / 2; return { x: W / 2, y: H - 12 - hh, hw: W / 2 - 12, hh, tint: t }; })()
      : (() => { const hw = Math.min(400, W * 0.27); return { x: W - 24 - hw - Math.max(0, W * 0.08 - 40), y: H * 0.54, hw, hh: H * 0.4, tint: t }; })();
    // az alkategória összes műve együtt marad; az éppen megnyitott kiemelve
    const items = [
      ...(sub.works || []).map((w) => w === work
        ? { key: `${key}/${w.slug}`, label: w.title, kind: "child", active: true, tint: t, size: z.child * 0.9, minR: z.minChild * 0.85, sets: [0] }
        : { key: `${key}/${w.slug}`, label: w.title, href: link(`/${cat.slug}/${sub.slug}/${w.slug}`), kind: "child", tint: t, size: z.child * 0.8, minR: z.minChild * 0.75, sets: [0] }),
      ...drifters(t, W).slice(0, z.narrow ? 4 : 7),
    ];
    return {
      title: `${work.title} — ${site.name}`, h1: work.title, panel, work, items,
      sets: [{ x: z.narrow ? W / 2 : (panel.x - panel.hw) * 0.56, y: z.narrow ? (top + panel.y - panel.hh) / 2 : H * 0.5, tint: t }], maxGrow: 0.85,
      monoTint: monoOf(cat, sub), startAngle: -Math.PI / 2, topInset: top,
    };
  }
  return {
    title: `Nincs ilyen oldal — ${site.name}`, h1: "Nincs ilyen oldal", monoTint: hexRgb(paletteOf("titan").mono || "#d1dbf2"),
    items: [
      { key: "/404", label: "Ez a sejt még nem nőtt ki", kind: "center", tint: 0, size: z.center * 0.8, minR: z.minChild },
      ...drifters(0, W),
    ],
    topInset: z.narrow ? 74 : 64,
  };
}

function workBody(cat, sub, w) {
  let h = "";
  h += `<h2 class="work-title">${esc(w.title)}</h2>`;
  if (w.meta) h += `<p class="meta">${esc(w.meta)}</p>`;
  if (w.image) h += `<figure class="figure"><img src="${esc(w.image)}" alt="${esc(w.title)}" loading="lazy"></figure>`;
  for (const p of w.about || []) h += `<p class="about">${esc(p)}</p>`;
  if (w.poem) h += `<div class="poem">${esc(w.poem)}</div>`;
  if (w.audio) h += `<audio class="audio" controls preload="none" src="${esc(w.audio)}"></audio>`;
  if (w.embed) h += `<div class="embed"><iframe src="${esc(w.embed)}" title="${esc(w.title)}" loading="lazy" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>`;
  if (w.links?.length) h += `<ul class="links">${w.links.map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join("")}</ul>`;
  if (w.entries?.length) {
    // tételek évenként, a legfrissebb elöl
    const years = new Map();
    w.entries.forEach((e) => { const y = String(e.year || "").trim() || "—"; if (!years.has(y)) years.set(y, []); years.get(y).push(e); });
    const order = [...years.keys()].sort((a, b) => (parseInt(b) || 0) - (parseInt(a) || 0));
    if (w.entriesTitle) h += `<h3 class="entries-title">${esc(w.entriesTitle)}</h3>`;
    h += `<p class="entries-count">${w.entries.length} tétel</p>`;
    h += order.map((y) => `<section class="year"><h4>${esc(y)}</h4><ul class="entries">${years.get(y).map((e) => `
      <li>
        <span class="e-title">${esc(e.title || "")}</span>
        ${e.source ? `<span class="e-source">${esc(e.source)}</span>` : ""}
        ${e.note ? `<span class="e-note">${esc(e.note)}</span>` : ""}
        ${e.link ? `<a class="e-link" href="${esc(e.link)}" target="_blank" rel="noopener">megnyitás ↗</a>` : ""}
      </li>`).join("")}</ul></section>`).join("");
  }
  return h;
}

/* ---------- oldal ---------- */

const canvas = document.getElementById("surface");
const cells = document.getElementById("cells");
const panelEl = document.getElementById("panel");
const a11y = document.getElementById("a11y");

let org = null;
try { org = createOrganism(canvas, cells, { onNavigate: (href) => go(href) }); } catch (e) { console.error(e); }
if (!org) document.documentElement.classList.add("no-gl");

function a11yLinks(r) {
  const out = [];
  const add = (t, p) => out.push(`<li><a href="${esc(link(p))}">${esc(t)}</a></li>`);
  if (r.type === "home") site.categories.forEach((c) => add(c.title, "/" + c.slug));
  if (r.type === "home") shared.forEach((s) => add(s.title, `/${s.in[0]}/${s.slug}`));
  if (r.type === "category") { childrenOf(r.cat).forEach((s) => add(s.title, `/${r.cat.slug}/${s.slug}`)); add(site.name, "/"); }
  if (r.type === "sub" || r.type === "work") {
    (r.sub.works || []).forEach((w) => add(w.title, `/${r.cat.slug}/${r.sub.slug}/${w.slug}`));
    add(r.cat.title, "/" + r.cat.slug); add(site.name, "/");
  }
  if (r.type === "notfound") add(site.name, "/");
  return out.join("");
}

let currentWorkKey = null;

// a felső útvonalsáv: Bordás Máté › menü › almenü › mű (minden szint kattintható, az utolsó az aktuális)
function crumbsFor(r) {
  if (r.type === "home") return null;
  const L = (text, path) => ({ text, href: link(path) });
  const out = [L(site.name, "/")];
  if (r.type === "notfound") return [...out, { text: "Nincs ilyen oldal" }];
  if (r.sub && isShared(r.sub)) {
    // közös alkategória: mindkét halmaz neve, a metszet jelével
    out.push({ group: r.sub.in.map(catBySlug).filter(Boolean).map((c) => L(c.title, "/" + c.slug)) });
  } else out.push(L(r.cat.title, "/" + r.cat.slug));
  if (r.sub) out.push(L(r.sub.title, `/${r.cat.slug}/${r.sub.slug}`));
  if (r.work) out.push(L(r.work.title, `/${r.cat.slug}/${r.sub.slug}/${r.work.slug}`));
  delete out[out.length - 1].href; // az aktuális szint nem link
  return out;
}
function renderCrumbs(r) {
  const el = document.getElementById("crumbs");
  const c = crumbsFor(r);
  el.hidden = !c;
  if (!c) { el.innerHTML = ""; return; }
  const item = (x, i) => {
    if (x.group) return `<span class="crumb crumb-group">${x.group.map((g) => `<a href="${esc(g.href)}">${esc(g.text)}</a>`).join('<span class="crumb-cap" aria-label="és">∩</span>')}</span>`;
    const cls = i === 0 ? "crumb crumb-home" : x.href ? "crumb" : "crumb crumb-here";
    return x.href ? `<a class="${cls}" href="${esc(x.href)}">${esc(x.text)}</a>` : `<span class="${cls}" aria-current="page">${esc(x.text)}</span>`;
  };
  el.innerHTML = c.map(item).join('<span class="crumb-sep" aria-hidden="true">›</span>');
}

function render() {
  if (PREVIEW && window.parent !== window) window.parent.postMessage({ type: "bm-path", path: currentPath() }, location.origin);
  const r = resolve(currentPath());
  const W = window.innerWidth, H = window.innerHeight;
  const sc = sceneFor(r, W, H);
  document.title = sc.title;
  a11y.innerHTML = `<h1>${esc(sc.h1)}</h1><nav aria-label="Oldalak"><ul>${a11yLinks(r)}</ul></nav>`;

  sc.mono = r.type !== "home";
  renderCrumbs(r);
  if (org) org.setScene(sc);
  else cells.innerHTML = `<div class="fallback"><p class="fb-name">${esc(site.name)}</p><ul>${a11yLinks(r)}</ul></div>`;

  // szövegpanel
  if (sc.panel) {
    const p = sc.panel, inset = 14;
    Object.assign(panelEl.style, {
      left: p.x - p.hw + inset + "px", top: p.y - p.hh + inset + "px",
      width: p.hw * 2 - inset * 2 + "px", height: p.hh * 2 - inset * 2 + "px",
    });
    const key = currentPath();
    if (key !== currentWorkKey) {
      currentWorkKey = key;
      panelEl.classList.remove("show");
      setTimeout(() => {
        panelEl.innerHTML = workBody(r.cat, r.sub, r.work);
        panelEl.scrollTop = 0;
        panelEl.classList.add("show");
      }, panelEl.innerHTML ? 260 : 420);
    }
  } else {
    currentWorkKey = null;
    panelEl.classList.remove("show");
  }
}

function go(path) {
  if (path === (HASH ? "#" + currentPath() : currentPath())) return;
  if (HASH) location.hash = path.replace(/^#/, "");
  else { history.pushState(null, "", path); render(); }
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = a.getAttribute("href");
  if (!href || a.target === "_blank") return;
  if ((HASH && href.startsWith("#/")) || (!HASH && href.startsWith("/"))) {
    e.preventDefault();
    if (org && a.classList.contains("cell-label")) {
      const rc = a.getBoundingClientRect();
      org.ripple(rc.left + rc.width / 2, rc.top + rc.height / 2, 1);
    }
    go(href);
  }
});
window.addEventListener(HASH ? "hashchange" : "popstate", render);

let rt;
window.addEventListener("resize", () => {
  clearTimeout(rt);
  rt = setTimeout(() => { if (org) org.resize(); render(); }, 150);
});

/* ---------- lábléc ---------- */

function renderFooter() {
  const c = site.contact || {};
  document.getElementById("foot").innerHTML = [
    c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "",
    ...(c.links || []).map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`),
    `© ${new Date().getFullYear()} ${esc(site.name)}`,
  ].filter(Boolean).join('<span aria-hidden="true"> · </span>');
}

/* ---------- élő előnézet az admin felületen ---------- */

if (PREVIEW) {
  document.documentElement.classList.add("preview");
  window.addEventListener("message", async (e) => {
    if (e.origin !== location.origin || !e.data) return;
    const m = e.data;
    if (m.type === "bm-content") { currentWorkKey = null; await applyContent(m.content); render(); }
    if (m.type === "bm-go" && m.path) go(link(m.path));
    if (m.type === "bm-glitch" && org) org.burst({ full: true, power: 1, dur: 600 });
  });
}

loadContent()
  .then(applyContent)
  .then(render)
  .then(() => { if (PREVIEW && window.parent !== window) window.parent.postMessage({ type: "bm-ready" }, location.origin); })
  .catch((err) => {
    console.error(err);
    document.getElementById("cells").innerHTML = '<div class="fallback"><p class="fb-name">A tartalom nem tölthető be.</p></div>';
  });
