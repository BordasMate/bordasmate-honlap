// Bordás Máté: Tervrajzok – az audiovizualitás üledékei (2025)
// Hangmotor: az eredeti Python program (FULLOS_tervrajzok_foliaszim.py) két hangkimenetének
// pontos átirata AudioWorkletre:
//   1. WhiteNoiseMultiFilterEngine – szűrt fehérzaj + szinuszoszcillátor + MultiTapReverb
//   2. LetterToneGenerator – a versciklus szövege betűnként, C-moll szinuszhangokként
// A szűrők a scipy.signal.butter(..., output="sos") és sosfilt_zi pontos átiratai.

/* ======================= komplex számok ======================= */
const C = (re, im = 0) => ({ re, im });
const cadd = (a, b) => C(a.re + b.re, a.im + b.im);
const csub = (a, b) => C(a.re - b.re, a.im - b.im);
const cmul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const cscale = (a, s) => C(a.re * s, a.im * s);
const cabs = (a) => Math.hypot(a.re, a.im);
function csqrt(a) {   // főérték, mint a numpy-ban
  const r = cabs(a);
  if (r === 0) return C(0, 0);
  const re = Math.sqrt((r + a.re) / 2);
  let im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  if (a.im < 0 || (a.im === 0 && Object.is(a.im, -0))) im = -im;
  return C(re, im);
}
const isReal = (a) => a.im === 0;

