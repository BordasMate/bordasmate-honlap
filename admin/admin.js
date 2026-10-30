// A honlap szerkesztője: a tartalmat szerkeszti élő előnézettel, és egy jelszóval védett
// Netlify Functionön keresztül közvetlenül a honlap tárhelyére (Netlify Blobs) menti.
// A mentés azonnal él, újraépítés és GitHub nélkül.

const LS_DRAFT = "bm-draft";
const LS_PASS = "bm-admin-pass";
const SS_PASS = "bm-admin-pass";

const FONTS = {
  display: ["Syne", "Unbounded", "Bricolage Grotesque", "Space Grotesk", "Fraunces"],
  body: ["Literata", "Newsreader", "Source Serif 4", "Space Grotesk"],
};
const PALETTE_KEYS = ["titan", "rez", "kobalt", "zoldarany"];
const DEFAULTS = {
  palettes: {
    titan: { label: "Titán (nyitóoldal)", metal: "#ccccdb", glow: "#bf8cff", mono: "#d1dbf2", iridescence: 0.55 },
    rez: { label: "Réz", metal: "#fa8c52", glow: "#ff598c", mono: "#ff803d", iridescence: 0.38 },
    kobalt: { label: "Kobalt", metal: "#668cff", glow: "#33bfff", mono: "#4d8fff", iridescence: 0.62 },
    zoldarany: { label: "Zöldarany", metal: "#b8cc6b", glow: "#bfff4d", mono: "#b3f24d", iridescence: 0.45 },
  },
  sharedMono: "#eb5ce0",
  home: { light: "#fab8ff", depth: "#b85ce6", crystalA: "#ff33c7", crystalB: "#26d9ff" },
  glitch: { enabled: true, minGap: 9000, maxGap: 11000, burstCount: 3, fullChance: 0.5, minLength: 140, maxLength: 420, intensity: 1, onNavigate: true, navigateLength: 420, respectReducedMotion: true },
  texture: { grain: 1, rust: 0.8, metal: 0.55, wood: 0.35, stone: 0.4, clay: 0.3 },
  lidar: { density: 1, pointSize: 1, tintMix: 0.3, relief: 1, pitch: 50, yaw: -22, sway: 1 },
  fonts: { display: "Syne", body: "Literata" },
};

const $ = (s, r = document) => r.querySelector(s);
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let published = null;   // a közzétett content.json
let data = null;        // a szerkesztett változat
let tab = "content";
let sel = { kind: "intro" };
const openNodes = new Set();

/* ---------------- segédek ---------------- */

function slugify(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "uj";
}
function uniqueSlug(base, taken) {
  let s = base, i = 2;
  while (taken.includes(s)) s = `${base}-${i++}`;
  return s;
}
function ensureSettings() {
  data.settings = data.settings || {};
  const st = data.settings;
  st.palettes = st.palettes || {};
  for (const k of PALETTE_KEYS) st.palettes[k] = { ...DEFAULTS.palettes[k], ...(st.palettes[k] || {}) };
  st.sharedMono = st.sharedMono || DEFAULTS.sharedMono;
  st.home = { ...DEFAULTS.home, ...(st.home || {}) };
  st.glitch = { ...DEFAULTS.glitch, ...(st.glitch || {}) };
  st.texture = { ...DEFAULTS.texture, ...(st.texture || {}) };
  st.lidar = { ...DEFAULTS.lidar, ...(st.lidar || {}) };
  st.fonts = { ...DEFAULTS.fonts, ...(st.fonts || {}) };
  data.site = data.site || { name: "", description: "", palette: "titan", contact: { email: "", links: [] } };
  data.site.contact = data.site.contact || { email: "", links: [] };
  data.site.contact.links = data.site.contact.links || [];
  data.categories = data.categories || [];
  data.shared = data.shared || [];
}

function toast(html, kind = "", ms = 4200) {
  const t = $("#toast");
  t.innerHTML = html;
  t.className = "toast " + kind;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}

// h("div.class", {attr}, ...children)
function h(tag, attrs = {}, ...kids) {
  const [name, ...cls] = tag.split(".");
  const el = document.createElement(name);
  if (cls.length) el.className = cls.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

/* ---------------- állapot, előnézet ---------------- */

let previewReady = false;
const frame = () => $("#preview");
function postPreview(msg) {
  const w = frame()?.contentWindow;
  if (w) w.postMessage(msg, location.origin);
}
let pushT;
function changed({ tree = true } = {}) {
  try { localStorage.setItem(LS_DRAFT, JSON.stringify(data)); } catch {}
  const dirty = JSON.stringify(data) !== JSON.stringify(published);
  $("#dirty").hidden = !dirty;
  if (tree) renderTree();
  clearTimeout(pushT);
  pushT = setTimeout(() => {
    postPreview({ type: "bm-content", content: data });
    if (["cat", "sub", "work"].includes(sel.kind)) goPreview(pathOf(sel));
  }, 180);
}
function goPreview(path) { if (path) postPreview({ type: "bm-go", path }); }

window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data) return;
  if (e.data.type === "bm-ready") { previewReady = true; postPreview({ type: "bm-content", content: data }); }
  if (e.data.type === "bm-path") $("#preview-path").textContent = e.data.path;
});

/* ---------------- hivatkozások ---------------- */

const subList = (ref) => (ref.shared ? data.shared : data.categories[ref.ci].children);
const getSub = (ref) => subList(ref)[ref.si];
const getWork = (ref) => getSub(ref).works[ref.wi];
function pathOf(s) {
  if (s.kind === "cat") return "/" + data.categories[s.ci].slug;
  if (s.kind === "sub" || s.kind === "work") {
    const sub = getSub(s);
    const catSlug = s.shared ? (sub.in || [])[0] || (data.categories[0] || {}).slug : data.categories[s.ci].slug;
    const base = `/${catSlug}/${sub.slug}`;
    return s.kind === "work" ? `${base}/${sub.works[s.wi].slug}` : base;
  }
  return "/";
}
function select(s) {
  sel = s;
  renderTree();
  renderEditor();
  if (["cat", "sub", "work"].includes(s.kind)) goPreview(pathOf(s));
  if (s.kind === "site" || s.kind === "intro") goPreview("/");
}

/* ---------------- fa ---------------- */

function palColor(p) { return (data.settings.palettes[p] || {}).metal || "#999"; }

