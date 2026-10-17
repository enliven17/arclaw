"use client";

/**
 * How it works: pay, the claw drops a sealed box, the lid lifts and a pack rises out, the pack's crimped top tears
 * off, three cards slide out, fan and flip.
 *
 * Wide screens with a fine pointer pin the section and scrub one timeline. Everywhere else the same timeline plays
 * once when the stage scrolls in. Reduced motion: nothing moves, the cards render face up.
 */
import { useRef } from "react";
import { PINNED, REDUCED, ScrollTrigger, gsap, pinType, useGSAP } from "@/lib/motion";
import { examplePack, type Machine } from "@/lib/machines";
import { Logo } from "@/components/Logo";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { StockCard } from "./StockCard";

/** Crimped edge: a zigzag along the top or bottom of the pack, as a clip-path. */
const CRIMP_TEETH = 18;
const crimp = (() => {
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= CRIMP_TEETH * 2; i++) {
    const x = (i / (CRIMP_TEETH * 2)) * 100;
    top.push(`${x.toFixed(2)}% ${i % 2 ? 0 : 1.6}%`);
    bottom.push(`${(100 - x).toFixed(2)}% ${i % 2 ? 100 : 98.4}%`);
  }
  return `polygon(${[...top, ...bottom].join(",")})`;
})();

