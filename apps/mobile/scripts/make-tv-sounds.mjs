#!/usr/bin/env node
/**
 * The Apple TV app's sound effects, synthesised from nothing.
 *
 *   node apps/mobile/scripts/make-tv-sounds.mjs
 *
 * Every cue is additive synthesis and filtered noise written straight to a
 * 16-bit mono WAV in `assets/sounds/tv/`. Nothing is sampled, so there is no
 * licence to record and nothing lifted from a broadcast or another game: the
 * outputs are generated files like the icons -- change this script, re-run it,
 * commit both.
 *
 * Deterministic: the noise comes from a seeded generator, so a re-run with no
 * change to this file rewrites byte-identical files and the diff stays empty.
 *
 * Loudness is balanced here rather than in the app: every cue is normalised to
 * a peak chosen for how often it plays (a focus move is a whisper, the 17-0
 * sting is the loudest thing the app ever makes), and `sound.ts` applies one
 * master volume on top.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../assets/sounds/tv');

let seed = 0x17_0_17;
const rand = () => {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const buffer = (seconds) => new Float64Array(Math.ceil(seconds * RATE));

/** Exponential-decay envelope with a short linear attack. */
const env = (t, attack, decay) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

function tone(buf, { at = 0, dur, freq, to = freq, amp = 1, attack = 0.004, decay = dur / 4, shape = 'sine' }) {
  let phase = 0;
  const start = Math.floor(at * RATE);
  const n = Math.floor(dur * RATE);
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE;
    const f = freq * Math.pow(to / freq, t / dur);
    phase += (2 * Math.PI * f) / RATE;
    let s = Math.sin(phase);
    if (shape === 'tri') s = (2 / Math.PI) * Math.asin(s);
    if (shape === 'soft') s = Math.tanh(2.2 * s) / Math.tanh(2.2);
    buf[start + i] += s * amp * env(t, attack, decay);
  }
}

/** Noise through a one-pole band, swept from `lo` to `hi` Hz. */
function noise(buf, { at = 0, dur, lo = 400, hi = lo, amp = 1, attack = 0.01, decay = dur / 3, swell = false }) {
  const start = Math.floor(at * RATE);
  const n = Math.floor(dur * RATE);
  let lp = 0;
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE;
    const k = t / dur;
    const cut = lo * Math.pow(hi / lo, k);
    const a = 1 - Math.exp((-2 * Math.PI * cut) / RATE);
    lp += a * (rand() * 2 - 1 - lp);
    // a gentle high-pass at a third of the cut keeps it airy rather than rumbly
    const b = Math.exp((-2 * Math.PI * (cut / 3)) / RATE);
    hp = b * (hp + lp - prev);
    prev = lp;
    const shape = swell ? Math.sin(Math.PI * Math.min(1, k)) ** 1.5 : env(t, attack, decay);
    buf[start + i] += hp * amp * shape * 3;
  }
}

function normalise(buf, peak) {
  let max = 0;
  for (const s of buf) max = Math.max(max, Math.abs(s));
  if (max === 0) return buf;
  // 4 ms fade at both ends so no cue clicks in or out
  const fade = Math.floor(0.004 * RATE);
  for (let i = 0; i < buf.length; i++) {
    const edge = Math.min(1, i / fade, (buf.length - 1 - i) / fade);
    buf[i] = (buf[i] / max) * peak * edge;
  }
  return buf;
}

function wav(name, buf) {
  const data = Buffer.alloc(buf.length * 2);
  buf.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  writeFileSync(join(OUT, `${name}.wav`), Buffer.concat([head, data]));
  console.log(`  ${name}.wav  ${(buf.length / RATE).toFixed(2)}s`);
}