function renderTree() {
  const t = $("#tree");
  t.innerHTML = "";
  if (tab === "look") {
    const items = [["look-colors", "Színek"], ["look-fonts", "Betűtípus"], ["look-texture", "Pontfelhő és kamera"], ["look-glitch", "Glitch"]];
    t.append(h("div.tree-section", {}, h("div.tree-head", {}, "Megjelenés"),
      items.map(([k, label]) => h("button.node" + (sel.kind === k ? ".sel" : ""), { onclick: () => select({ kind: k }) }, label))));
    return;
  }
  if (tab === "site") {
    t.append(h("div.tree-section", {}, h("div.tree-head", {}, "Oldal"),
      h("button.node" + (sel.kind === "site" ? ".sel" : ""), { onclick: () => select({ kind: "site" }) }, "Név, leírás, elérhetőség")));
    return;
  }

  const isSel = (s) => sel.kind === s.kind && ["ci", "si", "wi"].every((k) => (sel[k] ?? null) === (s[k] ?? null)) && !!sel.shared === !!s.shared;

  const workNodes = (ref, sub) => [
    ...(sub.works || []).map((w, wi) => {
      const r = { kind: "work", ...ref, wi };
      return h("button.node.lvl-2" + (isSel(r) ? ".sel" : ""), { onclick: () => select(r), title: w.title },
        h("span.twist", {}, "·"), w.title || "(cím nélkül)",
        w.entries?.length ? h("span.count", {}, `${w.entries.length} tétel`) : null);
    }),
    h("div.add-row", {}, h("button", { onclick: () => addWork(ref) }, "+ mű")),
  ];

  const subNode = (ref, sub, lvlCls, dot) => {
    const key = (ref.shared ? "x" : "c" + ref.ci) + ":" + ref.si;
    const isOpen = openNodes.has(key);
    const r = { kind: "sub", ...ref };
    return [
      h("button.node" + lvlCls + (isSel(r) ? ".sel" : ""), {
        onclick: () => { openNodes.add(key); select(r); },
      },
        h("span.twist", { onclick: (e) => { e.stopPropagation(); isOpen ? openNodes.delete(key) : openNodes.add(key); renderTree(); } }, isOpen ? "▾" : "▸"),
        dot, sub.title || "(cím nélkül)", h("span.count", {}, (sub.works || []).length)),
      isOpen ? workNodes(ref, sub) : null,
    ];
  };

  const cats = h("div.tree-section", {},
    h("div.tree-head", {}, "Kategóriák (halmazok)", h("button.icon", { title: "Új kategória", onclick: addCategory }, "+")),
    data.categories.map((c, ci) => {
      const key = "c" + ci;
      const isOpen = openNodes.has(key);
      const r = { kind: "cat", ci };
      return [
        h("button.node" + (isSel(r) ? ".sel" : ""), { onclick: () => { openNodes.add(key); select(r); } },
          h("span.twist", { onclick: (e) => { e.stopPropagation(); isOpen ? openNodes.delete(key) : openNodes.add(key); renderTree(); } }, isOpen ? "▾" : "▸"),
          h("span.dot", { style: `background:${palColor(c.palette)}` }),
          h("b", {}, c.title || "(cím nélkül)"), h("span.count", {}, (c.children || []).length)),
        isOpen ? [
          (c.children || []).map((sub, si) => subNode({ ci, si, shared: false }, sub, ".lvl-1", null)),
          h("div.add-row.l1", {}, h("button", { onclick: () => addSub(ci) }, "+ alkategória")),
        ] : null,
      ];
    }));

  const sh = h("div.tree-section", {},
    h("div.tree-head", {}, "Közös alkategóriák (metszet)", h("button.icon", { title: "Új közös alkategória", onclick: addShared }, "+")),
    data.shared.length ? null : h("div.list-empty", { style: "padding:2px 8px" }, "Nincs közös alkategória."),
    data.shared.map((sub, si) => subNode({ si, shared: true }, sub, "", h("span.dot", { style: `background:${data.settings.sharedMono}` }))));

  t.append(cats, sh);
}

/* ---------------- hozzáadás, törlés, mozgatás ---------------- */

function addCategory() {
  const slug = uniqueSlug("uj-kategoria", data.categories.map((c) => c.slug));
  data.categories.push({ title: "Új kategória", slug, palette: "zoldarany", children: [] });
  const ci = data.categories.length - 1;
  openNodes.add("c" + ci);
  changed();
  select({ kind: "cat", ci });
}
function addSub(ci) {
  const list = data.categories[ci].children;
  list.push({ title: "Új alkategória", slug: uniqueSlug("uj-alkategoria", list.map((s) => s.slug)), works: [] });
  openNodes.add("c" + ci);
  changed();
  select({ kind: "sub", ci, si: list.length - 1, shared: false });
}
function addShared() {
  const ins = data.categories.slice(0, 2).map((c) => c.slug);
  data.shared.push({ title: "Új közös alkategória", slug: uniqueSlug("uj-kozos", data.shared.map((s) => s.slug)), in: ins, works: [] });
  changed();
  select({ kind: "sub", si: data.shared.length - 1, shared: true });
}
function addWork(ref) {
  const sub = getSub(ref);
  sub.works = sub.works || [];
  sub.works.push({ title: "Új mű", slug: uniqueSlug("uj-mu", sub.works.map((w) => w.slug)), meta: "", about: [] });
  openNodes.add((ref.shared ? "x" : "c" + ref.ci) + ":" + ref.si);
  changed();
  select({ kind: "work", ...ref, wi: sub.works.length - 1 });
}
function moveIn(list, i, d) {
  const j = i + d;
  if (j < 0 || j >= list.length) return i;
  [list[i], list[j]] = [list[j], list[i]];
  return j;
}

/* ---------------- mezők ---------------- */

