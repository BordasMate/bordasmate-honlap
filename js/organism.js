// Fémes, bioorganikus sejtfelület: WebGL2, két lépésben.
//  1. jelenet: egymást ölelő sejtek (Apollonius-cellák), folyékony fémtükör,
//     mélységi rétegek (kristályszilánkok, fazettás kristályok) – a kép alfa
//     csatornájába a mélységélesség mértéke (CoC) kerül
//  2. utófeldolgozás: élsimítás (FXAA), mélységélesség, ragyogás, glitch,
//     monokróm átmenet, szemcse
// A fizika egyszerű vízfelszíni sodródás: a tartalmas sejtek összetapadnak,
// lökdösik egymást, a kristályok különböző mélységben úsznak.

/* ===== GLITCH BEÁLLÍTÁSOK – ezeket nyugodtan átírhatod ===== */
const GLITCH = {
  enabled: true,         // false = nincs véletlen glitch (oldalváltáskor sem)
  firstAfter: 5000,      // az első glitch a betöltés után ennyi ms-mal
  minGap: 9000,          // két glitch között legalább ennyi ms telik el…
  maxGap: 11000,         // …és legfeljebb ennyi (átlagosan kb. 10 mp)
  fullChance: 0.28,      // a véletlen glitch-ek ekkora része érinti a teljes oldalt (0–1)
  minLength: 110,        // egy helyi glitch hossza ms-ban: minLength…
  maxLength: 440,        // …és maxLength között
  onNavigate: true,      // oldalváltáskor teljes képes glitch
  navigateLength: 420,   // annak hossza ms-ban
};
/* ========================================================== */

const MAX_B = 24;
const MAX_G = 14;
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

/* ---------------- 1. jelenet ---------------- */

const SCENE = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uRes;
uniform float uScale, uTime, uRimK, uPanelOn, uPanelTint;
uniform int uN, uNG;
uniform vec4 uB[${MAX_B}];   // x, y, ax, ay
uniform vec4 uC[${MAX_B}];   // kind, tint, hover, seed
uniform vec4 uG[${MAX_G}];   // x, y, r, z (mélység: <0 távoli, >0 közeli)
uniform vec4 uGA[${MAX_G}];  // forgás, seed, tint, -
uniform vec4 uPanel;
uniform vec4 uRip[${MAX_R}];
uniform vec4 uTint[5];
uniform vec3 uGlow[5];
uniform vec3 uEnvTint, uDeepTint, uGemA, uGemB;
uniform vec2 uCam, uFocus;
uniform float uRough;
uniform float uSet[${MAX_B}];   // halmaztagság bitmaszkként
uniform vec3 uSetCol[3];
uniform int uNS;
uniform float uPad;
${COMMON}
float sdRBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0-h); }

vec3 env(vec3 r){
  float up = -r.y;
  vec3 c = mix(vec3(0.008, 0.009, 0.012), vec3(0.42, 0.45, 0.5) * uEnvTint, smoothstep(-0.35, 0.85, up));
  c += vec3(1.45) * exp(-pow((up - 0.2) * 7.0, 2.0));
  c += vec3(0.8) * exp(-pow((r.x + 0.6) * 4.5, 2.0)) * smoothstep(-0.1, 0.6, up);
  c += vec3(0.45) * uEnvTint * exp(-pow((r.x - 0.7) * 6.0, 2.0));
  c *= 0.84 + 0.16 * sin(r.x * 9.0 + up * 3.0);
  return c;
}

vec3 metal(vec3 n, vec4 tint, float phase){
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float fres = pow(1.0 - n.z, 2.0);
  vec3 en = env(r);
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + fres * 1.9 + phase));
  vec3 col = en * tint.rgb;
  col = mix(col, en * irid * 1.25, tint.a * (0.25 + 0.75 * fres));
  col += vec3(1.25) * pow(max(dot(r, normalize(vec3(-0.35, -0.55, 0.76))), 0.0), 56.0);
  col += vec3(0.4) * pow(max(dot(r, normalize(vec3(0.5, -0.2, 0.84))), 0.0), 20.0);
  return col;
}

float water(vec2 p){
  float t = uTime;
  float v = 0.05*sin(p.x*0.011 + t*0.7 + 2.0*sin(p.y*0.008 + t*0.25))
          + 0.035*sin(p.y*0.016 - t*0.55 + p.x*0.005)
          + 0.06*noise(p*0.012 + vec2(t*0.12, -t*0.09));
  for (int i = 0; i < ${MAX_R}; i++) {
    vec4 r = uRip[i];
    if (r.w <= 0.0) continue;
    float d = length(p - r.xy);
    float ring = d - r.z * 170.0;
    v += r.w * 0.16 * sin(ring * 0.13) * exp(-abs(ring) / 34.0) * exp(-r.z * 1.1);
  }
  return v;
}

