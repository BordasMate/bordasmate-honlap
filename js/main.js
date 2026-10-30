import { site } from "./content.js";
import { createOrganism, TINTS } from "./organism.js";

/* ---------- útvonalak ---------- */

const HASH = location.protocol === "file:" || window.SITE_HASH_ROUTING === true;
const link = (path) => (HASH ? "#" + path : path);
const currentPath = () => {
  const raw = HASH ? location.hash.replace(/^#/, "") || "/" : location.pathname;
  return decodeURI(raw).replace(/\/+$/, "") || "/";
};

// egy kategória alkategóriái: a sajátjai és a vele közös (metszetbeli) alkategóriák
const shared = site.shared || [];
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

// az almenük egyszínű árnyalata
const MONO = { titan: [0.82, 0.86, 0.95], rez: [1.0, 0.5, 0.24], kobalt: [0.3, 0.56, 1.0], zoldarany: [0.7, 0.95, 0.3] };
const MONO_SHARED = [0.92, 0.36, 0.88];
const monoOf = (cat, sub) => (sub && isShared(sub) ? MONO_SHARED : MONO[cat.palette] || MONO.titan);

// állandó kulcsok: ugyanaz a sejt oldalváltáskor átúszik az új helyére
const subKey = (cat, sub) => (isShared(sub) ? "~" + sub.slug : `/${cat.slug}/${sub.slug}`);
const subHref = (cat, sub) => link(`/${cat.slug}/${sub.slug}`);

const homeItem = (z) => ({ key: "/", label: site.name, href: link("/"), kind: "nav", tint: tintOf(site.palette), size: z.nav, minR: z.minNav });
const homeCorner = (W, H, z) => ({ "/": z.narrow ? { x: W * 0.2, y: H * 0.06 } : { x: W * 0.08, y: H * 0.1 } });

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
  if (r.type === "category") {
    const { cat } = r, t = tintOf(cat.palette);
    // a kategória halmaza középen, a vele metsző halmazok a szélén
    const others = site.categories.filter((c) => c !== cat && shared.some((s) => s.in.includes(cat.slug) && s.in.includes(c.slug)));
    const sets = [{ x: z.narrow ? W / 2 : W * (others.length ? 0.42 : 0.5), y: H * (z.narrow ? (others.length ? 0.4 : 0.48) : 0.5), tint: t }];
    others.forEach((c, i) => sets.push(z.narrow
      ? { x: W / 2, y: H * 0.92, tint: tintOf(c.palette) }
      : { x: W * 0.9, y: H * (0.5 + (i - (others.length - 1) / 2) * 0.35), tint: tintOf(c.palette) }));
    const items = [
      { key: "/" + cat.slug, label: cat.title, kind: "center", tint: t, size: z.center, minR: z.minChild * 1.2, sets: [0], nucleus: 0 },
      ...cat.children.map((s) => ({ key: subKey(cat, s), label: s.title, href: subHref(cat, s), kind: "child", tint: t, size: z.child, minR: z.minChild, sets: [0] })),
      ...shared.filter((s) => s.in.includes(cat.slug)).map((s) => ({
        key: "~" + s.slug, label: s.title, href: subHref(cat, s), kind: "child", tint: t, size: z.child, minR: z.minChild,
        sets: [0, ...others.map((c, i) => (s.in.includes(c.slug) ? i + 1 : -1)).filter((k) => k > 0)],
      })),
      ...others.map((c, i) => ({ key: "/" + c.slug, label: c.title, href: link("/" + c.slug), kind: "nav", tint: tintOf(c.palette), size: z.nav, minR: z.minNav * 1.1, sets: [i + 1], nucleus: i + 1 })),
      homeItem(z),
      ...drifters(t, W),
    ];
    return { title: `${cat.title} — ${site.name}`, h1: cat.title, items, sets, anchors: homeCorner(W, H, z), monoTint: monoOf(cat), startAngle: -Math.PI / 2 + 0.3 };
  }
  if (r.type === "sub") {
    const { cat, sub } = r, t = tintOf(cat.palette), key = subKey(cat, sub);
    const works = sub.works || [];
    if (isShared(sub)) {
      // közös alkategória: minden a metszetben, a két kategória a két szélen
      const cats = sub.in.map(catBySlug).filter(Boolean);
      const C = setCenters(cats.length, W, H, z, H * 0.52).map((c) => (z.narrow ? c : { x: c.x < W / 2 ? W * 0.14 : W * 0.86, y: c.y }));
      const all = cats.map((_, k) => k);
      const items = [
        { key, label: sub.title, kind: "center", tint: t, size: z.center, minR: z.minChild * 1.1, sets: all },
        ...works.map((w) => ({ key: `${key}/${w.slug}`, label: w.title, href: link(`/${cat.slug}/${sub.slug}/${w.slug}`), kind: "child", tint: t, size: z.child, minR: z.minChild, sets: all })),
        ...cats.map((c, k) => ({ key: "/" + c.slug, label: c.title, href: link("/" + c.slug), kind: "nav", tint: tintOf(c.palette), size: z.nav, minR: z.minNav * 1.1, sets: [k], nucleus: k })),
        homeItem(z),
        ...drifters(t, W),
      ];
      return { title: `${sub.title} — ${site.name}`, h1: sub.title, items, sets: cats.map((c, k) => ({ ...C[k], tint: tintOf(c.palette) })), anchors: homeCorner(W, H, z), monoTint: monoOf(cat, sub) };
    }
    const items = [
      { key, label: sub.title, kind: "center", tint: t, size: z.center, minR: z.minChild * 1.1, sets: [0], nucleus: 0 },
      ...works.map((w) => ({ key: `${key}/${w.slug}`, label: w.title, href: link(`/${cat.slug}/${sub.slug}/${w.slug}`), kind: "child", tint: t, size: z.child, minR: z.minChild, sets: [0] })),
      { key: "/" + cat.slug, label: cat.title, href: link("/" + cat.slug), kind: "nav", tint: t, size: z.nav, minR: z.minNav, sets: [0] },
      homeItem(z),
      ...drifters(t, W),
    ];
    return { title: `${sub.title} — ${site.name}`, h1: sub.title, items, sets: [{ x: W / 2, y: H * 0.5, tint: t }], anchors: homeCorner(W, H, z), monoTint: monoOf(cat, sub), startAngle: -Math.PI / 2 - 0.4 };
  }
  if (r.type === "work") {
    const { cat, sub, work } = r, t = tintOf(cat.palette), key = subKey(cat, sub);
    const panel = z.narrow
      ? (() => { const hh = (H * 0.54 - 12) / 2; return { x: W / 2, y: H - 12 - hh, hw: W / 2 - 12, hh, tint: t }; })()
      : (() => { const hw = Math.min(400, W * 0.27); return { x: W - 24 - hw - Math.max(0, W * 0.08 - 40), y: H * 0.52, hw, hh: H * 0.42, tint: t }; })();
    const items = [
      { key: `${key}/${work.slug}`, label: work.title, kind: "center", tint: t, size: z.center * 0.85, minR: z.minChild, sets: [0], nucleus: 0 },
      { key, label: sub.title, href: subHref(cat, sub), kind: "nav", tint: t, size: z.nav, minR: z.minNav, sets: [0] },
      { key: "/" + cat.slug, label: cat.title, href: link("/" + cat.slug), kind: "nav", tint: t, size: z.nav, minR: z.minNav, sets: [0] },
      homeItem(z),
      ...(sub.works || []).filter((w) => w !== work).map((w) => ({ key: `${key}/${w.slug}`, label: w.title, href: link(`/${cat.slug}/${sub.slug}/${w.slug}`), kind: "child", tint: t, size: z.child * 0.8, minR: z.minChild * 0.75, sets: [0] })),
      ...drifters(t, W).slice(0, z.narrow ? 4 : 7),
    ];
    return {
      title: `${work.title} — ${site.name}`, h1: work.title, panel, work, items,
      sets: [{ x: W * 0.22, y: H * 0.45, tint: t }], anchors: homeCorner(W, H, z), monoTint: monoOf(cat, sub),
      startAngle: z.narrow ? -Math.PI / 2 : Math.PI,
    };
  }
  return {
    title: `Nincs ilyen oldal — ${site.name}`, h1: "Nincs ilyen oldal", monoTint: MONO.titan,
    items: [
      { key: "/404", label: "Ez a sejt még nem nőtt ki", kind: "center", tint: 0, size: z.center * 0.8, minR: z.minChild },
      homeItem(z),
      ...drifters(0, W),
    ],
  };
}