function textField(label, value, oninput, { type = "text", placeholder = "", help = "", area = false, mono = false, rows } = {}) {
  const input = area
    ? h("textarea" + (mono ? ".mono" : ""), { value: value ?? "", placeholder, rows, oninput: (e) => oninput(e.target.value) })
    : h("input", { type, value: value ?? "", placeholder, oninput: (e) => oninput(e.target.value) });
  return h("label.field", {}, h("span", {}, label), input, help ? h("small", {}, help) : null);
}
function titleSlug(obj, siblings, { onTitle } = {}) {
  const slugInput = h("input", { value: obj.slug || "", oninput: (e) => { obj.slug = slugify(e.target.value) === e.target.value ? e.target.value : e.target.value.toLowerCase(); changed(); } });
  slugInput.addEventListener("change", (e) => { obj.slug = uniqueSlug(slugify(e.target.value), siblings.filter((s) => s !== obj).map((s) => s.slug)); slugInput.value = obj.slug; changed(); });
  const title = h("input", {
    value: obj.title || "",
    oninput: (e) => {
      // csak új elemnél követi a cím a webcímet; a meglévők címe ne törjön el (a ↻ gomb kézzel frissít)
      const wasAuto = !obj.slug || /^uj(-|$)/.test(obj.slug);
      obj.title = e.target.value;
      if (wasAuto) { obj.slug = uniqueSlug(slugify(obj.title), siblings.filter((s) => s !== obj).map((s) => s.slug)); slugInput.value = obj.slug; }
      $(".ed-title") && ($(".ed-title").textContent = obj.title || "(cím nélkül)");
      onTitle && onTitle();
      changed();
    },
  });
  return [
    h("label.field", {}, h("span", {}, "Cím"), title),
    h("label.field", {}, h("span", {}, "Webcím-rész (slug)"),
      h("div.slug-wrap", {}, slugInput, h("button.small", { type: "button", title: "Újragenerálás a címből", onclick: () => { obj.slug = uniqueSlug(slugify(obj.title), siblings.filter((s) => s !== obj).map((s) => s.slug)); slugInput.value = obj.slug; changed(); } }, "↻")),
      h("small", {}, "Csak kisbetű, szám és kötőjel – ez lesz a webcím része. Új elemnél a címből készül; meglévőnél a ↻ gombbal frissíthető (ekkor a régi link megszűnik).")),
  ];
}
function colorField(label, value, oninput) {
  const txt = h("input", { value, oninput: (e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { col.value = e.target.value; oninput(e.target.value); } } });
  const col = h("input", { type: "color", value, oninput: (e) => { txt.value = e.target.value; oninput(e.target.value); } });
  return h("label.field", {}, h("span", {}, label), h("div.color-row", {}, col, txt));
}
function rangeField(label, value, min, max, step, oninput, { help = "", fmt = (v) => v } = {}) {
  const out = h("output", {}, fmt(value));
  const r = h("input", { type: "range", min, max, step, value, oninput: (e) => { out.textContent = fmt(+e.target.value); oninput(+e.target.value); } });
  return h("label.field", {}, h("span", {}, label), h("div.range-row", {}, r, out), help ? h("small", {}, help) : null);
}
function checkField(label, value, onchange) {
  return h("label.check", {}, h("input", { type: "checkbox", checked: !!value, onchange: (e) => onchange(e.target.checked) }), label);
}
function group(title, ...kids) {
  const t = typeof title === "string" ? h("h3", {}, title) : title;
  return h("section.group", {}, t, ...kids);
}

/* ---------------- szerkesztő nézetek ---------------- */

function renderEditor() {
  const ed = $("#editor");
  ed.innerHTML = "";
  const v = {
    intro: viewIntro, cat: viewCategory, sub: viewSub, work: viewWork, site: viewSite,
    "look-colors": viewColors, "look-fonts": viewFonts, "look-texture": viewTexture, "look-glitch": viewGlitch,
  }[sel.kind];
  ed.append(...[].concat((v || viewIntro)()).flat(Infinity).filter(Boolean));
  ed.scrollTop = 0;
}

function head(kicker, title, tools = []) {
  return h("div.ed-head", {}, h("div", {}, h("p.ed-kicker", {}, kicker), h("h1.ed-title", {}, title || "(cím nélkül)")), h("div.ed-tools", {}, tools));
}

function viewIntro() {
  return [
    head("Szerkesztő", data.site.name || "Honlap"),
    group("Hogyan működik?",
      h("p.note", { html: "Bal oldalt a honlap szerkezete: <b>kategóriák</b> (a nagy halmazok), bennük <b>alkategóriák</b>, azokban a <b>művek</b>. A több kategóriához tartozó alkategóriák a <b>Közös alkategóriák</b> között vannak – ezek a halmazok metszetében jelennek meg." }),
      h("p.note", { html: "Minden változás azonnal látszik a jobb oldali <b>élő előnézetben</b>, és ebben a böngészőben piszkozatként megmarad. A honlapon akkor jelenik meg, amikor a <b>Mentés</b> gombra kattintasz – onnantól mindenkinek így látszik, és így is marad." }),
      h("p.note", { html: "Az <b>Előzmények</b> gombbal bármelyik korábbi mentés visszahozható." }),
      h("p.note", { html: "A <b>Megjelenés</b> fülön a színek, a betűtípus, az anyagok (fém, fa, kő, agyag) és a glitch állítható; az <b>Oldal</b> fülön a név és az elérhetőség." }),
    ),
  ];
}

function viewCategory() {
  const c = data.categories[sel.ci];
  const del = () => {
    const sharedUse = data.shared.filter((s) => (s.in || []).includes(c.slug)).length;
    if (!confirm(`Törlöd a(z) „${c.title}” kategóriát az összes alkategóriájával és művével együtt?${sharedUse ? `\n(${sharedUse} közös alkategóriából is kikerül.)` : ""}`)) return;
    data.shared.forEach((s) => (s.in = (s.in || []).filter((x) => x !== c.slug)));
    data.categories.splice(sel.ci, 1);
    changed(); select({ kind: "intro" });
  };
  const move = (d) => { sel.ci = moveIn(data.categories, sel.ci, d); changed(); renderEditor(); };
  const oldSlug = { v: c.slug };
  const slugSync = () => { // a közös alkategóriák hivatkozása kövesse a slug változását
    if (oldSlug.v !== c.slug) { data.shared.forEach((s) => (s.in = (s.in || []).map((x) => (x === oldSlug.v ? c.slug : x)))); oldSlug.v = c.slug; }
  };
  const ts = titleSlug(c, data.categories, { onTitle: slugSync });
  ts[1].addEventListener("input", () => setTimeout(slugSync));
  ts[1].addEventListener("change", () => setTimeout(slugSync));
  return [
    head("Kategória (halmaz)", c.title, [h("button.small", { onclick: () => move(-1) }, "↑"), h("button.small", { onclick: () => move(1) }, "↓"), h("button.small.danger", { onclick: del }, "Törlés")]),
    group("Alapadatok", ...ts,
      h("label.field", {}, h("span", {}, "Színvilág (fém)"),
        h("select", { onchange: (e) => { c.palette = e.target.value; changed(); } },
          PALETTE_KEYS.map((k) => h("option", { value: k, selected: c.palette === k }, data.settings.palettes[k].label || k))),
        h("small", {}, "A nyitóoldalon ez a halmaz színe, az almenükben ez lesz az egyszínű kép árnyalata. A színek a Megjelenés fülön állíthatók."))),
    group(h("h3", {}, "Alkategóriák", h("button.small", { onclick: () => addSub(sel.ci) }, "+ alkategória")),
      (c.children || []).length ? h("div.list", {}, c.children.map((s, si) => h("button.node", { onclick: () => select({ kind: "sub", ci: sel.ci, si, shared: false }) }, s.title, h("span.count", {}, `${(s.works || []).length} mű`))))
        : h("p.list-empty", {}, "Még nincs alkategória.")),
  ];
}

