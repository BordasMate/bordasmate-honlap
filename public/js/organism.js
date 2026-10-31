// A honlap élő felülete: WebGL2, két lépésben.
//  1. jelenet (lidar.js): LiDAR-szerű pontfelhő 3D térben – dőlt térképlap, pontokból álló
//     amőbasejtek, halmazkontúrok, lebegő kristályok; a kép alfa csatornájába a
//     mélységélesség mértéke (CoC) kerül
//  2. utófeldolgozás (itt): élsimítás, mélységélesség, ragyogás, glitch, színes monokróm, szemcse
// A fizika és az elrendezés képernyő-koordinátákban dolgozik; a sejtek összetapadnak,
// sodródnak és lökdösik egymást, a renderelő pedig a talajsíkra vetíti őket.

import { createLidar, makeNoisePoints, makeTextCloud, MAX_CELLS, MAX_GEMS } from "./lidar.js";

/* ===== ALAPBEÁLLÍTÁSOK – a content.json "settings" része felülírja őket ===== */
export const GLITCH = {
  enabled: true,              // false = nincs glitch
  firstAfter: 4000,           // az első glitch-sorozat a betöltés után (ms)
  minGap: 9000,               // két glitch-sorozat között legalább…
  maxGap: 11000,              // …és legfeljebb ennyi ms (átlagosan kb. 10 mp)
  burstCount: 3,              // egy sorozatban ennyi villanás jön egymás után
  fullChance: 0.5,            // a villanások ekkora része a teljes oldalt érinti (0–1)
  minLength: 140,             // egy villanás hossza (ms)…
  maxLength: 420,
  intensity: 1,               // erősség (0,3–1,5)
  onNavigate: true,           // oldalváltáskor teljes képes glitch
  navigateLength: 420,
  respectReducedMotion: true, // ha a rendszerben „csökkentett mozgás” van beállítva, nincs glitch
};
export const LOOK = {
  grain: 1,                   // szemcse
  rust: 1,                    // rozsda, homokfújás
  materials: { metal: 0.55, wood: 0.35, stone: 0.4, clay: 0.3 },
  displayFont: "Syne",
  lidar: { density: 1, pointSize: 1, tintMix: 0.3, relief: 1, pitch: 50, yaw: -22, sway: 1 },
};
/* ========================================================================== */

const MAX_B = MAX_CELLS;
const MAX_G = MAX_GEMS;
const MAX_R = 8;

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `
// egyenletes eloszlású hash (nincs rácsmintázat a szemcsében)
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

/* ---------------- 2. utófeldolgozás ---------------- */

const POST = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uScale, uTime, uMono, uGlitch, uGSeed, uDofK;
uniform vec4 uGRect, uGType, uGType2;
uniform float uGrain;
uniform vec3 uMonoTint;
${COMMON}
vec2 toUV(vec2 pc){ return vec2(pc.x * uScale / uRes.x, 1.0 - pc.y * uScale / uRes.y); }
vec4 T(vec2 uv){ return textureLod(uTex, uv, 0.0); }

vec3 fxaa(vec2 uv, vec3 rgbM){
  vec2 px = 1.0 / uRes;
  vec3 nw = T(uv + vec2(-1.0, -1.0) * px).rgb, ne = T(uv + vec2(1.0, -1.0) * px).rgb;
  vec3 sw = T(uv + vec2(-1.0, 1.0) * px).rgb, se = T(uv + vec2(1.0, 1.0) * px).rgb;
  float lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se), lM = luma(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, -8.0, 8.0) * px;
  vec3 a = 0.5 * (T(uv + dir * (1.0/3.0 - 0.5)).rgb + T(uv + dir * (2.0/3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (T(uv - dir * 0.5).rgb + T(uv + dir * 0.5).rgb);
  float lb = luma(b);
  return (lb < lMin || lb > lMax) ? a : b;
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / uRes;
  vec2 pc = vec2(fc.x, uRes.y - fc.y) / uScale;
  vec2 suv = uv;
  float split = 0.0, scan = 0.0, glitched = 0.0;

  if (uGlitch > 0.001) {
    vec2 lo = uGRect.xy, hi = uGRect.xy + uGRect.zw;
    float inR = step(lo.x, pc.x) * step(pc.x, hi.x) * step(lo.y, pc.y) * step(pc.y, hi.y);
    float g = uGlitch * inR;
    if (g > 0.0) {
      vec2 s = pc;
      // vízszintes szeletcsúszás
      if (uGType.x > 0.0) {
        float bh = 4.0 + 26.0 * hash(vec2(floor(pc.y / 37.0), uGSeed));
        float band = floor(pc.y / bh);
        if (hash(vec2(band, uGSeed)) < 0.28) { s.x += (hash(vec2(band, uGSeed + 1.7)) - 0.5) * 100.0 * g; split = 2.1 * g; scan = 0.8 * g; }
      }
      // blokkeltolódás
      if (uGType.w > 0.0) {
        vec2 bl = floor(pc / vec2(56.0, 22.0));
        if (hash(bl + uGSeed * 1.3) < 0.18) { s += (hash2(bl + uGSeed * 2.1) - 0.5) * vec2(66.0, 18.0) * g; split = max(split, 1.4 * g); }
      }
      // függőleges elkenődés (pixelsort)
      if (uGType.y > 0.0) {
        float cw = 2.0 + 14.0 * hash(vec2(floor(pc.x / 48.0), uGSeed + 3.0));
        float ci = floor(pc.x / cw);
        if (hash(vec2(ci, uGSeed + 5.0)) < 0.5) {
          float anchor = lo.y + hash(vec2(ci, uGSeed + 9.0)) * uGRect.w;
          s.y = anchor + (pc.y - anchor) * mix(1.0, 0.28, min(1.0, g * 1.2));
        }
      }
      // kristályos háromszög-mozaik
      if (uGType.z > 0.0) {
        float sz = 16.0 + 34.0 * hash(vec2(uGSeed, 7.0));
        vec2 tq = s / sz;
        vec2 sk = vec2(tq.x - tq.y * 0.57735, tq.y * 1.1547);
        vec2 ci = floor(sk); vec2 f = fract(sk);
        float up = step(f.x + f.y, 1.0);
        vec2 cen = ci + mix(vec2(2.0/3.0), vec2(1.0/3.0), up);
        vec2 back = vec2(cen.x + cen.y * 0.5, cen.y * 0.8660254) * sz;
        if (hash(ci + up * 17.0 + uGSeed) < 0.6) s = back + (hash2(ci + up * 3.0 + uGSeed) - 0.5) * sz * 0.4;
      }
      // pixelmozaik
      if (uGType2.x > 0.0) {
        float ps = 4.0 + 9.0 * hash(vec2(uGSeed, 2.0));
        vec2 cell = floor(s / ps);
        if (hash(cell * 0.13 + floor(uGSeed)) < 0.7) s = (cell + 0.5) * ps;
      }
      // képszakadás és -gördülés
      if (uGType2.y > 0.0) {
        s.x += sin(pc.y * 0.045 + uGSeed * 3.0) * 9.0 * g;
        float row = floor(pc.y / 3.0);
        s.x += step(hash(vec2(row, uGSeed)), 0.05) * (hash(vec2(row, uGSeed + 4.0)) - 0.5) * 52.0 * g;
        float H = uRes.y / uScale;
        s.y = mod(s.y + hash(vec2(uGSeed, 11.0)) * H * 0.1 * g, H);
        split = max(split, 1.7 * g);
      }
      // vízszintes elnyújtás sávokban (a látható képet húzza szét)
      if (uGType2.z > 0.0) {
        float band = floor(pc.y / (8.0 + 46.0 * hash(vec2(uGSeed, 5.0))));
        if (hash(vec2(band, uGSeed + 8.0)) < 0.28) {
          float ax = lo.x + hash(vec2(band, uGSeed + 2.0)) * uGRect.z;
          s.x = ax + (s.x - ax) * mix(1.0, 0.4, min(1.0, g * 1.2));
        }
      }
      // váltott soros kiesés
      if (uGType2.w > 0.0 && mod(floor(fc.y), 2.0) < 1.0) { s.x += 4.0 * g; scan = max(scan, 1.2 * g); }
      suv = fract(toUV(s));
      glitched = 1.0;
    }
  }

  vec4 c0 = T(suv);
  float coc = c0.a;
#if QUALITY > 0
  vec3 col = fxaa(suv, c0.rgb);
#else
  vec3 col = c0.rgb;
#endif

  // mélységélesség: spirális mintavétel a mipmap-szintekből
  float blur = 0.0;
  if (coc > 0.03) {
    float R = coc * uDofK * uScale;
    float lod = max(0.0, log2(R / (QUALITY == 0 ? 2.5 : 4.0)));
    vec3 acc = vec3(0.0); float ws = 0.0;
    for (int i = 0; i < DOF_TAPS; i++) {
      float fi = float(i);
      float rr = sqrt((fi + 0.5) / float(DOF_TAPS)) * R;
      float a = fi * 2.39996;
      vec4 sm = textureLod(uTex, suv + vec2(cos(a), sin(a)) * rr / uRes, lod);
      float w = 0.25 + 0.75 * smoothstep(0.0, 0.3, sm.a);
      acc += sm.rgb * w; ws += w;
    }
    blur = smoothstep(0.03, 0.22, coc);
    col = mix(col, acc / ws, blur);
  }

  // RGB-csúszás: glitch alatt erős, a kép szélein enyhe lencsehiba
  vec2 cd = uv - 0.5;
  float ca = split + 1.4 * dot(cd, cd) * (1.0 - blur);
  if (ca > 0.05) {
    vec2 o = vec2(ca * uScale / uRes.x, 0.0);
    col.r += T(suv + o).r - c0.r;
    col.b += T(suv - o).b - c0.b;
  }

  // ragyogás
  vec3 bl = vec3(0.0);
  // a mipmap-szint a felbontáshoz igazodik, így a ragyogás mérete minden gépen ugyanaz
  float lb = max(1.0, 4.0 + log2(uScale));
  for (int i = 0; i < BLOOM_TAPS; i++) {
    float a = float(i) * 6.2832 / float(BLOOM_TAPS) + 0.5;
    vec2 o = vec2(cos(a), sin(a)) * 16.0 * uScale / uRes;
    bl += textureLod(uTex, suv + o, lb).rgb + textureLod(uTex, suv + o * 2.4, lb + 1.5).rgb;
  }
  col += max(bl / float(2 * BLOOM_TAPS) - 0.27, 0.0) * 1.15;

  col *= 1.0 - 0.2 * min(scan, 1.0) * step(0.5, fract(fc.y * 0.5));
  if (scan > 1.0) col *= 1.0 - 0.35 * step(0.5, fract(fc.y * 0.5));
  // a torzított részeken a csúcsfények nem égnek ki fehér csíkká
  if (glitched > 0.5) { float Lc = luma(col); col *= min(1.0, 0.72 / max(Lc, 0.001)) * 0.35 + 0.65 * min(1.0, 0.9 / max(Lc, 0.001)); col = min(col, vec3(0.86)); }
  // invertált, poszterizált sávok
  if (uGlitch > 0.001 && uGType2.z > 0.0) {
    float inR = step(uGRect.x, pc.x) * step(pc.x, uGRect.x + uGRect.z) * step(uGRect.y, pc.y) * step(pc.y, uGRect.y + uGRect.w);
    float band = floor(pc.y / (6.0 + 40.0 * hash(vec2(uGSeed, 5.0))));
    float hb = hash(vec2(band, uGSeed + 8.0));
    if (inR > 0.0 && hb < 0.2) col = mix(col, floor(col * 5.0 + 0.5) / 5.0, 0.7);
  }

  // monokróm (almenük)
  // egyszínű, de színes: a fényesség egy árnyalat skáláján (fekete → szín → fehéres)
  float L = luma(col);
  L = mix(L, smoothstep(0.0, 1.0, L), 0.35);
  vec3 duo = uMonoTint * min(L * 1.7, 1.0) + (vec3(1.0) - uMonoTint) * smoothstep(0.6, 1.0, L) * 0.4;
  col = mix(col, duo, uMono);

  col *= 1.0 - 0.5 * pow(length(cd) * 1.3, 2.4);
  // alapszemcse: durva (kb. 1,6 px-es) és finom, a középtónusokban erősebb
  float Lg = luma(col);
  float gw = 0.45 + 0.55 * smoothstep(0.0, 0.35, Lg) * (1.0 - 0.5 * smoothstep(0.6, 1.0, Lg));
  vec2 gp = floor(fc / max(1.0, 1.6 * uScale));
  float frameN = floor(uTime * 24.0);
  float coarse = hash(gp + frameN * 13.1) - 0.5;
  float fine = hash(fc + fract(uTime * 7.3) * 113.0) - 0.5;
  col += (coarse * 0.06 + fine * 0.035) * uGrain * gw;
  // ritka por- és karcszemcsék
  float dust = hash(floor(fc / max(1.0, 2.0 * uScale)) + frameN * 0.37);
  col += step(0.9996, dust) * 0.3 * uGrain - step(dust, 0.0004) * 0.25 * uGrain;
  outColor = vec4(col, 1.0);
}`;

