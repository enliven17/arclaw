"use client";

/**
 * First visit per tab session. A USDC coin spins in and drops through the slot, then the claw drops on its cable with
 * its prongs open, grips the wordmark, gives it a tug, then hauls the whole panel up off the page like a curtain: the
 * panel is attached to the wordmark, the claw and wordmark lead by a little rope slack, and everything moves by
 * transform only. The head script in app/layout decides (html.splashing) before first paint, and globals.css holds the
 * claw above the screen and the wordmark hidden until the timeline takes over, so nothing flashes before the coin.
 * When it lifts it removes html.splashing and dispatches SPLASH_DONE (lib/splash.ts) so heavy page work can start.
 */
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { MARK_BODY, MARK_PRONGS, MARK_SIZE, PRONG_W, WORD_H, WORD_PATH, WORD_W } from "@/lib/brand/logo";
import { getLenis } from "@/lib/motion";
import { SPLASH_DONE } from "@/lib/splash";
import { USDC_BLUE, USDC_BOX, USDC_DISC, USDC_DOLLAR, USDC_RINGS } from "@/lib/brand/usdc";

export const SPLASH_KEY = "arclaw:splash";

// The logo prongs split into separate paths so each can pivot on the hub. Order in MARK_PRONGS: left, right, middle.
const [LEFT, RIGHT, MID] = MARK_PRONGS.split("M").filter(Boolean).map((d) => `M${d}`);