// x: magasság, y: sejt (-1 víz, 99 panel), z: feliratmező, w: határtávolság (px, a vízben negatív)
vec4 field(vec2 p, out vec4 attr, out vec3 sdo){
  vec2 w = vec2(noise(p*0.006 + vec2(uTime*0.06, 0.0)), noise(p*0.006 + vec2(13.1, -uTime*0.05))) - 0.5;
  vec2 q = p + w * 24.0;
  float f1 = 1e5, f2 = 1e5, r1 = 1.0, r2 = 1.0, id = -1.0, men = 0.0;
  vec3 accS = vec3(0.0);
  attr = vec4(0.0);
  sdo = vec3(1e5);
  for (int i = 0; i < ${MAX_B}; i++) {
    if (i >= uN) break;
    vec4 b = uB[i];
    if (b.z < 0.5) continue;
    vec4 c = uC[i];
    vec2 d = (q - b.xy) / b.zw;
    float f = length(d);
    float ang = atan(d.y, d.x);
    float th = 0.02 * sin(ang * 6.0 + c.w * 9.0 + uTime * 0.6)
             + pow(abs(sin(ang * 5.0 + c.w * 4.0 - uTime * 0.2)), 14.0) * 0.07;
    f /= (1.0 + th * smoothstep(0.62, 0.98, f));
    float r = sqrt(b.z * b.w);
    men += exp(min(0.0, (1.0 - f) * r) / 14.0);
    int bits = int(uSet[i] + 0.5);
    if (bits > 0) {
      float ex = exp(clamp(-(f - 1.0) * r / 24.0, -30.0, 30.0));
      if ((bits & 1) != 0) accS.x += ex;
      if ((bits & 2) != 0) accS.y += ex;
      if ((bits & 4) != 0) accS.z += ex;
    }
    if (f < f1) { f2 = f1; r2 = r1; f1 = f; r1 = r; id = float(i); attr = c; }
    else if (f < f2) { f2 = f; r2 = r; }
  }
  if (uPanelOn > 0.01) {
    float sd = sdRBox(q - uPanel.xy, uPanel.zw, 30.0);
    float f = 1.0 + sd / 170.0;
    men += exp(min(0.0, -sd) / 14.0);
    if (f < f1) { f2 = f1; r2 = r1; f1 = f; r1 = 170.0; id = 99.0; attr = vec4(4.0, uPanelTint, 0.0, 0.3); }
    else if (f < f2) { f2 = f; r2 = 170.0; }
  }
  float seam = (f2 - f1) / (1.0 / r1 + 1.0 / r2);
  float outer = (1.0 - f1) * r1;
  // halmazhártyák: a tagsejtek lágy uniója, kitágítva, amőbaszerűen hullámzó peremmel
  for (int k = 0; k < 3; k++) {
    if (k >= uNS || accS[k] < 1e-9) continue;
    float fk = float(k);
    float wob = (noise(q * 0.016 + fk * 7.3 + uTime * 0.05) - 0.5) * 26.0
              + (noise(q * 0.05 - fk * 3.1 - uTime * 0.12) - 0.5) * 9.0;
    sdo[k] = -24.0 * log(accS[k]) - uPad + wob;
  }
  if (outer > 0.0) {
    // lágy minimum: a varrat és a külső perem találkozásánál nincs törés (ez okozta a lépcsőzést)
    float bd = max(smin(seam, outer, 6.0), 0.0);
    float rim = (attr.x > 1.5 && attr.x < 2.5 ? 44.0 : attr.x > 0.5 && attr.x < 1.5 ? 22.0 : 34.0) * uRimK;
    if (id > 98.0) rim = 26.0;
    float bev = clamp(bd / (rim * 0.6), 0.0, 1.0);
    float h = 0.2 + 0.8 * (1.0 - (1.0 - bev) * (1.0 - bev));
    float ribZone = 1.0 - smoothstep(rim * 0.55, rim * 0.95, bd);
    h += 0.032 * sin(bd * 0.7) * smoothstep(rim * 0.3, rim * 0.5, bd) * ribZone;
    float vn = abs(noise(q * 0.03 + attr.w * 40.0) - 0.5);
    h += 0.04 * (1.0 - smoothstep(0.0, 0.06, vn)) * smoothstep(6.0, 14.0, bd) * ribZone;
    float sock = smoothstep(rim * 0.92, rim * 1.18, bd);
    float depth = smoothstep(rim * 0.92, rim * 2.2, bd);
    h -= 0.75 * sock * (0.45 + 0.55 * depth);
    h += 0.018 * sin(bd * 0.9) * (smoothstep(rim * 0.95, rim * 1.1, bd) - smoothstep(rim * 1.2, rim * 1.6, bd));
    return vec4(h, id, sock, bd);
  }
  float dmin = min(sdo.x, min(sdo.y, sdo.z));
  if (dmin < 0.0) {
    float e = -dmin, cd = -outer;
    float mask = (sdo.x < 0.0 ? 1.0 : 0.0) + (sdo.y < 0.0 ? 2.0 : 0.0) + (sdo.z < 0.0 ? 4.0 : 0.0);
    // hártya: duzzadt perem kívül, lankás gél befelé, bordák
    float hm = 0.12 + 0.55 * exp(-pow((e - 10.0) / 8.0, 2.0)) + 0.18 * smoothstep(4.0, 26.0, e);
    hm += 0.03 * sin(e * 0.75) * smoothstep(20.0, 30.0, e) * (1.0 - smoothstep(40.0, 70.0, e));
    hm += 0.25 * exp(-cd / 8.0);
    hm += water(p) * 0.3;
    return vec4(hm, -1.0, mask, outer);
  }
  float wv = water(p) + 0.3 * min(men, 1.4);
  return vec4(wv, -1.0, 0.0, outer);
}