const cues = {
  /** Focus moving: a soft, short glassy tick. Plays constantly, so it is the quietest. */
  focus: () => {
    const b = buffer(0.06);
    tone(b, { dur: 0.06, freq: 2350, amp: 0.6, decay: 0.012 });
    tone(b, { dur: 0.06, freq: 3520, amp: 0.25, decay: 0.008 });
    return normalise(b, 0.22);
  },
  /** One click of the reel passing a franchise. */
  tick: () => {
    const b = buffer(0.045);
    noise(b, { dur: 0.045, lo: 3000, hi: 1800, amp: 1, attack: 0.0008, decay: 0.008 });
    tone(b, { dur: 0.045, freq: 1250, amp: 0.5, decay: 0.01, shape: 'tri' });
    return normalise(b, 0.4);
  },
  /** The spin starting: an airy rising whoosh. */
  whoosh: () => {
    const b = buffer(0.55);
    noise(b, { dur: 0.55, lo: 300, hi: 4200, amp: 1, swell: true });
    tone(b, { dur: 0.5, freq: 180, to: 420, amp: 0.25, attack: 0.15, decay: 0.2 });
    return normalise(b, 0.55);
  },
  /** The reel landing on a franchise and era: a low thud with a bright cap. */
  land: () => {
    const b = buffer(0.5);
    tone(b, { dur: 0.35, freq: 140, to: 70, amp: 1, attack: 0.002, decay: 0.09 });
    noise(b, { dur: 0.08, lo: 2500, hi: 900, amp: 0.5, attack: 0.001, decay: 0.02 });
    tone(b, { at: 0.02, dur: 0.45, freq: 1046.5, amp: 0.22, decay: 0.14, shape: 'tri' });
    tone(b, { at: 0.02, dur: 0.45, freq: 1568, amp: 0.12, decay: 0.12 });
    return normalise(b, 0.7);
  },
  /** A pick locked into a slot: two-stage mechanical latch. */
  lock: () => {
    const b = buffer(0.32);
    noise(b, { dur: 0.04, lo: 4000, hi: 2000, amp: 1, attack: 0.0005, decay: 0.008 });
    noise(b, { at: 0.055, dur: 0.05, lo: 2600, hi: 1200, amp: 0.9, attack: 0.0005, decay: 0.012 });
    tone(b, { at: 0.055, dur: 0.26, freq: 660, amp: 0.45, decay: 0.07, shape: 'tri' });
    tone(b, { at: 0.055, dur: 0.26, freq: 990, amp: 0.25, decay: 0.06 });
    return normalise(b, 0.6);
  },
  /** Before the record shows: a two-second riser. */
  build: () => {
    const b = buffer(2.1);
    noise(b, { dur: 2.0, lo: 200, hi: 6000, amp: 0.8, swell: true });
    for (const [f, a] of [[110, 0.5], [164.8, 0.35], [220, 0.3]]) {
      tone(b, { dur: 2.0, freq: f, to: f * 2, amp: a, attack: 1.6, decay: 0.25, shape: 'soft' });
    }
    return normalise(b, 0.6);
  },
  /** The record slamming down on the card. */
  stamp: () => {
    const b = buffer(0.7);
    tone(b, { dur: 0.5, freq: 95, to: 48, amp: 1, attack: 0.001, decay: 0.12, shape: 'soft' });
    noise(b, { dur: 0.25, lo: 1800, hi: 300, amp: 0.8, attack: 0.001, decay: 0.05 });
    tone(b, { at: 0.01, dur: 0.6, freq: 523.25, amp: 0.18, decay: 0.2, shape: 'tri' });
    return normalise(b, 0.85);
  },
  /** 17-0: a bright major fanfare over the stamp. The loudest cue in the app. */
  perfect: () => {
    const b = buffer(1.9);
    tone(b, { dur: 0.5, freq: 95, to: 48, amp: 0.9, attack: 0.001, decay: 0.12, shape: 'soft' });
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      tone(b, { at: 0.08 + i * 0.11, dur: 1.4 - i * 0.1, freq: f, amp: 0.4, attack: 0.01, decay: 0.45, shape: 'tri' });
      tone(b, { at: 0.08 + i * 0.11, dur: 1.2, freq: f * 2.0, amp: 0.1, decay: 0.3 });
    });
    noise(b, { at: 0.5, dur: 1.3, lo: 6000, hi: 9000, amp: 0.12, attack: 0.05, decay: 0.4 });
    return normalise(b, 0.95);
  },
  /** One short of perfection: the stamp, then a falling minor pair. */
  denied: () => {
    const b = buffer(1.4);
    tone(b, { dur: 0.5, freq: 95, to: 48, amp: 0.9, attack: 0.001, decay: 0.12, shape: 'soft' });
    tone(b, { at: 0.12, dur: 0.55, freq: 622.25, amp: 0.38, decay: 0.2, shape: 'tri' });
    tone(b, { at: 0.42, dur: 0.95, freq: 587.33, to: 554.37, amp: 0.4, decay: 0.35, shape: 'tri' });
    return normalise(b, 0.85);
  },
  /** Gut Check, fair: an upward chirp, card flying right. */
  fair: () => {
    const b = buffer(0.32);
    noise(b, { dur: 0.22, lo: 900, hi: 3800, amp: 0.5, swell: true });
    tone(b, { at: 0.02, dur: 0.12, freq: 880, amp: 0.5, decay: 0.05, shape: 'tri' });
    tone(b, { at: 0.09, dur: 0.2, freq: 1318.5, amp: 0.5, decay: 0.07, shape: 'tri' });
    return normalise(b, 0.5);
  },
  /** Gut Check, off: a downward buzz. */
  off: () => {
    const b = buffer(0.3);
    tone(b, { dur: 0.28, freq: 330, to: 196, amp: 0.7, decay: 0.09, shape: 'soft' });
    tone(b, { dur: 0.28, freq: 335, to: 199, amp: 0.4, decay: 0.09, shape: 'soft' });
    return normalise(b, 0.5);
  },
  /** Gut Check, don't know: a muted swish. */
  skip: () => {
    const b = buffer(0.25);
    noise(b, { dur: 0.24, lo: 700, hi: 1500, amp: 0.6, swell: true });
    return normalise(b, 0.35);
  },
  /** A round of Gut Check finished: three quick rising notes. */
  round: () => {
    const b = buffer(0.9);
    [659.25, 783.99, 987.77].forEach((f, i) =>
      tone(b, { at: i * 0.09, dur: 0.7 - i * 0.1, freq: f, amp: 0.45, decay: 0.2, shape: 'tri' }),
    );
    return normalise(b, 0.6);
  },
  /** Broadcast graphics wiping on: a short filtered sweep. */
  wipe: () => {
    const b = buffer(0.35);
    noise(b, { dur: 0.33, lo: 1200, hi: 5000, amp: 0.6, swell: true });
    return normalise(b, 0.28);
  },
};

mkdirSync(OUT, { recursive: true });
console.log(`writing ${Object.keys(cues).length} cues to ${OUT}`);
for (const [name, make] of Object.entries(cues)) wav(name, make());
