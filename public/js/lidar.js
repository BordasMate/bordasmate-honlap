// LiDAR-szerű pontfelhő-renderelő: dőlt, perspektivikus „térképlap”, rajta
// magasság szerint színezett pontokból álló 3D amőbák, halmazkontúrok és lebegő kristályok.
// A fizika és az elrendezés képernyő-koordinátákban dolgozik (organism.js); itt ezeket
// a talajsíkra vetítjük, és a mozgó kamerával rajzoljuk ki.

export const MAX_CELLS = 24;
export const MAX_GEMS = 14;
export const MAX_TEXT = 4;
const MAX_SETS = 3;
const MAX_RIP = 8;

/* ---------------- kis vektor- és mátrixkönyvtár ---------------- */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(eye, target, up) {
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
function mat4mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

/* ---------------- shaderek ---------------- */

const COMMON = `
precision highp float;
float hash1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
}
// „turbo” színskála: lila → kék → cián → zöld → sárga → narancs → vörös (a LiDAR-magasságtérképek színei)
vec3 turbo(float x){
  x = clamp(x, 0.0, 1.0);
  const vec4 kR = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kG = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kB = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kR2 = vec2(-152.94239396, 59.28637943);
  const vec2 kG2 = vec2(4.27729857, 2.82956604);
  const vec2 kB2 = vec2(-89.90310912, 27.34824973);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return clamp(vec3(dot(v4, kR) + dot(v2, kR2), dot(v4, kG) + dot(v2, kG2), dot(v4, kB) + dot(v2, kB2)), 0.0, 1.0);
}
uniform mat4 uVP;
uniform mat4 uV;
uniform float uTime, uPointK, uPtSize, uHRef, uFocus, uFocusRange, uTintMix;
uniform vec4 uTint[5];
out vec3 vCol;
out float vCoc;
void emit(vec3 pos, vec3 col, float worldSize){
  vec4 vp = uV * vec4(pos, 1.0);
  gl_Position = uVP * vec4(pos, 1.0);
  float dist = max(1.0, -vp.z);
  gl_PointSize = clamp(uPointK * uPtSize * worldSize / dist, 1.0, 9.0);
  vCol = col;
  vCoc = clamp(abs(dist - uFocus) / uFocusRange, 0.0, 1.0);
}
void hide(){ gl_Position = vec4(3.0, 3.0, 3.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); vCoc = 0.0; }
`;

// a sejtek adatai: C = (x, z, rx, rz), D = (magasság, emelés, kiemelés, seed), E = (tónus, fajta, láthatóság, halmazbitek)
const CELL_UNIFORMS = `
uniform int uN;
uniform vec4 uC[${MAX_CELLS}];
uniform vec4 uD[${MAX_CELLS}];
uniform vec4 uE[${MAX_CELLS}];
`;

const GROUND_VS = `#version 300 es
layout(location = 0) in vec3 aG;   // rácskoordináta (0..1, 0..1), véletlen
${COMMON}
${CELL_UNIFORMS}
uniform vec4 uSlab;               // középpont x, z, fél oldalhossz, -
uniform float uRelief, uPad;
uniform int uNS;
uniform vec3 uSetCol[${MAX_SETS}];
uniform vec4 uRip[${MAX_RIP}];
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
void main(){
  vec2 jitter = (vec2(hash1(aG.z * 91.7), hash1(aG.z * 13.3)) - 0.5) * 0.9 / GRIDN;
  vec2 g = aG.xy + jitter;
  vec3 pos = vec3(uSlab.x + (g.x - 0.5) * 2.0 * uSlab.z, 0.0, uSlab.y + (g.y - 0.5) * 2.0 * uSlab.z);
  // domborzat: lassan hullámzó felszín + kattintásra futó gyűrűk
  float t = uTime;
  float hgt = uRelief * (14.0 * (vnoise(pos.xz * 0.004 + vec2(t * 0.03, 0.0)) - 0.5)
            + 6.0 * sin(pos.x * 0.012 + t * 0.6 + 2.0 * sin(pos.z * 0.009 + t * 0.2))
            + 4.0 * vnoise(pos.xz * 0.02 - t * 0.05));
  for (int i = 0; i < ${MAX_RIP}; i++) {
    vec4 r = uRip[i];
    if (r.w <= 0.0) continue;
    float ring = length(pos.xz - r.xy) - r.z * 220.0;
    hgt += r.w * 16.0 * sin(ring * 0.09) * exp(-abs(ring) / 40.0) * exp(-r.z * 1.0);
  }
  // halmazok: a talaj kissé megemelkedik és a halmaz színét veszi fel; a peremen fényes kontúr
  float minF = 9.0;
  float dk[${MAX_SETS}];
  for (int k = 0; k < ${MAX_SETS}; k++) dk[k] = 1e5;
  for (int i = 0; i < ${MAX_CELLS}; i++) {
    if (i >= uN) break;
    vec4 C = uC[i]; vec4 E = uE[i];
    if (E.z < 0.05) continue;
    float f = length((pos.xz - C.xy) / C.zw);
    minF = min(minF, f);
    float d = (f - 1.0) * min(C.z, C.w);
    int bits = int(E.w + 0.5);
    for (int k = 0; k < ${MAX_SETS}; k++) if ((bits & (1 << k)) != 0) dk[k] = smin(dk[k], d, 60.0);
  }
  if (minF < 0.98) { hide(); return; }   // a sejtek alatt nincs talajpont
  // a talaj a skála alján: lila–kék, a domborzattal enyhén világosodva
  vec3 col = turbo(0.1 + 0.16 * clamp((hgt + 16.0) / 44.0, 0.0, 1.0));
  float lit = 0.62 + 0.5 * hash1(aG.z * 3.7);
  col *= lit;
  for (int k = 0; k < ${MAX_SETS}; k++) {
    if (k >= uNS) break;
    float d = dk[k] - uPad;
    if (d < 0.0) { hgt += 7.0 * smoothstep(0.0, -30.0, d); col = mix(col, uSetCol[k] * (0.55 + 0.45 * lit), 0.5); }
    float edge = 1.0 - smoothstep(0.0, 7.0, abs(d));
    col = mix(col, uSetCol[k] * 1.5 + 0.15, edge * 0.9);
  }
  pos.y = hgt;
  emit(pos, col, 2.9);
}`;

const CELL_VS = `#version 300 es
layout(location = 0) in vec4 aP;  // sejt sorszáma, u (kör), v (magasság), w (véletlen)
${COMMON}
${CELL_UNIFORMS}
uniform float uDensity;
void main(){
  int i = int(aP.x + 0.5);
  if (i >= uN) { hide(); return; }
  vec4 C = uC[i], D = uD[i], E = uE[i];
  float w = aP.w, v = aP.z;
  // nagyobb sejt = több pont; a teteje ritkább, hogy a felirat olvasható maradjon
  float dens = clamp(C.z * C.w / 7000.0, 0.22, 1.0) * uDensity * E.z;
  if (w > dens) { hide(); return; }
  if (v > 0.62 && fract(w * 13.7) > 0.4) { hide(); return; }
  float ang = aP.y * 6.2831853;
  float wob = 1.0 + 0.08 * sin(ang * 3.0 + uTime * 0.7 + D.w * 20.0) + 0.05 * sin(ang * 5.0 - uTime * 0.5 + D.w * 7.0)
            + 0.03 * sin(v * 6.0 + uTime * 1.1 + D.w * 3.0);
  float radial = sqrt(max(0.0, 1.0 - v * v));
  float shell = 0.84 + 0.16 * fract(w * 7.31);
  vec3 pos = vec3(cos(ang) * C.z * radial * wob * shell, pow(v, 0.85) * D.x * shell, sin(ang) * C.w * radial * wob * shell);
  pos.xz += C.xy;
  pos.y += D.y;
  // mint a fák a LiDAR-képen: alul kék, a tetején sárga–vörös
  float rel = clamp((pos.y - D.y) / max(D.x, 1.0), 0.0, 1.0);
  float hn = pos.y / uHRef;
  vec3 col = turbo(0.16 + rel * 0.62 + hn * 0.18);
  vec4 tint = uTint[int(E.x + 0.5)];
  col = mix(col, tint.rgb * (0.45 + 0.9 * hn), uTintMix);
  col *= 0.7 + 0.45 * fract(w * 3.17);
  col = mix(col, vec3(1.0), D.z * 0.35);
  emit(pos, col, 3.1 * (1.0 + 0.35 * D.z));
}`;

const GEM_VS = `#version 300 es
layout(location = 0) in vec4 aP;  // kristály sorszáma, véletlenek
${COMMON}
uniform int uNG;
uniform vec4 uGP[${MAX_GEMS}];    // x, y, z, sugár
uniform vec4 uGA[${MAX_GEMS}];    // forgás, seed, tónus, láthatóság
uniform vec3 uGemA, uGemB;
void main(){
  int i = int(aP.x + 0.5);
  if (i >= uNG) { hide(); return; }
  vec4 P = uGP[i], A = uGA[i];
  if (aP.w > A.w) { hide(); return; }
  // pont egy oktaéder felületén (kristály), a pontok egy része egy kisebb, belső kristályon
  float face = floor(aP.y * 8.0);
  vec2 b = vec2(fract(aP.y * 8.0), aP.z);
  if (b.x + b.y > 1.0) b = 1.0 - b;
  vec3 s = vec3(mod(face, 2.0) < 1.0 ? 1.0 : -1.0, mod(floor(face / 2.0), 2.0) < 1.0 ? 1.0 : -1.0, face < 4.0 ? 1.0 : -1.0);
  vec3 q = vec3(b.x, 1.0 - b.x - b.y, b.y) * s;
  q.y *= 1.5;
  bool inner = fract(aP.w * 17.3) < 0.3;
  if (inner) q *= 0.45;
  float r = A.x, c = cos(r), sn = sin(r);
  q = vec3(c * q.x + sn * q.z, q.y, -sn * q.x + c * q.z);
  float c2 = cos(r * 0.6 + 0.5), s2 = sin(r * 0.6 + 0.5);
  q = vec3(q.x, c2 * q.y - s2 * q.z, s2 * q.y + c2 * q.z);
  vec3 pos = P.xyz + q * P.w;
  vec3 col = turbo(0.25 + pos.y / uHRef * 0.7);
  vec3 glow = mix(uGemA, uGemB, step(0.5, fract(A.y * 7.31)));
  col = inner ? glow * 1.2 : mix(col, glow, 0.25);
  emit(pos, col, 2.8);
}`;

// térbeli pontfelhő-betűk (a nyitóoldal IRODALOM / ZENE felirata): a kirajzolt betűk mintavételezett
// pontjai elöl, mögöttük kihúzott oldalfalak; a sík a kamera felé néz, és lassan billeg
const TEXT_VS = `#version 300 es
layout(location = 0) in vec4 aT;  // x, y (betűpixel a felirat közepéhez képest), mélység 0..1, véletlen
layout(location = 1) in vec2 aS;  // felirat sorszáma, perempont (0, 0.5, 1)
${COMMON}
uniform int uTN;
uniform vec4 uTO[${MAX_TEXT}];   // origó (világ), világegység / betűpixel
uniform vec3 uTR[${MAX_TEXT}], uTU[${MAX_TEXT}], uTZ[${MAX_TEXT}];
uniform vec4 uTP[${MAX_TEXT}];   // fél szélesség, fél magasság (px), vastagság (világ), pontméret (világ)
uniform vec4 uTQ[${MAX_TEXT}];   // tónus, kiemelés, láthatóság, seed
void main(){
  int i = int(aS.x + 0.5);
  if (i >= uTN) { hide(); return; }
  vec4 O = uTO[i], Pp = uTP[i], Q = uTQ[i];
  if (aT.w > Q.z) { hide(); return; }
  float d = aT.z, edge = aS.y;
  // a pontok enyhén remegnek a mélység mentén (mint egy élő szken)
  float jit = sin(uTime * 2.3 + aT.w * 61.0) * 0.35 + sin(uTime * 0.7 + aT.x * 0.05) * 0.25;
  vec3 pos = O.xyz + uTR[i] * aT.x * O.w - uTU[i] * aT.y * O.w - uTZ[i] * (d * Pp.z + jit * O.w);
  float yN = clamp(0.5 - aT.y / (2.0 * Pp.y), 0.0, 1.0);
  vec3 col;
  if (d < 0.001) {
    col = turbo(0.5 + 0.42 * yN);
    col = mix(col, vec3(1.0), 0.42 + 0.3 * edge);
  } else {
    col = turbo(0.1 + 0.34 * (1.0 - d)) * (0.55 + 0.35 * edge);
  }
  vec4 tint = uTint[int(Q.x + 0.5)];
  col = mix(col, tint.rgb * (0.6 + 0.8 * yN), uTintMix * 0.6);
  // pásztázó szkenvonal
  float sc = 1.0 - smoothstep(0.0, 0.05, abs(fract(aT.x / (2.0 * Pp.x) * 0.6 - uTime * 0.11 + Q.w) - 0.5));
  col += sc * vec3(0.55, 0.6, 0.7) * (d < 0.001 ? 1.0 : 0.5);
  col *= 0.82 + 0.3 * fract(aT.w * 7.13);
  col = mix(col, vec3(1.0), Q.y * 0.3);
  emit(pos, col, Pp.w * (d < 0.001 ? 1.0 : 0.85) * (1.0 + 0.25 * Q.y));
}`;

// szabad pontok: halmazkontúrok, a kiemelt sejt kontúrja, szórt „zajpontok”
const FREE_VS = `#version 300 es
layout(location = 0) in vec4 aP;  // x, y, z, méret
layout(location = 1) in vec3 aC;
${COMMON}
void main(){ emit(aP.xyz, aC, aP.w); }`;

// a sötét lap a pontok alatt (a "térképlap")
const SLAB_VS = `#version 300 es
layout(location = 0) in vec2 aQ;
${COMMON}
uniform vec4 uSlab;
out vec2 vW;
void main(){
  vec3 pos = vec3(uSlab.x + aQ.x * uSlab.z * 1.04, -18.0, uSlab.y + aQ.y * uSlab.z * 1.04);
  vW = aQ;
  emit(pos, vec3(0.0), 1.0);
}`;
const SLAB_FS = `#version 300 es
precision highp float;
in vec3 vCol; in float vCoc; in vec2 vW;
out vec4 o;
float h2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 g = abs(fract(vW * 12.0) - 0.5);
  float grid = 1.0 - smoothstep(0.0, 0.03, min(g.x, g.y));
  float n = h2(floor(vW * 140.0));
  vec3 c = vec3(0.028, 0.03, 0.04) * (0.8 + 0.4 * n) + vec3(0.05, 0.06, 0.09) * grid * 0.5;
  float edge = smoothstep(0.985, 1.0, max(abs(vW.x), abs(vW.y)));
  c += vec3(0.12, 0.13, 0.18) * edge;
  o = vec4(c, vCoc);
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec3 vCol; in float vCoc;
out vec4 o;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  o = vec4(vCol * (1.05 - r * 1.4), vCoc);
}`;

/* ---------------- a renderelő ---------------- */

export function createLidar(gl) {
  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src.split("\n").slice(0, 3).join(" "));
    return s;
  };
  const prog = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = new Proxy({}, { get: (c, n) => (n in c ? c[n] : (c[n] = gl.getUniformLocation(p, n))) });
    return { p, U };
  };

  let P = null;           // programok
  let grid = 0, cellPts = 0, gemPts = 0;
  const vaos = {};
  let counts = {};
  const freeBuf = gl.createBuffer();
  let freeData = new Float32Array(0), freeCount = 0;
  // pontfelhő-betűk
  const textBuf = gl.createBuffer();
  let textVao = null, textKey = "", textCount = 0;
  function uploadText(clouds) {
    const key = clouds.map((c) => c.id).join("|");
    if (key === textKey) return;
    textKey = key;
    const total = clouds.reduce((a, c) => a + c.count, 0);
    const buf = new Float32Array(total * 6);
    let o = 0;
    clouds.forEach((c, slot) => {
      for (let n = 0; n < c.count; n++) {
        buf[o++] = c.data[n * 5]; buf[o++] = c.data[n * 5 + 1]; buf[o++] = c.data[n * 5 + 2]; buf[o++] = c.data[n * 5 + 3];
        buf[o++] = slot; buf[o++] = c.data[n * 5 + 4];
      }
    });
    if (!textVao) {
      textVao = gl.createVertexArray();
      gl.bindVertexArray(textVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, textBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, textBuf);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
    textCount = total;
  }

  function vao(name, data, comps, stride = comps) {
    if (vaos[name]) { gl.deleteVertexArray(vaos[name].vao); gl.deleteBuffer(vaos[name].buf); }
    const v = gl.createVertexArray(), b = gl.createBuffer();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, comps, gl.FLOAT, false, stride * 4, 0);
    gl.bindVertexArray(null);
    vaos[name] = { vao: v, buf: b };
  }

  // pontszámok a teljesítményszint szerint
  function setQuality(q) {
    grid = [120, 170, 236][q];
    cellPts = [650, 1100, 1700][q];
    gemPts = [200, 300, 420][q];
    if (P) for (const k in P) gl.deleteProgram(P[k].p);
    P = {
      ground: prog(GROUND_VS.replace("GRIDN", grid + ".0"), POINT_FS),
      cell: prog(CELL_VS, POINT_FS),
      gem: prog(GEM_VS, POINT_FS),
      free: prog(FREE_VS, POINT_FS),
      slab: prog(SLAB_VS, SLAB_FS),
      text: prog(TEXT_VS, POINT_FS),
    };
    textKey = "";
    // talajrács
    const g = new Float32Array(grid * grid * 3);
    let k = 0;
    for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) { g[k++] = (i + 0.5) / grid; g[k++] = (j + 0.5) / grid; g[k++] = j * grid + i; }
    vao("ground", g, 3);
    // sejtek pontjai
    const rnd = mulberry(7);
    const c = new Float32Array(MAX_CELLS * cellPts * 4);
    k = 0;
    for (let i = 0; i < MAX_CELLS; i++) for (let n = 0; n < cellPts; n++) {
      c[k++] = i; c[k++] = rnd(); c[k++] = Math.pow(rnd(), 0.9); c[k++] = rnd();
    }
    vao("cell", c, 4);
    const gm = new Float32Array(MAX_GEMS * gemPts * 4);
    k = 0;
    for (let i = 0; i < MAX_GEMS; i++) for (let n = 0; n < gemPts; n++) { gm[k++] = i; gm[k++] = rnd(); gm[k++] = rnd(); gm[k++] = rnd(); }
    vao("gem", gm, 4);
    vao("slab", new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2);
    // szabad pontok (minden képkockában frissül)
    const fv = gl.createVertexArray();
    gl.bindVertexArray(fv);
    gl.bindBuffer(gl.ARRAY_BUFFER, freeBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 16);
    gl.bindVertexArray(null);
    vaos.free = { vao: fv, buf: freeBuf };
    counts = { ground: grid * grid, cell: MAX_CELLS * cellPts, gem: MAX_GEMS * gemPts };
  }

  /* ----- kamera ----- */
  const cam = { W: 1, H: 1, fov: (40 * Math.PI) / 180, D: 1, base: null, cur: null };
  function makeCam(W, H, pitchDeg, yawDeg, dx = 0, dz = 0) {
    const pitch = (pitchDeg * Math.PI) / 180, yaw = (yawDeg * Math.PI) / 180;
    const target = [dx, 0, dz];
    const eye = add(target, mul([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)], cam.D));
    const fwd = norm(sub(target, eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
    const V = lookAt(eye, target, [0, 1, 0]);
    const Pm = perspective(cam.fov, W / H, cam.D * 0.05, cam.D * 8);
    return { eye, fwd, right, up, V, P: Pm, VP: mat4mul(Pm, V), tanH: Math.tan(cam.fov / 2), aspect: W / H };
  }
  function setCamera(W, H, pitch, yaw, sway) {
    cam.W = W; cam.H = H;
    cam.D = H / (2 * Math.tan(cam.fov / 2)) * 1.05;
    cam.base = makeCam(W, H, pitch, yaw);
    cam.cur = makeCam(W, H, pitch + sway.pitch, yaw + sway.yaw, sway.dx, sway.dz);
  }
  // képernyőpont → a talajsík pontja (az alapkamerával, így a világbeli helyzet nem remeg a kamerával)
  function toWorld(sx, sy) {
    const c = cam.base;
    const nx = (2 * sx) / cam.W - 1, ny = 1 - (2 * sy) / cam.H;
    let d = norm(add(c.fwd, add(mul(c.right, nx * c.tanH * c.aspect), mul(c.up, ny * c.tanH))));
    if (d[1] > -0.06) d = norm([d[0], -0.06, d[2]]);
    const t = -c.eye[1] / d[1];
    return [c.eye[0] + d[0] * t, c.eye[2] + d[2] * t];
  }
  // világpont → képernyő (a mozgó kamerával)
  function toScreen(x, y, z) {
    const m = cam.cur.VP;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [((cx / cw + 1) / 2) * cam.W, ((1 - cy / cw) / 2) * cam.H, cw];
  }

  // a térképlap: a képernyő nagy részét lefedő, a világ tengelyeihez igazított négyzet
  function slabFor(W, H) {
    const pts = [[0.06, 0.16], [0.94, 0.16], [0.98, 0.98], [0.02, 0.98], [0.5, 0.5]].map(([u, v]) => toWorld(u * W, v * H));
    const c = toWorld(W * 0.5, H * 0.56);
    let half = 0;
    for (const p of pts) half = Math.max(half, Math.abs(p[0] - c[0]), Math.abs(p[1] - c[1]));
    return [c[0], c[1], half * 0.92, 0];
  }

  /* ----- rajzolás ----- */
  function render(s) {
    // s: { W, H, scale, time, pitch, yaw, sway, cells[], gems[], sets[], ripples[], hover, tints, gemA, gemB, look }
    setCamera(s.W, s.H, s.pitch, s.yaw, s.sway);
    const slab = slabFor(s.W, s.H);
    const L = s.look;
    const hRef = Math.max(140, s.H * 0.32);

    // sejtek a világban
    const C = new Float32Array(MAX_CELLS * 4), D = new Float32Array(MAX_CELLS * 4), E = new Float32Array(MAX_CELLS * 4);
    s.cells.slice(0, MAX_CELLS).forEach((b, i) => {
      const [x, z] = toWorld(b.x, b.y);
      const [x2] = toWorld(b.x + 10, b.y);
      const k = Math.abs(x2 - x) / 10 || 1;
      const rx = b.ax * k * 0.98, rz = b.ay * k * 1.2;
      // a pontfelhő-betűk alatt csak alacsony halom marad, a betűk fölötte lebegnek
      const h = Math.min(rx, rz) * 0.95 * L.relief + 14;
      const lift = 6 + Math.sin(s.time * (0.8 + b.seed * 0.5) + b.seed * 20) * 4;
      C.set([x, z, rx, rz], i * 4);
      D.set([h, lift, b.hover, b.seed], i * 4);
      E.set([b.tint, b.kindCode, b.alpha, b.mask || 0], i * 4);
      b.world = { x, z, rx, rz, h, lift };
      // a felirat a kupola belsejében, a mozgó kamera szerint
      const [sx, sy] = toScreen(x, lift + h * 0.42, z);
      b.sx = sx; b.sy = sy;
      b.tframe = null;
    });

    // pontfelhő-betűk: a sík a (nyugodt) kamera felé néz, és lassan billeg, hogy látsszon a mélysége
    const texts = s.cells.filter((b) => b.cloud && b.world).slice(0, MAX_TEXT);
    uploadText(texts.map((b) => b.cloud));
    const TO = new Float32Array(MAX_TEXT * 4), TR = new Float32Array(MAX_TEXT * 3), TU = new Float32Array(MAX_TEXT * 3), TZ = new Float32Array(MAX_TEXT * 3);
    const TP = new Float32Array(MAX_TEXT * 4), TQ = new Float32Array(MAX_TEXT * 4);
    texts.forEach((b, i) => {
      const w = b.world, c = b.cloud;
      const k = w.rx / (b.ax * 0.98);   // világegység / képernyőpixel a sejt helyén
      const th = (s.reduced ? 0 : 0.2 * Math.sin(s.time * 0.23 + b.seed * 6)) + 0.12 * (i % 2 ? -1 : 1);
      const ph = s.reduced ? 0 : 0.07 * Math.sin(s.time * 0.17 + b.seed * 3);
      const cb = cam.base;
      const ct = Math.cos(th), st = Math.sin(th);
      let R = norm(add(mul(cb.right, ct), mul(cb.fwd, st)));
      let Z = norm(add(mul(cb.fwd, -ct), mul(cb.right, st)));   // a kamera felé
      let U = cb.up;
      const cp = Math.cos(ph), sp = Math.sin(ph);
      const U2 = norm(add(mul(U, cp), mul(Z, sp)));
      Z = norm(add(mul(Z, cp), mul(U, -sp)));
      U = U2;
      const thick = c.h * k * 0.32;
      // a felirat a saját halmaza (a kategória és csak hozzá tartozó almenüi) fölött lebeg;
      // ha az egér egy almenüjén van, feljebb csúszik, hogy ne takarja az amőbát
      const mem = s.cells.filter((o) => o !== b && o.world && o.mask === b.mask && o.alpha > 0.05);
      let cx = w.x, cz = w.z, top = w.lift + w.h;
      mem.forEach((o) => { cx += o.world.x; cz += o.world.z; top = Math.max(top, o.world.lift + o.world.h * 0.8); });
      cx /= mem.length + 1; cz /= mem.length + 1;
      let O = [cx, top + (c.h * 0.5) * k * 0.6 + (b.raise || 0) * c.h * k * 1.15, cz];
      // a képen belül marad (vízszintesen és felül)
      const proj = (x, y) => { const p = add(add(O, mul(R, x * k)), mul(U, -y * k)); return toScreen(p[0], p[1], p[2]); };
      const mx = 14, my = s.topInset || 44;
      const l = proj(-c.w / 2, 0), r2 = proj(c.w / 2, 0);
      let dx = 0;
      if (l[0] < mx) dx = mx - l[0]; else if (r2[0] > s.W - mx) dx = s.W - mx - r2[0];
      if (dx) O = add(O, mul(R, dx * k));
      const tp = proj(0, -c.h / 2);
      if (tp[1] < my) O = add(O, mul(U, -(my - tp[1]) * k));
      TO.set([O[0], O[1], O[2], k], i * 4);
      TR.set(R, i * 3); TU.set(U, i * 3); TZ.set(Z, i * 3);
      TP.set([c.w / 2, c.h / 2, thick, c.step * k * 1.3], i * 4);
      TQ.set([b.tint, b.hover, b.alpha, b.seed], i * 4);
      b.tframe = { O, R, U, Z, k, thick };
      const [sx, sy] = toScreen(O[0], O[1], O[2]);
      b.sx = sx; b.sy = sy;
    });

    // kristályok: mélységük szerint a lap fölött, mögött vagy a kamera előtt
    const GP = new Float32Array(MAX_GEMS * 4), GA = new Float32Array(MAX_GEMS * 4);
    const eye = cam.base.eye;
    s.gems.slice(0, MAX_GEMS).forEach((g, i) => {
      // a kamera előtti (közeli) kristályok mindig a kép szélén maradnak, ne takarják a tartalmat
      const gx = g.z > 0.3 ? (g.x < s.W / 2 ? s.W * 0.04 : s.W * 0.96) : g.x;
      const [x, z] = toWorld(gx, g.y);
      const [x2] = toWorld(gx + 10, g.y);
      const k = Math.abs(x2 - x) / 10 || 1;
      let p = [x, 40 + g.ax * k * 1.2, z];
      if (g.z > 0.3) p = add(p, mul(sub(eye, p), 0.22 + 0.18 * g.z));           // közel a kamerához
      if (g.z < -0.2) p = add(add(p, mul(norm(sub(p, eye)), 260 * -g.z)), [0, 120 * -g.z, 0]); // messze, a lap mögött
      GP.set([p[0], p[1], p[2], g.ax * k * 0.9], i * 4);
      GA.set([g.rot, g.seed, g.tint, g.alpha], i * 4);
    });

    // szabad pontok: halmazkontúrok és a kiemelt sejt kontúrja
    const free = [];
    const pushPt = (x, y, z, size, r, g, b) => free.push(x, y, z, size, r, g, b);
    s.sets.forEach((st) => {
      const mem = s.cells.filter((b) => b.world && (b.mask || 0) & (1 << st.k) && b.alpha > 0.05);
      if (!mem.length) return;
      let cx = 0, cz = 0;
      mem.forEach((b) => { cx += b.world.x; cz += b.world.z; });
      cx /= mem.length; cz /= mem.length;
      const pad = s.pad;
      const sdf = (x, z) => {
        let d = 1e5;
        for (const b of mem) {
          const f = Math.hypot((x - b.world.x) / b.world.rx, (z - b.world.z) / b.world.rz);
          const di = (f - 1) * Math.min(b.world.rx, b.world.rz);
          const hh = Math.max(0, Math.min(1, 0.5 + (0.5 * (di - d)) / 60));
          d = di * (1 - hh) + d * hh - 60 * hh * (1 - hh);
        }
        return d - pad;
      };
      const N = 220;
      for (let a = 0; a < N; a++) {
        const ang = (a / N) * Math.PI * 2, ux = Math.cos(ang), uz = Math.sin(ang);
        let lo = 0, hi = 2400;
        if (sdf(cx + ux * hi, cz + uz * hi) < 0) continue;
        for (let it = 0; it < 22; it++) { const m = (lo + hi) / 2; if (sdf(cx + ux * m, cz + uz * m) < 0) lo = m; else hi = m; }
        // a halmaz pereme: néhány pont egymás fölött, mint egy szkennelt fal
        const px = cx + ux * lo, pz = cz + uz * lo;
        for (let l = 0; l < 3; l++) pushPt(px, 4 + l * 6 + Math.sin(a * 0.7 + s.time) * 1.5, pz, 2.6, st.col[0] * 1.3, st.col[1] * 1.3, st.col[2] * 1.3);
      }
    });
    // fényes gyűrű az egérrel kiemelt és az éppen megnyitott sejt körül
    for (const hv of s.cells) {
      if (!(hv.hover > 0.05) || !hv.world) continue;
      const w = hv.world, N = 120, glow = s.glow[hv.tint] || [1, 1, 1];
      for (let a = 0; a < N; a++) {
        const ang = (a / N) * Math.PI * 2;
        pushPt(w.x + Math.cos(ang) * w.rx * 1.05, w.lift + 2, w.z + Math.sin(ang) * w.rz * 1.05, 3.4 * hv.hover, glow[0], glow[1], glow[2]);
      }
    }
    // szórt zajpontok a lap fölött (mint a LiDAR-mérés "kósza" visszaverődései)
    const noise = s.noise;
    for (let i = 0; i < noise.length; i += 4) {
      const x = slab[0] + noise[i] * slab[2], z = slab[1] + noise[i + 1] * slab[2];
      const y = 30 + noise[i + 2] * hRef * 1.6 + Math.sin(s.time * 0.3 + i) * 6;
      const c = turboJS(0.25 + (y / hRef) * 0.6);
      pushPt(x, y, z, 2.2, c[0] * noise[i + 3], c[1] * noise[i + 3], c[2] * noise[i + 3]);
    }
    freeData = new Float32Array(free);
    freeCount = free.length / 7;

    // élesség a tartalom közepén
    let fx = 0, fz = 0, fn = 0;
    for (const b of s.cells) if (b.world && b.alpha > 0.5) { fx += b.world.x; fz += b.world.z; fn++; }
    const fc = fn ? [fx / fn, 30, fz / fn] : [0, 0, 0];
    const focusDist = Math.hypot(...sub(cam.cur.eye, fc));
    // közös uniformok
    const common = (pr) => {
      const U = pr.U;
      gl.useProgram(pr.p);
      gl.uniformMatrix4fv(U.uVP, false, cam.cur.VP);
      gl.uniformMatrix4fv(U.uV, false, cam.cur.V);
      gl.uniform1f(U.uTime, s.time);
      gl.uniform1f(U.uPointK, (s.H * s.scale) / (2 * Math.tan(cam.fov / 2)));
      gl.uniform1f(U.uPtSize, L.pointSize * Math.max(0.75, Math.min(1.4, 1 / Math.sqrt(s.scale))));
      gl.uniform1f(U.uHRef, hRef);
      gl.uniform1f(U.uFocus, focusDist);
      gl.uniform1f(U.uFocusRange, cam.D * 0.95);
      gl.uniform1f(U.uTintMix, L.tintMix);
      gl.uniform4fv(U.uTint, s.tints);
    };
    const cellU = (pr) => {
      gl.uniform1i(pr.U.uN, Math.min(s.cells.length, MAX_CELLS));
      gl.uniform4fv(pr.U.uC, C);
      gl.uniform4fv(pr.U.uD, D);
      gl.uniform4fv(pr.U.uE, E);
    };

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.006, 0.007, 0.01, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // a lap
    common(P.slab);
    gl.uniform4fv(P.slab.U.uSlab, slab);
    gl.bindVertexArray(vaos.slab.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // talaj
    common(P.ground);
    cellU(P.ground);
    gl.uniform4fv(P.ground.U.uSlab, slab);
    gl.uniform1f(P.ground.U.uRelief, L.relief);
    gl.uniform1f(P.ground.U.uPad, s.pad);
    gl.uniform1i(P.ground.U.uNS, s.sets.length);
    const sc = new Float32Array(MAX_SETS * 3);
    s.sets.slice(0, MAX_SETS).forEach((st) => sc.set(st.col, st.k * 3));
    gl.uniform3fv(P.ground.U.uSetCol, sc);
    const rp = new Float32Array(MAX_RIP * 4);
    s.ripples.slice(0, MAX_RIP).forEach((r, i) => { const [x, z] = toWorld(r.x, r.y); rp.set([x, z, r.t, r.s], i * 4); });
    gl.uniform4fv(P.ground.U.uRip, rp);
    gl.bindVertexArray(vaos.ground.vao);
    gl.drawArrays(gl.POINTS, 0, Math.round(counts.ground * Math.min(1, L.density)));

    // sejtek
    common(P.cell);
    cellU(P.cell);
    gl.uniform1f(P.cell.U.uDensity, L.density);
    gl.bindVertexArray(vaos.cell.vao);
    gl.drawArrays(gl.POINTS, 0, Math.min(s.cells.length, MAX_CELLS) * cellPts);

    // kristályok
    common(P.gem);
    gl.uniform1i(P.gem.U.uNG, Math.min(s.gems.length, MAX_GEMS));
    gl.uniform4fv(P.gem.U.uGP, GP);
    gl.uniform4fv(P.gem.U.uGA, GA);
    gl.uniform3fv(P.gem.U.uGemA, s.gemA);
    gl.uniform3fv(P.gem.U.uGemB, s.gemB);
    gl.bindVertexArray(vaos.gem.vao);
    gl.drawArrays(gl.POINTS, 0, Math.min(s.gems.length, MAX_GEMS) * gemPts);

    // pontfelhő-betűk
    if (texts.length && textCount) {
      common(P.text);
      gl.uniform1i(P.text.U.uTN, texts.length);
      gl.uniform4fv(P.text.U.uTO, TO);
      gl.uniform3fv(P.text.U.uTR, TR);
      gl.uniform3fv(P.text.U.uTU, TU);
      gl.uniform3fv(P.text.U.uTZ, TZ);
      gl.uniform4fv(P.text.U.uTP, TP);
      gl.uniform4fv(P.text.U.uTQ, TQ);
      gl.bindVertexArray(textVao);
      gl.drawArrays(gl.POINTS, 0, textCount);
    }

    // szabad pontok
    if (freeCount) {
      common(P.free);
      gl.bindBuffer(gl.ARRAY_BUFFER, freeBuf);
      gl.bufferData(gl.ARRAY_BUFFER, freeData, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(vaos.free.vao);
      gl.drawArrays(gl.POINTS, 0, freeCount);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  // egy betűpont (felirat-koordináta, mélység 0..1) képernyőhelye – a „blob tracking” rétegnek
  function textToScreen(b, x, y, d = 0) {
    const f = b.tframe;
    if (!f) return null;
    const p = add(add(f.O, mul(f.R, x * f.k)), add(mul(f.U, -y * f.k), mul(f.Z, -d * f.thick)));
    return toScreen(p[0], p[1], p[2]);
  }
  return { setQuality, render, toWorld, toScreen, textToScreen };
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function makeNoisePoints(n, seed = 3) {
  const r = mulberry(seed), out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    // csomókban, mint a fák lombja a mintaképen
    const cl = Math.floor(r() * 9);
    const cr = mulberry(cl * 31 + 5);
    const cx = cr() * 1.8 - 0.9, cz = cr() * 1.8 - 0.9;
    out.set([cx + (r() - 0.5) * 0.12, cz + (r() - 0.5) * 0.12, cr() * 0.6 + r() * 0.25, 0.6 + r() * 0.5], i * 4);
  }
  return out;
}
function turboJS(x) {
  x = Math.max(0, Math.min(1, x));
  const v = [1, x, x * x, x * x * x], v2 = [x * x * x * x, x * x * x * x * x];
  const d = (k, k2) => Math.max(0, Math.min(1, k[0] * v[0] + k[1] * v[1] + k[2] * v[2] + k[3] * v[3] + k2[0] * v2[0] + k2[1] * v2[1]));
  return [
    d([0.13572138, 4.6153926, -42.66032258, 132.13108234], [-152.94239396, 59.28637943]),
    d([0.09140261, 2.19418839, 4.84296658, -14.18503333], [4.27729857, 2.82956604]),
    d([0.1066733, 12.64194608, -60.58204836, 110.36276771], [-89.90310912, 27.34824973]),
  ];
}

/* ---------------- pontfelhő-betűk előállítása ---------------- */
// A feliratot egy rejtett vásznon kirajzoljuk, a kitöltött képpontokból mintát veszünk (elülső arc),
// a peremekből több rétegben hátrafelé kihúzott oldalfalat építünk. Visszaadja a betűk dobozait is.
const cloudCache = new Map();
export function makeTextCloud({ lines, fs, weight, track, family, budget, ver = 0 }) {
  const id = [lines.join("/"), fs.toFixed(1), weight, track, family, budget, ver].join("|");
  if (cloudCache.has(id)) return cloudCache.get(id);
  const S = 2;                                   // a rasztervászon felbontása (élesebb mintavétel)
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const font = `${weight} ${fs * S}px "${family}", system-ui, sans-serif`;
  ctx.font = font;
  const tr = track * fs * S;
  const rows = lines.map((l) => {
    const chars = Array.from(l), adv = chars.map((ch) => ctx.measureText(ch).width + tr);
    return { chars, adv, w: adv.reduce((a, b) => a + b, 0) - tr };
  });
  const pad = Math.ceil(fs * S * 0.25), lh = fs * S * 1.08;
  const Wc = Math.ceil(Math.max(...rows.map((r) => r.w)) + pad * 2), Hc = Math.ceil(rows.length * lh + pad * 2);
  cv.width = Wc; cv.height = Hc;
  ctx.font = font; ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
  const letters = [];
  rows.forEach((r, li) => {
    let x = (Wc - r.w) / 2;
    const y = pad + (li + 0.5) * lh;
    r.chars.forEach((ch, ci) => {
      ctx.fillText(ch, x, y);
      if (ch.trim()) {
        const m = ctx.measureText(ch);
        letters.push({ ch, x0: (x + Math.min(0, -m.actualBoundingBoxLeft) - Wc / 2) / S, x1: (x + m.actualBoundingBoxRight - Wc / 2) / S,
          y0: (y - m.actualBoundingBoxAscent - Hc / 2) / S, y1: (y + m.actualBoundingBoxDescent - Hc / 2) / S });
      }
      x += r.adv[ci];
    });
  });
  const A = ctx.getImageData(0, 0, Wc, Hc).data;
  const filled = (x, y) => { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < Wc && y < Hc && A[(y * Wc + x) * 4 + 3] > 127; };
  let nFilled = 0;
  for (let i = 3; i < A.length; i += 4) if (A[i] > 127) nFilled++;
  const front = budget * 0.62;
  const step = Math.max(S * 0.9, Math.sqrt(nFilled / front));
  const rnd = mulberry(Math.round(fs * 13) + lines.join("").length * 7);
  const out = [];
  const LAYERS = 6;
  for (let gy = step / 2; gy < Hc; gy += step) {
    for (let gx = step / 2; gx < Wc; gx += step) {
      const x = gx + (rnd() - 0.5) * step * 0.8, y = gy + (rnd() - 0.5) * step * 0.8;
      if (!filled(x, y)) continue;
      const e = step * 1.25;
      const edge = !filled(x + e, y) || !filled(x - e, y) || !filled(x, y + e) || !filled(x, y - e);
      const px = (x - Wc / 2) / S, py = (y - Hc / 2) / S;
      out.push(px, py, 0, rnd(), edge ? 1 : 0);
      if (edge) for (let l = 1; l <= LAYERS; l++) if (rnd() < 0.7) out.push(px, py, l / LAYERS, rnd(), 0.5);
      if (!edge && rnd() < 0.18) out.push(px, py, 1, rnd(), 0);
    }
  }
  const cloud = { id, data: new Float32Array(out), count: out.length / 5, letters, w: Wc / S, h: Hc / S, step: step / S, lines };
  cloudCache.set(id, cloud);
  if (cloudCache.size > 24) cloudCache.delete(cloudCache.keys().next().value);
  return cloud;
}
