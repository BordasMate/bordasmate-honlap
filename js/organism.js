// Fémes, bioorganikus sejtfelület: WebGL2 shader + egyszerű vízfelszíni fizika.
// A sejtek egy multiplikatívan súlyozott Voronoi-felosztás (Apollonius-cellák)
// részei, ezért ahol összeérnek, közös, ívelt határuk lesz – rés nélkül.

const MAX_B = 40;
const MAX_R = 8;

/* ---------------- shader ---------------- */

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uRes;
uniform float uScale;
uniform float uTime;
uniform int uN;
uniform vec4 uB[${MAX_B}];   // x, y, ax, ay
uniform vec4 uC[${MAX_B}];   // kind, tint, hover, seed
uniform vec4 uPanel;         // cx, cy, hw, hh
uniform float uPanelOn;
uniform float uPanelTint;
uniform float uRimK;
uniform vec4 uRip[${MAX_R}]; // x, y, age, strength
uniform vec4 uTint[5];       // rgb = fém tónusa, a = irizálás
uniform vec3 uGlow[5];

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float sdRBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

float water(vec2 p){
  float t = uTime;
  float v = 0.05*sin(p.x*0.011 + t*0.7 + 2.0*sin(p.y*0.008 + t*0.25))
          + 0.035*sin(p.y*0.016 - t*0.55 + p.x*0.005)
          + 0.06*noise(p*0.012 + vec2(t*0.12, -t*0.09));
  for (int i = 0; i < ${MAX_R}; i++) {
    vec4 r = uRip[i];
    if (r.w <= 0.0) continue;
    float d = length(p - r.xy);
    float rad = r.z * 170.0;
    float ring = d - rad;
    v += r.w * 0.16 * sin(ring * 0.13) * exp(-abs(ring) / 34.0) * exp(-r.z * 1.1);
  }
  return v;
}

// x: magasság, y: sejt (-1 víz, 99 panel), z: mélyedés (feliratmező), w: határtávolság px
vec4 field(vec2 p, out vec4 attr, out float f1o){
  vec2 w = vec2(noise(p*0.006 + vec2(uTime*0.06, 0.0)), noise(p*0.006 + vec2(13.1, -uTime*0.05))) - 0.5;
  vec2 q = p + w * 24.0;
  float f1 = 1e5, f2 = 1e5, r1 = 1.0, r2 = 1.0, id = -1.0, men = 0.0;
  attr = vec4(0.0);
  for (int i = 0; i < ${MAX_B}; i++) {
    if (i >= uN) break;
    vec4 b = uB[i];
    if (b.z < 0.5) continue;
    vec4 c = uC[i];
    vec2 d = (q - b.xy) / b.zw;
    float f = length(d);
    float ang = atan(d.y, d.x);
    // a szabad peremen tüskék / hullámzás
    float th = c.x > 2.5
      ? pow(abs(sin(ang * 3.5 + c.w * 6.0 + uTime * 0.35)), 12.0) * 0.16
      : 0.02 * sin(ang * 6.0 + c.w * 9.0 + uTime * 0.6) + pow(abs(sin(ang * 5.0 + c.w * 4.0 - uTime * 0.2)), 24.0) * 0.07;
    f /= (1.0 + th * smoothstep(0.62, 0.98, f));
    float r = sqrt(b.z * b.w);
    men += exp(min(0.0, (1.0 - f) * r) / 14.0);
    if (f < f1) { f2 = f1; r2 = r1; f1 = f; r1 = r; id = float(i); attr = c; }
    else if (f < f2) { f2 = f; r2 = r; }
  }
  if (uPanelOn > 0.01) {
    float sd = sdRBox(q - uPanel.xy, uPanel.zw, 30.0);
    float f = 1.0 + sd / 170.0;
    if (f < f1) { f2 = f1; r2 = r1; f1 = f; r1 = 170.0; id = 99.0; attr = vec4(4.0, uPanelTint, 0.0, 0.3); }
    else if (f < f2) { f2 = f; r2 = 170.0; }
  }
  f1o = f1;
  float seam = (f2 - f1) / (1.0 / r1 + 1.0 / r2);
  float outer = (1.0 - f1) * r1;
  float bd = min(seam, outer);
  if (outer > 0.0) {
    // a perem szélessége px-ben, sejttípus szerint
    float rim = (attr.x > 1.5 && attr.x < 2.5 ? 44.0 : attr.x > 0.5 && attr.x < 1.5 ? 22.0 : 34.0) * uRimK;
    if (id > 98.0) rim = 26.0;
    float bev = smoothstep(0.0, rim * 0.6, bd);
    float h = 0.25 + 0.75 * sqrt(bev);
    // bordázott perem
    float ribZone = 1.0 - smoothstep(rim * 0.55, rim * 0.95, bd);
    h += 0.045 * sin(bd * 0.75) * smoothstep(rim * 0.3, rim * 0.5, bd) * ribZone;
    // erezet a peremen
    float vn = abs(noise(q * 0.03 + attr.w * 40.0) - 0.5);
    h += 0.05 * (1.0 - smoothstep(0.0, 0.05, vn)) * smoothstep(6.0, 14.0, bd) * ribZone;
    float sock = 0.0;
    if (attr.x < 2.5 || id > 98.0) {
      // mélyedés: a perem belső szélétől lejt le
      sock = smoothstep(rim * 0.92, rim * 1.15, bd);
      float depth = smoothstep(rim * 0.92, rim * 2.2, bd);
      h -= 0.75 * sock * (0.45 + 0.55 * depth);
      // gyűrűk a mélyedés szélén
      h += 0.025 * sin(bd * 1.4) * (smoothstep(rim * 0.95, rim * 1.1, bd) - smoothstep(rim * 1.2, rim * 1.6, bd));
    } else {
      h += 0.05 * sin(f1 * 40.0 - uTime);
    }
    return vec4(h, id, sock, bd);
  }
  if (uPanelOn > 0.01) men += exp(min(0.0, -sdRBox(q - uPanel.xy, uPanel.zw, 30.0)) / 14.0);
  float wv = water(p) + 0.3 * min(men, 1.4);
  return vec4(wv, -1.0, 0.0, outer);
}