function viewSub() {
  const ref = { ci: sel.ci, si: sel.si, shared: !!sel.shared };
  const list = subList(ref);
  const s = list[ref.si];
  const del = () => {
    if (!confirm(`Törlöd a(z) „${s.title}” alkategóriát és a benne levő ${(s.works || []).length} művet?`)) return;
    list.splice(ref.si, 1);
    changed(); select(ref.shared ? { kind: "intro" } : { kind: "cat", ci: ref.ci });
  };
  const move = (d) => { sel.si = moveIn(list, ref.si, d); changed(); renderEditor(); };
  const parts = [
    head(ref.shared ? "Közös alkategória (metszet)" : `Alkategória · ${data.categories[ref.ci].title}`, s.title,
      [h("button.small", { onclick: () => move(-1) }, "↑"), h("button.small", { onclick: () => move(1) }, "↓"), h("button.small.danger", { onclick: del }, "Törlés")]),
    group("Alapadatok", ...titleSlug(s, list)),
  ];
  if (ref.shared) {
    parts.push(group("Melyik halmazok metszetébe tartozik?",
      h("p.note", {}, "Legalább két kategóriát jelölj be; az alkategória mindegyik alól elérhető lesz."),
      data.categories.map((c) => checkField(c.title, (s.in || []).includes(c.slug), (on) => {
        s.in = (s.in || []).filter((x) => x !== c.slug);
        if (on) s.in.push(c.slug);
        s.in.sort((a, b) => data.categories.findIndex((c) => c.slug === a) - data.categories.findIndex((c) => c.slug === b));
        changed();
      })),
      (s.in || []).length < 2 ? h("p.note.warn", {}, "Egy kategóriával csak sima alkategóriaként viselkedik.") : null));
  } else if (data.categories.length > 1) {
    parts.push(group("Áthelyezés",
      h("label.field", {}, h("span", {}, "Másik kategóriába"),
        h("select", { onchange: (e) => {
          const to = +e.target.value;
          if (to === ref.ci) return;
          const [item] = list.splice(ref.si, 1);
          const dest = data.categories[to].children;
          item.slug = uniqueSlug(item.slug, dest.map((x) => x.slug));
          dest.push(item);
          changed(); select({ kind: "sub", ci: to, si: dest.length - 1, shared: false });
        } }, data.categories.map((c, i) => h("option", { value: i, selected: i === ref.ci }, c.title))))));
  }
  parts.push(group(h("h3", {}, "Művek", h("button.small", { onclick: () => addWork(ref) }, "+ mű")),
    (s.works || []).length ? h("div.list", {}, s.works.map((w, wi) => h("button.node", { onclick: () => select({ kind: "work", ...ref, wi }) }, w.title, h("span.count", {}, w.entries?.length ? `${w.entries.length} tétel` : (w.meta || "")))))
      : h("p.list-empty", {}, "Még nincs mű.")));
  return parts;
}

function allSubs() {
  const out = [];
  data.categories.forEach((c, ci) => (c.children || []).forEach((s, si) => out.push({ label: `${c.title} › ${s.title}`, ref: { ci, si, shared: false } })));
  data.shared.forEach((s, si) => out.push({ label: `Közös › ${s.title}`, ref: { si, shared: true } }));
  return out;
}

function viewWork() {
  const ref = { ci: sel.ci, si: sel.si, shared: !!sel.shared };
  const sub = getSub(ref);
  const w = sub.works[sel.wi];
  const del = () => {
    if (!confirm(`Törlöd a(z) „${w.title}” művet?`)) return;
    sub.works.splice(sel.wi, 1);
    changed(); select({ kind: "sub", ...ref });
  };
  const move = (d) => { sel.wi = moveIn(sub.works, sel.wi, d); changed(); renderEditor(); };
  const subs = allSubs();
  const curIdx = subs.findIndex((x) => x.ref.shared === ref.shared && x.ref.si === ref.si && (ref.shared || x.ref.ci === ref.ci));

  const about = (w.about || []).join("\n\n");
  const parts = [
    head(`Mű · ${sub.title}`, w.title, [h("button.small", { onclick: () => move(-1) }, "↑"), h("button.small", { onclick: () => move(1) }, "↓"), h("button.small.danger", { onclick: del }, "Törlés")]),
    group("Alapadatok", ...titleSlug(w, sub.works),
      textField("Rövid sor a cím alatt", w.meta, (v) => { w.meta = v; changed({ tree: false }); }, { placeholder: "pl. versek · Napkút Kiadó, 2020" }),
      h("label.field", {}, h("span", {}, "Áthelyezés másik alkategóriába"),
        h("select", { onchange: (e) => {
          const target = subs[+e.target.value];
          if (!target) return;
          const [item] = sub.works.splice(sel.wi, 1);
          const dest = getSub(target.ref);
          dest.works = dest.works || [];
          item.slug = uniqueSlug(item.slug, dest.works.map((x) => x.slug));
          dest.works.push(item);
          changed(); select({ kind: "work", ...target.ref, wi: dest.works.length - 1 });
        } }, subs.map((x, i) => h("option", { value: i, selected: i === curIdx }, x.label))))),
    group("Szöveg",
      textField("Bemutatás", about, (v) => { w.about = v.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean); changed({ tree: false }); }, { area: true, rows: 5, help: "Üres sorral elválasztott bekezdések." }),
      textField("Vers vagy részlet", w.poem, (v) => { w.poem = v || undefined; changed({ tree: false }); }, { area: true, rows: 7, help: "A sortörések és behúzások megmaradnak." })),
    group("Média",
      mediaField("Kép", w.image, (v) => { w.image = v || undefined; changed({ tree: false }); }, "image/*", "pl. /media/borito.jpg"),
      mediaField("Hangfájl", w.audio, (v) => { w.audio = v || undefined; changed({ tree: false }); }, "audio/*", "pl. /media/felolvasas.mp3"),
      textField("Beágyazott lejátszó vagy videó (embed URL)", w.embed, (v) => { w.embed = v || undefined; changed({ tree: false }); }, { type: "url", placeholder: "https://www.youtube.com/embed/…", help: "Bandcamp, SoundCloud vagy YouTube „beágyazás” (embed) linkje." })),
    linksEditor(w),
    entriesEditor(w),
  ];
  return parts;
}