/* ======================= scipy.signal.butter (digitális, sos) ======================= */
function buttap(N) {
  const p = [];
  for (let m = -N + 1; m < N; m += 2) {
    const th = Math.PI * m / (2 * N);
    p.push(C(-Math.cos(th), -Math.sin(th)));      // -exp(1j*pi*m/(2N))
  }
  return { z: [], p, k: 1 };
}
function lp2lp(z, p, k, wo) {
  const deg = p.length - z.length;
  return { z: z.map((x) => cscale(x, wo)), p: p.map((x) => cscale(x, wo)), k: k * Math.pow(wo, deg) };
}
function lp2hp(z, p, k, wo) {
  const deg = p.length - z.length;
  const W = C(wo, 0);
  const zh = z.map((x) => cdiv(W, x)), ph = p.map((x) => cdiv(W, x));
  for (let i = 0; i < deg; i++) zh.push(C(0, 0));
  let num = C(1, 0), den = C(1, 0);
  z.forEach((x) => (num = cmul(num, cscale(x, -1))));
  p.forEach((x) => (den = cmul(den, cscale(x, -1))));
  return { z: zh, p: ph, k: k * cdiv(num, den).re };
}
function lp2bp(z, p, k, wo, bw) {
  const deg = p.length - z.length;
  const wo2 = C(wo * wo, 0);
  const zl = z.map((x) => cscale(x, bw / 2)), pl = p.map((x) => cscale(x, bw / 2));
  const zb = [...zl.map((x) => cadd(x, csqrt(csub(cmul(x, x), wo2)))), ...zl.map((x) => csub(x, csqrt(csub(cmul(x, x), wo2))))];
  const pb = [...pl.map((x) => cadd(x, csqrt(csub(cmul(x, x), wo2)))), ...pl.map((x) => csub(x, csqrt(csub(cmul(x, x), wo2))))];
  for (let i = 0; i < deg; i++) zb.push(C(0, 0));
  return { z: zb, p: pb, k: k * Math.pow(bw, deg) };
}
function bilinear(z, p, k, fs) {
  const deg = p.length - z.length;
  const F = C(2 * fs, 0);
  const zz = z.map((x) => cdiv(cadd(F, x), csub(F, x)));
  const pz = p.map((x) => cdiv(cadd(F, x), csub(F, x)));
  for (let i = 0; i < deg; i++) zz.push(C(-1, 0));
  let num = C(1, 0), den = C(1, 0);
  z.forEach((x) => (num = cmul(num, csub(F, x))));
  p.forEach((x) => (den = cmul(den, csub(F, x))));
  return { z: zz, p: pz, k: k * cdiv(num, den).re };
}
// scipy _cplxreal: az összetartozó párokból a pozitív képzetes részűek, valós rész szerint rendezve; majd a valósak
function cplxreal(arr) {
  const real = arr.filter(isReal).sort((a, b) => a.re - b.re);
  const cpx = arr.filter((x) => !isReal(x) && x.im > 0).sort((a, b) => a.re - b.re || Math.abs(a.im) - Math.abs(b.im));
  return [...cpx, ...real];
}
function nearestIdx(fro, to, which) {
  const order = fro.map((x, i) => [cabs(csub(x, to)), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[1]);
  for (const i of order) {
    if (which === "any") return i;
    if (which === "real" && isReal(fro[i])) return i;
    if (which === "complex" && !isReal(fro[i])) return i;
  }
  throw new Error("nincs megfelelő zérus");
}
function polyRealPair(r1, r2) {   // (x - r1)(x - r2) együtthatói, valós eredmény
  return [1, -(r1.re + r2.re), cmul(r1, r2).re];
}
function zpk2sos(z, p, k) {
  // páros fokszámú Butterworth: minden pólus komplex pár, minden zérus valós (±1)
  let zz = cplxreal(z), pp = cplxreal(p);
  // a cplxreal a komplex párokból csak egyet tart meg: a zérusok mind valósak, a pólusok párok
  zz = z.filter(isReal).sort((a, b) => a.re - b.re);
  const nSec = (Math.max(p.length, z.length) + 1) >> 1;
  const sos = [];
  const worst = (arr) => { let bi = 0, bv = Infinity; arr.forEach((x, i) => { const v = Math.abs(1 - cabs(x)); if (v < bv) { bv = v; bi = i; } }); return bi; };
  for (let si = nSec - 1; si >= 0; si--) {
    const i1 = worst(pp);
    const p1 = pp[i1];
    pp.splice(i1, 1);
    if (isReal(p1)) throw new Error("valós pólus – nem várt a Butterworth-tervben");
    const p2 = C(p1.re, -p1.im);
    const zi1 = nearestIdx(zz, p1, "any");
    const z1 = zz[zi1]; zz.splice(zi1, 1);
    const zi2 = nearestIdx(zz, p1, "real");
    const z2 = zz[zi2]; zz.splice(zi2, 1);
    sos[si] = [...polyRealPair(z1, z2), ...polyRealPair(p1, p2)];
  }
  for (let j = 0; j < 3; j++) sos[0][j] *= k;
  return sos;
}
function butterSos(N, Wn, btype) {
  const fs = 2.0;
  const { z, p, k } = buttap(N);
  let r;
  if (btype === "low" || btype === "high") {
    const warped = 2 * fs * Math.tan(Math.PI * Wn / fs);
    r = btype === "low" ? lp2lp(z, p, k, warped) : lp2hp(z, p, k, warped);
  } else {
    const w0 = 2 * fs * Math.tan(Math.PI * Wn[0] / fs), w1 = 2 * fs * Math.tan(Math.PI * Wn[1] / fs);
    r = lp2bp(z, p, k, Math.sqrt(w0 * w1), w1 - w0);
  }
  const d = bilinear(r.z, r.p, r.k, fs);
  return zpk2sos(d.z, d.p, d.k);
}
// scipy.signal.sosfilt_zi
function sosfiltZi(sos) {
  let scale = 1;
  return sos.map(([b0, b1, b2, a0, a1, a2]) => {
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    // lfilter_zi: (I - A^T) zi = B, másodrendű esetben
    const m00 = 1 + a1, m01 = -1, m10 = a2, m11 = 1;
    const B0 = b1 - a1 * b0, B1 = b2 - a2 * b0;
    const det = m00 * m11 - m01 * m10;
    const z0 = (B0 * m11 - m01 * B1) / det, z1 = (m00 * B1 - m10 * B0) / det;
    const zi = [z0 * scale, z1 * scale];
    scale *= (b0 + b1 + b2) / (1 + a1 + a2);
    return zi;
  });
}
// scipy.signal.sosfilt (transzponált direkt II. alak), helyben, a zi állapotot frissítve
function sosfilt(sos, x, zi) {
  for (let s = 0; s < sos.length; s++) {
    const [b0, b1, b2, a0, a1n, a2n] = sos[s];
    const a1 = a1n / a0, a2 = a2n / a0, c0 = b0 / a0, c1 = b1 / a0, c2 = b2 / a0;
    let z0 = zi[s][0], z1 = zi[s][1];
    for (let n = 0; n < x.length; n++) {
      const xn = x[n];
      const y = c0 * xn + z0;
      z0 = c1 * xn - a1 * y + z1;
      z1 = c2 * xn - a2 * y;
      x[n] = y;
    }
    zi[s][0] = z0; zi[s][1] = z1;
  }
  return x;
}

/* ======================= véletlen ======================= */
const uniform = (a, b) => a + (b - a) * Math.random();
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
let gaussSpare = null;
function normal() {   // np.random.normal(0, 1)
  if (gaussSpare !== null) { const g = gaussSpare; gaussSpare = null; return g; }
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u));
  gaussSpare = r * Math.sin(2 * Math.PI * v);
  return r * Math.cos(2 * Math.PI * v);
}

