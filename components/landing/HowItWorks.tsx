"use client";

/**
 * How it works: pay, the claw drops a box, the box opens into a pack, three cards flip.
 *
 * Wide screens with a fine pointer pin the section and scrub one timeline through the steps. Everywhere else the
 * same timeline plays once when the stage scrolls in. Reduced motion: nothing moves, cards render face up.
 */
import { useRef } from "react";
import { PINNED, REDUCED, ScrollTrigger, gsap, pinType, useGSAP } from "@/lib/motion";
import { SAMPLE_PACK } from "@/lib/stocks";
import { Logo } from "@/components/Logo";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { StockCard } from "./StockCard";

const STEPS = [
  { n: "01", title: "Pay 1 USDC", body: "One play costs one dollar in USDC on Arc. Every play wins a box." },
  { n: "02", title: "The claw drops a box", body: "The claw is the show. The contract has already picked what is inside." },
  { n: "03", title: "The box opens into a pack", body: "Tear it open. Three cards, sealed until now." },
  { n: "04", title: "Three cards flip", body: "Each card pays a real tokenized stock, straight to your wallet." },
];

export function HowItWorks() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add({ pinned: PINNED, reduced: REDUCED }, (ctx) => {
        const { pinned, reduced } = ctx.conditions as { pinned: boolean; reduced: boolean };
        if (reduced) return;
        const q = gsap.utils.selector(el);
        const steps = q("[data-step]");
        const setStep = (i: number) => steps.forEach((s, k) => s.toggleAttribute("data-active", k === i));

        const box = q("[data-box]");
        const pack = q("[data-pack]");
        const strip = q("[data-strip]");
        const cards = q("[data-card]");
        const inners = q("[data-card-inner]");
        // Cards share one cell from md up and fan out; below md they sit in a row already.
        const wide = window.matchMedia("(min-width: 768px)").matches;
        const spread = wide ? [-1, 0, 1] : [0, 0, 0];

        gsap.set(inners, { rotateY: 0 });
        gsap.set(cards, { yPercent: 30, opacity: 0, scale: 0.8 });
        gsap.set(pack, { opacity: 0, y: 40, scale: 0.9 });
        gsap.set(box, { y: -260, opacity: 0 });

        const tl = gsap.timeline({ defaults: { ease: "power3.out" }, paused: !pinned });
        tl.addLabel("pay")
          .call(() => setStep(0))
          .from(q("[data-coin]"), { y: 30, opacity: 0, duration: 0.6 })
          .to(q("[data-coin]"), { y: -30, opacity: 0, duration: 0.5, ease: "power2.in" }, "+=0.4")
          .addLabel("drop")
          .call(() => setStep(1))
          .to(box, { y: 0, opacity: 1, duration: 0.9, ease: "back.out(1.3)" })
          .to(box, { scaleY: 0.92, scaleX: 1.05, duration: 0.12, ease: "power2.out" })
          .to(box, { scaleY: 1, scaleX: 1, duration: 0.4, ease: "back.out(2)" })
          .addLabel("open", "+=0.2")
          .call(() => setStep(2), [], "open")
          .to(box, { scale: 0.86, opacity: 0, duration: 0.5, ease: "power2.in" }, "open")
          .to(pack, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.4)" }, "open+=0.3")
          .to(pack, { rotate: -2, duration: 0.08, yoyo: true, repeat: 3, ease: "sine.inOut" })
          .to(strip, { xPercent: 110, rotate: 8, opacity: 0, duration: 0.7, ease: "power2.in" })
          .addLabel("flip")
          .call(() => setStep(3), [], "flip")
          .to(cards, { yPercent: -10, opacity: 1, scale: 1, duration: 0.6, stagger: 0.06 }, "flip")
          .to(pack, { y: 80, opacity: 0, duration: 0.6, ease: "power2.in" }, "flip+=0.2")
          .to(cards, { xPercent: (i: number) => spread[i]! * 108, yPercent: 0, rotate: (i: number) => spread[i]! * 4, duration: 0.8, ease: "power3.inOut" }, "flip+=0.5")
          .to(inners, { rotateY: 180, duration: 0.8, stagger: 0.35, ease: "back.out(1.2)" }, "+=0.1")
          .to({}, { duration: 0.6 });

        if (pinned) {
          ScrollTrigger.create({
            trigger: el,
            start: "top top",
            end: "+=2400",
            pin: true,
            pinType: pinType(),
            scrub: 0.8,
            animation: tl,
            anticipatePin: 1,
          });
        } else {
          ScrollTrigger.create({ trigger: q("[data-stage]")[0], start: "top 75%", once: true, onEnter: () => tl.play() });
        }
        return () => steps.forEach((s) => s.removeAttribute("data-active"));
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} id="how" aria-labelledby="how-title" className="relative border-t border-line">
      <div className="wrap grid min-h-dvh items-center gap-12 py-24 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
        <div>
          <p className="label" data-reveal>
            How it works
          </p>
          <SplitHeading as="h2" id="how-title" onScroll className="h-section mt-5 !text-[clamp(36px,4.2vw,60px)]" lines={["One dollar in.", "Three stocks out."]} />
          <ol className="mt-8 grid gap-1">
            {STEPS.map((s) => (
              <li key={s.n} data-step="" className="group rounded-[10px] border border-transparent px-4 py-3 transition-colors duration-300 data-[active]:border-line data-[active]:bg-panel">
                <div className="flex items-baseline gap-4">
                  <span className="money text-[13px] text-muted transition-colors group-data-[active]:text-claw">{s.n}</span>
                  <div>
                    <h3 className="text-[19px] tracking-[-0.01em] text-cream">{s.title}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-muted">{s.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div data-stage="" className="relative mx-auto flex aspect-[5/4] w-full max-w-[640px] items-center justify-center overflow-hidden rounded-[18px] border border-line bg-panel">
          {/* Coin: the payment. */}
          <div data-coin="" aria-hidden="true" className="money absolute top-[14%] rounded-full border border-line-strong bg-panel-2 px-4 py-2 text-[14px] text-cream opacity-0">
            1.00 USDC
          </div>
          {/* The prize box, as it lands from the chute. */}
          <div data-box="" aria-hidden="true" className="absolute flex size-[26%] items-center justify-center rounded-[10px] border border-line-strong bg-panel-2 opacity-0">
            <div className="absolute inset-y-0 left-1/2 w-[18%] -translate-x-1/2 bg-cream/10" />
            <span className="label relative">Sealed</span>
          </div>
          {/* The pack, with a tear strip across the top. */}
          <div data-pack="" aria-hidden="true" className="absolute flex h-[70%] w-[34%] flex-col overflow-hidden rounded-[10px] border border-line-strong bg-panel-2 opacity-0">
            <div data-strip="" className="flex h-[16%] items-center justify-center border-b border-dashed border-line-strong bg-ink/40">
              <span className="label">Tear here</span>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <Logo variant="mark" height={40} />
              <span className="label">3 cards</span>
            </div>
          </div>
          {/* The three cards. Face up without JS. */}
          <div className="relative grid w-full grid-cols-3 gap-3 px-6 md:pointer-events-none md:absolute md:grid-cols-1 md:place-items-center md:px-0">
            {SAMPLE_PACK.map((card, i) => (
              <StockCard
                key={card.ticker}
                card={card}
                index={i}
                foil={i === 1}
                className="w-full md:col-start-1 md:row-start-1 md:w-[30%]"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