function mediaField(label, value, set, accept, placeholder) {
  const input = h("input", { value: value || "", placeholder, oninput: (e) => set(e.target.value.trim()) });
  const file = h("input", { type: "file", accept, hidden: true, onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const path = await uploadMedia(f);
      input.value = path; set(path);
      toast(`Feltöltve. A honlapon a következő mentés után jelenik meg.`, "ok");
    } catch (err) { toast(esc(err.message), "err", 7000); }
    e.target.value = "";
  } });
  return h("label.field", {}, h("span", {}, label),
    h("div.slug-wrap", {}, input, h("button.small", { type: "button", onclick: () => file.click(), title: "Fájl feltöltése a honlapra" }, "Feltöltés"), file),
    h("small", {}, "Kép, hang, videó vagy PDF, legfeljebb 5 MB. Nagyobb hanghoz, videóhoz használj beágyazott lejátszót (SoundCloud, Bandcamp, YouTube)."));
}

function linksEditor(w) {
  w.links = w.links || [];
  const box = h("div.list");
  const draw = () => {
    box.innerHTML = "";
    if (!w.links.length) box.append(h("p.list-empty", {}, "Nincs hivatkozás."));
    w.links.forEach((l, i) => box.append(h("div.list-item", {},
      h("div.fields", {},
        h("input", { value: l.label || "", placeholder: "Felirat", oninput: (e) => { l.label = e.target.value; changed({ tree: false }); } }),
        h("input", { value: l.href || "", placeholder: "https://…", type: "url", oninput: (e) => { l.href = e.target.value; changed({ tree: false }); } })),
      h("div.ops", {}, h("button.icon", { title: "Törlés", onclick: () => { w.links.splice(i, 1); if (!w.links.length) delete w.links; changed({ tree: false }); w.links = w.links || []; draw(); } }, "✕")))));
  };
  draw();
  return group(h("h3", {}, "Hivatkozások", h("button.small", { onclick: () => { w.links.push({ label: "", href: "" }); draw(); } }, "+ hivatkozás")), box);
}

function entriesEditor(w) {
  w.entries = w.entries || [];
  const box = h("div.list");
  const count = h("span", {}, "");
  const draw = () => {
    box.innerHTML = "";
    count.textContent = w.entries.length ? ` (${w.entries.length})` : "";
    if (!w.entries.length) box.append(h("p.list-empty", {}, "Nincs tétel. Publikációs listához, folyóiratközlésekhez, fordításokhoz használd: a honlapon évenként csoportosítva jelennek meg."));
    w.entries.forEach((en, i) => box.append(h("div.list-item", {},
      h("div.fields", {},
        h("div.two", {},
          h("input", { value: en.year || "", placeholder: "Év", oninput: (e) => { en.year = e.target.value; changed({ tree: false }); } }),
          h("input", { value: en.title || "", placeholder: "Cím (pl. Szerző: Cím)", oninput: (e) => { en.title = e.target.value; changed({ tree: false }); } })),
        h("input", { value: en.source || "", placeholder: "Megjelenés (folyóirat, kötet, oldalszám)", oninput: (e) => { en.source = e.target.value; changed({ tree: false }); } }),
        h("div.two", {},
          h("input", { value: en.note || "", placeholder: "Címke", oninput: (e) => { en.note = e.target.value || undefined; changed({ tree: false }); } }),
          h("input", { value: en.link || "", placeholder: "Link (https://…)", type: "url", oninput: (e) => { en.link = e.target.value || undefined; changed({ tree: false }); } }))),
      h("div.ops", {},
        h("button.icon", { title: "Fel", onclick: () => { moveIn(w.entries, i, -1); changed({ tree: false }); draw(); } }, "↑"),
        h("button.icon", { title: "Le", onclick: () => { moveIn(w.entries, i, 1); changed({ tree: false }); draw(); } }, "↓"),
        h("button.icon", { title: "Törlés", onclick: () => { w.entries.splice(i, 1); changed(); draw(); } }, "✕")))));
  };
  draw();
  const bulk = h("textarea.mono", { rows: 5, placeholder: "2024 | Cím | Megjelenés | https://link | címke\n2023 | Másik cím | Folyóirat, 2023/5" });
  const add = () => {
    const rows = bulk.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [year, title, source, link, note] = l.split("|").map((x) => (x || "").trim());
      const e = { title, source, year };
      if (link) e.link = link;
      if (note) e.note = note;
      return e;
    });
    if (!rows.length) return;
    w.entries.push(...rows);
    bulk.value = "";
    changed(); draw();
    toast(`${rows.length} tétel hozzáadva.`, "ok");
  };
  return group(h("h3", {}, h("span", {}, "Tételek (lista)", count),
      h("span", {}, h("button.small", { onclick: () => { w.entries.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0)); changed({ tree: false }); draw(); } }, "Év szerint"), " ",
        h("button.small", { onclick: () => { w.entries.unshift({ year: String(new Date().getFullYear()), title: "", source: "" }); changed(); draw(); } }, "+ tétel"))),
    textField("A lista fölötti cím (nem kötelező)", w.entriesTitle, (v) => { w.entriesTitle = v || undefined; changed({ tree: false }); }, { placeholder: "pl. A kötetről írták" }),
    box,
    h("details.bulk", {}, h("summary", {}, "Több tétel beillesztése egyszerre"),
      h("p.note", {}, "Soronként egy tétel, függőleges vonallal elválasztva: év | cím | megjelenés | link | címke. A link és a címke elhagyható."),
      bulk, h("button.small", { onclick: add, style: "margin-top:8px" }, "Hozzáadás")));
}

