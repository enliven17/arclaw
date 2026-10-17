"use client";

/**
 * The live claw machine. Static art arrives as element props (built on the server in geometry.tsx); this
 * component places it in painter's order, wraps the moving parts in refs and writes attributes per frame without
 * re-rendering.
 *
 * Control it through the ref:
 *   play()            runs the scripted play once (coin to prize), resolves when the box is down the chute
 *   run(from, to)     plays part of it (the app starts on submit and finishes on confirm), respawn() resets
 *   seek(seconds)     shows the pose at a time; used by the landing's scroll scrub
 *   seekProgress(p)   the same, 0..1
 *   reset()           back to rest
 *
 * At rest it idles still; a fine pointer over it nudges the gantry, which then settles and stops. Reduced motion:
 * play() jumps to the final frame, no pointer nudge.
 */
import { useEffect, useId, useImperativeHandle, useRef, type Ref } from "react";
import { gsap } from "@/lib/motion";
import { translateAlong } from "@/components/iso/iso-kit";
import type { ClawArt } from "./geometry";
import { DURATION, REST_POSE, poseAt, type Phase, type Pose } from "./model";
import { CHUTE_CLIP, PRONG_ANGLES, boxShift, bridgeShift, cablePath, clawShift, coinShift, hubTop, joystick, prongPath, px, trolleyShift } from "./frame";
import { H, P, W } from "./view";
import { play, type Sfx } from "@/lib/sfx";
import "./claw.css";

const PHASE_SOUND: Partial<Record<Phase, Sfx>> = { coin: "coin", move: "motor", drop: "drop", grip: "grip", release: "box" };

export type ClawHandle = {
  /** The whole play, then a fresh box drops onto the pile. */
  play: () => Promise<void>;
  /** Animate from one time to another (seconds); the app holds at the drop until the payment confirms. */
  run: (from: number, to: number) => Promise<void>;
  /** A fresh box drops back onto the pile and the claw is at rest. */
  respawn: () => Promise<void>;
  seek: (seconds: number) => void;
  seekProgress: (progress: number) => void;
  reset: () => void;
  readonly duration: number;
};

type Props = {
  art: ClawArt;
  ref?: Ref<ClawHandle>;
  label?: string;
  className?: string;
  onPhase?: (phase: Phase, pose: Pose) => void;
  /** Play sound effects on phase changes during run()/play() (the app; never the landing scrub). */
  sound?: boolean;
  /** Cabinet finish: "single" (default), "stack" or "vault" (claw.css). */
  machine?: string;
};

const PRONG_W = px(1.9);
const CABLE_W = px(0.8);
const SHAFT_W = px(1.6);
const BALL_R = px(3.6);
const PIN_R = px(0.9);

