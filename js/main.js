import { site } from "./content.js";
import { createOrganism, TINTS } from "./organism.js";

/* ---------- útvonalak ---------- */

const HASH = location.protocol === "file:" || window.SITE_HASH_ROUTING === true;
const link = (path) => (HASH ? "#" + path : path);
const currentPath = () => {
  const raw = HASH ? location.hash.replace(/^#/, "") || "/" : location.pathname;
  return decodeURI(raw).replace(/\/+$/, "") || "/";
};

function resolve(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { type: "home" };
  const cat = site.categories.find((c) => c.slug === parts[0]);
  if (!cat) return { type: "notfound" };
  if (parts.length === 1) return { type: "category", cat };
  const sub = cat.children.find((s) => s.slug === parts[1]);
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

const homeItem = (z) => ({ key: "/", label: site.name, href: link("/"), kind: "nav", tint: tintOf(site.palette), size: z.nav, minR: z.minNav });

function sceneFor(r, W, H) {
  const z = sizes(W);
  if (r.type === "home") {
    const t = tintOf(site.palette);
    return {
      title: site.name, h1: site.name,
      items: [
        { key: "/", label: site.name, kind: "name", tint: t, size: z.name, minR: z.narrow ? 100 : 130 },
        ...site.categories.map((c) => ({ key: "/" + c.slug, label: c.title, href: link("/" + c.slug), kind: "child", upper: true, tint: tintOf(c.palette), size: z.center, minR: z.minChild * 1.9 })),
        ...drifters(t, W, true),
      ],
      cx: W / 2, cy: H * (z.narrow ? 0.34 : 0.4),
      startAngle: Math.PI / 2, spread: site.categories.length > 2 ? Math.PI * 1.1 : Math.PI * 0.55,
    };
  }
  if (r.type === "category") {
    const { cat } = r, t = tintOf(cat.palette), base = "/" + cat.slug;
    return {
      title: `${cat.title} — ${site.name}`, h1: cat.title,
      items: [
        { key: base, label: cat.title, kind: "center", tint: t, size: z.center, minR: z.minChild * 1.2 },
        ...cat.children.map((s) => ({ key: `${base}/${s.slug}`, label: s.title, href: link(`${base}/${s.slug}`), kind: "child", tint: t, size: z.child, minR: z.minChild })),
        homeItem(z),
        ...drifters(t, W),
      ],
      startAngle: -Math.PI / 2 + 0.3,
    };
  }
  if (r.type === "sub") {
    const { cat, sub } = r, t = tintOf(cat.palette), base = `/${cat.slug}/${sub.slug}`;
    return {
      title: `${sub.title} — ${site.name}`, h1: sub.title,
      items: [
        { key: base, label: sub.title, kind: "center", tint: t, size: z.center, minR: z.minChild * 1.1 },
        ...(sub.works || []).map((w) => ({ key: `${base}/${w.slug}`, label: w.title, href: link(`${base}/${w.slug}`), kind: "child", tint: t, size: z.child, minR: z.minChild })),
        { key: "/" + cat.slug, label: cat.title, href: link("/" + cat.slug), kind: "nav", tint: t, size: z.nav, minR: z.minNav },
        homeItem(z),
        ...drifters(t, W),
      ],
      startAngle: -Math.PI / 2 - 0.4,
    };
  }
  if (r.type === "work") {
    const { cat, sub, work } = r, t = tintOf(cat.palette), base = `/${cat.slug}/${sub.slug}`;
    const panel = z.narrow
      ? (() => { const hh = (H * 0.54 - 12) / 2; return { x: W / 2, y: H - 12 - hh, hw: W / 2 - 12, hh, tint: t }; })()
      : (() => { const hw = Math.min(400, W * 0.27); return { x: W - 24 - hw - Math.max(0, W * 0.08 - 40), y: H * 0.52, hw, hh: H * 0.42, tint: t }; })();
    return {
      title: `${work.title} — ${site.name}`, h1: work.title, panel, work,
      items: [
        { key: `${base}/${work.slug}`, label: work.title, kind: "center", tint: t, size: z.center * 0.85, minR: z.minChild },
        { key: base, label: sub.title, href: link(base), kind: "nav", tint: t, size: z.nav, minR: z.minNav },
        { key: "/" + cat.slug, label: cat.title, href: link("/" + cat.slug), kind: "nav", tint: t, size: z.nav, minR: z.minNav },
        homeItem(z),
        ...(sub.works || []).filter((w) => w !== work).map((w) => ({ key: `${base}/${w.slug}`, label: w.title, href: link(`${base}/${w.slug}`), kind: "child", tint: t, size: z.child * 0.8, minR: z.minChild * 0.75 })),
        ...drifters(t, W).slice(0, z.narrow ? 4 : 7),
      ],
      startAngle: z.narrow ? -Math.PI / 2 : Math.PI,
    };
  }
  return {
    title: `Nincs ilyen oldal — ${site.name}`, h1: "Nincs ilyen oldal",
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
  if (r.type === "category") { r.cat.children.forEach((s) => add(s.title, `/${r.cat.slug}/${s.slug}`)); add(site.name, "/"); }
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
