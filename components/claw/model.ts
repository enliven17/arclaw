/**
 * The play, as a pure function of time. Every moving part reads one Pose, so a timed play() and a scroll scrub
 * draw the same frames. No DOM here.
 *
 * Coin, button, travel, open (anticipation), drop, grip, lift, carry, release, fall, close. The claw sways on its
 * cable like a damped pendulum driven by the gantry's acceleration; the sway is integrated once at load and sampled.
 */
import { BOX, CARRY_DROP, HOME, HUB_GRIP, HUB_REST, TARGET, Z } from "./view";

export const DURATION = 7.3;

export type Phase = "ready" | "coin" | "move" | "drop" | "grip" | "lift" | "carry" | "release" | "prize";

export type Pose = {
  /** Bridge x and trolley y. */
  gx: number;
  gy: number;
  /** Claw sway from the cable's plumb line, world units. */
  sx: number;
  sy: number;
  /** Hub top z. */
  hub: number;
  /** Prongs: 0 closed, 1 fully open. */
  open: number;
  /** The prize box: centre x, y and bottom z; hidden once it is down the chute. */
  box: { x: number; y: number; z: number; shown: boolean; falling: boolean };
  /** Coin flight 0..1 (0 = not yet thrown, 1 = in the slot), button travel 0..1, joystick lean -1..1. */
  coin: number;
  button: number;
  lean: { x: number; y: number };
  phase: Phase;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

const inOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const outCubic = (u: number) => 1 - (1 - u) ** 3;
const outQuint = (u: number) => 1 - (1 - u) ** 5;
/** Out with a small overshoot: the spring at the end of a drop or an opening. */
const outBack = (u: number, s = 1.2) => 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2;

const REST_OPEN = 0.16;
const GRIP_OPEN = 0.42;
const RELEASE = 6.1;
const GRAVITY = 820;

function gantry(t: number) {
  const out = inOutCubic(span(t, 0.8, 2.0));
  const back = inOutCubic(span(t, 4.75, 5.95));
  const outY = inOutCubic(span(t, 0.95, 2.15));
  const backY = inOutCubic(span(t, 4.85, 6.0));
  return {
    gx: lerp(lerp(HOME.x, TARGET.x, out), HOME.x, back),
    gy: lerp(lerp(HOME.y, TARGET.y, outY), HOME.y, backY),
  };
}

function hubAt(t: number) {
  const rise = outCubic(span(t, 2.2, 2.5)) * 3;
  const drop = outBack(span(t, 2.5, 3.4), 0.9);
  const lift = inOutCubic(span(t, 3.9, 4.7));
  const down = lerp(HUB_REST + rise, HUB_GRIP, drop);
  return lerp(down, HUB_REST, lift);
}

function openAt(t: number) {
  let v = REST_OPEN;
  v = lerp(v, 1, outBack(span(t, 2.15, 2.5), 1.4));
  v = lerp(v, GRIP_OPEN, outQuint(span(t, 3.4, 3.85)));
  v = lerp(v, 1, outBack(span(t, RELEASE, RELEASE + 0.25), 1.4));
  v = lerp(v, REST_OPEN, inOutCubic(span(t, 6.7, 7.1)));
  return v;
}

/** Damped pendulum driven by the gantry, integrated once at 240 Hz over the whole play. */
const RATE = 240;
const SWAY = (() => {
  const n = Math.ceil(DURATION * RATE) + 2;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const omega2 = 7.2 * 7.2;
  const damp = 3.2;
  const h = 1 / RATE;
  let sx = 0;
  let sy = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const t = i * h;
    const a = gantry(t - h);
    const b = gantry(t);
    const c = gantry(t + h);
    const ax = (c.gx - 2 * b.gx + a.gx) / (h * h);
    const ay = (c.gy - 2 * b.gy + a.gy) / (h * h);
    vx += (-omega2 * sx - damp * vx - ax * 0.22) * h;
    vy += (-omega2 * sy - damp * vy - ay * 0.22) * h;
    sx += vx * h;
    sy += vy * h;
    xs[i] = Math.max(-6, Math.min(6, sx));
    ys[i] = Math.max(-6, Math.min(6, sy));
  }
  return { xs, ys, n };
})();

function swayAt(t: number) {
  const f = clamp01(t / DURATION) * DURATION * RATE;
  const i = Math.min(SWAY.n - 2, Math.floor(f));
  const u = f - i;
  // A shorter cable swings less: scale by the hanging length.
  const reach = 0.4 + 0.6 * clamp01((HUB_REST + 10 - hubAt(t)) / 45);
  return { sx: lerp(SWAY.xs[i]!, SWAY.xs[i + 1]!, u) * reach, sy: lerp(SWAY.ys[i]!, SWAY.ys[i + 1]!, u) * reach };
}

function phaseAt(t: number): Phase {
  if (t <= 0) return "ready";
  if (t < 0.8) return "coin";
  if (t < 2.5) return "move";
  if (t < 3.4) return "drop";
  if (t < 3.9) return "grip";
  if (t < 4.75) return "lift";
  if (t < RELEASE) return "carry";
  if (t < 6.7) return "release";
  if (t < DURATION) return "prize";
  return "prize";
}

/** Pose at `t` seconds into the play (0 = ready, DURATION = prize down the chute). */
export function poseAt(t: number): Pose {
  const { gx, gy } = gantry(t);
  const { sx, sy } = swayAt(t);
  const hub = hubAt(t);
  const open = openAt(t);

  let box: Pose["box"] = { x: TARGET.x, y: TARGET.y, z: TARGET.z, shown: true, falling: false };
  if (t >= 3.9 && t < RELEASE) {
    box = { x: gx + sx, y: gy + sy, z: hub - CARRY_DROP - BOX, shown: true, falling: false };
  } else if (t >= RELEASE) {
    const r = swayAt(RELEASE);
    const g0 = gantry(RELEASE);
    const dt = t - RELEASE;
    const z = HUB_REST - CARRY_DROP - BOX - 0.5 * GRAVITY * dt * dt;
    box = { x: g0.gx + r.sx, y: g0.gy + r.sy, z, shown: z > Z.floor - BOX - 30, falling: true };
  }

  const h = 1 / 60;
  const a = gantry(t - h);
  const b = gantry(t + h);
  const vmax = 75;
  const lean = { x: Math.max(-1, Math.min(1, (b.gx - a.gx) / (2 * h) / vmax)), y: Math.max(-1, Math.min(1, (b.gy - a.gy) / (2 * h) / vmax)) };

  return {
    gx,
    gy,
    sx,
    sy,
    hub,
    open,
    box,
    coin: span(t, 0, 0.55),
    button: Math.sin(Math.PI * span(t, 0.55, 0.85)),
    lean,
    phase: phaseAt(t),
  };
}

export const REST_POSE: Pose = poseAt(0);

/** Readout words, one per phase. */
export const PHASE_LABEL: Record<Phase, string> = {
  ready: "Ready",
  coin: "1 USDC in",
  move: "Aiming",
  drop: "Drop",
  grip: "Grip",
  lift: "Lift",
  carry: "Carry",
  release: "Release",
  prize: "Box won",
};