function workBody(cat, sub, w) {
  let h = `<p class="crumbs"><a href="${link("/" + cat.slug)}">${esc(cat.title)}</a><span aria-hidden="true">/</span><a href="${link(`/${cat.slug}/${sub.slug}`)}">${esc(sub.title)}</a></p>`;
  h += `<h2 class="work-title">${esc(w.title)}</h2>`;
  if (w.meta) h += `<p class="meta">${esc(w.meta)}</p>`;
  if (w.image) h += `<figure class="figure"><img src="${esc(w.image)}" alt="${esc(w.title)}" loading="lazy"></figure>`;
  for (const p of w.about || []) h += `<p class="about">${esc(p)}</p>`;
  if (w.poem) h += `<div class="poem">${esc(w.poem)}</div>`;
  if (w.audio) h += `<audio class="audio" controls preload="none" src="${esc(w.audio)}"></audio>`;
  if (w.embed) h += `<div class="embed"><iframe src="${esc(w.embed)}" title="${esc(w.title)}" loading="lazy" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>`;
  if (w.links?.length) h += `<ul class="links">${w.links.map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join("")}</ul>`;
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

function render() {
  const r = resolve(currentPath());
  const W = window.innerWidth, H = window.innerHeight;
  const sc = sceneFor(r, W, H);
  document.title = sc.title;
  a11y.innerHTML = `<h1>${esc(sc.h1)}</h1><nav aria-label="Oldalak"><ul>${a11yLinks(r)}</ul></nav>`;

  sc.mono = r.type !== "home";
  if (org) org.setScene(sc);
  else cells.innerHTML = `<div class="fallback"><p class="fb-name">${esc(site.name)}</p><ul>${a11yLinks(r)}</ul></div>`;

  // szövegpanel
  if (sc.panel) {
    const p = sc.panel, inset = 30;
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

const c = site.contact || {};
document.getElementById("foot").innerHTML = [
  c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "",
  ...(c.links || []).map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`),
  `© ${new Date().getFullYear()} ${esc(site.name)}`,
].filter(Boolean).join('<span aria-hidden="true"> · </span>');

Promise.race([
  Promise.all([document.fonts.load("700 30px Syne"), document.fonts.load("400 18px Literata")]),
  new Promise((r) => setTimeout(r, 1500)),
]).finally(render);