export function HowItWorks({ machines }: { machines: Machine[] }) {
  const root = useRef<HTMLElement>(null);
  const machine = machines[0]!;
  const tier = machine.tiers[Math.min(2, machine.tiers.length - 1)]!;
  const pack = examplePack(machine, tier);
  const prices = machines.map((m) => m.priceUsdc);

  const steps = [
    { n: "01", title: `Pay ${prices.slice(0, -1).join(", ")} or ${prices.at(-1)} USDC`, body: "Pick a machine. Every play wins a box, there is no miss." },
    { n: "02", title: "The claw drops a box", body: "The claw is the show. A verifiable draw has already decided what is inside." },
    { n: "03", title: "The box opens into a pack", body: "Lift the lid, tear the pack. Three cards, sealed until now." },
    { n: "04", title: "Three cards flip", body: "Each card pays a real tokenized stock, straight to your wallet." },
  ];

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add({ pinned: PINNED, reduced: REDUCED }, (ctx) => {
        const { pinned, reduced } = ctx.conditions as { pinned: boolean; reduced: boolean };
        if (reduced) return;
        const q = gsap.utils.selector(el);
        const items = q("[data-step]");
        const setStep = (i: number) => items.forEach((s, k) => s.toggleAttribute("data-active", k === i));
        const wide = window.matchMedia("(min-width: 768px)").matches;
        const spread = wide ? [-1, 0, 1] : [0, 0, 0];

        const box = q("[data-box]");
        const lid = q("[data-lid]");
        const packEl = q("[data-pack]");
        const strip = q("[data-strip]");
        const cards = q("[data-card]");
        const inners = q("[data-card-inner]");

        gsap.set(inners, { rotateY: 0 });
        gsap.set(cards, { yPercent: wide ? 8 : 20, opacity: 0, scale: wide ? 0.82 : 0.9 });
        gsap.set(packEl, { opacity: 0, yPercent: 30, scale: 0.86 });
        gsap.set(box, { yPercent: -160, opacity: 0 });
        gsap.set(q("[data-coin]"), { opacity: 0, y: 24 });

        const tl = gsap.timeline({ defaults: { ease: "power3.out" }, paused: !pinned });
        tl.call(() => setStep(0))
          .to(q("[data-coin]"), { opacity: 1, y: 0, duration: 0.5 })
          .to(q("[data-coin]"), { opacity: 0, y: -24, duration: 0.45, ease: "power2.in" }, "+=0.35")
          .call(() => setStep(1))
          .to(box, { yPercent: 0, opacity: 1, duration: 0.8, ease: "power2.in" })
          .to(box, { scaleY: 0.9, scaleX: 1.06, duration: 0.1, ease: "power1.out", transformOrigin: "50% 100%" })
          .to(box, { scaleY: 1, scaleX: 1, duration: 0.45, ease: "back.out(2.4)" })
          .addLabel("open", "+=0.15")
          .call(() => setStep(2), [], "open")
          .to(lid, { yPercent: -120, rotate: -9, opacity: 0, duration: 0.7, ease: "power2.inOut" }, "open")
          .to(packEl, { opacity: 1, yPercent: 0, scale: 1, duration: 0.8, ease: "back.out(1.3)" }, "open+=0.25")
          .to(box, { yPercent: 40, opacity: 0, duration: 0.6, ease: "power2.in" }, "open+=0.45")
          .to(packEl, { rotate: -1.6, duration: 0.07, yoyo: true, repeat: 3, ease: "sine.inOut" })
          .to(strip, { xPercent: 70, yPercent: -140, rotate: 14, opacity: 0, duration: 0.7, ease: "power2.in" })
          .addLabel("cards")
          .call(() => setStep(3), [], "cards")
          .to(cards, { opacity: 1, yPercent: -24, scale: 0.9, duration: 0.6, stagger: 0.08 }, "cards")
          .to(packEl, { yPercent: 70, opacity: 0, duration: 0.6, ease: "power2.in" }, "cards+=0.35")
          .to(
            cards,
            { xPercent: (i: number) => spread[i]! * 106, yPercent: 0, scale: 1, rotate: (i: number) => spread[i]! * 3, duration: 0.8, ease: "power3.inOut" },
            "cards+=0.6",
          )
          .to(inners, { rotateY: 180, duration: 0.9, stagger: 0.3, ease: "back.out(1.15)" }, "+=0.05")
          .to({}, { duration: 0.6 });

        if (pinned) {
          ScrollTrigger.create({ trigger: el, start: "top top", end: "+=2600", pin: true, pinType: pinType(), scrub: 0.8, animation: tl, anticipatePin: 1 });
        } else {
          ScrollTrigger.create({ trigger: q("[data-stage]")[0], start: "top 75%", once: true, onEnter: () => tl.play() });
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

        <div
          data-stage=""
          className="relative mx-auto flex w-full max-w-[680px] items-center justify-center overflow-hidden rounded-[18px] border border-line bg-panel py-10 md:aspect-[6/5] md:py-0"
        >
          {/* Payment. */}
          <div data-coin="" aria-hidden="true" className="money absolute left-1/2 top-[10%] hidden -translate-x-1/2 rounded-full border border-line-strong bg-panel-2 px-4 py-2 text-[15px] text-cream md:block">
            {machine.priceUsdc}.00 USDC
          </div>

          {/* The sealed box: body, a lid that lifts, a tape band and the seal. */}
          <div data-box="" aria-hidden="true" className="absolute hidden aspect-[5/4] w-[38%] md:block">
            <div className="absolute inset-x-0 bottom-0 top-[22%] rounded-b-[12px] rounded-t-[4px] border border-line-strong bg-panel-2">
              <div className="absolute inset-y-0 left-1/2 w-[16%] -translate-x-1/2 border-x border-line bg-cream/[0.06]" />
              <div className="absolute bottom-[14%] left-[8%] flex items-center gap-2">
                <Logo variant="wordmark" height={13} />
              </div>
              <span className="money absolute bottom-[14%] right-[8%] text-[12px] text-muted">{machine.name}</span>
            </div>
            <div data-lid="" className="absolute inset-x-[-3%] top-[6%] h-[20%] rounded-[8px] border border-line-strong bg-panel-2">
              <div className="absolute inset-y-0 left-1/2 w-[15%] -translate-x-1/2 border-x border-line bg-cream/[0.06]" />
              <div className="absolute left-1/2 top-1/2 flex size-[46%] min-h-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[6px] border border-line-strong bg-panel" style={{ aspectRatio: "1" }}>
                <Logo variant="mark" height={16} />
              </div>
            </div>
          </div>

          {/* The pack: crimped top and bottom, a tear strip, printed frames, the mark and the count. */}
          <div data-pack="" aria-hidden="true" className="absolute z-20 hidden h-[78%] w-[36%] md:block">
            <div className="absolute inset-0 bg-panel-2" style={{ clipPath: crimp }}>
              <div className="absolute inset-x-0 top-[14%] border-t border-dashed border-line-strong" />
              <div className="absolute inset-x-[9%] bottom-[9%] top-[20%] rounded-[10px] border border-line" />
              <div className="absolute inset-x-[14%] bottom-[13%] top-[24%] rounded-[8px] border border-line" />
              <div className="absolute inset-x-0 top-[24%] flex flex-col items-center gap-4 pt-[18%]">
                <Logo variant="mark" height={56} />
                <Logo variant="wordmark" height={18} />
              </div>
              <div className="absolute inset-x-0 bottom-[17%] flex justify-center">
                <span className="money text-[13px] text-muted">3 cards</span>
              </div>
            </div>
            <div data-strip="" className="absolute inset-x-0 top-0 h-[14%] bg-panel-2" style={{ clipPath: crimp }}>
              <div className="flex h-full items-center justify-center">
                <span className="text-[12px] text-muted">Tear</span>
              </div>
            </div>
          </div>

          {/* The cards: a row on phones, one cell that fans out from md. Face up without JS. */}
          <div className="relative z-10 grid w-full grid-cols-3 gap-3 px-5 md:absolute md:inset-0 md:grid-cols-1 md:place-items-center md:gap-0 md:px-0">
            {pack.map((card, i) => (
              <StockCard key={`${card.ticker}-${i}`} card={card} tier={tier.name} index={i} className="w-full md:col-start-1 md:row-start-1 md:w-[31%]" />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