/* ======================= az eredeti konstansok ======================= */
const SAMPLE_RATE = 44100, BLOCKSIZE = 1024, OUTPUT_GAIN = 0.2;
const F_MIN = 60, F_MAX = 16000, BPF_ORDER = 4;
const MODE_CHANGE_MIN = 0.5, MODE_CHANGE_MAX = 2;
const BW_MIN = 300, BW_MAX = 4000, BW_LFO_RATE_HZ = 0.25, MIN_EFFECTIVE_BW = 50;
const SINE_MIN_FREQ = 500, SINE_MAX_FREQ = 14000, SINE_GAIN = 0.7, NOISE_GAIN = 0.5;
const FREQ_SMOOTH_TAU = 0.02, AM_NOISE_SCALE = 0.2;

/* ======================= MultiTapReverb ======================= */
class MultiTapReverb {
  constructor(sr = 44100, delays_ms = [83, 127, 149, 173], feedbacks = [0.72, 0.7, 0.68, 0.66], damp = 0.25, wet = 1.0) {
    this.n = delays_ms.length;
    this.feedbacks = Float32Array.from(feedbacks);
    this.damp = damp; this.wet = wet;
    this.buf = delays_ms.map((d) => new Float32Array(Math.max(1, Math.trunc(sr * d / 1000.0))));
    this.idx = delays_ms.map(() => 0);
    this.lp_state = delays_ms.map(() => 0.0);
  }
  process(x) {
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const s = x[i];
      let wet_acc = 0.0;
      for (let k = 0; k < this.n; k++) {
        const b = this.buf[k], j = this.idx[k];
        const delayed = b[j];
        const lp = (1.0 - this.damp) * delayed + this.damp * this.lp_state[k];
        this.lp_state[k] = lp;
        b[j] = s + this.feedbacks[k] * lp;
        this.idx[k] = (j + 1) % b.length;
        wet_acc += delayed;
      }
      y[i] = (wet_acc / this.n) * this.wet;
    }
    return y;
  }
}

