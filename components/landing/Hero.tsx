"use client";

/**
 * Hero: the cabinet, the promise, one action.
 *
 * Wide screens with a fine pointer pin the hero and scrub the claw's play with the scroll (out to the prize in
 * the chute). Touch and narrow screens play it once when the hero has settled in view. The button plays it
 * on demand; the app will wire payment to the same play(). Reduced motion: the machine stays at rest and the
 * button shows the final frame.
 */
import { useRef } from "react";
import { ClawMachine, type ClawHandle } from "@/components/claw/ClawMachine";
import type { ClawArt } from "@/components/claw/geometry";
import { PHASE_LABEL, type Phase } from "@/components/claw/model";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { PINNED, REDUCED, ScrollTrigger, gsap, pinType, useGSAP } from "@/lib/motion";

export function Hero({ art }: { art: ClawArt }) {
  const root = useRef<HTMLElement>(null);
  const claw = useRef<ClawHandle>(null);
  const readout = useRef<HTMLSpanElement>(null);

  const onPhase = (phase: Phase) => {
    if (readout.current) readout.current.textContent = PHASE_LABEL[phase];
  };

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __claw?: ClawHandle | null }).__claw = claw.current;
      const mm = gsap.matchMedia();
      mm.add({ pinned: PINNED, reduced: REDUCED }, (ctx) => {
        const { pinned, reduced } = ctx.conditions as { pinned: boolean; reduced: boolean };
        if (reduced) return;
        if (pinned) {
          const proxy = { p: 0 };
          const tween = gsap.to(proxy, {
            p: 1,
            ease: "none",
            onUpdate: () => claw.current?.seekProgress(proxy.p),
          });
          ScrollTrigger.create({
            trigger: el,
            start: "top top",
            end: "+=1600",
            pin: true,
            pinType: pinType(),
            scrub: 0.6,
            animation: tween,
            anticipatePin: 1,
          });
          return;
        }
        const st = ScrollTrigger.create({
          trigger: el.querySelector("[data-cabinet]"),
          start: "top 70%",
          once: true,
          onEnter: () => gsap.delayedCall(0.6, () => void claw.current?.play()),
        });
        return () => st.kill();
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="hero-title" className="relative overflow-hidden">
      <div className="wrap grid min-h-dvh items-center gap-10 pb-16 pt-28 md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] md:gap-8 md:pb-10 md:pt-24">
        <div className="max-w-[620px]">
          <p className="label" data-reveal>
            A claw machine on Arc
          </p>
          <SplitHeading as="h1" id="hero-title" className="h-display mt-6" lines={["Play the claw.", "Win real stocks."]} />
          <p className="lede mt-7 max-w-[30em]" data-reveal>
            Pay 1 USDC and win a sealed box. It opens into a pack of three cards, and every card is a tokenized stock
            you keep.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3" data-reveal>
            <button type="button" className="btn-cream" onClick={() => void claw.current?.play()}>
              Play for <span className="money">1 USDC</span>
            </button>
            <a href="#how" className="btn-ghost">
              How it works
            </a>
          </div>
          <dl className="mt-12 grid max-w-[460px] grid-cols-3 gap-6 border-t border-line pt-6" data-reveal>
            <div>
              <dt className="label">Per play</dt>
              <dd className="money mt-2 text-[18px]">1 USDC</dd>
            </div>
            <div>
              <dt className="label">Cards</dt>
              <dd className="money mt-2 text-[18px]">3</dd>
            </div>
            <div>
              <dt className="label">Returned</dt>
              <dd className="money mt-2 text-[18px]">70 to 80%</dd>
            </div>
          </dl>
        </div>

        <figure data-cabinet="" className="claw-plate relative mx-auto w-full max-w-[460px] md:max-w-[520px]">
          <div aria-hidden="true">
            <span className="claw-corner left-0 top-0">Cab 01</span>
            <span className="claw-corner right-0 top-0">1 USDC per play</span>
            <span className="claw-corner bottom-0 left-0">Scroll to play</span>
            <span ref={readout} className="claw-corner bottom-0 right-0 text-cream">
              {PHASE_LABEL.ready}
            </span>
          </div>
          <div className="px-2 py-8">
            <ClawMachine ref={claw} art={art} onPhase={onPhase} />
          </div>
          <figcaption className="sr-only">
            The claw moves over the pile, drops, grips a sealed box, carries it to the chute and lets go.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
