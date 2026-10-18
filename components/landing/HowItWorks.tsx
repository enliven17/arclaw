"use client";

/**
 * How it works: pay, the claw drops a sealed box, the lid lifts and a booster pack rises out, the pack's top seal
 * rips off along the perforation and curls away, three cards slide up out of the pack, fan out and flip.
 *
 * Wide screens with a fine pointer pin the section and scrub one timeline. Phones, tablets and touch laptops play
 * the same timeline once when the stage comes into view. The stage has the same layout at every size. Reduced
 * motion: nothing moves, the cards render face up.
 */
import { useRef } from "react";
import { PINNED, REDUCED, ScrollTrigger, gsap, pinType, useGSAP } from "@/lib/motion";
import { whenSplashDone } from "@/lib/splash";
import { play } from "@/lib/sfx";
import { examplePack, type Machine } from "@/lib/machines";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { BoosterPack, PACK_SEAL_AT } from "@/components/pack/BoosterPack";
import { SealedBox } from "@/components/pack/SealedBox";
import { variantOf } from "@/components/claw/view";
import { StockCard } from "./StockCard";

export function HowItWorks({ machines }: { machines: Machine[] }) {
  const root = useRef<HTMLElement>(null);
  const machine = machines[0]!;
  const tier = machine.tiers[Math.min(2, machine.tiers.length - 1)]!;
  const pack = examplePack(machine, tier);
  const prices = machines.map((m) => m.priceUsdc);

  const steps = [
    { n: "01", title: `Pay ${prices.slice(0, -1).join(", ")} or ${prices.at(-1)} USDC`, body: "Pick a machine. Every play wins a box, there is no miss." },
    { n: "02", title: "The claw drops a box", body: "The claw is the show. A verifiable draw has already decided what is inside." },
    { n: "03", title: "The box opens into a pack", body: "Lift the lid, rip the seal. Three cards, sealed until now." },
    { n: "04", title: "Three cards flip", body: "Each card pays a real tokenized stock, straight to your wallet." },
  ];

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      // Scroll timelines and pins wait for the splash to lift, so they do not compete with it for frames.
      let live = true;
      void whenSplashDone().then(() => {
        if (!live) return;
      // `any` always matches: with only pinned and reduced, phones and touch laptops (neither) never ran the callback.
      mm.add({ pinned: PINNED, reduced: REDUCED, any: "all" }, (ctx) => {
        const { pinned, reduced } = ctx.conditions as { pinned: boolean; reduced: boolean };
        if (reduced) return;
        const q = gsap.utils.selector(el);
        const items = q("[data-step]");
        let shown = 0;
        const STEP_SOUND = ["coin", "drop", "tear", "flip"] as const;
        const setStep = (i: number) => {
          items.forEach((s, k) => (s.dataset.state = k < i ? "past" : k === i ? "active" : "future"));
          // A quiet cue when the scene moves forward into a step, never when scrubbing back.
          if (i > shown) play(STEP_SOUND[i]!);
          shown = i;
        };

        const coin = q("[data-coin]");
        const box = q("[data-box]");
        const lid = q("[data-lid]");
        const packEl = q("[data-pack]");
        const strip = q("[data-pack-strip]");
        const deck = q("[data-deck]");
        const cards = q("[data-card]");
        const inners = q("[data-card-inner]");
        const spread = [-1, 0, 1];

        gsap.set(inners, { rotateY: 0 });
        gsap.set(deck, { zIndex: 10 });
        // Hidden until the pack is in front of them; then they wait inside it.
        gsap.set(cards, { yPercent: 0, scale: 1, opacity: 0 });
        gsap.set(packEl, { opacity: 0, yPercent: 26, scale: 0.88 });
        gsap.set(box, { yPercent: -170, opacity: 0 });
        gsap.set(coin, { opacity: 0, y: 24 });

        const tl = gsap.timeline({ defaults: { ease: "power3.out" }, paused: !pinned });
        tl.call(() => setStep(0))
          .to(coin, { opacity: 1, y: 0, duration: 0.45 })
          .to(coin, { opacity: 0, y: -24, duration: 0.4, ease: "power2.in" }, "+=0.3")
          .call(() => setStep(1))
          .to(box, { yPercent: 0, opacity: 1, duration: 0.75, ease: "power2.in" })
          .to(box, { scaleY: 0.9, scaleX: 1.06, duration: 0.1, ease: "power1.out", transformOrigin: "50% 100%" })
          .to(box, { scaleY: 1, scaleX: 1, duration: 0.45, ease: "back.out(2.4)" })
          .addLabel("open", "+=0.1")
          .call(() => setStep(2), [], "open")
          .to(lid, { yPercent: -130, rotate: -10, opacity: 0, duration: 0.7, ease: "power2.inOut" }, "open")
          .to(packEl, { opacity: 1, yPercent: 0, scale: 1, duration: 0.8, ease: "back.out(1.3)" }, "open+=0.2")
          .to(box, { yPercent: 45, opacity: 0, duration: 0.6, ease: "power2.in" }, "open+=0.4")
          .set(cards, { opacity: 1 }, "open+=0.9")
          // A tug before the rip.
          .to(packEl, { rotate: -2, duration: 0.07, yoyo: true, repeat: 3, ease: "sine.inOut" })
          .addLabel("tear")
          // The strip peels from the notch (left) toward the right, pivoting on its right end, then curls off.
          .to(strip, { rotate: -14, skewX: -8, x: 6, y: -6, duration: 0.35, ease: "power2.in" }, "tear")
          .to(strip, { rotate: -38, skewX: -18, scaleY: 0.7, x: 70, y: -90, opacity: 0, duration: 0.55, ease: "power2.in" }, "tear+=0.35")
          .addLabel("cards", "tear+=0.5")
          .call(() => setStep(3), [], "cards")
          // Cards slide up out of the open top, staggered, still behind the pack's body.
          .to(cards, { yPercent: -56, duration: 0.7, stagger: 0.12, ease: "power2.out" }, "cards")
          // Clear of the opening: the cards come in front of the wrapper, which drops away empty.
          .set(deck, { zIndex: 30, clipPath: "none" }, "cards+=1.05")
          .to(packEl, { yPercent: 75, opacity: 0, duration: 0.6, ease: "power2.in" }, "cards+=1.05")
          .to(
            cards,
            { xPercent: (i: number) => spread[i]! * 106, yPercent: 0, scale: 1, rotate: (i: number) => spread[i]! * 3, duration: 0.8, ease: "power3.inOut" },
            "cards+=1.2",
          )
          .to(inners, { rotateY: 180, duration: 0.9, stagger: 0.28, ease: "back.out(1.15)" }, "+=0.05")
          .to({}, { duration: 0.5 });

        if (pinned) {
          ScrollTrigger.create({ trigger: el, start: "top top", end: "+=2600", refreshPriority: 2, pin: true, pinType: pinType(), scrub: 0.8, animation: tl, anticipatePin: 1 });
        } else {
          tl.timeScale(1.2);
          ScrollTrigger.create({ trigger: q("[data-stage]")[0], start: "top 80%", once: true, onEnter: () => tl.play() });
        }
        return () => items.forEach((s, k) => (s.dataset.state = k === 0 ? "active" : "future"));
      });
        ScrollTrigger.refresh();
      });
      return () => {
        live = false;
        mm.revert();
      };
    },
    { scope: root },
  );

  return (
    <section ref={root} id="how" aria-labelledby="how-title" className="relative border-t border-line">
      <div className="wrap flex min-h-dvh flex-col justify-center gap-6 py-20 md:gap-8 md:py-10">
        <SplitHeading as="h2" id="how-title" onScroll className="h-section !text-[clamp(40px,4.4vw,76px)]" lines={["One play. Three stocks."]} />

        {/* One wide panel; the scene keeps its proportions in the middle of it. */}
        <div data-stage="" className="relative w-full overflow-hidden rounded-[18px] border border-line bg-panel md:h-[min(56vh,580px)]">
          <div className="relative mx-auto aspect-[5/6] w-full sm:aspect-[6/5] md:h-full md:w-auto">
            {/* Payment. */}
            <div data-coin="" data-how-hide="" aria-hidden="true" className="money absolute left-1/2 top-[9%] -translate-x-1/2 rounded-full border border-line-strong bg-panel-2 px-4 py-2 text-[15px] text-cream">
              {machine.priceUsdc}.00 USDC
            </div>

            <div className="absolute inset-0 flex items-center justify-center">
              {/* The sealed box, finished like the boxes in its machine. */}
              <div data-how-hide="" className="absolute w-[56%] sm:w-[40%]">
                <SealedBox variant={variantOf(machine.slug)} />
              </div>

              {/* The pack slot: the cards wait inside the wrapper (clipped at its bottom seal, behind its front), rise out
                  through the torn top, then come forward and deal out. Face up without JS. */}
              <div className="absolute aspect-[200/330] w-[44%] sm:w-[36%]">
                <div data-deck="" className="absolute inset-0 z-10 grid place-items-center" style={{ clipPath: `inset(-300% -200% ${((1 - PACK_SEAL_AT) * 100).toFixed(1)}% -200%)` }}>
                  {pack.map((card, i) => (
                    <StockCard key={`${card.ticker}-${i}`} card={card} tier={tier.name} index={i} className="col-start-1 row-start-1 w-[68%] sm:w-[83%]" />
                  ))}
                </div>
                <div data-how-hide="" className="absolute inset-0 z-20">
                  <BoosterPack machine={machine.name} tiers={machine.tiers.length} uid="how-pack" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The steps: a row under the panel that advances with the scene. Past steps dim, the active one slides up
            into place, the rest wait below (globals.css .how-step). Phones show the active step only. */}
        <ol className="how-steps grid md:grid-cols-4 md:gap-6">
          {steps.map((s, i) => (
            <li key={s.n} data-step="" data-state={i === 0 ? "active" : "future"} className="how-step col-start-1 row-start-1 md:col-start-auto md:row-start-auto">
              <span className="money text-[14px] text-muted">{s.n}</span>
              <h3 className="mt-2 text-[20px] leading-tight tracking-[-0.01em] text-cream">{s.title}</h3>
              <p className="mt-1 text-[15px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