/* ======================= WhiteNoiseMultiFilterEngine ======================= */
class WhiteNoiseMultiFilterEngine {
  constructor(clock) {
    this.clock = clock;   // a time.time() megfelelője (az audióóra)
    this.sr = SAMPLE_RATE; this.blocksize = BLOCKSIZE; this.gain = OUTPUT_GAIN;
    this.fmin = F_MIN; this.fmax = F_MAX; this.order = BPF_ORDER;
    this.mode_change_min = MODE_CHANGE_MIN; this.mode_change_max = MODE_CHANGE_MAX;
    this.bw_min = BW_MIN; this.bw_max = BW_MAX; this.bw_lfo_rate = BW_LFO_RATE_HZ;
    this._t = 0.0;
    this._active = false;
    this._next_change_ts = 0.0;
    this.MODES = ["low", "high", "band"];
    this._mode = choice(this.MODES);
    this._cutoff = this._rand_cutoff();
    this._center = this._rand_center();
    this._sos = null; this._zi = null;
    this._rebuild_filter_for_current_mode(true);
    this._sine_phase = 0.0;
    this._sine_freq = 220.0; this._sine_target_freq = 220.0;
    this._mod_depth = 0.0;
    this._sine_gain = SINE_GAIN; this._noise_gain = NOISE_GAIN;
    this._sine_env = 0.0; this._sine_attack = 0.6; this._sine_delay = 0.15; this._sine_delay_left = 0.0;
    this.reverb = new MultiTapReverb(this.sr);
  }
  _rand_cutoff() { return uniform(this.fmin, this.fmax); }
  _rand_center() {
    const guard = Math.max(this.bw_max, MIN_EFFECTIVE_BW);
    let low = this.fmin + guard / 2.0, high = this.fmax - guard / 2.0;
    low = Math.min(low, this.fmax - 1.0); high = Math.max(high, this.fmin + 1.0);
    if (high <= low) return (this.fmin + this.fmax) * 0.5;
    return uniform(low, high);
  }
  _design(btype, wc) { const sos = butterSos(this.order, wc, btype); return [sos, sosfiltZi(sos)]; }
  _design_low(cutoff) {
    const nyq = 0.5 * this.sr;
    let wc = Math.max(this.fmin, Math.min(this.fmax, cutoff)) / nyq;
    wc = Math.max(Math.min(wc, 0.999), 0.001);
    return this._design("low", wc);
  }
  _design_high(cutoff) {
    const nyq = 0.5 * this.sr;
    let wc = Math.max(this.fmin, Math.min(this.fmax, cutoff)) / nyq;
    wc = Math.max(Math.min(wc, 0.999), 0.001);
    return this._design("high", wc);
  }
  _design_band(center_hz, bandwidth_hz) {
    const bw = Math.max(bandwidth_hz, MIN_EFFECTIVE_BW);
    const half = bw / 2.0;
    const low = Math.max(this.fmin, center_hz - half);
    let high = Math.min(this.fmax, center_hz + half);
    if (high - low < 1.0) high = low + 1.0;
    const nyq = 0.5 * this.sr;
    const wp = [low / nyq, high / nyq];
    wp[0] = Math.max(Math.min(wp[0], 0.999), 0.001);
    wp[1] = Math.max(Math.min(wp[1], 0.999), wp[0] + 0.001);
    return this._design("band", wp);
  }
  _rebuild_filter_for_current_mode(initial = false) {
    if (this._mode === "low") { [this._sos, this._zi] = this._design_low(this._cutoff); return; }
    if (this._mode === "high") { [this._sos, this._zi] = this._design_high(this._cutoff); return; }
    const bw_now = initial ? (this.bw_min + this.bw_max) * 0.5 : this._current_bw_from_lfo();
    [this._sos, this._zi] = this._design_band(this._center, bw_now);
  }
  _current_bw_from_lfo() {
    const phase = 2.0 * Math.PI * this.bw_lfo_rate * this._t;
    const norm = 0.5 * (Math.sin(phase) + 1.0);
    return this.bw_min + norm * Math.max(this.bw_max - this.bw_min, 0.0);
  }
  _maybe_change_mode() {
    const now = this.clock();
    if (now >= this._next_change_ts) {
      this._mode = choice(this.MODES);
      if (this._mode === "band") this._center = this._rand_center();
      else this._cutoff = this._rand_cutoff();
      this._rebuild_filter_for_current_mode();
      this._next_change_ts = now + uniform(this.mode_change_min, this.mode_change_max);
    }
  }
  set_mod_from_density(density) {
    const d = Math.max(0.0, Math.min(1.0, +density));
    this._sine_target_freq = SINE_MIN_FREQ + d * (SINE_MAX_FREQ - SINE_MIN_FREQ);
    this._mod_depth = d;
  }
  _gen_sine_block(frames, freq) {
    const sig = new Float32Array(frames);
    for (let n = 0; n < frames; n++) sig[n] = Math.fround(Math.sin(2.0 * Math.PI * freq * ((n + this._sine_phase) / this.sr)));
    this._sine_phase = (this._sine_phase + frames) % this.sr;
    return sig;
  }
  render(frames) {   // _callback
    const active = this._active, sine_target = this._sine_target_freq, mod_depth = this._mod_depth;
    const current_freq = this._sine_freq;
    let env = this._sine_env, delay_left = this._sine_delay_left;
    const attack = this._sine_attack;
    this._maybe_change_mode();
    let noise_in;
    if (active) {
      const noise = new Float32Array(frames);
      for (let i = 0; i < frames; i++) noise[i] = Math.fround(normal());
      if (this._mode === "band") {
        const bw_now = this._current_bw_from_lfo();
        [this._sos, this._zi] = this._design_band(this._center, bw_now);
      }
      const y = Float64Array.from(noise);
      sosfilt(this._sos, y, this._zi);
      noise_in = Float32Array.from(y);
    } else {
      noise_in = new Float32Array(frames);
    }
    let sine_mod;
    if (active) {
      const dt = frames / this.sr;
      const alpha = 1.0 - Math.exp(-dt / Math.max(FREQ_SMOOTH_TAU, 0.001));
      const new_freq = current_freq + alpha * (sine_target - current_freq);
      const sine = this._gen_sine_block(frames, new_freq);
      let use_env;
      if (delay_left > 0.0) { use_env = 0.0; delay_left = Math.max(0.0, delay_left - dt); }
      else { const attack_tau = Math.max(0.001, attack); env = Math.min(1.0, env + dt / attack_tau); use_env = env; }
      sine_mod = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const mod_sig = Math.tanh(noise_in[i] * 0.5);
        const amp = Math.max(0.0, 1.0 + mod_depth * AM_NOISE_SCALE * mod_sig);
        sine_mod[i] = sine[i] * amp * use_env;
      }
      this._sine_freq = new_freq; this._sine_env = env; this._sine_delay_left = delay_left;
    } else {
      sine_mod = new Float32Array(frames);
      this._sine_env = 0.0; this._sine_delay_left = 0.0;
    }
    const mixed = new Float32Array(frames);
    for (let i = 0; i < frames; i++) mixed[i] = this._noise_gain * noise_in[i] + this._sine_gain * sine_mod[i];
    const wet = this.reverb.process(mixed);
    for (let i = 0; i < frames; i++) wet[i] = Math.fround(wet[i] * this.gain);
    this._t += frames / this.sr;
    return wet;
  }
  set_active(flag) {
    this._active = !!flag;
    if (this._active) { this._sine_env = 0.0; this._sine_delay_left = this._sine_delay; }
    if (this._active && this.clock() >= this._next_change_ts) this._next_change_ts = this.clock() + uniform(this.mode_change_min, this.mode_change_max);
  }
}