export function ClawMachine({ art, ref, label = "A claw machine: a glass cabinet with a gantry, a three prong claw over a pile of sealed prize boxes, a chute, a coin slot and a joystick.", className, onPhase, machine = "single", sound = false }: Props) {
  const CLIP_ID = `chute-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const root = useRef<SVGSVGElement>(null);
  const farTruck = useRef<SVGGElement>(null);
  const bridge = useRef<SVGGElement>(null);
  const trolley = useRef<SVGGElement>(null);
  const cable = useRef<SVGPathElement>(null);
  const hub = useRef<SVGGElement>(null);
  const box = useRef<SVGGElement>(null);
  const boxClip = useRef<SVGGElement>(null);
  const prongs = useRef<(SVGPathElement | null)[]>([]);
  const pins = useRef<(SVGCircleElement | null)[]>([]);
  const shaft = useRef<SVGPathElement>(null);
  const ball = useRef<SVGCircleElement>(null);
  const button = useRef<SVGGElement>(null);
  const coin = useRef<SVGGElement>(null);

  const t = useRef(0);
  const phase = useRef<Phase>("ready");
  const playing = useRef<Promise<void> | null>(null);
  const nudge = useRef({ x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, raf: 0, last: 0 });
  const onPhaseRef = useRef(onPhase);
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  useEffect(() => {
    onPhaseRef.current = onPhase;
  }, [onPhase]);

  /** Write one pose to the DOM. */
  const apply = (s: Pose, extra: { boxLift?: number; boxAlpha?: number } = {}) => {
    farTruck.current?.setAttribute("transform", bridgeShift(s));
    bridge.current?.setAttribute("transform", bridgeShift(s));
    trolley.current?.setAttribute("transform", trolleyShift(s));
    cable.current?.setAttribute("d", cablePath(s));
    hub.current?.setAttribute("transform", clawShift(s));
    const c = hubTop(s);
    PRONG_ANGLES.forEach((a, i) => {
      const { d, knuckle } = prongPath(c, a, s.open);
      prongs.current[i]?.setAttribute("d", d);
      pins.current[i]?.setAttribute("cx", knuckle[0].toFixed(1));
      pins.current[i]?.setAttribute("cy", knuckle[1].toFixed(1));
    });
    const b = box.current;
    if (b) {
      const lift = extra.boxLift ?? 0;
      b.setAttribute("transform", boxShift(lift ? { ...s, box: { ...s.box, z: s.box.z + lift } } : s));
      b.style.display = s.box.shown ? "" : "none";
      b.style.opacity = extra.boxAlpha === undefined ? "" : String(extra.boxAlpha);
      // The clip sits on an untransformed wrapper so it stays put while the box moves.
      if (s.box.falling) boxClip.current?.setAttribute("clip-path", `url(#${CLIP_ID})`);
      else boxClip.current?.removeAttribute("clip-path");
    }
    const j = joystick(s);
    shaft.current?.setAttribute("d", j.d);
    ball.current?.setAttribute("cx", j.ball[0].toFixed(1));
    ball.current?.setAttribute("cy", j.ball[1].toFixed(1));
    button.current?.setAttribute("transform", translateAlong(P, [0, 0, -1.3 * s.button]));
    const cg = coin.current;
    if (cg) {
      cg.setAttribute("transform", coinShift(s));
      cg.style.display = s.coin > 0 && s.coin < 1 ? "" : "none";
      cg.style.opacity = String(Math.min(1, (1 - s.coin) / 0.15));
    }
    if (s.phase !== phase.current) {
      phase.current = s.phase;
      onPhaseRef.current?.(s.phase, s);
      if (soundRef.current && playing.current) {
        const cue = PHASE_SOUND[s.phase];
        if (cue) play(cue);
      }
    }
  };

  /** Pose at the current time, plus the idle nudge when at rest. */
  const render = () => {
    const s = poseAt(t.current);
    const n = nudge.current;
    if (t.current <= 0 && (n.x || n.y)) {
      apply({ ...s, gx: s.gx + n.x, gy: s.gy + n.y, sx: -n.vx * 0.06, sy: -n.vy * 0.06, lean: { x: n.vx / 40, y: n.vy / 40 } });
    } else apply(s);
  };

  useImperativeHandle(
    ref,
    () => {
      const handle: ClawHandle = {
      duration: DURATION,
      seek(seconds: number) {
        if (playing.current) return;
        t.current = Math.max(0, Math.min(DURATION, seconds));
        render();
      },
      seekProgress(progress: number) {
        handle.seek(progress * DURATION);
      },
      reset() {
        t.current = 0;
        render();
      },
      run(from: number, to: number) {
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const start = Math.max(0, Math.min(DURATION, from));
        const end = Math.max(start, Math.min(DURATION, to));
        const job = new Promise<void>((resolve) => {
          if (still || end === start) {
            t.current = end;
            render();
            resolve();
            return;
          }
          const proxy = { t: start };
          gsap.to(proxy, {
            t: end,
            duration: end - start,
            ease: "none",
            onUpdate: () => {
              t.current = proxy.t;
              render();
            },
            onComplete: () => resolve(),
          });
        });
        playing.current = job.then(() => {
          playing.current = null;
        });
        return playing.current;
      },
      respawn() {
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        t.current = 0;
        if (still) {
          apply(REST_POSE);
          return Promise.resolve();
        }
        // A fresh box drops back onto the pile, so the machine is ready for the next play.
        return new Promise<void>((resolve) => {
          const proxy = { lift: 36, alpha: 0 };
          gsap.to(proxy, {
            lift: 0,
            alpha: 1,
            duration: 0.7,
            ease: "back.out(1.4)",
            delay: 0.3,
            onUpdate: () => apply(REST_POSE, { boxLift: proxy.lift, boxAlpha: Math.min(1, proxy.alpha * 1.6) }),
            onComplete: () => {
              apply(REST_POSE);
              resolve();
            },
          });
        });
      },
      play() {
        if (playing.current) return playing.current;
        return handle.run(0, DURATION).then(() => handle.respawn());
      },
      };
      return handle;
    },
    // render/apply only touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Idle: a fine pointer over the cabinet pulls the gantry a little toward it; it settles and the loop stops. */
  useEffect(() => {
    const svg = root.current;
    if (!svg) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    const n = nudge.current;
    const step = (now: number) => {
      const dt = n.last ? Math.min(0.05, (now - n.last) / 1000) : 1 / 60;
      n.last = now;
      const k = 1 - Math.exp(-dt / 0.35);
      const px0 = n.x;
      const py0 = n.y;
      n.x += (n.tx - n.x) * k;
      n.y += (n.ty - n.y) * k;
      n.vx = (n.x - px0) / dt;
      n.vy = (n.y - py0) / dt;
      if (!playing.current && t.current <= 0) render();
      if (Math.abs(n.tx - n.x) < 0.02 && Math.abs(n.ty - n.y) < 0.02) {
        n.x = n.tx;
        n.y = n.ty;
        n.vx = 0;
        n.vy = 0;
        if (!playing.current && t.current <= 0) render();
        n.raf = 0;
        n.last = 0;
        return;
      }
      n.raf = requestAnimationFrame(step);
    };
    const kick = () => {
      if (!n.raf) n.raf = requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = svg.getBoundingClientRect();
      const u = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      const v = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      // Screen right is +x and -y in this camera; keep the nudge inside the cabinet near home.
      n.tx = u * 10;
      n.ty = -u * 4 + v * 6;
      kick();
    };
    const onLeave = () => {
      n.tx = 0;
      n.ty = 0;
      kick();
    };
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerleave", onLeave);
    return () => {
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(n.raf);
      n.raf = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server and first client render: the rest pose, from the same pure functions the loop uses.
  const s = REST_POSE;
  const c = hubTop(s);
  const rest = PRONG_ANGLES.map((a) => prongPath(c, a, s.open));
  const j = joystick(s);

  const prong = (i: number) => (
    <g key={`prong-${i}`}>
      <path
        ref={(el) => {
          prongs.current[i] = el;
        }}
        className="claw-prong"
        data-far={i === 0 ? undefined : ""}
        strokeWidth={PRONG_W}
        d={rest[i]!.d}
      />
      <circle
        ref={(el) => {
          pins.current[i] = el;
        }}
        className="claw-pin"
        r={PIN_R}
        cx={rest[i]!.knuckle[0].toFixed(1)}
        cy={rest[i]!.knuckle[1].toFixed(1)}
      />
    </g>
  );

  return (
    <div className={className ? `claw-fig ${className}` : "claw-fig"} data-machine={machine}>
      <svg ref={root} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} focusable="false">
        <defs>
          <clipPath id={CLIP_ID}>
            <path d={CHUTE_CLIP} />
          </clipPath>
        </defs>
        {art.back}
        <g ref={farTruck}>{art.farTruck}</g>
        <g ref={trolley}>{art.trolley}</g>
        <path ref={cable} className="claw-cable" strokeWidth={CABLE_W} d={cablePath(s)} />
        {prong(1)}
        {prong(2)}
        <g ref={boxClip}>
          <g ref={box}>{art.box}</g>
        </g>
        <g ref={hub}>{art.hub}</g>
        {prong(0)}
        {art.nearRail}
        <g ref={bridge}>{art.bridge}</g>
        {art.near}
        {art.header}
        <path ref={shaft} className="claw-shaft" strokeWidth={SHAFT_W} d={j.d} />
        <circle ref={ball} className="claw-ball" r={BALL_R} cx={j.ball[0].toFixed(1)} cy={j.ball[1].toFixed(1)} />
        <g ref={button}>{art.buttonCap}</g>
        <g ref={coin} style={{ display: "none" }}>
          {art.coin}
        </g>
      </svg>
    </div>
  );
}