function viewSite() {
  const s = data.site;
  const linksBox = h("div.list");
  const draw = () => {
    linksBox.innerHTML = "";
    s.contact.links.forEach((l, i) => linksBox.append(h("div.list-item", {},
      h("div.fields", {},
        h("input", { value: l.label || "", placeholder: "Felirat (pl. Instagram)", oninput: (e) => { l.label = e.target.value; changed({ tree: false }); } }),
        h("input", { value: l.href || "", type: "url", placeholder: "https://…", oninput: (e) => { l.href = e.target.value; changed({ tree: false }); } })),
      h("div.ops", {}, h("button.icon", { onclick: () => { s.contact.links.splice(i, 1); changed({ tree: false }); draw(); } }, "✕")))));
    if (!s.contact.links.length) linksBox.append(h("p.list-empty", {}, "Nincs link."));
  };
  draw();
  return [
    head("Oldal", s.name),
    group("Alapadatok",
      textField("Név (a nyitóoldal közepén)", s.name, (v) => { s.name = v; $(".ed-title").textContent = v; changed({ tree: false }); }),
      textField("Leírás (keresőknek)", s.description, (v) => { s.description = v; changed({ tree: false }); }, { area: true, rows: 3 })),
    group(h("h3", {}, "Elérhetőség a lap alján", h("button.small", { onclick: () => { s.contact.links.push({ label: "", href: "" }); draw(); } }, "+ link")),
      textField("E-mail", s.contact.email, (v) => { s.contact.email = v; changed({ tree: false }); }, { type: "email", help: "Ha üresen hagyod, nem jelenik meg." }),
      linksBox),
  ];
}

function viewColors() {
  const st = data.settings;
  const strip = (p) => h("span.swatch-strip", {}, ["metal", "glow", "mono"].map((k) => h("i", { style: `background:${p[k]}` })));
  return [
    head("Megjelenés", "Színek"),
    group("Fémtónusok",
      h("p.note", { html: "Minden kategória egy tónust választ. A <b>fém</b> szín a nyitóoldalon látszik, a <b>fény</b> az egérrel ráállva, az <b>egyszínű árnyalat</b> az almenük képének színe. A <b>szivárvány</b> a fém irizálásának erőssége." }),
      PALETTE_KEYS.map((k) => {
        const p = st.palettes[k];
        const title = h("h4", {}, strip(p), p.label || k);
        const upd = () => { title.replaceChildren(strip(p), p.label || k); changed(); };
        return h("div.palette-card", {}, title,
          textField("Név", p.label, (v) => { p.label = v; upd(); }),
          h("div.row3", {}, colorField("Fém", p.metal, (v) => { p.metal = v; upd(); }), colorField("Fény", p.glow, (v) => { p.glow = v; upd(); }), colorField("Egyszínű árnyalat", p.mono, (v) => { p.mono = v; upd(); })),
          rangeField("Szivárvány", p.iridescence, 0, 1, 0.01, (v) => { p.iridescence = v; changed({ tree: false }); }, { fmt: (v) => v.toFixed(2) }));
      }),
      colorField("Közös alkategóriák egyszínű árnyalata", st.sharedMono, (v) => { st.sharedMono = v; changed(); })),
    group("Nyitóoldal",
      h("div.row", {}, colorField("Fény (környezet)", st.home.light, (v) => { st.home.light = v; changed({ tree: false }); }), colorField("Mélység (szilánkok)", st.home.depth, (v) => { st.home.depth = v; changed({ tree: false }); })),
      h("div.row", {}, colorField("Kristálymag A", st.home.crystalA, (v) => { st.home.crystalA = v; changed({ tree: false }); }), colorField("Kristálymag B", st.home.crystalB, (v) => { st.home.crystalB = v; changed({ tree: false }); }))),
  ];
}

function viewFonts() {
  const f = data.settings.fonts;
  const sample = (fam, text, weight) => h("div.font-sample", { style: `font-family:"${fam}";font-weight:${weight}` }, text);
  const disp = sample(f.display, "BORDÁS MÁTÉ · Zenés felolvasás", 700);
  const body = sample(f.body, "Árvíztűrő tükörfúrógép – a folyó hátán úszó sejtek.", 400);
  return [
    head("Megjelenés", "Betűtípus"),
    group("Címek és feliratok",
      h("label.field", {}, h("span", {}, "Betűtípus"),
        h("select", { onchange: (e) => { f.display = e.target.value; disp.style.fontFamily = `"${f.display}"`; changed({ tree: false }); } },
          FONTS.display.map((x) => h("option", { value: x, selected: f.display === x }, x)))), disp),
    group("Szövegek (bemutatások, versek, listák)",
      h("label.field", {}, h("span", {}, "Betűtípus"),
        h("select", { onchange: (e) => { f.body = e.target.value; body.style.fontFamily = `"${f.body}"`; changed({ tree: false }); } },
          FONTS.body.map((x) => h("option", { value: x, selected: f.body === x }, x)))), body,
      h("p.note", { style: "margin-top:12px" }, "Mindegyik betűtípus a honlap saját tárhelyéről töltődik, és tartalmazza a magyar ékezeteket.")),
  ];
}