/* ======================= LetterToneGenerator ======================= */
class LetterToneGenerator {
  constructor(log, tone_ms = 120, gap_ms = 15, space_ms = 80, punct_ms = 120, newline_ms = 200) {
    this.sr = SAMPLE_RATE; this.master_gain = OUTPUT_GAIN;
    this.log = log;
    this._total_tones = 0; this._played_tones = 0;
    this.tone_len = Math.trunc(this.sr * tone_ms / 1000.0);
    this.gap_len = Math.trunc(this.sr * gap_ms / 1000.0);
    this.space_len = Math.trunc(this.sr * space_ms / 1000.0);
    this.punct_len = Math.trunc(this.sr * punct_ms / 1000.0);
    this.newline_len = Math.trunc(this.sr * newline_ms / 1000.0);
    this.hungarian_alphabet = ["a", "á", "b", "c", "d", "e", "é", "f", "g", "h", "i", "í", "j", "k", "l", "m", "n", "o", "ó", "ö", "ő", "p", "q", "r", "s", "sz", "t", "ty", "u", "ú", "ü", "ű", "v", "w", "x", "y", "z", "zs"];
    const freqs = this._build_c_minor_frequencies(7, 0);
    this.frequency_map = new Map(this.hungarian_alphabet.map((ch, i) => [ch, freqs[i]]));
    this._playing = false; this._tokens = []; this._tok_idx = 0;
    this._cur_wave = new Float32Array(0); this._cur_pos = 0;
  }
  _build_c_minor_frequencies(octaves = 7, start_oct = 0) {
    const C0 = 16.351597831287414, semis = [0, 2, 3, 5, 7, 8, 10], freqs = [];
    for (let o = start_oct; o < start_oct + octaves; o++) for (const st of semis) freqs.push(Math.round(C0 * 2 ** o * 2 ** (st / 12.0) * 100) / 100);
    return freqs;
  }
  _env_sine(freq_hz, length_samples) {
    if (length_samples <= 0) return new Float32Array(0);
    const sig = new Float32Array(length_samples);
    for (let n = 0; n < length_samples; n++) sig[n] = Math.fround(Math.sin(2.0 * Math.PI * freq_hz * Math.fround(n / this.sr)));
    const att_s = Math.max(1, Math.trunc(0.01 * this.sr)), rel_s = Math.max(1, Math.trunc(0.03 * this.sr));
    const env = new Float32Array(length_samples).fill(1);
    const lin = (a, b, n, i) => (n === 1 ? a : a + (b - a) * i / (n - 1));   // np.linspace
    if (att_s < env.length) for (let i = 0; i < att_s; i++) env[i] *= lin(0, 1, att_s, i);
    if (rel_s < env.length) for (let i = 0; i < rel_s; i++) env[env.length - rel_s + i] *= lin(1, 0, rel_s, i);
    for (let n = 0; n < length_samples; n++) sig[n] = Math.fround(sig[n] * env[n]);
    return sig;
  }
  _tokenize(text) {
    // Python str.lower() + iterálás kódpontonként; a whitespace a Python str.isspace() szerint
    const chars = Array.from(text.toLowerCase());
    const tokens = [], N = chars.length, digraphs = new Set(["sz", "ty", "zs"]);
    const isspace = (c) => /^[\s\u001c-\u001f\u0085]$/u.test(c);
    let i = 0;
    while (i < N) {
      const ch = chars[i];
      if (ch === "\n") { tokens.push(["rest", this.newline_len]); i += 1; continue; }
      if (isspace(ch)) { tokens.push(["rest", this.space_len]); i += 1; continue; }
      if (i + 1 < N) {
        const di = chars[i] + chars[i + 1];
        if (digraphs.has(di) && this.frequency_map.has(di)) {
          tokens.push(["tone", this.frequency_map.get(di), di]); tokens.push(["rest", this.gap_len]); i += 2; continue;
        }
      }
      if (this.frequency_map.has(ch)) { tokens.push(["tone", this.frequency_map.get(ch), ch]); tokens.push(["rest", this.gap_len]); }
      else tokens.push(["rest", this.punct_len]);
      i += 1;
    }
    return tokens;
  }
  play_sentence(full_text) {
    if (this._playing) return;
    this._playing = true;
    this._tokens = this._tokenize(full_text);
    this._total_tones = this._tokens.filter((t) => t[0] === "tone").length;
    this._played_tones = 0; this._tok_idx = 0;
    this._cur_wave = new Float32Array(0); this._cur_pos = 0;
  }
  render(frames) {   // _callback
    const out = new Float32Array(frames);
    if (!this._playing) return out;
    let filled = 0;
    while (filled < frames) {
      if (this._cur_pos >= this._cur_wave.length) {
        if (!this._playing || this._tok_idx >= this._tokens.length) {
          this._playing = false;   // a stream leáll
          break;
        }
        const tok = this._tokens[this._tok_idx++];
        if (tok[0] === "tone") {
          const freq = +tok[1], symbol = tok[2];
          this._played_tones += 1;
          const pct = 100.0 * this._played_tones / this._total_tones;
          this.log(`[LetterTone] ${this._played_tones}/${this._total_tones} (${pct.toFixed(1)}%) – '${symbol}' → ${freq.toFixed(2)} Hz`);
          this._cur_wave = this._env_sine(freq, this.tone_len);
        } else {
          this._cur_wave = new Float32Array(tok[1]);
        }
        this._cur_pos = 0;
      }
      const take = Math.min(this._cur_wave.length - this._cur_pos, frames - filled);
      if (take > 0) { out.set(this._cur_wave.subarray(this._cur_pos, this._cur_pos + take), filled); this._cur_pos += take; filled += take; }
      else { out[filled] = 0.0; filled += 1; }
    }
    for (let i = 0; i < frames; i++) out[i] = Math.fround(out[i] * this.master_gain);
    return out;
  }
}

