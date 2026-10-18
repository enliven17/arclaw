"use client";

/**
 * The page change between the landing and the app, as a story: the claw drops down the screen on its cable and grips
 * the top edge of a black curtain waiting below the frame, tugs once, and hauls it up over the page. Behind the black
 * the new route loads. Then the claw takes the curtain on up and off the top, and the new page is there.
 *
 *   drop   the claw falls from above while the curtain's edge rises to meet it (prongs open)
 *   grip   the prongs shut, a small tug
 *   cover  the curtain is hauled up over the old page; the new route starts loading as it closes
 *   wait   black, until the new path is in
 *   reveal the curtain leaves through the top
 *
 * Transforms only, on two elements (the claw rides on the curtain). Reduced motion never gets here (ClawLink).
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MARK_BODY, MARK_PRONGS, MARK_SIZE, PRONG_W } from "@/lib/brand/logo";
import { registerCurtain } from "@/lib/curtain";
import { getLenis } from "@/lib/motion";
import { play } from "@/lib/sfx";

// Same scale as the splash claw (24 units to 144px); the prongs are split so the outer two can swing.
const SCALE = 6;
const [LEFT, RIGHT, MID] = MARK_PRONGS.split("M").filter(Boolean).map((d) => `M${d}`);
/** How far the curtain's top edge peeks above the bottom of the screen when the claw grips it. */
const PEEK = 150;

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const frames = (n: number) => new Promise<void>((r) => (n <= 0 ? r() : requestAnimationFrame(() => void frames(n - 1).then(r))));
const go = (el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) => el.animate(keyframes, { fill: "forwards", ...options }).finished;

export function ClawCurtain() {
  const router = useRouter();
  const path = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const rig = useRef<HTMLDivElement>(null);
  const arrived = useRef<{ from: string; done: () => void } | null>(null);
  const busy = useRef(false);

  // The new route is in once the path changes.
  useEffect(() => {
    if (arrived.current && path !== arrived.current.from) arrived.current.done();
  }, [path]);

  useEffect(() => {
    const play1 = async (href: string) => {
      const el = root.current;
      const pan = panel.current;
      const rg = rig.current;
      if (!el || !pan || !rg || busy.current) return;
      busy.current = true;
      const html = document.documentElement;
      getLenis()?.stop();
      el.dataset.on = "";
      el.dataset.phase = "drop";
      router.prefetch(href);
      html.dataset.curtain = ""; // the new page's entrance animations wait for the reveal (globals.css)
      try {
        play("drop");
        await Promise.all([
          go(rg, [{ transform: "translateY(-115vh)" }, { transform: "translateY(0)" }], { duration: 320, easing: "cubic-bezier(0.55, 0, 0.85, 0.4)" }),
          go(pan, [{ transform: "translateY(100%)" }, { transform: `translateY(calc(100% - ${PEEK}px))` }], { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" }),
        ]);
        el.dataset.phase = "grip";
        play("grip");
        await sleep(90);
        await go(rg, [{ transform: "translateY(0)" }, { transform: "translateY(-10px)" }, { transform: "translateY(0)" }], { duration: 130, easing: "ease-out" });
        play("motor");
        // Hauled up over the page. The route loads while the curtain is still rising, timed to land just after it has
        // closed, so the swap is never seen; the claw lifts out of sight once the screen is black.
        const covering = go(pan, [{ transform: `translateY(calc(100% - ${PEEK}px))` }, { transform: "translateY(0)" }], { duration: 460, easing: "cubic-bezier(0.65, 0, 0.25, 1)" });
        void go(rg, [{ transform: "translateY(0)" }, { transform: "translateY(-44px)" }], { duration: 140, delay: 330, easing: "ease-in" });
        const target = new URL(href, window.location.href);
        let here: Promise<void> = Promise.resolve();
        if (target.pathname !== window.location.pathname) {
          here = new Promise<void>((done) => (arrived.current = { from: window.location.pathname, done }));
          await sleep(190);
          router.push(href, { transitionTypes: ["claw"] });
        }
        // A slow route must not leave the screen black for good.
        await Promise.all([covering, Promise.race([here, sleep(3500)])]);
        arrived.current = null;
        el.dataset.phase = "wait";
        await frames(3);
        el.dataset.phase = "reveal";
        delete html.dataset.curtain;
        await go(pan, [{ transform: "translateY(0)" }, { transform: "translateY(-105%)" }], { duration: 620, easing: "cubic-bezier(0.55, 0, 0.8, 0.3)" });
      } finally {
        for (const n of [pan, rg]) n.getAnimations().forEach((a) => a.cancel());
        delete el.dataset.on;
        delete el.dataset.phase;
        delete html.dataset.curtain;
        busy.current = false;
        getLenis()?.start();
      }
    };
    registerCurtain((href) => void play1(href));
    return () => registerCurtain(null);
  }, [router]);

  return (
    <div ref={root} className="curtain" aria-hidden="true">
      <div ref={panel} className="curtain-panel">
        <div ref={rig} className="curtain-rig">
          <div className="curtain-cable" />
          <svg viewBox={`0 1 ${MARK_SIZE} 23`} width={MARK_SIZE * SCALE} height={23 * SCALE}>
            <path fill="var(--color-cream)" d={MARK_BODY} />
            <g fill="none" stroke="var(--color-claw)" strokeWidth={PRONG_W} strokeLinejoin="miter">
              <path className="prong-l" d={LEFT} />
              <path d={MID} />
              <path className="prong-r" d={RIGHT} />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