/* ---------------- színek ---------------- */

// 0: titán (nyitóoldal), 1: réz (Irodalom), 2: kobalt (Zene), 3: zöldarany, 4: víz
export const TINTS = { titan: 0, rez: 1, kobalt: 2, zoldarany: 3 };
export const TINT_DATA = [
  [0.8, 0.8, 0.86, 0.55],
  [0.98, 0.55, 0.32, 0.38],
  [0.4, 0.55, 1.0, 0.62],
  [0.72, 0.8, 0.42, 0.45],
  [0.2, 0.21, 0.25, 0.3],
];
export const GLOW_DATA = [
  [0.75, 0.55, 1.0],
  [1.0, 0.35, 0.55],
  [0.2, 0.75, 1.0],
  [0.75, 1.0, 0.3],
  [0, 0, 0],
];
export const ENV_HOME = [0.98, 0.72, 1.12], DEEP_HOME = [0.72, 0.36, 0.9];
const ENV_MONO = [1, 1, 1], DEEP_MONO = [0.62, 0.64, 0.7];
export const GEM_A = [1.0, 0.2, 0.78], GEM_B = [0.15, 0.85, 1.0];
// a kristályok mélysége a sorszámuk szerint (<0 a víz alatt, >0 a kamera előtt)
const DEPTHS = [-0.8, 0, -0.5, 0.9, 0.05, -1.0, 0.65, -0.3, 0];