function viewTexture() {
  const L = data.settings.lidar, t = data.settings.texture;
  const r = (obj, label, key, min, max, step, help, fmt = (v) => v.toFixed(2)) =>
    rangeField(label, obj[key], min, max, step, (v) => { obj[key] = v; changed({ tree: false }); }, { help, fmt });
  return [
    head("Megjelenés", "Pontfelhő és kamera"),
    group("Pontfelhő",
      h("p.note", {}, "A honlap LiDAR-szerű pontfelhőként jelenik meg: a pontok színe a magasságot mutatja (alul lila–kék, felül sárga–vörös), mint egy lézerszkennelt tájon."),
      r(L, "Pontsűrűség", "density", 0.3, 1, 0.01, "Kevesebb pont = gyorsabb, levegősebb kép."),
      r(L, "Pontméret", "pointSize", 0.5, 2, 0.01),
      r(L, "Kategóriaszín keverése", "tintMix", 0, 1, 0.01, "0 = tisztán magasság szerinti szín, 1 = a kategória fémtónusa."),
      r(L, "Domborzat és kupolák magassága", "relief", 0.3, 2, 0.01)),
    group("Kamera",
      r(L, "Dőlésszög (felülnézet felé nő)", "pitch", 30, 80, 1, "", (v) => Math.round(v) + "°"),
      r(L, "Elforgatás", "yaw", -45, 45, 1, "", (v) => Math.round(v) + "°"),
      r(L, "Lassú kameramozgás", "sway", 0, 2, 0.01, "0 = álló kamera.")),
    group("Felület",
      r(t, "Szemcse (film- és pixelszemcse)", "grain", 0, 2, 0.01, "0 = tiszta kép, 1 = alap, 2 = erős szemcse.")),
  ];
}

function viewGlitch() {
  const g = data.settings.glitch;
  const sec = (v) => (v / 1000).toFixed(1) + " s";
  const ms = (v) => Math.round(v) + " ms";
  const c = () => changed({ tree: false });
  return [
    head("Megjelenés", "Glitch", [h("button.small", { onclick: () => postPreview({ type: "bm-glitch" }) }, "Kipróbálás")]),
    group("Gyakoriság",
      checkField("Glitch bekapcsolva", g.enabled, (v) => { g.enabled = v; c(); }),
      rangeField("Legrövidebb szünet két sorozat között", g.minGap, 2000, 30000, 500, (v) => { g.minGap = v; if (g.maxGap < v) g.maxGap = v; c(); }, { fmt: sec }),
      rangeField("Leghosszabb szünet", g.maxGap, 2000, 40000, 500, (v) => { g.maxGap = Math.max(v, g.minGap); c(); }, { fmt: sec }),
      rangeField("Villanások egy sorozatban", g.burstCount, 1, 6, 1, (v) => { g.burstCount = v; c(); })),
    group("Megjelenés",
      rangeField("Erősség", g.intensity, 0.2, 1.6, 0.05, (v) => { g.intensity = v; c(); }, { fmt: (v) => v.toFixed(2) }),
      rangeField("Teljes oldalt érintő villanások aránya", g.fullChance, 0, 1, 0.05, (v) => { g.fullChance = v; c(); }, { fmt: (v) => Math.round(v * 100) + "%" }),
      rangeField("Egy villanás legrövidebb hossza", g.minLength, 60, 1200, 10, (v) => { g.minLength = v; if (g.maxLength < v) g.maxLength = v; c(); }, { fmt: ms }),
      rangeField("Egy villanás leghosszabb hossza", g.maxLength, 60, 1500, 10, (v) => { g.maxLength = Math.max(v, g.minLength); c(); }, { fmt: ms })),
    group("Oldalváltás és hozzáférhetőség",
      checkField("Oldalváltáskor teljes képes glitch", g.onNavigate, (v) => { g.onNavigate = v; c(); }),
      rangeField("Annak hossza", g.navigateLength, 100, 1200, 10, (v) => { g.navigateLength = v; c(); }, { fmt: ms }),
      checkField("Ha a látogató gépén „csökkentett mozgás” van beállítva, ne legyen glitch", g.respectReducedMotion, (v) => { g.respectReducedMotion = v; c(); }),
      h("p.note", {}, "Ez utóbbit érdemes bekapcsolva hagyni: a villódzás egyeseknek rosszullétet okozhat. Ha a saját gépeden nem látod a glitchet, nézd meg, nincs-e bekapcsolva a rendszerben az animációk csökkentése.")),
  ];
}

/* ---------------- mentés a honlapra (Netlify Function) ---------------- */

function getPass() { return sessionStorage.getItem(SS_PASS) || localStorage.getItem(LS_PASS) || ""; }
function setPass(p, remember) {
  sessionStorage.setItem(SS_PASS, p);
  if (remember) localStorage.setItem(LS_PASS, p); else localStorage.removeItem(LS_PASS);
}
function forgetPass() { sessionStorage.removeItem(SS_PASS); localStorage.removeItem(LS_PASS); }

async function api(path, { method = "GET", body, type } = {}) {
  const headers = { authorization: "Bearer " + getPass() };
  if (type) headers["content-type"] = type;
  let r;
  try { r = await fetch("/api/" + path, { method, headers, body, cache: "no-store" }); }
  catch { throw new Error("Nem érem el a honlap szerverét. Ellenőrizd az internetkapcsolatot."); }
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json")) throw new Error(r.status === 404
    ? "A mentés csak a Netlify-on futó honlapon működik (helyi gépen nem). A Letöltés gombbal addig fájlba mentheted a munkát."
    : `Szerverhiba (${r.status}).`);
  const j = await r.json();
  if (r.status === 401) { forgetPass(); }
  if (!r.ok) { const e = new Error(j.error || `Hiba (${r.status}).`); e.status = r.status; throw e; }
  return j;
}

function openLogin(message = "") {
  return new Promise((resolve) => {
    const d = $("#login-dialog");
    const f = d.querySelector("form");
    f.pass.value = "";
    $("#login-msg").textContent = message;
    $("#login-msg").hidden = !message;
    d.onclose = async () => {
      if (d.returnValue !== "ok" || !f.pass.value) return resolve(false);
      setPass(f.pass.value, f.remember.checked);
      try { await api("login", { method: "POST" }); resolve(true); }
      catch (err) { resolve(await openLogin(err.message)); }
    };
    d.showModal();
    f.pass.focus();
  });
}
async function ensureLogin() {
  if (getPass()) return true;
  return openLogin();
}
async function withLogin(fn) {
  if (!(await ensureLogin())) throw new Error("A mentéshez be kell lépni.");
  try { return await fn(); }
  catch (err) {
    if (err.status === 401 && (await openLogin("Hibás jelszó. Próbáld újra."))) return fn();
    throw err;
  }
}

async function uploadMedia(file) {
  if (file.size > 5.5 * 1024 * 1024) throw new Error("A fájl túl nagy (legfeljebb 5 MB).");
  const r = await withLogin(() => api("media?name=" + encodeURIComponent(file.name), { method: "POST", body: file, type: file.type || "application/octet-stream" }));
  return r.url;
}