/* ======================= AudioWorklet ======================= */
// A két eredeti hangkimenet (sounddevice.OutputStream, 1024-es blokkok) összegezve.
// A böngésző 128 mintás egységekben kér hangot; a motorok az eredetivel azonos 1024-es blokkokban számolnak.
if (typeof registerProcessor === "function") {
  class TervrajzokProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.frameCount = 0;
      const clock = () => this.frameCount / sampleRate;
      this.noise = new WhiteNoiseMultiFilterEngine(clock);
      this.logBuf = [];
      this.letters = new LetterToneGenerator((line) => this.logBuf.push(line));
      this.qNoise = new Float32Array(0); this.qNoisePos = 0;
      this.qLet = new Float32Array(0); this.qLetPos = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (m.type === "active") this.noise.set_active(m.flag);
        else if (m.type === "density") this.noise.set_mod_from_density(m.value);
        else if (m.type === "play") this.letters.play_sentence(m.text);
      };
    }
    process(inputs, outputs) {
      const out = outputs[0][0];
      for (let i = 0; i < out.length; i++) {
        if (this.qNoisePos >= this.qNoise.length) { this.qNoise = this.noise.render(BLOCKSIZE); this.qNoisePos = 0; }
        if (this.qLetPos >= this.qLet.length) { this.qLet = this.letters.render(BLOCKSIZE); this.qLetPos = 0; }
        out[i] = this.qNoise[this.qNoisePos++] + this.qLet[this.qLetPos++];
        this.frameCount++;
      }
      for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
      if (this.logBuf.length) { this.port.postMessage(this.logBuf); this.logBuf = []; }
      return true;
    }
  }
  registerProcessor("tervrajzok", TervrajzokProcessor);
}
if (typeof module !== "undefined") module.exports = { butterSos, sosfiltZi, sosfilt, MultiTapReverb, LetterToneGenerator, WhiteNoiseMultiFilterEngine };