export function Splash() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    const el = root.current;
    if (!el || !html.classList.contains("splashing")) return;
    // html.splashing clips overflow, so scrolling is locked even before Lenis exists.
    getLenis()?.stop();
    const moving = () => [el, ...el.querySelectorAll<HTMLElement | SVGElement>("[data-rig], [data-word], [data-coin]")];
    const done = () => {
      html.classList.remove("splashing");
      moving().forEach((n) => (n.style.willChange = ""));
      try {
        sessionStorage.setItem(SPLASH_KEY, "1");
      } catch {}
      getLenis()?.start();
      window.dispatchEvent(new Event(SPLASH_DONE));
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done();
      return;
    }
    const q = gsap.utils.selector(el);
    const count = { v: 0 };
    const num = q("[data-count]")[0] as HTMLElement;
    gsap.set(q("[data-left]"), { svgOrigin: "9 10.5", rotation: 22 });
    gsap.set(q("[data-right]"), { svgOrigin: "15 10.5", rotation: -22 });
    gsap.set(q("[data-rig]"), { y: "-75vh" });
    gsap.set(q("[data-word]"), { opacity: 0 });
    // Compositor layers for the parts that move, only for the splash.
    moving().forEach((n) => (n.style.willChange = "transform, opacity"));

    performance.mark("splash-start");
    const tl = gsap.timeline({ onComplete: done });
    // Coin: pops in, spins twice on its edge, drops through the slot. The claw act starts at C.
    const C = 1.05;
    tl.fromTo(q("[data-coin]"), { scale: 0.6, opacity: 0, y: -72 }, { scale: 1, opacity: 1, duration: 0.35, ease: "back.out(1.6)" }, 0)
      .fromTo(q("[data-coin]"), { rotationY: 0 }, { rotationY: 720, transformPerspective: 600, duration: 0.7, ease: "power2.inOut" }, 0.05)
      .to(q("[data-coin]"), { y: 150, duration: 0.3, ease: "power3.in" }, 0.72)
      .fromTo(q("[data-slot]"), { opacity: 0, scaleX: 0.6 }, { opacity: 1, scaleX: 1, duration: 0.3, ease: "power2.out" }, 0.1)
      .to(q("[data-slot]"), { opacity: 0, duration: 0.2 }, 1.0);
    tl.addLabel("claw", C);
    tl.to(q("[data-rig]"), { y: 0, duration: 1, ease: "power3.inOut" }, "claw+=0")
      // fromTo, not from: a StrictMode re-run would read the first run's opacity 0 as the end value.
      .fromTo(q("[data-word]"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, "claw+=0.35")
      // Grip: the prongs swing shut a touch past closed, then settle.
      .to(q("[data-left]"), { rotation: -4, duration: 0.22, ease: "power2.in" }, "claw+=0.95")
      .to(q("[data-right]"), { rotation: 4, duration: 0.22, ease: "power2.in" }, "claw+=0.95")
      .to(q("[data-left], [data-right]"), { rotation: 0, duration: 0.18, ease: "power2.out" }, "claw+=1.17")
      // Tug: claw and wordmark lift together a few pixels, as if testing the weight.
      .to(q("[data-rig], [data-word]"), { y: -10, duration: 0.22, ease: "power2.out" }, "claw+=1.3")
      .to(count, { v: 100, duration: 2.55, ease: "power2.inOut", onUpdate: () => void (num.textContent = String(Math.round(count.v)).padStart(3, "0")) }, 0)
      .to(q("[data-bar]"), { scaleX: 1, duration: 2.55, ease: "power2.inOut" }, 0)
      // Haul: the claw and wordmark lead (the rope takes up a little slack), and the panel hangs from them, so it
      // rises with them and its bottom edge sweeps up the page. Transforms only.
      .to(q("[data-rig], [data-word]"), { y: -34, duration: 0.18, ease: "power2.in" }, "claw+=1.55")
      .to(el, { yPercent: -112, duration: 0.95, ease: "power3.in" }, "claw+=1.62");
    return () => {
      tl.kill();
    };
  }, []);

  const s = 6; // mark scale: 24 units to 144px
  return (
    <div ref={root} aria-hidden className="splash fixed inset-0 z-[100] hidden bg-ink text-cream">
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center">
          {/* The coin falls through this window; its bottom edge is the slot, so the coin vanishes into it. */}
          <div className="flex h-[170px] w-[140px] items-end justify-center overflow-hidden">
            <svg data-coin viewBox={`0 0 ${USDC_BOX} ${USDC_BOX}`} width={112} height={112} className="mb-[-56px] block opacity-0">
              <path fill={USDC_BLUE} d={USDC_DISC} />
              <path fill="#fff" d={USDC_DOLLAR} />
              <path fill="#fff" d={USDC_RINGS} />
            </svg>
          </div>
          <div data-slot className="h-2 w-[136px] rounded-full bg-cream/25 opacity-0" />
        </div>
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center">
          <div data-rig className="relative flex flex-col items-center">
            {/* The cable runs off the top of the screen whatever the claw's height. Out of flow, so only the claw
                and the wordmark are centred; it meets the mark's own cable stub at the top of the svg. */}
            <div className="absolute bottom-full left-1/2 -mb-px h-[150vh] -translate-x-1/2 bg-cream" style={{ width: 2 * s }} />
            <svg viewBox={`0 1 ${MARK_SIZE} 23`} width={MARK_SIZE * s} height={23 * s} className="-mt-px block overflow-visible">
              <path fill="var(--color-cream)" d={MARK_BODY} />
              <g fill="none" stroke="var(--color-claw)" strokeWidth={PRONG_W} strokeLinecap="butt" strokeLinejoin="miter">
                <path data-left d={LEFT} />
                <path d={MID} />
                <path data-right d={RIGHT} />
              </g>
            </svg>
          </div>
          <svg data-word viewBox={`0 0 ${WORD_W} ${WORD_H}`} className="mt-2 block h-[clamp(44px,7vw,88px)] w-auto">
            <path fill="var(--color-cream)" d={WORD_PATH} />
          </svg>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-8 max-sm:p-4">
        <div className="flex justify-end">
          <span data-count className="font-mono text-[15px] tabular-nums text-muted">
            000
          </span>
        </div>
        <div className="mt-3 h-px bg-cream/10">
          <div data-bar className="h-px origin-left scale-x-0 bg-cream/60" />
        </div>
      </div>
    </div>
  );
}