// a content.json "settings" részének alkalmazása (az admin felületről is)
const hexRgb = (h) => { const n = parseInt(String(h).replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const num = (v, d) => (v === undefined || v === null || v === "" || isNaN(+v) ? d : +v);
export function applySettings(st = {}) {
  const g = st.glitch || {};
  for (const k of Object.keys(GLITCH)) {
    if (g[k] === undefined) continue;
    GLITCH[k] = typeof GLITCH[k] === "boolean" ? !!g[k] : num(g[k], GLITCH[k]);
  }
  const t = st.texture || {};
  LOOK.grain = num(t.grain, LOOK.grain);
  LOOK.rust = num(t.rust, LOOK.rust);
  for (const k of ["metal", "wood", "stone", "clay"]) LOOK.materials[k] = num(t[k], LOOK.materials[k]);
  // legalább egy anyag maradjon
  if (Object.values(LOOK.materials).every((v) => v <= 0.001)) LOOK.materials.metal = 1;
  if (st.fonts && st.fonts.display) LOOK.displayFont = st.fonts.display;
  const ld = st.lidar || {};
  for (const k of Object.keys(LOOK.lidar)) LOOK.lidar[k] = num(ld[k], LOOK.lidar[k]);
  const pal = st.palettes || {};
  for (const [name, i] of Object.entries(TINTS)) {
    const p = pal[name];
    if (!p) continue;
    if (p.metal) TINT_DATA[i].splice(0, 3, ...hexRgb(p.metal));
    if (p.iridescence !== undefined) TINT_DATA[i][3] = num(p.iridescence, TINT_DATA[i][3]);
    if (p.glow) GLOW_DATA[i].splice(0, 3, ...hexRgb(p.glow));
  }
  const h = st.home || {};
  if (h.light) ENV_HOME.splice(0, 3, ...hexRgb(h.light).map((v) => v * 1.1));
  if (h.depth) DEEP_HOME.splice(0, 3, ...hexRgb(h.depth));
  if (h.crystalA) GEM_A.splice(0, 3, ...hexRgb(h.crystalA));
  if (h.crystalB) GEM_B.splice(0, 3, ...hexRgb(h.crystalB));
}

/* ---------------- segédek ---------------- */

const measure = document.createElement("canvas").getContext("2d");
function textW(s, size, weight) {
  measure.font = `${weight} ${size}px "${LOOK.displayFont}", system-ui, sans-serif`;
  return measure.measureText(s).width;
}
function splitLines(label, size, weight, maxW) {
  if (textW(label, size, weight) <= maxW || !label.includes(" ")) return [label];
  const words = label.split(" ");
  let best = [label], score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const s = Math.max(textW(a, size, weight), textW(b, size, weight));
    if (s < score) { score = s; best = [a, b]; }
  }
  return best;
}
const rE = (b, ux, uy) => (b.ax * b.ay) / Math.sqrt((b.ay * ux) ** 2 + (b.ax * uy) ** 2 + 1e-6);
function sdRBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function hash(n) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

const STYLE = {
  name: { weight: 750, upper: true, track: 0.04 },
  center: { weight: 700, upper: true, track: 0.06 },
  child: { weight: 650, upper: false, track: 0.01 },
  nav: { weight: 650, upper: true, track: 0.1 },
};

/* ---------------- motor ---------------- */

export function createOrganism(canvas, labelLayer, opts = {}) {
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, alpha: false });
  if (!gl) return null;
  const params = new URLSearchParams(location.search);

  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (fs, names, q) => {
    const p = gl.createProgram();
    const defs = `#version 300 es\n#define QUALITY ${q}\n#define DOF_TAPS ${[6, 10, 16][q]}\n#define BLOOM_TAPS ${[3, 5, 6][q]}\n`;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs.replace("#version 300 es\n", defs)));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = {};
    for (const n of names) U[n] = gl.getUniformLocation(p, n);
    return { p, U };
  };
  /* ----- teljesítményszintek ----- */
  // pix: legfeljebb ennyi pixelt számolunk (a vászon felbontása), maxScale: CSS-pixelenként,
  // fps: képkocka-korlát, q: shaderminőség (0 egyszerű – 2 teljes), gems: lebegő kristályok száma
  const TIERS = [
    { name: "alacsony", pix: 0.42e6, maxScale: 0.7, minScale: 0.4, fps: 30, q: 0, gems: 4 },
    { name: "közepes", pix: 0.75e6, maxScale: 0.85, minScale: 0.45, fps: 30, q: 1, gems: 6 },
    { name: "magas", pix: 1.4e6, maxScale: 1.0, minScale: 0.55, fps: 60, q: 2, gems: 9 },
  ];
  function detectTier() {
    const forced = { low: 0, mid: 1, high: 2 }[params.get("q")];
    if (forced !== undefined) return forced;
    let renderer = "";
    try { const ext = gl.getExtension("WEBGL_debug_renderer_info"); if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)); } catch {}
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)) return 0;
    const touch = matchMedia("(pointer: coarse)").matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
    const saveData = navigator.connection && navigator.connection.saveData;
    let t = touch ? 1 : 2;
    if (mem <= 4 || cores <= 4) t = Math.min(t, 1);
    if (mem <= 2 || cores <= 2 || saveData) t = 0;
    if (/Mali-(4|T[67])|Adreno \(TM\) [345]\d\d|PowerVR|Intel.*HD Graphics( [2-5]\d\d\d?)?$/i.test(renderer)) t = Math.min(t, touch ? 0 : 1);
    return t;
  }
  let tierIdx = detectTier();
  // az admin felület élő előnézete legfeljebb közepes minőségben fut (a szerkesztő mellett ne terhelje a gépet)
  if (params.has("preview") && !params.get("q")) tierIdx = Math.min(tierIdx, 1);
  let tier = TIERS[tierIdx];
  window.__tier = tier.name;
  const lidar = createLidar(gl);
  const POST_U = ["uTex", "uRes", "uScale", "uTime", "uMono", "uGlitch", "uGSeed", "uDofK", "uGRect", "uGType", "uGType2", "uGrain", "uMonoTint"];
  let post;
  function buildPrograms() {
    if (post) gl.deleteProgram(post.p);
    post = program(POST, POST_U, tier.q);
    lidar.setQuality(tier.q);
  }
  buildPrograms();

  // teljes képernyős négyszög az utófeldolgozáshoz
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);


  // a jelenet textúrája (mipmap a mélységélességhez és a ragyogáshoz)
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  const depth = gl.createRenderbuffer();
  function allocTarget() {
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, canvas.width, canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let ovReady = false;
  let fontVer = 0;   // ha egy betűtípus később töltődik be, a pontfelhő-betűk újraépülnek
  try { document.fonts.addEventListener("loadingdone", () => fontVer++); } catch {}
  const bodies = new Map();
  const ripples = [];
  let panel = null, panelOn = 0, panelTarget = 0;
  let W = 0, H = 0, scale = 1;
  let hoverKey = null;
  let last = performance.now(), time = 0;
  let mono = 0, monoTarget = 0;
  const envTint = [...ENV_HOME], deepTint = [...DEEP_HOME];
  const cam = [0, 0], camTarget = [0, 0];
  let focus = [0, 0];
  const bArr = new Float32Array(MAX_B * 4), cArr = new Float32Array(MAX_B * 4), sArr = new Float32Array(MAX_B);
  let setCols = new Float32Array(9), nSets = 0;
  const monoTint = [1, 1, 1]; let monoTintTarget = [1, 1, 1];
  const gArr = new Float32Array(MAX_G * 4), gaArr = new Float32Array(MAX_G * 4), rArr = new Float32Array(MAX_R * 4);

  let quality = parseFloat(params.get("res")) || 1;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    scale = Math.min(dpr, tier.maxScale, Math.sqrt(tier.pix / (W * H))) * quality;
    scale = Math.max(0.2, scale);
    if (params.get("scale")) scale = +params.get("scale");  // csak teszteléshez
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    allocTarget();
    if (ovReady) sizeOverlay();
  }
  resize();

  // a halmazhártya vastagsága (px)
  const padPx = () => (W < 640 ? 26 : 44);
  let comp = null;
  let topInset = 0;   // a felső útvonalsáv magassága (px)

  function ripple(x, y, s = 1) {
    ripples.push({ x, y, t: 0, s });
    if (ripples.length > MAX_R) ripples.shift();
  }

  /* ----- glitch ----- */

  const G = { queue: [], end: 0, next: performance.now() + GLITCH.firstAfter, rect: [0, 0, 0, 0], type: [0, 0, 0, 0], type2: [0, 0, 0, 0], seed: 0, seedT: 0, power: 0, amt: 0 };
  function burst({ full = null, power = 1, dur = null, types = null, blob = null } = {}) {
    if ((reduced && GLITCH.respectReducedMotion) || !GLITCH.enabled) return;
    const now = performance.now();
    // néha a teljes oldalt érinti
    if (full === null) full = Math.random() < GLITCH.fullChance;
    G.end = now + (dur ?? GLITCH.minLength + Math.random() * (GLITCH.maxLength - GLITCH.minLength));
    G.power = power * GLITCH.intensity * 0.82;   // valamivel finomabb, mint korábban
    if (full) G.rect = [0, 0, W, H];
    else {
      const list = [...bodies.values()].filter((b) => b.ax > 12 && (b.kind !== "drift" || Math.abs(b.z) < 0.3));
      if (list.length && Math.random() < 0.6) {
        const b = list[Math.floor(Math.random() * list.length)];
        const wide = Math.random() < 0.35 ? 2.2 : 1.15;
        const bx = b.sx ?? b.x, by = b.sy ?? b.y;
        G.rect = [bx - b.ax * wide, by - b.ay * 1.1, b.ax * 2 * wide, b.ay * 2.2];
      } else {
        const w = W * (0.15 + Math.random() * 0.7), h = H * (0.06 + Math.random() * 0.3);
        G.rect = [Math.random() * (W - w), Math.random() * (H - h), w, h];
      }
    }
    // típusok: 0 szelet, 1 elkenődés, 2 mozaik, 3 blokk | 4 pixel, 5 szakadás, 6 vízszintes nyújtás, 7 sorkiesés
    const t = [0, 0, 0, 0, 0, 0, 0, 0];
    if (types) types.forEach((v, i) => (t[i] = v));
    else {
      const pool = full ? [0, 0, 2, 4, 5, 5, 6, 7, 3] : [0, 1, 2, 3, 4, 6, 7];
      const n = Math.random() < 0.45 ? 2 : 1;
      for (let i = 0; i < n; i++) t[pool[Math.floor(Math.random() * pool.length)]] = 1;
    }
    G.type = t.slice(0, 4); G.type2 = t.slice(4);
    // néha a glitch-csel együtt a „blob tracking” réteg is felvillan a torzított részen
    if (blob ?? Math.random() < (full ? 0.55 : 0.4)) BT.glitch = { until: G.end + 220, rect: G.rect.slice(), seed: Math.random() * 1000 };
    const [rx, ry, rw, rh] = G.rect;
    for (const b of bodies.values()) {
      if (!b.el || b.kind === "drift") continue;
      const bx = b.sx ?? b.x, by = b.sy ?? b.y;
      if (bx > rx && bx < rx + rw && by > ry && by < ry + rh) {
        b.el.classList.add("glitch");
        b.el.style.setProperty("--gx", ((Math.random() - 0.5) * 9).toFixed(1) + "px");
        clearTimeout(b.glitchT);
        b.glitchT = setTimeout(() => b.el && b.el.classList.remove("glitch"), G.end - now);
      }
    }
  }

  /* ----- „blob tracking” réteg -----
     Számítógépes látás (blobkövetés) stílusú rajz: a pontfelhő-betűk köré követődobozok,
     azonosítók, koordináták, összekötő vonalak; glitchnél a torzított részen is felvillan. */
  const ov = document.createElement("canvas");
  ov.id = "blobs"; ov.setAttribute("aria-hidden", "true");
  canvas.after(ov);
  const oc = ov.getContext("2d");
  ovReady = true;
  const BT = { glitch: null, lost: new Map(), dirty: false };
  let ovScale = 1;
  function sizeOverlay() {
    ovScale = Math.min(2, window.devicePixelRatio || 1);
    ov.width = Math.round(W * ovScale); ov.height = Math.round(H * ovScale);
    ov.style.width = W + "px"; ov.style.height = H + "px";
  }
  const MONO_FONT = '"DM Mono", "Roboto Mono", ui-monospace, Menlo, Consolas, monospace';
  try { document.fonts.load(`500 10px "DM Mono"`); } catch {}
  sizeOverlay();
  const pad2 = (n) => String(n).padStart(2, "0");
  function hashN(a, b = 0) { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }
  function tag(x, y, text, col, alpha) {
    oc.font = `500 ${W < 640 ? 8.5 : 9.5}px ${MONO_FONT}`;
    const w = oc.measureText(text).width + 6;
    oc.fillStyle = `rgba(0,0,0,${0.55 * alpha})`;
    oc.fillRect(x, y - 11, w, 12);
    oc.fillStyle = col;
    oc.fillText(text, x + 3, y - 2);
  }
  function box(x0, y0, x1, y1, col, { corner = 6, alpha = 1, dash = null } = {}) {
    oc.strokeStyle = col; oc.globalAlpha = alpha * 0.55; oc.lineWidth = 1;
    if (dash) oc.setLineDash(dash);
    oc.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
    oc.setLineDash([]);
    // erősebb sarokjelek
    oc.globalAlpha = alpha; oc.lineWidth = 1.5;
    const c = Math.min(corner, (x1 - x0) / 3, (y1 - y0) / 3);
    oc.beginPath();
    oc.moveTo(x0, y0 + c); oc.lineTo(x0, y0); oc.lineTo(x0 + c, y0);
    oc.moveTo(x1 - c, y0); oc.lineTo(x1, y0); oc.lineTo(x1, y0 + c);
    oc.moveTo(x1, y1 - c); oc.lineTo(x1, y1); oc.lineTo(x1 - c, y1);
    oc.moveTo(x0 + c, y1); oc.lineTo(x0, y1); oc.lineTo(x0, y1 - c);
    oc.stroke();
    oc.globalAlpha = 1;
  }
  function cross(x, y, r, col, alpha = 1) {
    oc.strokeStyle = col; oc.globalAlpha = alpha; oc.lineWidth = 1;
    oc.beginPath(); oc.moveTo(x - r, y); oc.lineTo(x + r, y); oc.moveTo(x, y - r); oc.lineTo(x, y + r); oc.stroke();
    oc.globalAlpha = 1;
  }
  function drawBlobs(now, cells, gems) {
    const texts = cells.filter((b) => b.cloud && b.tframe && b.alpha > 0.05);
    const gl8 = BT.glitch && now < BT.glitch.until ? BT.glitch : null;
    if (!texts.length && !gl8) { if (BT.dirty) { oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, ov.width, ov.height); BT.dirty = false; } return; }
    BT.dirty = true;
    oc.setTransform(ovScale, 0, 0, ovScale, 0, 0);
    oc.clearRect(0, 0, W, H);
    oc.textBaseline = "alphabetic";
    const tk = reduced ? 0 : Math.floor(now / 110);       // a követés „rángása”
    const tint = mono > 0.5 ? `rgb(${monoTint.map((v) => Math.round(Math.min(1, v * 1.2) * 255)).join(",")})` : "rgb(235,244,255)";
    const acc = mono > 0.5 ? tint : "rgb(120,235,255)";
    const glitchJ = G.amt > 0 ? 6 * G.amt : 0;
    // --- a pontfelhő-betűk követése ---
    let id = 0;
    const centers = [];
    texts.forEach((b, wi) => {
      const a = b.alpha;
      const L = b.cloud.letters;
      let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
      const pts = [];
      L.forEach((lt, li) => {
        id++;
        // a betű dobozának 8 sarka (elöl és hátul) → képernyőn befoglaló téglalap
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const d of [0, 1]) for (const [px, py] of [[lt.x0, lt.y0], [lt.x1, lt.y0], [lt.x1, lt.y1], [lt.x0, lt.y1]]) {
          const q = lidar.textToScreen(b, px, py, d);
          if (!q) continue;
          x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
        }
        if (!isFinite(x0)) return;
        ux0 = Math.min(ux0, x0); uy0 = Math.min(uy0, y0); ux1 = Math.max(ux1, x1); uy1 = Math.max(uy1, y1);
        const key = b.key + li;
        // néha „elveszti” a követést egy rövid időre
        const lostT = BT.lost.get(key) || 0;
        if (!reduced && now > lostT + 400 && hashN(tk, id * 3.1 + wi) < 0.012) BT.lost.set(key, now);
        if (now - (BT.lost.get(key) || -1e9) < 260) return;
        const j = reduced ? 0 : 1.6;
        const jx = (hashN(tk, id) - 0.5) * j * 2 + (hashN(tk, id + 50) - 0.5) * glitchJ;
        const jy = (hashN(tk + 7, id) - 0.5) * j * 2;
        const pd = 4;
        box(x0 - pd + jx, y0 - pd + jy, x1 + pd + jx, y1 + pd + jy, tint, { alpha: a * 0.9 });
        const cx = (x0 + x1) / 2 + jx, cy = (y0 + y1) / 2 + jy;
        cross(cx, cy, 3, acc, a * 0.9);
        pts.push([cx, cy]);
        const conf = (0.86 + 0.13 * hashN(Math.floor(now / 700), id)).toFixed(2);
        if (li % 2 === 0 || W >= 900) tag(x0 - pd + jx, y0 - pd + jy - 2, `#${pad2(id)} ${lt.ch}`, tint, a);
        if (W >= 900 && li % 2 === 1) { oc.globalAlpha = a * 0.8; tag(x0 - pd + jx, y1 + pd + jy + 12, `${Math.round(cx)},${Math.round(cy)} ${conf}`, acc, a); oc.globalAlpha = 1; }
      });
      if (!isFinite(ux0)) return;
      // a betűközéppontokat összekötő vonal
      oc.strokeStyle = acc; oc.globalAlpha = a * 0.45; oc.lineWidth = 1;
      oc.beginPath(); pts.forEach(([x, y], i) => (i ? oc.lineTo(x, y) : oc.moveTo(x, y))); oc.stroke();
      oc.globalAlpha = 1;
      // a teljes szó: szaggatott keret, felirattal
      const m = 14;
      box(ux0 - m, uy0 - m, ux1 + m, uy1 + m, tint, { alpha: a * 0.6, corner: 12, dash: [3, 4] });
      const area = Math.round((ux1 - ux0) * (uy1 - uy0));
      tag(ux0 - m, uy1 + m + 13, `BLOB_${pad2(wi + 1)} ${b.cloud.lines.join(" ")}  A=${area}  N=${b.cloud.count}`, tint, a * 0.9);
      centers.push([(ux0 + ux1) / 2, (uy0 + uy1) / 2, a]);
    });
    // a szavak között hosszú összekötő vonal, távolsággal
    if (centers.length > 1) {
      for (let i = 0; i < centers.length - 1; i++) {
        const [x0, y0, a0] = centers[i], [x1, y1, a1] = centers[i + 1];
        oc.strokeStyle = tint; oc.globalAlpha = Math.min(a0, a1) * 0.3; oc.setLineDash([2, 5]);
        oc.beginPath(); oc.moveTo(x0, y0); oc.lineTo(x1, y1); oc.stroke(); oc.setLineDash([]);
        oc.globalAlpha = 1;
        tag((x0 + x1) / 2 - 24, (y0 + y1) / 2 - 6, `d=${Math.round(Math.hypot(x1 - x0, y1 - y0))}`, acc, Math.min(a0, a1) * 0.8);
      }
    }
    // --- glitch közben: követődobozok a torzított részen ---
    if (gl8) {
      const [rx, ry, rw, rh] = gl8.rect;
      const fk = Math.floor(now / 55);
      const inR = (x, y) => x > rx && x < rx + rw && y > ry && y < ry + rh;
      const found = [];
      for (const b of [...cells, ...gems]) {
        const x = b.sx ?? b.x, y = b.sy ?? b.y;
        if (!inR(x, y) || b.alpha < 0.2 || b.cloud) continue;
        const r = b.kind === "drift" ? b.ax * 0.8 : Math.min(b.ax, b.ay) * 0.75;
        found.push([x - r * 1.1, y - r * 0.8, x + r * 1.1, y + r * 0.8]);
      }
      const n = 5 + Math.floor(hashN(gl8.seed, 1) * 7);
      for (let i = 0; i < n; i++) {
        const w = 18 + hashN(gl8.seed + i, fk % 3) * 110, h = 14 + hashN(gl8.seed - i, fk % 4) * 70;
        const x = rx + hashN(gl8.seed, i * 2 + (fk % 5)) * Math.max(1, rw - w), y = ry + hashN(gl8.seed, i * 2 + 1 + (fk % 2)) * Math.max(1, rh - h);
        found.push([x, y, x + w, y + h]);
      }
      const cs = [];
      found.forEach(([x0, y0, x1, y1], i) => {
        if (hashN(fk, i + gl8.seed) < 0.12) return;   // villódzó kiesés
        box(x0, y0, x1, y1, i % 3 === 0 ? acc : tint, { alpha: 0.85, corner: 5 });
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        cross(cx, cy, 3, acc, 0.9);
        cs.push([cx, cy]);
        tag(x0, y0 - 2, `ID ${pad2(Math.floor(hashN(gl8.seed, i) * 90) + 10)}`, tint, 0.95);
        if (x1 - x0 > 60) tag(x0, y1 + 12, `${Math.round(cx)},${Math.round(cy)}`, acc, 0.8);
      });
      oc.strokeStyle = acc; oc.globalAlpha = 0.4; oc.beginPath();
      cs.forEach(([x, y], i) => (i ? oc.lineTo(x, y) : oc.moveTo(x, y))); oc.stroke(); oc.globalAlpha = 1;
    }
  }

  /* ----- jelenet ----- */

  // items: [{key, label, href, kind: name|center|child|nav|drift, tint, size}]
  // halmazok elrendezése: minden halmaz magja a halmaz középpontjában, a tagok körülötte
  // kifelé néző íven, a közös tagok a halmazok között (a metszetben)
  function layoutSets(scene, content, P, narrow) {
    const SC = scene.sets.map((st) => ({ x: st.x, y: st.y }));
    const nuclei = [];
    content.forEach((s) => { if (s.nucleus != null) nuclei[s.nucleus] = s; });
    if (P && nuclei[0]) {
      const c0 = nuclei[0];
      if (narrow) { SC[0].x = W / 2; SC[0].y = P.y - P.hh - c0.ay * 0.62; }
      else { SC[0].x = Math.max(c0.ax + 12, P.x - P.hw - c0.ax * 0.62); SC[0].y = P.y - P.hh * 0.2; }
    }
    nuclei.forEach((s, k) => { if (s) { s.anchor = { ...SC[k] }; s.heavy = true; } });
    const mid = { x: SC.reduce((a, c) => a + c.x, 0) / SC.length, y: SC.reduce((a, c) => a + c.y, 0) / SC.length };
    const shared = content.filter((s) => s.nucleus == null && (s.sets || []).length > 1);
    if (shared.length) {
      const ks = shared[0].sets;
      const m = { x: ks.reduce((a, k) => a + SC[k].x, 0) / ks.length, y: ks.reduce((a, k) => a + SC[k].y, 0) / ks.length };
      const ax = SC[ks[1]].x - SC[ks[0]].x, ay = SC[ks[1]].y - SC[ks[0]].y, al = Math.hypot(ax, ay) || 1;
      const perp = Math.atan2(ax / al, -ay / al);
      const hub = shared.find((s) => s.kind === "center") || shared[0];
      hub.anchor = m; hub.heavy = true;
      shared.filter((s) => s !== hub).forEach((s, i) => {
        const a = perp + (i % 2 ? Math.PI : 0) + Math.floor(i / 2) * 0.75 * (i % 2 ? -1 : 1);
        const ux = Math.cos(a), uy = Math.sin(a), d = (rE(hub, ux, uy) + rE(s, ux, uy)) * 0.88;
        s.anchor = { x: m.x + ux * d, y: m.y + uy * d };
      });
    }
    SC.forEach((C, k) => {
      const mem = content.filter((s) => s.nucleus == null && (s.sets || []).length === 1 && s.sets[0] === k);
      const nuc = nuclei[k];
      if (!nuc && mem.length) {
        const order = [...mem].sort((a, b) => b.ax * b.ay - a.ax * a.ay);
        const rAvg = order.reduce((a, s) => a + Math.sqrt(s.ax * s.ay), 0) / order.length;
        order.forEach((s, i) => {
          const a = i * 2.39996 + (scene.startAngle ?? 0);
          const d = i === 0 ? 0 : rAvg * 1.62 * Math.sqrt(i);
          s.anchor = { x: C.x + Math.cos(a) * d * 1.15, y: C.y + Math.sin(a) * d * 0.9 };
          s.heavy = i === 0 && order.length > 2;
        });
        return;
      }
      const many = SC.length > 1;
      const away = many ? Math.atan2(C.y - mid.y, C.x - mid.x) : scene.startAngle ?? -Math.PI / 2;
      const spread = many ? Math.min(Math.PI * 1.6, mem.length * 1.05) : Math.PI * 2;
      mem.forEach((s, i) => {
        const a = many ? away + spread * ((i + 0.5) / mem.length - 0.5) : away + (Math.PI * 2 * i) / mem.length;
        const ux = Math.cos(a), uy = Math.sin(a);
        const d = nuc ? (rE(nuc, ux, uy) + rE(s, ux, uy)) * 0.88 : 0;
        s.anchor = { x: C.x + ux * d, y: C.y + uy * d };
      });
    });
    content.filter((s) => !(s.sets || []).length).forEach((s) => {
      s.anchor = (scene.anchors && scene.anchors[s.key]) || { x: W / 2, y: H * 0.12 };
      if (s.kind === "name") s.heavy = true;
    });
  }

  function trimGems() {
    let n = 0;
    for (const b of bodies.values()) if (b.kind === "drift" && ++n > tier.gems) { b.tax = 0; b.tay = 0; b.dying = true; }
  }
  function setScene(scene) {
    let items = scene.items;
    const first = bodies.size === 0;
    monoTarget = scene.mono ? 1 : 0;
    comp = scene.comp || null;
    topInset = scene.topInset || 0;
    if (scene.monoTint) monoTintTarget = scene.monoTint;
    document.documentElement.style.setProperty("--mono-tint", `rgb(${(scene.monoTint || [1, 1, 1]).map((v) => Math.round(v * 255)).join(",")})`);
    nSets = Math.min(3, (scene.sets || []).length);
    setCols = new Float32Array(9);
    (scene.sets || []).slice(0, 3).forEach((st, k) => setCols.set(TINT_DATA[st.tint ?? 0].slice(0, 3), k * 3));
    document.documentElement.classList.toggle("mono", !!scene.mono);
    if (!first && GLITCH.onNavigate) burst({ full: true, power: 1, dur: GLITCH.navigateLength, types: [1, Math.random() < 0.4 ? 1 : 0, 1, 1, Math.random() < 0.5 ? 1 : 0, 1, 0, 0] });
    const narrow = W < 640;
    // panel (műoldal szövegfelülete)
    if (scene.panel) { panel = scene.panel; panelTarget = 1; } else panelTarget = 0;

    // méretezés a felirat alapján: a szöveg a fix szélességű perem belsejébe férjen
    const rimK = narrow ? 0.65 : 1;
    const rimOf = (kind) => (kind === "name" || kind === "center" ? 44 : kind === "nav" ? 22 : 34) * rimK;
    const fit = (it, fsScale, minScale) => {
      const st = { ...(STYLE[it.kind] || STYLE.child), ...(it.upper != null ? { upper: it.upper } : {}) };
      const text = st.upper ? it.label.toLocaleUpperCase("hu") : it.label;
      const fs = it.size * fsScale;
      const lines = splitLines(text, fs, st.weight, it.kind === "name" ? W * (narrow ? 0.5 : 0.62) : narrow ? W * 0.42 : W * 0.28);
      const tw = Math.max(...lines.map((l) => textW(l, fs, st.weight) * (1 + st.track * 0.9))) / 2 + fs * 0.5;
      const th = (lines.length * fs * 1.06) / 2 + fs * 0.15;
      const rim = rimOf(it.kind);
      const maxAsp = it.kind === "name" ? 2.4 : 1.8;
      let ax = Math.max((it.minR || 0) * minScale, tw + rim), ay = Math.max(th + rim, ax / maxAsp);
      for (let i = 0; i < 6; i++) {
        const r = Math.sqrt(ax * ay);
        const g = 1 / Math.max(0.35, 1 - (rim * 1.15) / r) / 0.86;
        ax = Math.max((it.minR || 0) * minScale, tw * g);
        ay = Math.max(th * g, ax / maxAsp, (it.minR || 0) * minScale * 0.7);
      }
      if (it.pointText) { ax *= 0.76; ay *= 0.86; }
      return { ...it, text, lines, fs, ax, ay, st };
    };
    const P = scene.panel;
    const area = P ? (narrow ? W * (P.y - P.hh) * 0.85 : (P.x - P.hw) * H * 1.2) : W * H;
    const driftSize = (it) => {
      const n = parseInt(it.key.replace(/\D/g, ""), 10) || 0;
      const z = DEPTHS[n % DEPTHS.length];
      const r = it.r * (z > 0.3 ? 3.4 : z < -0.2 ? 0.9 : 1.6) * (narrow ? 0.75 : 1);
      return { ...it, z, ax: r, ay: r, lines: [] };
    };
    let gemCount = 0;
    items = items.filter((it) => it.kind !== "drift" || gemCount++ < tier.gems);
    let sized = items.map((it) => (it.kind === "drift" ? driftSize(it) : fit(it, 1, 1)));
    {
      const content = sized.filter((s) => s.kind !== "drift");
      const sum = content.reduce((a, s) => a + Math.PI * s.ax * s.ay, 0);
      const maxAx = Math.max(...content.map((s) => s.ax), 1);
      const k = Math.min(scene.maxGrow ?? 1.4, Math.sqrt((area * (narrow ? 0.46 : 0.36)) / sum), (W * (narrow ? 0.47 : 0.4)) / maxAx);
      if (Math.abs(k - 1) > 0.02) sized = items.map((it, i) => (it.kind === "drift" ? sized[i] : fit(it, Math.max(0.55, k > 1 ? 1 + (k - 1) * 0.6 : k), k)));
    }
    const content = sized.filter((s) => s.kind !== "drift");

    if (scene.sets) layoutSets(scene, content, P, narrow);
    else {
    // horgonyok: a középső körül szorosan körbe
      const c = content.find((s) => s.kind === "center" || s.kind === "name");
      const others = content.filter((s) => s !== c);
      let cx = scene.cx ?? W / 2, cy = scene.cy ?? H * 0.45;
      if (P && c) {
        // a középső sejt a panelhez simul
        if (narrow) { cx = W / 2; cy = P.y - P.hh - c.ay * 0.62; }
        else { cx = Math.max(c.ax + 12, P.x - P.hw - c.ax * 0.62); cy = P.y - P.hh * 0.2; }
      }
      if (c) { c.anchor = { x: cx, y: cy }; c.heavy = true; }
      const n = others.length;
      const a0 = scene.startAngle ?? Math.PI / 2;
      const spread = scene.spread ?? Math.PI * 2;
      others.forEach((s, i) => {
        const a = a0 + (n === 1 ? 0 : spread * (spread >= Math.PI * 2 - 0.01 ? i / n : i / (n - 1) - 0.5));
        const ux = Math.cos(a), uy = Math.sin(a);
        const d = c ? (rE(c, ux, uy) + rE(s, ux, uy)) * 0.88 : 0;
        s.anchor = { x: cx + ux * d, y: cy + uy * d };
        if (scene.anchors && scene.anchors[s.key]) s.anchor = scene.anchors[s.key];
      });
    }

    const keep = new Set();
    for (const s of sized) {
      keep.add(s.key);
      let b = bodies.get(s.key);
      if (!b) {
        const sx = s.anchor ? s.anchor.x : Math.random() * W;
        const sy = s.anchor ? s.anchor.y : Math.random() * H;
        b = { key: s.key, x: sx + (Math.random() - 0.5) * 30, y: sy + (Math.random() - 0.5) * 30, vx: 0, vy: 0, ax: 0, ay: 0, seed: Math.random(), hover: 0, el: null, nudge: Math.random() * 4, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.35 };
        if (s.kind === "drift" && s.z > 0.3) b.anchor0 = { x: Math.random() < 0.5 ? W * 0.04 : W * 0.96, y: H * (0.12 + Math.random() * 0.76) };
        bodies.set(s.key, b);
      }
      Object.assign(b, {
        kind: s.kind, tint: s.tint ?? 0, href: s.href || null, anchor: s.anchor || b.anchor0 || null, heavy: !!s.heavy, z: s.z ?? 0, active: !!s.active, pointText: !!s.pointText,
        mask: (s.sets || []).reduce((m, k) => m | (1 << k), 0),
        tax: s.ax, tay: s.ay, dying: false, fs: s.fs, lines: s.lines, st: s.st,
      });
      if (s.kind !== "drift") updateLabel(b);
    }
    for (const b of bodies.values()) if (!keep.has(b.key)) { b.tax = 0; b.tay = 0; b.dying = true; b.href = null; if (b.el) b.el.classList.add("gone"); }
  }

  function updateLabel(b) {
    const tag = b.href ? "a" : "span";
    if (!b.el || b.el.tagName.toLowerCase() !== tag) {
      if (b.el) b.el.remove();
      b.el = document.createElement(tag);
      b.el.className = "cell-label";
      labelLayer.appendChild(b.el);
    }
    b.el.classList.remove("gone");
    b.el.dataset.kind = b.kind;
    b.el.classList.toggle("active", !!b.active);
    b.el.classList.toggle("pc", !!b.pointText);   // a felirat pontfelhőként látszik, a HTML-szöveg csak kattintható / felolvasható
    if (b.href) b.el.setAttribute("href", b.href);
    b.el.style.fontSize = b.fs.toFixed(1) + "px";
    b.el.style.fontWeight = b.st.weight;
    b.el.style.letterSpacing = b.st.track + "em";
    const html = b.lines.map((l) => `<span>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`).join("");
    if (b.el.innerHTML !== html) b.el.innerHTML = html;
    if (b.href) {
      b.el.onmouseenter = () => (hoverKey = b.key);
      b.el.onmouseleave = () => { if (hoverKey === b.key) hoverKey = null; };
      b.el.onfocus = () => (hoverKey = b.key);
      b.el.onblur = () => { if (hoverKey === b.key) hoverKey = null; };
    }
  }

  /* ----- fizika ----- */

  const layerOf = (b) => (b.kind !== "drift" ? "c" : b.z < -0.2 ? "far" : b.z > 0.3 ? "near" : "focal");

  function step(dt) {
    const list = [...bodies.values()];
    const live = reduced ? 0 : 1;
    for (const b of list) {
      b.ax += (b.tax - b.ax) * 0.09; b.ay += (b.tay - b.ay) * 0.09;
      b.hover += ((hoverKey === b.key ? 1 : b.active ? 0.65 : 0) - b.hover) * 0.12;
      b.rot += b.spin * dt * live;
      if (b.kind !== "drift" && b.el) {
        const op = Math.min(1, Math.max(0, (b.ax / (b.tax || b.ax || 1)) * 1.4 - 0.4));
        const o = b.dying ? "0" : op.toFixed(2);
        if (b._op !== o) { b._op = o; b.el.style.opacity = o; }
      }
    }
    for (const b of [...list]) if (b.dying && b.ax < 1.5) { if (b.el) b.el.remove(); bodies.delete(b.key); }

    const content = list.filter((b) => b.kind !== "drift" && !b.dying);
    let gx = W / 2, gy = H / 2;
    if (content.length) {
      gx = 0; gy = 0;
      for (const b of content) { gx += b.x; gy += b.y; }
      gx /= content.length; gy /= content.length;
    }
    focus = [gx, gy];
    // a kompozíció súlypontja a kért helyre csúszik (pl. a nyitóoldalon középre)
    const compF = comp && content.length ? [(comp.x - gx) * 0.004, (comp.y - gy) * 0.004] : [0, 0];
    const setC = [0, 1, 2].map((k) => {
      const m = content.filter((b) => b.mask & (1 << k));
      return m.length ? [m.reduce((a, b) => a + b.x, 0) / m.length, m.reduce((a, b) => a + b.y, 0) / m.length] : null;
    });

    for (const b of list) {
      const L = layerOf(b);
      let fx = 0, fy = 0;
      if (b.anchor) {
        const k = b.heavy ? 0.0035 : L === "near" ? 0.0005 : 0.0012;
        fx += (b.anchor.x - b.x) * k; fy += (b.anchor.y - b.y) * k;
      }
      if (L === "c" && !b.heavy) { fx += compF[0]; fy += compF[1]; }
      if (L === "c" && content.length > 1) {
        fx += (gx - b.x) * 0.0003; fy += (gy - b.y) * 0.0003;
        // a saját halmaz(ok) súlypontja felé
        if (b.mask) {
          let tx = 0, ty = 0, n = 0;
          for (let k = 0; k < 3; k++) if (b.mask & (1 << k) && setC[k]) { tx += setC[k][0]; ty += setC[k][1]; n++; }
          if (n) { fx += (tx / n - b.x) * 0.0012; fy += (ty / n - b.y) * 0.0012; }
        }
      }
      const nx = Math.sin(b.y * 0.004 + time * 0.31 + b.seed * 6) + Math.sin(b.x * 0.003 - time * 0.17);
      const ny = Math.cos(b.x * 0.0035 + time * 0.27 + b.seed * 4) + Math.sin(b.y * 0.005 + time * 0.21);
      const cur = L === "c" ? 0.018 : L === "near" ? 0.025 : 0.05;
      fx += nx * cur * live; fy += ny * cur * live;
      b.nudge -= dt;
      if (b.nudge < 0 && live) {
        b.nudge = 2.5 + Math.random() * 5;
        const a = Math.random() * Math.PI * 2, s = L === "c" ? 0.9 : 1.4;
        b.vx += Math.cos(a) * s; b.vy += Math.sin(a) * s;
      }
      const m = L === "near" ? -b.ax * 0.55 : L === "far" ? -b.ax * 0.3 : 8;
      if (b.x - b.ax < m) fx += (m - (b.x - b.ax)) * 0.06;
      if (b.x + b.ax > W - m) fx -= (b.x + b.ax - (W - m)) * 0.06;
      const mTop = L === "c" ? Math.max(m, topInset) : m;
      if (b.y - b.ay < mTop) fy += (mTop - (b.y - b.ay)) * 0.06;
      if (b.y + b.ay > H - m) fy -= (b.y + b.ay - (H - m)) * 0.06;
      if (L !== "c" && (b.x < -260 || b.x > W + 260 || b.y < -260 || b.y > H + 260)) { b.x = Math.random() * W; b.y = H + b.ax; }
      b.fx = fx; b.fy = fy;
    }

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.ax < 1) continue;
      const la = layerOf(a);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.ax < 1) continue;
        const lb = layerOf(b);
        // csak az azonos mélységben levők ütköznek; a közeli kristályok kitérnek a tartalom elől
        let mode;
        if (la === "c" && lb === "c") mode = "both";
        else if (la === "far" || lb === "far") { if (la !== lb) continue; mode = "drift"; }
        else if (la === "near" || lb === "near") {
          if (la === lb) mode = "drift";
          else if (la === "c" || lb === "c") mode = "avoid";
          else continue;
        } else mode = "drift";
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const ux = dx / d, uy = dy / d;
        const rs = rE(a, ux, uy) + rE(b, ux, uy);
        if (mode === "avoid") {
          const target = rs * 1.05;
          if (d < target) {
            const f = (target - d) * 0.03;
            if (la === "near") { a.fx -= ux * f; a.fy -= uy * f; } else { b.fx += ux * f; b.fy += uy * f; }
          }
          continue;
        }
        if (mode === "both" && !((a.mask & b.mask) || (!a.mask && !b.mask))) {
          const gap = padPx() * (a.mask && b.mask ? 2.0 : 1.35);
          const target = rs * 0.92 + gap;
          if (d < target) {
            const f = -(target - d) * 0.06;
            const ma = a.heavy ? 3 : 1, mb = b.heavy ? 3 : 1;
            a.fx += ux * f / ma; a.fy += uy * f / ma;
            b.fx -= ux * f / mb; b.fy -= uy * f / mb;
          }
          continue;
        }
        const both = mode === "both" && !a.dying && !b.dying;
        const target = rs * (both ? 0.85 : 1.12);
        let f = 0;
        if (d < target) f = -(target - d) * 0.08;
        else if (both && d < rs * 1.8) f = Math.min(d - target, 40) * 0.008;
        if (f < -0.4) {
          const rel = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
          if (rel < -0.8 && Math.random() < 0.08) ripple(a.x + ux * rE(a, ux, uy), a.y + uy * rE(a, ux, uy), Math.min(1, -rel * 0.5));
        }
        const ma = a.heavy ? 3 : 1, mb = b.heavy ? 3 : 1;
        a.fx += ux * f / ma; a.fy += uy * f / ma;
        b.fx -= ux * f / mb; b.fy -= uy * f / mb;
      }
    }

    if (panel && panelOn > 0.05) {
      const hw = panel.hw * panelOn, hh = panel.hh * panelOn;
      for (const b of list) {
        if (b.ax < 1 || layerOf(b) === "far") continue;
        const sd = sdRBox(b.x, b.y, panel.x, panel.y, hw, hh, 30);
        const gx2 = sdRBox(b.x + 1, b.y, panel.x, panel.y, hw, hh, 30) - sdRBox(b.x - 1, b.y, panel.x, panel.y, hw, hh, 30);
        const gy2 = sdRBox(b.x, b.y + 1, panel.x, panel.y, hw, hh, 30) - sdRBox(b.x, b.y - 1, panel.x, panel.y, hw, hh, 30);
        const gl2 = Math.hypot(gx2, gy2) || 1;
        const ux = gx2 / gl2, uy = gy2 / gl2;
        const r = rE(b, ux, uy);
        const target = r * (b.kind === "drift" ? 0.95 : 0.84);
        let f = 0;
        if (sd < target) f = (target - sd) * 0.06;
        else if (b.kind !== "drift" && sd < r * 1.6) f = -(sd - target) * 0.008;
        b.fx += ux * f; b.fy += uy * f;
      }
    }

    for (const b of list) {
      const m = b.heavy ? 2 : 1;
      b.vx = (b.vx + b.fx / m) * 0.93;
      b.vy = (b.vy + b.fy / m) * 0.93;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 6) { b.vx *= 6 / sp; b.vy *= 6 / sp; }
      b.x += b.vx; b.y += b.vy;
    }

    panelOn += (panelTarget - panelOn) * 0.08;
    mono += (monoTarget - mono) * 0.06;
    for (let i = 0; i < 3; i++) monoTint[i] += (monoTintTarget[i] - monoTint[i]) * 0.06;
    for (let i = 0; i < 3; i++) {
      envTint[i] += ((monoTarget ? ENV_MONO : ENV_HOME)[i] - envTint[i]) * 0.05;
      deepTint[i] += ((monoTarget ? DEEP_MONO : DEEP_HOME)[i] - deepTint[i]) * 0.05;
    }
    const idle = live ? [Math.sin(time * 0.13) * 8, Math.cos(time * 0.11) * 6] : [0, 0];
    cam[0] += (camTarget[0] + idle[0] - cam[0]) * 0.04;
    cam[1] += (camTarget[1] + idle[1] - cam[1]) * 0.04;
    for (const r of ripples) r.t += dt;
    while (ripples.length && ripples[0].t > 3.5) ripples.shift();
  }

  /* ----- kirajzolás ----- */

  let noisePts = null, noiseFor = -1;
  function draw(now) {
    window.__drawn = (window.__drawn || 0) + 1;
    const cells = [], gems = [];
    for (const b of bodies.values()) {
      const alpha = Math.max(0, Math.min(1, b.tax ? b.ax / b.tax : b.ax > 1 ? 1 : 0)) * (b.dying ? Math.min(1, b.ax / 20) : 1);
      if (b.kind === "drift") { b.alpha = alpha; gems.push(b); continue; }
      b.alpha = alpha;
      b.kindCode = b.kind === "nav" ? 1 : b.kind === "center" || b.kind === "name" ? 2 : 0;
      b.cloud = b.pointText && b.lines && b.lines.length && !b.dying
        ? makeTextCloud({ lines: b.lines, fs: b.fs, weight: b.st.weight, track: b.st.track, family: LOOK.displayFont, ver: fontVer, budget: [4200, 7000, 11000][tier.q] })
        : null;
      cells.push(b);
    }
    if (noiseFor !== tier.q) { noisePts = makeNoisePoints([140, 260, 420][tier.q]); noiseFor = tier.q; }

    // glitch állapota
    if (now < G.end) {
      if (now - G.seedT > 55) { G.seedT = now; G.seed = Math.random() * 100; }
      G.amt = G.power * (0.55 + 0.45 * Math.random());
    } else G.amt = 0;

    const Ld = LOOK.lidar;
    const t = reduced ? 3 : time;
    const sets = [];
    for (let k = 0; k < nSets; k++) sets.push({ k, col: Array.from(setCols.slice(k * 3, k * 3 + 3)) });

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    lidar.render({
      W, H, scale, time: t,
      pitch: Ld.pitch, yaw: Ld.yaw,
      sway: {
        yaw: Ld.sway * Math.sin(t * 0.07) * 4 + cam[0] * 0.14,
        pitch: Ld.sway * Math.sin(t * 0.05 + 1) * 1.6 + cam[1] * 0.1,
        dx: 0, dz: 0,
      },
      cells, gems, sets, ripples, pad: padPx(),
      tints: new Float32Array(TINT_DATA.flat()), glow: GLOW_DATA,
      gemA: GEM_A, gemB: GEM_B, look: Ld, noise: noisePts, reduced,
    });
    drawBlobs(now, cells, gems);
    // a feliratok a vetített helyre
    for (const b of cells) {
      if (!b.el || b.sx === undefined) continue;
      // a felirat mindig a képernyőn belül marad
      b.sx = Math.max(18, Math.min(W - 18, b.sx));
      b.sy = Math.max(16 + topInset * 0.8, Math.min(H - 16, b.sy));
      const tr = `translate(${b.sx.toFixed(1)}px, ${b.sy.toFixed(1)}px) translate(-50%, -50%)`;
      if (b._tr !== tr) { b._tr = tr; b.el.style.transform = tr; }
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    const P = post.U;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(post.p);
    gl.bindVertexArray(quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(P.uTex, 0);
    gl.uniform2f(P.uRes, canvas.width, canvas.height);
    gl.uniform1f(P.uScale, scale);
    gl.uniform1f(P.uTime, time);
    gl.uniform1f(P.uMono, mono);
    gl.uniform1f(P.uGlitch, G.amt);
    gl.uniform1f(P.uGSeed, G.seed);
    gl.uniform1f(P.uDofK, W < 640 ? 7 : 10);
    gl.uniform4fv(P.uGRect, G.rect);
    gl.uniform4fv(P.uGType, G.type);
    gl.uniform4fv(P.uGType2, G.type2);
    gl.uniform1f(P.uGrain, LOOK.grain);
    gl.uniform3fv(P.uMonoTint, monoTint);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  let running = true, ema = 0, lastAdapt = performance.now() + 3000, lastDraw = 0, slowStreak = 0;
  const still = params.has("still");
  function frame(now) {
    if (!running) return;
    if (still) {
      // tesztelés: fizika előre lefuttatva, egyetlen képkocka
      if (bodies.size) {
        for (let s = 0; s < 420; s++) { time += 1 / 60; step(1 / 60); }
        mono = monoTarget; monoTint.splice(0, 3, ...monoTintTarget);
        if (params.get("glitch")) {
          const t = params.get("glitch").split("").map(Number);
          G.next = Infinity;
          burst({ full: params.has("full"), power: 1, dur: 1e6, types: t });
          G.seed = 42;
        }
        draw(performance.now()); running = false; return;
      }
      requestAnimationFrame(frame); return;
    }
    // képkocka-korlát: gyengébb szinteken 30 fps (a mozgás ugyanolyan gyors marad)
    // csökkentett mozgásnál a kép áll, elég ritkán frissíteni
    const fps = reduced ? 15 : tier.fps;
    const minInterval = 1000 / fps - 2;
    if (now - lastDraw < minInterval) { requestAnimationFrame(frame); return; }
    const interval = lastDraw ? now - lastDraw : minInterval;
    lastDraw = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // ha a gép nem bírja a tempót, előbb a felbontás csökken, aztán egyszerűbb shaderre vált
    ema = ema ? ema * 0.92 + interval * 0.08 : interval;
    if (now - lastAdapt > 1500 && !params.has("noadapt")) {
      lastAdapt = now;
      const target = 1000 / fps;
      if (ema > target * 1.45) {
        slowStreak++;
        if (scale > tier.minScale * 1.05) { quality *= 0.85; resize(); }
        else if (tierIdx > 0 && slowStreak > 2) {
          tierIdx--; tier = TIERS[tierIdx]; window.__tier = tier.name;
          quality = 1; buildPrograms(); resize(); trimGems();
        }
      } else slowStreak = 0;
    }
    time += dt;
    // kb. 10 másodpercenként egy jól látható glitch-sorozat (több gyors villanás egymás után)
    if (now > G.next) {
      G.next = now + GLITCH.minGap + Math.random() * Math.max(0, GLITCH.maxGap - GLITCH.minGap);
      const n = Math.max(1, Math.round(GLITCH.burstCount));
      let t = now;
      G.queue = [];
      for (let i = 0; i < n; i++) { G.queue.push({ t, full: i === 0 ? Math.random() < Math.max(GLITCH.fullChance, 0.5) : Math.random() < GLITCH.fullChance }); t += GLITCH.minLength + 60 + Math.random() * 240; }
    }
    if (G.queue && G.queue.length && now >= G.queue[0].t) { const q = G.queue.shift(); burst({ full: q.full }); }
    const steps = Math.max(1, Math.round(dt * 60));
    for (let s = 0; s < steps; s++) step(1 / 60);
    draw(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden && !still && !paused;
    if (running) { last = performance.now(); requestAnimationFrame(frame); }
  });

  /* ----- egér / érintés ----- */

  function hit(x, y) {
    let best = null, bf = 1;
    for (const b of bodies.values()) {
      if (b.ax < 2 || (b.kind === "drift" && Math.abs(b.z) > 0.3)) continue;
      const f = Math.hypot((x - (b.sx ?? b.x)) / b.ax, (y - (b.sy ?? b.y)) / b.ay);
      if (f < bf) { bf = f; best = b; }
    }
    return best;
  }
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") {
      camTarget[0] = -((e.clientX - W / 2) / W) * 50;
      camTarget[1] = -((e.clientY - H / 2) / H) * 36;
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const b = hit(e.clientX, e.clientY);
    hoverKey = b && b.href ? b.key : null;
    canvas.style.cursor = hoverKey ? "pointer" : "default";
  });
  canvas.addEventListener("pointerleave", () => (hoverKey = null));
  canvas.addEventListener("click", (e) => {
    const b = hit(e.clientX, e.clientY);
    ripple(e.clientX, e.clientY, 0.9);
    if (b) {
      const a = Math.atan2(b.y - e.clientY, b.x - e.clientX);
      b.vx += Math.cos(a) * 2; b.vy += Math.sin(a) * 2;
      if (b.href && opts.onNavigate) opts.onNavigate(b.href);
    }
  });

  if (params.has("debug")) window.__bodies = bodies;
  if (params.has("debug")) window.__G = G;
  if (params.has("debug")) window.__burst = burst;
  if (params.has("debug")) window.__bench = (n = 10) => {
    // csak teszteléshez: n teljes képkocka GPU-ideje, a böngésző többi munkája nélkül
    running = false;
    const pix = new Uint8Array(4);
    draw(performance.now()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pix);
    const t = performance.now();
    for (let i = 0; i < n; i++) { time += 1 / 60; draw(performance.now()); }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pix);
    return (performance.now() - t) / n;
  };
  let paused = false;
  function pause(on) {
    if (on === paused) return;
    paused = on;
    running = !on && !document.hidden && !still;
    if (running) { last = performance.now(); requestAnimationFrame(frame); }
  }
  return { setScene, resize, ripple, burst, pause, size: () => ({ W, H }) };
}
