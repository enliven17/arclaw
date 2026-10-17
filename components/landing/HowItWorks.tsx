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
import { examplePack, type Machine } from "@/lib/machines";
import { Logo } from "@/components/Logo";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { BoosterPack } from "@/components/pack/BoosterPack";
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
      // `any` always matches: with only pinned and reduced, phones and touch laptops (neither) never ran the callback.
      mm.add({ pinned: PINNED, reduced: REDUCED, any: "all" }, (ctx) => {
        const { pinned, reduced } = ctx.conditions as { pinned: boolean; reduced: boolean };
        if (reduced) return;
        const q = gsap.utils.selector(el);
        const items = q("[data-step]");
        const setStep = (i: number) => items.forEach((s, k) => s.toggleAttribute("data-active", k === i));

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
        gsap.set(cards, { yPercent: 18, scale: 0.92, opacity: 0 });
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
          .to(cards, { yPercent: -62, duration: 0.6, stagger: 0.12, ease: "power2.out" }, "cards")
          .set(deck, { zIndex: 30 }, "cards+=0.95")
          .to(packEl, { yPercent: 75, opacity: 0, duration: 0.6, ease: "power2.in" }, "cards+=0.95")
          .to(
            cards,
            { xPercent: (i: number) => spread[i]! * 106, yPercent: 0, scale: 1, rotate: (i: number) => spread[i]! * 3, duration: 0.8, ease: "power3.inOut" },
            "cards+=1.05",
          )
          .to(inners, { rotateY: 180, duration: 0.9, stagger: 0.28, ease: "back.out(1.15)" }, "+=0.05")
          .to({}, { duration: 0.5 });

        if (pinned) {
          ScrollTrigger.create({ trigger: el, start: "top top", end: "+=2600", pin: true, pinType: pinType(), scrub: 0.8, animation: tl, anticipatePin: 1 });
        } else {
          tl.timeScale(1.2);
          ScrollTrigger.create({ trigger: q("[data-stage]")[0], start: "top 80%", once: true, onEnter: () => tl.play() });
        }
        return () => items.forEach((s) => s.removeAttribute("data-active"));
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="how" aria-labelledby="how-title" className="relative border-t border-line">
      <div className="wrap grid min-h-dvh items-center gap-12 py-24 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-12 md:py-16 lg:gap-16">
        <div>
          <SplitHeading as="h2" id="how-title" onScroll className="h-section !text-[clamp(44px,4.6vw,80px)]" lines={["One play.", "Three stocks."]} />
          <ol className="mt-10 grid gap-1">
            {steps.map((s) => (
              <li
                key={s.n}
                data-step=""
                className="group rounded-[14px] border border-transparent px-4 py-3 transition-colors duration-300 data-[active]:border-line data-[active]:bg-panel"
              >
                <div className="flex items-baseline gap-4">
                  <span className="money text-[14px] text-muted transition-colors group-data-[active]:text-claw">{s.n}</span>
                  <div>
                    <h3 className="text-[20px] leading-tight tracking-[-0.01em] text-cream">{s.title}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-muted">{s.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div data-stage="" className="relative mx-auto aspect-[5/6] w-full max-w-[680px] overflow-hidden rounded-[18px] border border-line bg-panel sm:aspect-[6/5]">
          {/* Payment. */}
          <div data-coin="" data-how-hide="" aria-hidden="true" className="money absolute left-1/2 top-[9%] -translate-x-1/2 rounded-full border border-line-strong bg-panel-2 px-4 py-2 text-[15px] text-cream">
            {machine.priceUsdc}.00 USDC
          </div>

          <div className="absolute inset-0 flex items-center justify-center">
            {/* The sealed box: body, a lid that lifts, a tape band and the seal. */}
            <div data-box="" data-how-hide="" aria-hidden="true" className="absolute aspect-[5/4] w-[52%] sm:w-[38%]">
              <div className="absolute inset-x-0 bottom-0 top-[22%] rounded-b-[12px] rounded-t-[4px] border border-line-strong bg-panel-2">
                <div className="absolute inset-y-0 left-1/2 w-[16%] -translate-x-1/2 border-x border-line bg-cream/[0.06]" />
                <div className="absolute bottom-[14%] left-[8%]">
                  <Logo variant="wordmark" height={13} />
                </div>
                <span className="money absolute bottom-[14%] right-[8%] text-[12px] text-muted">{machine.name}</span>
              </div>
              <div data-lid="" className="absolute inset-x-[-3%] top-[6%] h-[20%] rounded-[8px] border border-line-strong bg-panel-2">
                <div className="absolute inset-y-0 left-1/2 w-[15%] -translate-x-1/2 border-x border-line bg-cream/[0.06]" />
                <div className="absolute left-1/2 top-1/2 flex aspect-square h-[60%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[6px] border border-line-strong bg-panel">
                  <Logo variant="mark" height={14} />
                </div>
              </div>
            </div>

            {/* The three cards: one cell, behind the pack until they come out. Face up without JS. */}
            <div data-deck="" className="absolute inset-0 grid place-items-center">
              {pack.map((card, i) => (
                <StockCard key={`${card.ticker}-${i}`} card={card} tier={tier.name} index={i} className="col-start-1 row-start-1 w-[30%]" />
              ))}
            </div>

            {/* The booster pack. */}
            <div data-how-hide="" className="absolute z-20 w-[44%] sm:w-[36%]">
              <BoosterPack machine={machine.name} uid="how-pack" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