vec3 env(vec3 r){
  float up = -r.y;
  vec3 c = mix(vec3(0.012, 0.013, 0.017), vec3(0.42, 0.45, 0.5), smoothstep(-0.35, 0.85, up));
  c += vec3(1.5) * exp(-pow((up - 0.2) * 7.5, 2.0));
  c += vec3(0.8) * exp(-pow((r.x + 0.6) * 5.0, 2.0)) * smoothstep(-0.1, 0.6, up);
  c += vec3(0.35) * exp(-pow((r.x - 0.7) * 7.0, 2.0));
  c *= 0.82 + 0.18 * sin(r.x * 11.0 + up * 3.0);
  return c;
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec4 A; float f1;
  vec4 ax, ay; float fx, fy;
  vec4 F = field(p, A, f1);
  float e = 1.4;
  vec4 Fx = field(p + vec2(e, 0.0), ax, fx);
  vec4 Fy = field(p + vec2(0.0, e), ay, fy);
  bool cell = F.y > -0.5;
  float K = cell ? 26.0 : 75.0;
  vec3 n = normalize(vec3(-(Fx.x - F.x) / e * K, -(Fy.x - F.x) / e * K, 1.0));
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);

  int ti = cell ? int(A.y + 0.5) : 4;
  vec4 tint = uTint[ti];
  vec3 glow = uGlow[ti];
  float fres = pow(1.0 - n.z, 2.0);
  vec3 en = env(r);
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + fres * 1.9 + F.x * 0.6 + uTime * 0.025 + A.w));
  vec3 col = en * tint.rgb;
  col = mix(col, en * irid * 1.25, tint.a * (0.25 + 0.75 * fres));
  col += vec3(1.6) * pow(max(dot(r, normalize(vec3(-0.35, -0.55, 0.76))), 0.0), 140.0);
  col += vec3(0.5) * pow(max(dot(r, normalize(vec3(0.5, -0.2, 0.84))), 0.0), 40.0);

  if (cell) {
    // feliratmező: sötét, lakkfényű mélyedés
    col = mix(col, col * 0.1 + vec3(0.006), F.z * 0.88);
    col *= 0.35 + 0.65 * smoothstep(0.0, 6.0, F.w);
    float hov = A.z;
    col += glow * hov * (exp(-abs(f1 - 0.64) * 26.0) * 0.9 + exp(-F.w / 5.0) * 0.5);
    col += glow * 0.18 * exp(-abs(f1 - 0.64) * 40.0) * (0.6 + 0.4 * sin(uTime * 1.3 + A.w * 20.0));
    if (A.x > 2.5 && A.x < 3.5) col *= 0.55;
  } else {
    col *= 0.55;
    col *= 0.4 + 0.6 * smoothstep(0.0, 22.0, -F.w);
  }
  // sötét varratok, kontúr
  float line = 1.0 - smoothstep(0.5, 1.8, abs(F.w));
  col *= 1.0 - 0.94 * line;

  vec2 uv = p / (uRes / uScale);
  col *= 1.0 - 0.45 * pow(length(uv - 0.5) * 1.25, 2.2);
  col = col / (1.0 + col * 0.35);
  col = pow(col, vec3(0.92));
  col += (hash(p + fract(uTime) * 91.0) - 0.5) * 0.03;
  outColor = vec4(col, 1.0);
}`;

/* ---------------- színek ---------------- */

// 0: titán (nyitóoldal), 1: réz (Irodalom), 2: kobalt (Zene), 3: zöldarany, 4: víz
export const TINTS = {
  titan: 0, rez: 1, kobalt: 2, zoldarany: 3,
};
const TINT_DATA = [
  [0.78, 0.8, 0.84, 0.55],
  [0.95, 0.56, 0.36, 0.35],
  [0.42, 0.55, 0.95, 0.6],
  [0.72, 0.8, 0.42, 0.45],
  [0.2, 0.21, 0.24, 0.28],
];
const GLOW_DATA = [
  [0.55, 0.95, 1.0],
  [1.0, 0.45, 0.15],
  [0.35, 0.55, 1.0],
  [0.75, 1.0, 0.3],
  [0, 0, 0],
];

/* ---------------- segédek ---------------- */

const measure = document.createElement("canvas").getContext("2d");
function textW(s, size, weight) {
  measure.font = `${weight} ${size}px Syne, system-ui, sans-serif`;
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
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
  if (!gl) return null;

  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ["uRes", "uScale", "uTime", "uN", "uB", "uC", "uPanel", "uPanelOn", "uPanelTint", "uRimK", "uRip", "uTint", "uGlow"]) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform4fv(U.uTint, TINT_DATA.flat());
  gl.uniform3fv(U.uGlow, GLOW_DATA.flat());

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const bodies = new Map();   // key -> body
  const ripples = [];
  let panel = null, panelOn = 0, panelTarget = 0;
  let W = 0, H = 0, scale = 1;
  let hoverKey = null;
  let t0 = performance.now(), last = t0, time = 0;
  const bArr = new Float32Array(MAX_B * 4), cArr = new Float32Array(MAX_B * 4), rArr = new Float32Array(MAX_R * 4);

  let quality = parseFloat(new URLSearchParams(location.search).get("res")) || 1;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    scale = Math.min(dpr, Math.sqrt(2.6e6 / (W * H))) * quality;
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();

  function ripple(x, y, s = 1) {
    ripples.push({ x, y, t: 0, s });
    if (ripples.length > MAX_R) ripples.shift();
  }

  /* ----- jelenet ----- */

  // items: [{key, label, href, kind: name|center|child|nav|drift, tint, size}]
  function setScene(scene) {
    const items = scene.items;
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
      return { ...it, text, lines, fs, ax, ay, st };
    };
    const P = scene.panel;
    const area = P ? (narrow ? W * (P.y - P.hh) * 0.85 : (P.x - P.hw) * H * 1.2) : W * H;
    let sized = items.map((it) => (it.kind === "drift" ? { ...it, ax: it.r, ay: it.r * (0.8 + hash(it.r) * 0.3), lines: [] } : fit(it, 1, 1)));
    {
      const content = sized.filter((s) => s.kind !== "drift");
      const sum = content.reduce((a, s) => a + Math.PI * s.ax * s.ay, 0);
      const maxAx = Math.max(...content.map((s) => s.ax), 1);
      const k = Math.min(scene.maxGrow ?? 1.4, Math.sqrt((area * (narrow ? 0.46 : 0.36)) / sum), (W * (narrow ? 0.47 : 0.4)) / maxAx);
      if (Math.abs(k - 1) > 0.02) sized = items.map((it, i) => (it.kind === "drift" ? sized[i] : fit(it, Math.max(0.55, k > 1 ? 1 + (k - 1) * 0.6 : k), k)));
    }
    const content = sized.filter((s) => s.kind !== "drift");

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

    const keep = new Set();
    for (const s of sized) {
      keep.add(s.key);
      let b = bodies.get(s.key);
      if (!b) {
        const sx = s.anchor ? s.anchor.x : Math.random() * W;
        const sy = s.anchor ? s.anchor.y : Math.random() * H;
        b = { key: s.key, x: sx + (Math.random() - 0.5) * 30, y: sy + (Math.random() - 0.5) * 30, vx: 0, vy: 0, ax: 0, ay: 0, seed: Math.random(), hover: 0, el: null, nudge: Math.random() * 4 };
        bodies.set(s.key, b);
      }
      Object.assign(b, {
        kind: s.kind, tint: s.tint ?? 0, href: s.href || null, anchor: s.anchor || null, heavy: !!s.heavy,
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

  function step(dt) {
    const list = [...bodies.values()];
    const live = reduced ? 0 : 1;
    for (const b of list) {
      const g = 0.09;
      b.ax += (b.tax - b.ax) * g; b.ay += (b.tay - b.ay) * g;
      b.hover += ((hoverKey === b.key ? 1 : 0) - b.hover) * 0.12;
      if (b.kind !== "drift" && b.el) {
        const op = Math.min(1, Math.max(0, (b.ax / (b.tax || b.ax || 1)) * 1.4 - 0.4));
        b.el.style.opacity = b.dying ? 0 : op;
      }
    }
    for (const b of [...list]) if (b.dying && b.ax < 1.5) { if (b.el) b.el.remove(); bodies.delete(b.key); }

    const content = list.filter((b) => b.kind !== "drift" && !b.dying);
    let gx = 0, gy = 0;
    for (const b of content) { gx += b.x; gy += b.y; }
    if (content.length) { gx /= content.length; gy /= content.length; }

    for (const b of list) {
      let fx = 0, fy = 0;
      if (b.anchor) {
        const k = b.heavy ? 0.0035 : 0.0012;
        fx += (b.anchor.x - b.x) * k; fy += (b.anchor.y - b.y) * k;
      }
      if (b.kind !== "drift" && content.length > 1) { fx += (gx - b.x) * 0.0005; fy += (gy - b.y) * 0.0005; }
      // vízáramlás
      const nx = Math.sin(b.y * 0.004 + time * 0.31 + b.seed * 6) + Math.sin(b.x * 0.003 - time * 0.17);
      const ny = Math.cos(b.x * 0.0035 + time * 0.27 + b.seed * 4) + Math.sin(b.y * 0.005 + time * 0.21);
      const cur = b.kind === "drift" ? 0.05 : 0.018;
      fx += nx * cur * live; fy += ny * cur * live;
      // időnkénti lökés
      b.nudge -= dt;
      if (b.nudge < 0 && live) {
        b.nudge = 2.5 + Math.random() * 5;
        const a = Math.random() * Math.PI * 2, s = b.kind === "drift" ? 1.6 : 0.9;
        b.vx += Math.cos(a) * s; b.vy += Math.sin(a) * s;
      }
      // falak
      const m = 8;
      if (b.x - b.ax < m) fx += (m - (b.x - b.ax)) * 0.06;
      if (b.x + b.ax > W - m) fx -= (b.x + b.ax - (W - m)) * 0.06;
      if (b.y - b.ay < m) fy += (m - (b.y - b.ay)) * 0.06;
      if (b.y + b.ay > H - m) fy -= (b.y + b.ay - (H - m)) * 0.06;
      if (b.kind === "drift") {
        // a sodródó sejtek a képernyőn kívülről visszaúsznak
        if (b.x < -200 || b.x > W + 200 || b.y < -200 || b.y > H + 200) { b.x = Math.random() * W; b.y = H + 120; }
      }
      b.fx = fx; b.fy = fy;
    }

    // páronkénti ütközés és összetartás
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.ax < 1) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.ax < 1) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy) || 0.01;
        const ux = dx / d, uy = dy / d;
        const rs = rE(a, ux, uy) + rE(b, ux, uy);
        const both = a.kind !== "drift" && b.kind !== "drift" && !a.dying && !b.dying;
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

    // panel mint rögzített test
    if (panel && panelOn > 0.05) {
      const hw = panel.hw * panelOn, hh = panel.hh * panelOn;
      for (const b of list) {
        if (b.ax < 1) continue;
        const sd = sdRBox(b.x, b.y, panel.x, panel.y, hw, hh, 30);
        const e = 1;
        const gx2 = sdRBox(b.x + e, b.y, panel.x, panel.y, hw, hh, 30) - sdRBox(b.x - e, b.y, panel.x, panel.y, hw, hh, 30);
        const gy2 = sdRBox(b.x, b.y + e, panel.x, panel.y, hw, hh, 30) - sdRBox(b.x, b.y - e, panel.x, panel.y, hw, hh, 30);
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
    for (const r of ripples) r.t += dt;
    while (ripples.length && ripples[0].t > 3.5) ripples.shift();
  }

  /* ----- kirajzolás ----- */

  function draw() {
    const list = [...bodies.values()].slice(0, MAX_B);
    list.forEach((b, i) => {
      const bob = reduced ? 1 : 1 + 0.018 * Math.sin(time * (0.9 + b.seed * 0.6) + b.seed * 20);
      bArr.set([b.x, b.y, b.ax * bob, b.ay * (2 - bob)], i * 4);
      const kind = b.kind === "drift" ? 3 : b.kind === "nav" ? 1 : b.kind === "center" || b.kind === "name" ? 2 : 0;
      cArr.set([kind, b.tint, b.hover, b.seed], i * 4);
      if (b.el && b.kind !== "drift") b.el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px) translate(-50%, -50%)`;
    });
    rArr.fill(0);
    ripples.forEach((r, i) => rArr.set([r.x, r.y, r.t, r.s], i * 4));
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uScale, scale);
    gl.uniform1f(U.uTime, reduced ? 3 : time);
    gl.uniform1i(U.uN, list.length);
    gl.uniform4fv(U.uB, bArr);
    gl.uniform4fv(U.uC, cArr);
    gl.uniform4fv(U.uRip, rArr);
    if (panel) gl.uniform4f(U.uPanel, panel.x, panel.y, panel.hw * panelOn, panel.hh * panelOn);
    gl.uniform1f(U.uPanelOn, panel ? panelOn : 0);
    gl.uniform1f(U.uRimK, W < 640 ? 0.65 : 1);
    gl.uniform1f(U.uPanelTint, panel ? panel.tint ?? 0 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let running = true, ema = 1 / 60, lastAdapt = performance.now() + 2000;
  const still = new URLSearchParams(location.search).has("still");
  function frame(now) {
    if (!running) return;
    if (still) {
      // tesztelés: fizika előre lefuttatva, egyetlen képkocka
      if (bodies.size) { for (let s = 0; s < 420; s++) { time += 1 / 60; step(1 / 60); } draw(); running = false; return; }
      requestAnimationFrame(frame); return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // gyengébb gépen a felbontás magától csökken, hogy a mozgás folyamatos maradjon
    ema = ema * 0.95 + dt * 0.05;
    if (now - lastAdapt > 2000) {
      lastAdapt = now;
      if (ema > 1 / 38 && quality > 0.45) { quality *= 0.85; resize(); }
    }
    time += dt;
    // fix lépésköz: lassú gépen is stabil
    const steps = Math.max(1, Math.round(dt * 60));
    for (let s = 0; s < steps; s++) step(1 / 60);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) { last = performance.now(); requestAnimationFrame(frame); }
  });

  /* ----- egér / érintés ----- */

  function hit(x, y) {
    let best = null, bf = 1;
    for (const b of bodies.values()) {
      if (b.ax < 2) continue;
      const f = Math.hypot((x - b.x) / b.ax, (y - b.y) / b.ay);
      if (f < bf) { bf = f; best = b; }
    }
    return best;
  }
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

  if (new URLSearchParams(location.search).has("debug")) window.__bodies = bodies;
  return { setScene, resize, ripple, size: () => ({ W, H }) };
}
