"use client";

/**
 * Sound effects, synthesized with Web Audio (no recorded samples, nothing to license or download): a USDC coin
 * dropping in, the claw's motor and drop, a box lid, a pack tearing, cards dealt and flipped, a sting for rare
 * pulls (a bigger one for Legendary and Jackpot), and soft blips for sheets and menus.
 *
 * Browsers block audio until the user interacts, so the AudioContext is created on the first pointer or key press
 * and nothing plays before that. Sound is on by default; the toggle (components/SoundToggle.tsx) persists the
 * choice in localStorage. Everything is short and quiet: one master gain at 0.22.
 */
export type Sfx = "coin" | "motor" | "drop" | "grip" | "box" | "tear" | "deal" | "flip" | "rare" | "jackpot" | "open" | "close";

const KEY = "arclaw:sound";
const EVENT = "arclaw:sound-change";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

export function soundOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSound(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
  window.dispatchEvent(new Event(EVENT));
  if (on) play("open");
}

export function onSoundChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** Create the context on the first gesture (call once from the app shell); the noise buffer is built then too. */
export function armSound(): () => void {
  if (typeof window === "undefined") return () => {};
  const unlock = () => {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume();
  };
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener("pointerdown", unlock, opts);
  window.addEventListener("keydown", unlock, opts);
  return () => {
    window.removeEventListener("pointerdown", unlock, opts);
    window.removeEventListener("keydown", unlock, opts);
  };
}

/* ---------- building blocks ---------- */

function env(g: GainNode, t: number, attack: number, peak: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(freq: number, t: number, { type = "sine", attack = 0.004, peak = 0.5, decay = 0.25, to }: { type?: OscillatorType; attack?: number; peak?: number; decay?: number; to?: number } = {}) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  env(g, t, attack, peak, decay);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

function hiss(t: number, { duration = 0.2, peak = 0.4, attack = 0.005, filter = "bandpass", freq = 2000, to, q = 1 }: { duration?: number; peak?: number; attack?: number; filter?: BiquadFilterType; freq?: number; to?: number; q?: number } = {}) {
  const c = ctx!;
  const s = c.createBufferSource();
  s.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + duration);
  f.Q.value = q;
  const g = c.createGain();
  env(g, t, attack, peak, duration);
  s.connect(f).connect(g).connect(master!);
  s.start(t, Math.random() * 0.5);
  s.stop(t + attack + duration + 0.05);
}

/* ---------- the sounds ---------- */

const SOUNDS: Record<Sfx, (t: number) => void> = {
  // A coin: two bright inharmonic partials, then the drop through the slot.
  coin: (t) => {
    tone(2637, t, { type: "triangle", peak: 0.3, decay: 0.35 });
    tone(3951, t + 0.002, { type: "sine", peak: 0.18, decay: 0.28 });
    tone(1760, t + 0.09, { type: "triangle", peak: 0.16, decay: 0.2 });
    hiss(t + 0.22, { duration: 0.12, peak: 0.12, freq: 900, to: 300 });
  },
  // The gantry motor: a low buzzing saw through a lowpass, rising a little.
  motor: (t) => {
    const c = ctx!;
    const o = c.createOscillator();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(92, t + 0.9);
    f.type = "lowpass";
    f.frequency.value = 520;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
    g.gain.setValueAtTime(0.16, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    o.connect(f).connect(g).connect(master!);
    o.start(t);
    o.stop(t + 1.05);
  },
  // The claw drops: a falling whistle of air, then a soft landing.
  drop: (t) => {
    hiss(t, { duration: 0.4, peak: 0.16, freq: 1800, to: 500, q: 2 });
    tone(140, t + 0.38, { type: "sine", peak: 0.4, decay: 0.16, to: 70 });
  },
  // Prongs shut: two quick clicks.
  grip: (t) => {
    tone(1800, t, { type: "square", peak: 0.08, decay: 0.03 });
    tone(1400, t + 0.05, { type: "square", peak: 0.07, decay: 0.03 });
  },
  // A box lid: a low knock and a puff.
  box: (t) => {
    tone(180, t, { type: "sine", peak: 0.5, decay: 0.18, to: 110 });
    hiss(t, { duration: 0.12, peak: 0.12, filter: "lowpass", freq: 1200 });
  },
  // Foil tearing: a crackling band of noise that rises.
  tear: (t) => {
    for (let i = 0; i < 6; i++) hiss(t + i * 0.035, { duration: 0.06, peak: 0.18, freq: 2400 + i * 500, q: 3 });
    hiss(t, { duration: 0.3, peak: 0.12, filter: "highpass", freq: 3000, to: 6000 });
  },
  // A card dealt: a short paper swish.
  deal: (t) => hiss(t, { duration: 0.09, peak: 0.2, freq: 3200, to: 1800, q: 0.8 }),
  // A card flips: a snap and a swish.
  flip: (t) => {
    tone(900, t, { type: "triangle", peak: 0.12, decay: 0.04 });
    hiss(t + 0.01, { duration: 0.12, peak: 0.16, freq: 2600, to: 4200, q: 0.9 });
  },
  // Rare and up: a short rising chime.
  rare: (t) => [784, 988, 1319].forEach((f, i) => tone(f, t + i * 0.07, { type: "triangle", peak: 0.22, decay: 0.45 })),
  // Legendary and Jackpot: a fuller arpeggio over a low bell.
  jackpot: (t) => {
    tone(196, t, { type: "sine", peak: 0.3, decay: 1.1 });
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.08, { type: "triangle", peak: 0.24, decay: 0.7 }));
    tone(2093, t + 0.45, { type: "sine", peak: 0.12, decay: 0.9 });
  },
  open: (t) => tone(660, t, { type: "sine", peak: 0.12, decay: 0.09, to: 880 }),
  close: (t) => tone(660, t, { type: "sine", peak: 0.1, decay: 0.08, to: 440 }),
};

/** Play a sound now (or `delay` seconds from now). Silent until the first gesture, and when muted. */
export function play(name: Sfx, delay = 0): void {
  if (!ctx || !master || !soundOn()) return;
  if (ctx.state !== "running") return;
  SOUNDS[name](ctx.currentTime + delay + 0.005);
}