function validate() {
  const problems = [];
  const dup = (list, where) => {
    const seen = new Set();
    list.forEach((x) => { if (seen.has(x.slug)) problems.push(`Ismétlődő webcím-rész („${x.slug}”) – ${where}`); seen.add(x.slug); if (!x.title?.trim()) problems.push(`Cím nélküli elem – ${where}`); });
  };
  dup(data.categories, "kategóriák");
  data.categories.forEach((c) => { dup(c.children || [], c.title); (c.children || []).forEach((s) => dup(s.works || [], `${c.title} › ${s.title}`)); });
  dup(data.shared, "közös alkategóriák");
  data.shared.forEach((s) => { dup(s.works || [], s.title); if ((s.in || []).length < 1) problems.push(`„${s.title}” egyik kategóriához sem tartozik.`); });
  const allSlugs = [...data.categories.flatMap((c) => (c.children || []).map((s) => [c.slug, s.slug])), ...data.shared.flatMap((s) => (s.in || []).map((ci) => [ci, s.slug]))];
  const seen = new Set();
  allSlugs.forEach(([c, s]) => { const k = c + "/" + s; if (seen.has(k)) problems.push(`A „${k}” cím kétszer szerepel (egy saját és egy közös alkategória ütközik).`); seen.add(k); });
  return problems;
}

async function publish() {
  const problems = validate();
  if (problems.length) { toast("Javítsd a mentés előtt:<br>" + problems.slice(0, 5).map(esc).join("<br>"), "err", 8000); return; }
  const btn = $("#btn-save");
  btn.disabled = true; btn.textContent = "Mentés…";
  try {
    const res = await withLogin(() => api("content", { method: "PUT", body: JSON.stringify(data), type: "application/json" }));
    published = clone(data);
    changed({ tree: false });
    const at = new Date(res.savedAt).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
    toast(`Elmentve (${at}). A honlapon már így látszik.`, "ok", 6000);
  } catch (err) {
    toast(esc(err.message), "err", 9000);
  } finally {
    btn.disabled = false; btn.textContent = "Mentés";
  }
}

async function openHistory() {
  const d = $("#history-dialog");
  const list = $("#history-list");
  list.innerHTML = "<p class='hint'>Betöltés…</p>";
  d.showModal();
  try {
    const { items } = await withLogin(() => api("history"));
    list.innerHTML = "";
    if (!items.length) { list.append(h("p.hint", {}, "Még nincs korábbi mentés.")); return; }
    items.forEach((it) => {
      const when = new Date(it.savedAt).toLocaleString("hu-HU", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
      list.append(h("div.list-item", {},
        h("div.fields", {}, h("b", {}, when)),
        h("div.ops", {}, h("button.small", { onclick: async () => {
          try {
            const old = await withLogin(() => api("history/" + encodeURIComponent(it.key)));
            data = old; ensureSettings(); sel = { kind: "intro" };
            changed(); renderEditor();
            d.close();
            toast(`A ${esc(when)}-i változat betöltve. Ha így szeretnéd, kattints a <b>Mentés</b> gombra.`, "ok", 8000);
          } catch (err) { toast(esc(err.message), "err"); }
        } }, "Betöltés"))));
    });
  } catch (err) {
    list.innerHTML = "";
    list.append(h("p.hint.warn", {}, err.message));
  }
}

/* ---------------- indulás ---------------- */

async function init() {
  // a honlapon elmentett tartalom; ha még nincs mentés, a kezdő content.json
  published = null;
  try {
    const r = await fetch("/api/content", { cache: "no-store" });
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) published = await r.json();
  } catch {}
  if (!published) {
    try { published = await (await fetch("/content.json", { cache: "no-store" })).json(); }
    catch { published = { site: { name: "" }, categories: [], shared: [] }; toast("A tartalom nem tölthető be.", "err"); }
  }
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(LS_DRAFT) || "null"); } catch {}
  data = clone(draft && Array.isArray(draft.categories) ? draft : published);
  ensureSettings();
  const pub = clone(published); data_ensure(pub); published = pub;
  if (draft && JSON.stringify(data) !== JSON.stringify(published)) toast("A legutóbbi mentetlen piszkozatot töltöttem be. Az <b>Elvetés</b> gomb visszaállítja a honlapon levő változatot.", "", 6500);
  try { localStorage.setItem(LS_DRAFT, JSON.stringify(data)); } catch {}
  $("#dirty").hidden = JSON.stringify(data) === JSON.stringify(published);
  data.categories.forEach((_, i) => openNodes.add("c" + i));
  renderTree();
  renderEditor();
  // ha az előnézet előbb töltődött be, mint mi
  postPreview({ type: "bm-content", content: data });
}
function data_ensure(obj) { const keep = data; data = obj; ensureSettings(); data = keep; }

document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  tab = b.dataset.tab;
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
  select(tab === "look" ? { kind: "look-colors" } : tab === "site" ? { kind: "site" } : { kind: "intro" });
}));
$("#btn-save").addEventListener("click", publish);
$("#btn-history").addEventListener("click", openHistory);
$("#btn-logout").addEventListener("click", () => { forgetPass(); toast("Kiléptél. A következő mentésnél újra kéri a jelszót.", "ok"); });
$("#btn-glitch").addEventListener("click", () => postPreview({ type: "bm-glitch" }));
$("#btn-download").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 1) + "\n"], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: "content.json" });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$("#file-import").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    if (!Array.isArray(obj.categories)) throw new Error("Ez nem a honlap content.json fájlja.");
    data = obj; ensureSettings(); sel = { kind: "intro" };
    changed(); renderEditor();
    toast("Betöltve. A honlapon a Mentés után jelenik meg.", "ok");
  } catch (err) { toast(esc(err.message || "Hibás fájl."), "err"); }
  e.target.value = "";
});
$("#btn-revert").addEventListener("click", () => {
  if (!confirm("Elveted a mentetlen változásokat, és visszatöltöd a honlapon levő változatot?")) return;
  data = clone(published); ensureSettings(); sel = { kind: "intro" };
  changed(); renderEditor();
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); publish(); }
});
window.addEventListener("beforeunload", (e) => {
  // a piszkozat úgyis megmarad, de figyelmeztetünk, ha nincs elmentve
  if (data && published && JSON.stringify(data) !== JSON.stringify(published)) { e.preventDefault(); e.returnValue = ""; }
});

init();
