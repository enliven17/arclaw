"use client";

/**
 * Hero: the slogan, one subline, a machine switcher and the play button, next to the cabinet.
 *
 * Wide screens with a fine pointer pin the hero and scrub the claw's play with the scroll. Touch and narrow
 * screens play it once when the cabinet is in view. The landing is marketing only: the button opens the machine in
 * the app (/app/play/<machine>). Reduced motion: the machine stays at rest.
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { ClawMachine, type ClawHandle } from "@/components/claw/ClawMachine";
import type { ClawArt } from "@/components/claw/geometry";
import { variantOf, type Variant } from "@/components/claw/view";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { PINNED, REDUCED, ScrollTrigger, gsap, pinType, useGSAP } from "@/lib/motion";
import type { Machine } from "@/lib/machines";
import { MachineSwitch } from "./MachineSwitch";

export function Hero({ art, machines }: { art: Record<Variant, ClawArt>; machines: Machine[] }) {
  const root = useRef<HTMLElement>(null);
  const claw = useRef<ClawHandle>(null);
  const [id, setId] = useState(machines[0]!.id);
  const machine = machines.find((m) => m.id === id) ?? machines[0]!;

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __claw?: ClawHandle | null }).__claw = claw.current;
      const mm = gsap.matchMedia();
      // `any` always matches: with only pinned and reduced, phones and touch laptops (neither) never ran the callback.
      mm.add({ pinned: PINNED, reduced: REDUCED, any: "all" }, (ctx) => {
        const { pinned, reduced } = ctx.conditions as { pinned: boolean; reduced: boolean };
        if (reduced) return;
        if (pinned) {
          const proxy = { p: 0 };
          const tween = gsap.to(proxy, { p: 1, ease: "none", onUpdate: () => claw.current?.seekProgress(proxy.p) });
          ScrollTrigger.create({ trigger: el, start: "top top", end: "+=1600", pin: true, pinType: pinType(), scrub: 0.6, animation: tween, anticipatePin: 1 });
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
      <div className="wrap grid min-h-dvh items-center gap-y-6 pb-12 pt-28 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-x-10 md:pb-8 md:pt-24 lg:gap-x-16">
        <div className="flex flex-col items-start">
          <SplitHeading as="h1" id="hero-title" className="h-display !text-[clamp(46px,5.3vw,92px)]" lines={["Grab a box.", "Pull real stocks."]} />
          <p className="lede mt-7 max-w-[26em]" data-reveal>
            Every play wins a sealed pack of three tokenized stocks, paid straight to your wallet on Arc.
          </p>
          <div className="mt-9 w-full max-w-[460px]" data-reveal>
            <MachineSwitch machines={machines} value={id} onChange={setId} label="Machine" />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3" data-reveal>
            <Link href={`/app/play/${machine.slug}`} className="btn-cream">
              Play {machine.name} for <span className="money">{machine.priceUsdc} USDC</span>
            </Link>
            <a href="#odds" className="btn-ghost">
              See the odds
            </a>
          </div>
        </div>

        <figure data-cabinet="" className="mx-auto w-full max-w-[400px] md:max-w-[500px] md:justify-self-end">
          <ClawMachine key={machine.slug} ref={claw} art={art[variantOf(machine.slug)]} machine={machine.slug} />
          <figcaption className="sr-only">
            The {machine.name} machine. The claw moves over the pile, drops, grips a sealed box, carries it to the chute
            and lets go.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