// mélyben úszó, elnyújtott kristályszilánkok
vec3 deepLayer(vec2 p, out float coc){
  vec2 pp = p - uCam * 0.9;
  float a = 1.05;
  vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * pp;
  q *= vec2(1.0 / 70.0, 1.0 / 250.0);
  q.y += uTime * 0.012;
  vec2 ip = floor(q), fp = fract(q);
  float d1 = 8.0, d2 = 8.0; vec2 cid = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j);
    vec2 o = hash2(ip + g);
    o = 0.5 + 0.42 * sin(uTime * 0.07 + 6.2831 * o);
    vec2 r = g + o - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; cid = ip + g; } else if (d < d2) d2 = d;
  }
  float hc = hash(cid);
  float present = smoothstep(0.42, 0.72, noise(cid * 0.55 + vec2(uTime * 0.015, 0.0)));
  vec2 nn = (hash2(cid * 1.37) - 0.5) * 1.8 + 0.3 * vec2(sin(uTime * 0.2 + hc * 6.0), cos(uTime * 0.17 + hc * 5.0));
  vec3 c = metal(normalize(vec3(nn, 1.0)), vec4(uDeepTint, 0.4), hc * 4.0);
  float edge = sqrt(d2) - sqrt(d1);
  c += uDeepTint * 0.7 * exp(-edge * 14.0);
  // néhány szilánk élén éles, világos csík
  c += mix(uDeepTint, vec3(1.0), 0.5) * 1.8 * exp(-edge * 34.0) * step(0.62, hash(cid + 3.1));
  c *= present * (0.14 + 0.5 * hc);
  coc = 0.6 + 0.4 * hc;
  return c;
}

// fazettás kristály a megadott mélységsávban; visszatérés: lefedettség
float gemAt(vec2 p, float zlo, float zhi, out vec3 n, out float inner, out float fe, out float gz, out float gi){
  float cov = 0.0; n = vec3(0.0, 0.0, 1.0); inner = 0.0; fe = 1e3; gz = 0.0; gi = 0.0;
  for (int i = 0; i < ${MAX_G}; i++) {
    if (i >= uNG) break;
    vec4 G = uG[i];
    if (G.w < zlo || G.w >= zhi || G.z < 1.0) continue;
    vec2 d = p - (G.xy + uCam * G.w);
    float r = G.z;
    if (dot(d, d) > r * r * 1.8) continue;
    vec4 A = uGA[i];
    float m = 0.0, m2 = 0.0; vec2 nd = vec2(0.0);
    for (int k = 0; k < 7; k++) {
      float fk = float(k);
      float a = A.x + 0.8976 * fk + 0.45 * sin(A.y * 7.0 + fk * 2.1);
      vec2 u = vec2(cos(a), sin(a));
      float rr = r * (0.72 + 0.38 * hash(vec2(A.y, fk)));
      float v = dot(d, u) / rr;
      if (v > m) { m2 = m; m = v; nd = u / rr; } else if (v > m2) m2 = v;
    }
    if (m >= 1.0) continue;
    float cv = smoothstep(0.0, 1.6 / uScale, (1.0 - m) * r);
    float q = 0.0, q2 = 0.0; vec2 nd2 = vec2(0.0);
    vec2 dc = d - vec2(cos(A.y * 9.0), sin(A.y * 9.0)) * r * 0.12;
    for (int k = 0; k < 5; k++) {
      float fk = float(k);
      float a = -A.x * 1.6 + 1.2566 * fk + A.y * 5.0;
      vec2 u = vec2(cos(a), sin(a));
      float rr = r * (0.3 + 0.14 * hash(vec2(fk, A.y)));
      float v = dot(dc, u) / rr;
      if (v > q) { q2 = q; q = v; nd2 = u / rr; } else if (v > q2) q2 = v;
    }
    bool inn = q < 1.0;
    n = normalize(vec3((inn ? nd2 * 1.9 : nd * 1.1) * r, 1.0));
    inner = inn ? 1.0 : 0.0;
    fe = inn ? min((1.0 - q) * r * 0.35, (q - q2) * r * 0.25) : (m - m2) * r * 0.6;
    cov = cv; gz = G.w; gi = float(i);
  }
  return cov;
}

