"use client";

/**
 * Motion core (ported from mimir-solana/lib/motion.ts). Plugins register once, one Lenis runs on GSAP's ticker so
 * smooth scroll and ScrollTrigger share one clock, and nothing smooths under prefers-reduced-motion.
 *
 * - Lenis only for a fine pointer with motion allowed. Touch scrolls natively; every consumer handles
 *   `getLenis()` being null.
 * - Lenis has no rAF of its own. Its tick sits on GSAP's ticker only while the page scrolls and comes off after a
 *   short rest, so an idle page runs no per-frame work for scrolling.
 * - Pins use `pinType()`: transform while Lenis drives the page (same frame as ScrollTrigger), fixed under native
 *   scroll (the compositor scrolls ahead of JS, so only a fixed pin does not jitter).
 *
 * Client only. Never import from a server component.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";

type MotionState = {
  lenis: Lenis | null;
  tick: ((time: number) => void) | null;
  registered: boolean;
  awake: boolean;
  restTimer: number;
  stopWake: (() => void) | null;
};

// On globalThis so an HMR re-evaluation finds the running instance instead of adding a second ticker callback.
const g = globalThis as typeof globalThis & { __arclawMotion?: MotionState };
const state: MotionState = (g.__arclawMotion ??= { lenis: null, tick: null, registered: false, awake: false, restTimer: 0, stopWake: null });

if (typeof window !== "undefined" && !state.registered) {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
  // Mobile URL bars resize the viewport while scrolling; re-measuring pins on each of those makes them jump.
  ScrollTrigger.config({ ignoreMobileResize: true, limitCallbacks: true });
  state.registered = true;
}

export const REDUCED = "(prefers-reduced-motion: reduce)";
/** Wide screen, a mouse or trackpad, motion allowed: where sections pin and scrub. CSS mirrors it (globals.css). */
export const PINNED = "(min-width: 768px) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
/** Everything else that still animates: phones, tablets, touch laptops. Stacked reveals, no pins. */
export const STACKED =
  "(prefers-reduced-motion: no-preference) and (max-width: 767.98px), (prefers-reduced-motion: no-preference) and (pointer: coarse)";

export function reducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(REDUCED).matches;
}

export function smoothScrollAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (reducedMotion()) return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function pinType(): "fixed" | "transform" {
  return smoothScrollAllowed() ? "transform" : "fixed";
}

export function getLenis(): Lenis | null {
  return state.lenis;
}

const REST_MS = 600;

function wake(): void {
  const lenis = state.lenis;
  if (!lenis || !state.tick) return;
  if (!state.awake) {
    state.awake = true;
    // After a rest the gap since the last Lenis tick is seconds long; restart its clock so the glide starts clean.
    lenis.time = 0;
    gsap.ticker.add(state.tick);
  }
  window.clearTimeout(state.restTimer);
  state.restTimer = window.setTimeout(rest, REST_MS);
}

function rest(): void {
  const lenis = state.lenis;
  if (!lenis || !state.tick) return;
  if (lenis.isScrolling) {
    state.restTimer = window.setTimeout(rest, REST_MS);
    return;
  }
  gsap.ticker.remove(state.tick);
  state.awake = false;
}

export function startSmoothScroll(): Lenis | null {
  if (typeof window === "undefined") return null;
  if (state.lenis || !smoothScrollAllowed()) return state.lenis;
  const lenis = new Lenis({
    lerp: 0.08,
    wheelMultiplier: 0.85,
    allowNestedScroll: true,
    stopInertiaOnNavigate: true,
    autoRaf: false,
    anchors: { offset: -72 },
  });
  lenis.on("scroll", ScrollTrigger.update);
  lenis.on("scroll", wake);
  const tick = (time: number) => lenis.raf(time * 1000);
  state.lenis = lenis;
  state.tick = tick;
  const scrollTo = lenis.scrollTo.bind(lenis);
  lenis.scrollTo = ((...args: Parameters<Lenis["scrollTo"]>) => {
    wake();
    return scrollTo(...args);
  }) as Lenis["scrollTo"];
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  const events = ["wheel", "pointerdown", "keydown"] as const;
  events.forEach((e) => window.addEventListener(e, wake, opts));
  state.stopWake = () => events.forEach((e) => window.removeEventListener(e, wake, opts));
  // No lag smoothing while Lenis runs: after a long task the scroll catches up in one step.
  gsap.ticker.lagSmoothing(0);
  wake();
  return lenis;
}

export function stopSmoothScroll(): void {
  if (state.tick) gsap.ticker.remove(state.tick);
  window.clearTimeout(state.restTimer);
  state.stopWake?.();
  state.lenis?.destroy();
  state.lenis = null;
  state.tick = null;
  state.awake = false;
  state.stopWake = null;
  gsap.ticker.lagSmoothing(500, 33);
}

export function scrollToTop(): void {
  if (state.lenis) state.lenis.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

/** Scroll to an element, through Lenis when it runs. */
export function scrollToEl(el: HTMLElement, offset = -72): void {
  if (state.lenis) state.lenis.scrollTo(el, { offset, force: true });
  else el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });
}

export { gsap, ScrollTrigger, useGSAP };