vec3 gemShade(vec3 n, float inner, float fe, float gi){
  vec4 A = uGA[int(gi + 0.5)];
  vec3 col = metal(n, uTint[int(A.z + 0.5)], A.y * 3.0 + uTime * 0.03);
  vec3 glow = mix(uGemA, uGemB, step(0.5, fract(A.y * 7.31)));
  if (inner > 0.5) col = col * 0.55 + glow * (0.25 + 0.6 * n.z);
  col += vec3(0.8) * exp(-fe * uScale * 0.8) * 0.55;
  return col;
}

vec2 bumpAt(vec2 lc, float sd){
  return ((vec2(noise(lc * 0.42 + sd), noise(lc * 0.42 + vec2(17.3, 9.1) + sd)) - 0.5) * 0.2
        + (vec2(noise(lc * 1.1 + 7.0), noise(lc * 1.1 + vec2(3.1, 11.0))) - 0.5) * 0.16) * uRough;
}
// homokfúvott, pöttyös, enyhén rozsdás fém
vec3 roughen(vec3 col, vec2 lc, float h, float sock, float sd){
  float speck = hash(floor(lc * 0.75 + sd * 2.0));
  float rustM = smoothstep(0.45, 0.8, noise(lc * 0.022 + sd * 0.6));
  float low = (1.0 - smoothstep(0.35, 0.95, h)) * (1.0 - sock);
  float rust = clamp(rustM * 0.7 + low * 0.45, 0.0, 1.0) * uRough;
  vec3 rustCol = vec3(0.45, 0.17, 0.06) * (0.55 + 0.9 * noise(lc * 0.3 + sd));
  col = mix(col, rustCol * (0.35 + 1.1 * luma(col)), rust * 0.32);
  col *= 1.0 - 0.5 * step(speck, (0.025 + 0.11 * rust) * uRough) * (1.0 - 0.8 * sock);
  col += vec3(0.55) * step(1.0 - 0.012 * uRough, speck) * (1.0 - rust);
  return col;
}

const vec2 D0 = vec2(1.0, 0.0), D1 = vec2(-0.5, 0.8660254), D2 = vec2(-0.5, -0.8660254);

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  // három, egymástól 120°-ra levő minta: középre igazított gradiens, simább normálok
  float e = 0.8 / uScale;
  vec4 A0, A1, A2; vec3 S0, S1, S2;
  vec4 F0 = field(p + D0 * e, A0, S0);
  vec4 F1 = field(p + D1 * e, A1, S1);
  vec4 F2 = field(p + D2 * e, A2, S2);
  float h = (F0.x + F1.x + F2.x) / 3.0;
  vec2 g = (2.0 / (3.0 * e)) * (F0.x * D0 + F1.x * D1 + F2.x * D2);
  vec2 gw = (2.0 / (3.0 * e)) * (F0.w * D0 + F1.w * D1 + F2.w * D2);
  float bd = (F0.w + F1.w + F2.w) / 3.0;
  vec3 sdA = (S0 + S1 + S2) / 3.0;
  bool c0 = F0.y > -0.5, c1 = F1.y > -0.5, c2 = F2.y > -0.5;
  bool isCell = (float(c0) + float(c1) + float(c2)) > 1.5;
  float sockC = ((c0 ? F0.z : 0.0) + (c1 ? F1.z : 0.0) + (c2 ? F2.z : 0.0)) / 3.0;
  vec4 F = F0, A = A0;
  if (c0 != isCell) { if (c1 == isCell) { F = F1; A = A1; } else { F = F2; A = A2; } }

  vec3 col; float coc;
  vec3 gn; float gin, gfe, gz, gi;
  if (isCell) {
    int ti = int(A.y + 0.5);
    // a textúra a sejthez rögzül, vele együtt úszik
    vec2 lc = p - (F.y < 98.0 ? uB[int(F.y)].xy : uPanel.xy);
    float sd = A.w * 50.0;
    vec3 n = normalize(vec3(-g * 18.0 + bumpAt(lc, sd), 1.0));
    col = metal(n, uTint[ti], h * 0.6 + uTime * 0.025 + A.w);
    col = roughen(col, lc, h, sockC, sd);
    col = mix(col, col * 0.1 + vec3(0.006), sockC * (F.y > 98.0 ? 0.97 : 0.88));  // a szövegpanel belseje sötétebb, nyugodtabb
    col *= 0.35 + 0.65 * smoothstep(0.0, 6.0, bd);
    float f1 = length((p - uB[int(F.y < 98.0 ? F.y : 0.0)].xy) / max(uB[int(F.y < 98.0 ? F.y : 0.0)].zw, vec2(1.0)));
    if (F.y < 98.0) {
      col += uGlow[ti] * A.z * (exp(-abs(f1 - 0.64) * 26.0) * 0.9 + exp(-bd / 5.0) * 0.5);
      col += uGlow[ti] * 0.16 * exp(-abs(f1 - 0.64) * 40.0) * (0.6 + 0.4 * sin(uTime * 1.3 + A.w * 20.0));
    }
    coc = 0.0;
  } else {
    vec3 n = normalize(vec3(-g * 60.0, 1.0));
    float cD;
    vec3 deep = deepLayer(p + n.xy * 30.0, cD);
    float fc = gemAt(p + n.xy * 16.0, -2.0, -0.2, gn, gin, gfe, gz, gi);
    if (fc > 0.0) { deep = mix(deep, gemShade(gn, gin, gfe, gi) * 0.5, fc); cD = mix(cD, 0.45 - gz * 0.4, fc); }
    vec3 refl = env(reflect(vec3(0.0, 0.0, -1.0), n)) * uTint[4].rgb;
    col = deep * 0.8 + refl * 0.5;
    float od = -bd - 16.0 * max(0.0, dot(normalize(-gw + 1e-5), vec2(-0.53, -0.85)));
    float far = length(p - uFocus) / length(uRes / uScale);
    float cW = 0.1 + 0.45 * smoothstep(0.12, 0.6, far);
    coc = mix(cW, cD, 0.4);
    int mk = int(F.z + 0.5);
    if (mk > 0) {
      // halmazhártya: áttetsző, színezett fém; a metszetben a két szín keveredik
      vec3 tc = vec3(0.0); float cnt = 0.0;
      for (int k = 0; k < 3; k++) if ((mk & (1 << k)) != 0) { tc += uSetCol[k]; cnt += 1.0; }
      tc /= max(cnt, 1.0);
      vec3 nm = normalize(vec3(-g * 24.0 + bumpAt(p, 3.0) * 0.8, 1.0));
      vec3 mc = metal(nm, vec4(tc, 0.5), h * 0.5 + uTime * 0.02 + cnt * 0.3);
      mc = roughen(mc, p, h, 0.0, 3.0);
      mc = mix(mc, col * 1.3, 0.16);
      if (cnt > 1.5) mc += tc * 0.07 * (0.6 + 0.4 * sin(uTime * 1.1 + p.x * 0.012));
      col = mc * (0.45 + 0.55 * smoothstep(0.0, 14.0, -bd));
      coc = 0.0;
    } else {
      // árnyék a sejtek és hártyák alatt (a fény balról felülről jön)
      col *= 0.3 + 0.7 * smoothstep(0.0, 34.0, od);
      float dm = min(sdA.x, min(sdA.y, sdA.z));
      col *= 0.45 + 0.55 * smoothstep(0.0, 26.0, dm);
    }
  }
  // a hártyák kontúrja (a metszetben a másik halmaz határa is látszik)
  if (!isCell) for (int k = 0; k < 3; k++) {
    if (k >= uNS) break;
    float lk = 1.0 - smoothstep(0.45, 1.7, abs(sdA[k]) * uScale / 1.5);
    col *= 1.0 - 0.85 * lk;
  }
  // sötét kontúr a sejthatárokon (élsimítva)
  float line = 1.0 - smoothstep(0.45, 1.7, abs(bd) * uScale / 1.5);
  col *= 1.0 - 0.94 * line;

  if (!isCell) {
    float fc = gemAt(p, -0.2, 0.3, gn, gin, gfe, gz, gi);
    if (fc > 0.0) { col = mix(col, gemShade(gn, gin, gfe, gi), fc); coc = mix(coc, 0.0, fc); }
  }
  float fn = gemAt(p, 0.3, 2.0, gn, gin, gfe, gz, gi);
  if (fn > 0.0) { col = mix(col, gemShade(gn, gin, gfe, gi) * 1.1, fn); coc = mix(coc, 0.5 + 0.3 * gz, fn); }

  col = col / (1.0 + col * 0.35);
  col = pow(col, vec3(0.92));
  outColor = vec4(clamp(col, 0.0, 1.0), clamp(coc, 0.0, 1.0));
}`;

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
        if (hash(vec2(band, uGSeed)) < 0.34) { s.x += (hash(vec2(band, uGSeed + 1.7)) - 0.5) * 150.0 * g; split = 3.0 * g; scan = g; }
      }
      // blokkeltolódás
      if (uGType.w > 0.0) {
        vec2 bl = floor(pc / vec2(56.0, 22.0));
        if (hash(bl + uGSeed * 1.3) < 0.22) { s += (hash2(bl + uGSeed * 2.1) - 0.5) * vec2(96.0, 26.0) * g; split = max(split, 2.0 * g); }
      }
      // függőleges elkenődés (pixelsort)
      if (uGType.y > 0.0) {
        float cw = 2.0 + 14.0 * hash(vec2(floor(pc.x / 48.0), uGSeed + 3.0));
        float ci = floor(pc.x / cw);
        if (hash(vec2(ci, uGSeed + 5.0)) < 0.62) {
          float anchor = lo.y + hash(vec2(ci, uGSeed + 9.0)) * uGRect.w;
          s.y = anchor + (pc.y - anchor) * mix(1.0, 0.1, min(1.0, g * 1.4));
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
        if (hash(ci + up * 17.0 + uGSeed) < 0.78) s = back + (hash2(ci + up * 3.0 + uGSeed) - 0.5) * sz * 0.55;
      }
      // pixelmozaik
      if (uGType2.x > 0.0) {
        float ps = 5.0 + 13.0 * hash(vec2(uGSeed, 2.0));
        vec2 cell = floor(s / ps);
        if (hash(cell * 0.13 + floor(uGSeed)) < 0.85) s = (cell + 0.5) * ps;
      }
      // képszakadás és -gördülés
      if (uGType2.y > 0.0) {
        s.x += sin(pc.y * 0.045 + uGSeed * 3.0) * 14.0 * g;
        float row = floor(pc.y / 3.0);
        s.x += step(hash(vec2(row, uGSeed)), 0.06) * (hash(vec2(row, uGSeed + 4.0)) - 0.5) * 80.0 * g;
        float H = uRes.y / uScale;
        s.y = mod(s.y + hash(vec2(uGSeed, 11.0)) * H * 0.18 * g, H);
        split = max(split, 2.5 * g);
      }
      // vízszintes elnyújtás sávokban (a látható képet húzza szét)
      if (uGType2.z > 0.0) {
        float band = floor(pc.y / (8.0 + 46.0 * hash(vec2(uGSeed, 5.0))));
        if (hash(vec2(band, uGSeed + 8.0)) < 0.35) {
          float ax = lo.x + hash(vec2(band, uGSeed + 2.0)) * uGRect.z;
          s.x = ax + (s.x - ax) * mix(1.0, 0.22, min(1.0, g * 1.3));
        }
      }
      // váltott soros kiesés
      if (uGType2.w > 0.0 && mod(floor(fc.y), 2.0) < 1.0) { s.x += 6.0 * g; scan = max(scan, 1.6 * g); }
      suv = fract(toUV(s));
      glitched = 1.0;
    }
  }

  vec4 c0 = T(suv);
  float coc = c0.a;
  vec3 col = fxaa(suv, c0.rgb);

  // mélységélesség: spirális mintavétel a mipmap-szintekből
  float blur = 0.0;
  if (coc > 0.03) {
    float R = coc * uDofK * uScale;
    float lod = max(0.0, log2(R / 4.0));
    vec3 acc = vec3(0.0); float ws = 0.0;
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      float rr = sqrt((fi + 0.5) / 16.0) * R;
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
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472 + 0.5;
    vec2 o = vec2(cos(a), sin(a)) * 16.0 * uScale / uRes;
    bl += textureLod(uTex, suv + o, 4.0).rgb + textureLod(uTex, suv + o * 2.4, 5.5).rgb;
  }
  col += max(bl / 12.0 - 0.27, 0.0) * 1.15;

  col *= 1.0 - 0.2 * min(scan, 1.0) * step(0.5, fract(fc.y * 0.5));
  if (scan > 1.0) col *= 1.0 - 0.35 * step(0.5, fract(fc.y * 0.5));
  // a torzított részeken a csúcsfények nem égnek ki fehér csíkká
  if (glitched > 0.5) { float Lc = luma(col); col *= min(1.0, 0.72 / max(Lc, 0.001)) * 0.35 + 0.65 * min(1.0, 0.9 / max(Lc, 0.001)); col = min(col, vec3(0.86)); }
  // invertált, poszterizált sávok
  if (uGlitch > 0.001 && uGType2.z > 0.0) {
    float inR = step(uGRect.x, pc.x) * step(pc.x, uGRect.x + uGRect.z) * step(uGRect.y, pc.y) * step(pc.y, uGRect.y + uGRect.w);
    float band = floor(pc.y / (6.0 + 40.0 * hash(vec2(uGSeed, 5.0))));
    float hb = hash(vec2(band, uGSeed + 8.0));
    if (inR > 0.0 && hb < 0.3) col = floor(col * 5.0 + 0.5) / 5.0;
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
const TINT_DATA = [
  [0.8, 0.8, 0.86, 0.55],
  [0.98, 0.55, 0.32, 0.38],
  [0.4, 0.55, 1.0, 0.62],
  [0.72, 0.8, 0.42, 0.45],
  [0.2, 0.21, 0.25, 0.3],
];
const GLOW_DATA = [
  [0.75, 0.55, 1.0],
  [1.0, 0.35, 0.55],
  [0.2, 0.75, 1.0],
  [0.75, 1.0, 0.3],
  [0, 0, 0],
];
const ENV_HOME = [0.98, 0.72, 1.12], DEEP_HOME = [0.72, 0.36, 0.9];
const ENV_MONO = [1, 1, 1], DEEP_MONO = [0.62, 0.64, 0.7];
const GEM_A = [1.0, 0.2, 0.78], GEM_B = [0.15, 0.85, 1.0];
// a kristályok mélysége a sorszámuk szerint (<0 a víz alatt, >0 a kamera előtt)
const DEPTHS = [-0.8, 0, -0.5, 0.9, 0.05, -1.0, 0.65, -0.3, 0];

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
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, alpha: false });
  if (!gl) return null;
  const params = new URLSearchParams(location.search);

  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (fs, names) => {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = {};
    for (const n of names) U[n] = gl.getUniformLocation(p, n);
    return { p, U };
  };
  const scene = program(SCENE, ["uRes", "uScale", "uTime", "uN", "uB", "uC", "uNG", "uG", "uGA", "uPanel", "uPanelOn", "uPanelTint", "uRimK", "uRip", "uTint", "uGlow", "uEnvTint", "uDeepTint", "uGemA", "uGemB", "uCam", "uFocus", "uRough", "uSet", "uSetCol", "uNS", "uPad"]);
  const post = program(POST, ["uTex", "uRes", "uScale", "uTime", "uMono", "uGlitch", "uGSeed", "uDofK", "uGRect", "uGType", "uGType2", "uGrain", "uMonoTint"]);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.useProgram(scene.p);
  gl.uniform4fv(scene.U.uTint, TINT_DATA.flat());
  gl.uniform3fv(scene.U.uGlow, GLOW_DATA.flat());
  gl.uniform3fv(scene.U.uGemA, GEM_A);
  gl.uniform3fv(scene.U.uGemB, GEM_B);

  // a jelenet textúrája (mipmap a mélységélességhez és a ragyogáshoz)
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  function allocTarget() {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    scale = Math.min(dpr, Math.sqrt(2.4e6 / (W * H))) * quality;
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    allocTarget();
  }
  resize();

  // a halmazhártya vastagsága (px)
  const padPx = () => (W < 640 ? 26 : 44);
  let comp = null;

  function ripple(x, y, s = 1) {
    ripples.push({ x, y, t: 0, s });
    if (ripples.length > MAX_R) ripples.shift();
  }

  /* ----- glitch ----- */

  const G = { end: 0, next: performance.now() + GLITCH.firstAfter, rect: [0, 0, 0, 0], type: [0, 0, 0, 0], type2: [0, 0, 0, 0], seed: 0, seedT: 0, power: 0, amt: 0 };
  function burst({ full = null, power = 1, dur = null, types = null } = {}) {
    if (reduced || !GLITCH.enabled) return;
    const now = performance.now();
    // néha a teljes oldalt érinti
    if (full === null) full = Math.random() < GLITCH.fullChance;
    G.end = now + (dur ?? GLITCH.minLength + Math.random() * (GLITCH.maxLength - GLITCH.minLength));
    G.power = power;
    if (full) G.rect = [0, 0, W, H];
    else {
      const list = [...bodies.values()].filter((b) => b.ax > 12 && (b.kind !== "drift" || Math.abs(b.z) < 0.3));
      if (list.length && Math.random() < 0.6) {
        const b = list[Math.floor(Math.random() * list.length)];
        const wide = Math.random() < 0.35 ? 2.2 : 1.15;
        G.rect = [b.x - b.ax * wide, b.y - b.ay * 1.1, b.ax * 2 * wide, b.ay * 2.2];
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
      if (full) G.end = now + 80 + Math.random() * 260;
    }
    G.type = t.slice(0, 4); G.type2 = t.slice(4);
    const [rx, ry, rw, rh] = G.rect;
    for (const b of bodies.values()) {
      if (!b.el || b.kind === "drift") continue;
      if (b.x > rx && b.x < rx + rw && b.y > ry && b.y < ry + rh) {
        b.el.classList.add("glitch");
        b.el.style.setProperty("--gx", ((Math.random() - 0.5) * 14).toFixed(1) + "px");
        clearTimeout(b.glitchT);
        b.glitchT = setTimeout(() => b.el && b.el.classList.remove("glitch"), G.end - now);
      }
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

  function setScene(scene) {
    const items = scene.items;
    const first = bodies.size === 0;
    monoTarget = scene.mono ? 1 : 0;
    comp = scene.comp || null;
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
        kind: s.kind, tint: s.tint ?? 0, href: s.href || null, anchor: s.anchor || b.anchor0 || null, heavy: !!s.heavy, z: s.z ?? 0,
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
      b.hover += ((hoverKey === b.key ? 1 : 0) - b.hover) * 0.12;
      b.rot += b.spin * dt * live;
      if (b.kind !== "drift" && b.el) {
        const op = Math.min(1, Math.max(0, (b.ax / (b.tax || b.ax || 1)) * 1.4 - 0.4));
        b.el.style.opacity = b.dying ? 0 : op;
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
      if (b.y - b.ay < m) fy += (m - (b.y - b.ay)) * 0.06;
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

  function draw(now) {
    const content = [], gems = [];
    for (const b of bodies.values()) (b.kind === "drift" ? gems : content).push(b);
    content.slice(0, MAX_B).forEach((b, i) => {
      const bob = reduced ? 1 : 1 + 0.018 * Math.sin(time * (0.9 + b.seed * 0.6) + b.seed * 20);
      bArr.set([b.x, b.y, b.ax * bob, b.ay * (2 - bob)], i * 4);
      const kind = b.kind === "nav" ? 1 : b.kind === "center" || b.kind === "name" ? 2 : 0;
      cArr.set([kind, b.tint, b.hover, b.seed], i * 4);
      sArr[i] = b.dying ? 0 : b.mask || 0;
      if (b.el) b.el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px) translate(-50%, -50%)`;
    });
    gems.sort((a, b) => a.z - b.z);
    gArr.fill(0); gaArr.fill(0);
    gems.slice(0, MAX_G).forEach((b, i) => {
      gArr.set([b.x, b.y, b.ax, b.z], i * 4);
      gaArr.set([b.rot, b.seed, b.tint, 0], i * 4);
    });
    rArr.fill(0);
    ripples.forEach((r, i) => rArr.set([r.x, r.y, r.t, r.s], i * 4));

    // glitch állapota
    if (now < G.end) {
      if (now - G.seedT > 55) { G.seedT = now; G.seed = Math.random() * 100; }
      G.amt = G.power * (0.55 + 0.45 * Math.random());
    } else G.amt = 0;

    const S = scene.U;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(scene.p);
    gl.uniform2f(S.uRes, canvas.width, canvas.height);
    gl.uniform1f(S.uScale, scale);
    gl.uniform1f(S.uTime, reduced ? 3 : time);
    gl.uniform1i(S.uN, Math.min(content.length, MAX_B));
    gl.uniform4fv(S.uB, bArr);
    gl.uniform4fv(S.uC, cArr);
    gl.uniform1i(S.uNG, Math.min(gems.length, MAX_G));
    gl.uniform4fv(S.uG, gArr);
    gl.uniform4fv(S.uGA, gaArr);
    gl.uniform4fv(S.uRip, rArr);
    gl.uniform4f(S.uPanel, panel ? panel.x : 0, panel ? panel.y : 0, panel ? panel.hw * panelOn : 0, panel ? panel.hh * panelOn : 0);
    gl.uniform1f(S.uPanelOn, panel ? panelOn : 0);
    gl.uniform1f(S.uPanelTint, panel ? panel.tint ?? 0 : 0);
    gl.uniform1f(S.uRimK, W < 640 ? 0.65 : 1);
    gl.uniform3fv(S.uEnvTint, envTint);
    gl.uniform3fv(S.uDeepTint, deepTint);
    gl.uniform2f(S.uCam, cam[0], cam[1]);
    gl.uniform2f(S.uFocus, focus[0], focus[1]);
    gl.uniform1f(S.uRough, 1);
    gl.uniform1fv(S.uSet, sArr);
    gl.uniform3fv(S.uSetCol, setCols);
    gl.uniform1i(S.uNS, nSets);
    gl.uniform1f(S.uPad, padPx());
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    const P = post.U;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(post.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(P.uTex, 0);
    gl.uniform2f(P.uRes, canvas.width, canvas.height);
    gl.uniform1f(P.uScale, scale);
    gl.uniform1f(P.uTime, time);
    gl.uniform1f(P.uMono, mono);
    gl.uniform1f(P.uGlitch, G.amt);
    gl.uniform1f(P.uGSeed, G.seed);
    gl.uniform1f(P.uDofK, W < 640 ? 14 : 22);
    gl.uniform4fv(P.uGRect, G.rect);
    gl.uniform4fv(P.uGType, G.type);
    gl.uniform4fv(P.uGType2, G.type2);
    gl.uniform1f(P.uGrain, 1);
    gl.uniform3fv(P.uMonoTint, monoTint);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let running = true, ema = 1 / 60, lastAdapt = performance.now() + 2500;
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
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // gyengébb gépen a felbontás magától csökken, hogy a mozgás folyamatos maradjon
    ema = ema * 0.95 + dt * 0.05;
    if (now - lastAdapt > 2000) {
      lastAdapt = now;
      if (ema > 1 / 38 && quality > 0.6) { quality *= 0.88; resize(); }
    }
    time += dt;
    if (!reduced && now > G.next) { burst(); G.next = now + GLITCH.minGap + Math.random() * (GLITCH.maxGap - GLITCH.minGap); }
    const steps = Math.max(1, Math.round(dt * 60));
    for (let s = 0; s < steps; s++) step(1 / 60);
    draw(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden && !still;
    if (running) { last = performance.now(); requestAnimationFrame(frame); }
  });

  /* ----- egér / érintés ----- */

  function hit(x, y) {
    let best = null, bf = 1;
    for (const b of bodies.values()) {
      if (b.ax < 2 || (b.kind === "drift" && Math.abs(b.z) > 0.3)) continue;
      const f = Math.hypot((x - b.x) / b.ax, (y - b.y) / b.ay);
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
  return { setScene, resize, ripple, burst, size: () => ({ W, H }) };
}
