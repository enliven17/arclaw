"use client";

/**
 * The stocks: two rows of tickers that move only while the page scrolls, faster when you scroll faster, in
 * opposite directions. No idle loop (no infinite frame-rate animation); the rows glide to rest with the scroll.
 * Reduced motion: still rows that wrap.
 */
import { useRef } from "react";
import { REDUCED, ScrollTrigger, gsap, useGSAP } from "@/lib/motion";
import { STOCKS } from "@/lib/stocks";
import { SplitHeading } from "@/components/motion/SmoothScroll";

const ROW_A = STOCKS.slice(0, 7);
const ROW_B = STOCKS.slice(7);

function Row({ items, dir }: { items: typeof STOCKS; dir: 1 | -1 }) {
  // Two copies so the track wraps without a seam.
  return (
    <div className="overflow-hidden" data-row={dir}>
      <div data-track="" className="flex w-max motion-reduce:w-full motion-reduce:flex-wrap">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0 motion-reduce:flex-wrap" aria-hidden={copy === 1 ? true : undefined}>
            {items.map((s) => (
              <li key={s.ticker} className="flex items-baseline gap-4 pr-[clamp(32px,5vw,72px)]">
                <span className="money text-[clamp(48px,8vw,120px)] leading-none tracking-[-0.05em] text-cream">{s.ticker}</span>
                <span className="text-[14px] text-muted">{s.name}</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export function StocksMarquee() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || window.matchMedia(REDUCED).matches) return;
      const rows = gsap.utils.toArray<HTMLElement>("[data-row]", el).map((row) => {
        const track = row.querySelector<HTMLElement>("[data-track]")!;
        const dir = Number(row.dataset.row);
        const half = () => track.scrollWidth / 2;
        // The offset grows without bound; the modifier wraps what is drawn, so the glide never jumps a seam.
        const setX = gsap.quickTo(track, "x", {
          duration: 0.9,
          ease: "power3.out",
          modifiers: { x: (x: string) => `${gsap.utils.wrap(-half(), 0, parseFloat(x))}px` },
        });
        return { dir, half, setX, offset: dir > 0 ? 0 : -half() / 3 };
      });
      let last = window.scrollY;
      const st = ScrollTrigger.create({
        trigger: el,
        start: "top bottom",
        end: "bottom top",
        onUpdate: (self) => {
          const y = self.scroll();
          const dy = y - last;
          last = y;
          // Distance scrolled drives the rows; velocity adds a push so a flick throws them further.
          const push = gsap.utils.clamp(-60, 60, self.getVelocity() / 60);
          rows.forEach((r) => {
            r.offset -= r.dir * (dy * 0.6 + push);
            r.setX(r.offset);
          });
        },
      });
      return () => st.kill();
    },
    { scope: root },
  );

  return (
    <section id="stocks" ref={root} aria-labelledby="stocks-title" className="overflow-hidden border-t border-line py-28 md:py-36">
      <div className="wrap grid gap-8 md:grid-cols-2 md:items-end">
        <div>
          <p className="label" data-reveal>
            The stocks
          </p>
          <SplitHeading as="h2" id="stocks-title" onScroll className="h-section mt-5" lines={["Real names.", "Real shares."]} />
        </div>
        <p className="lede max-w-[28em] md:justify-self-end" data-reveal>
          Every card is a tokenized stock from Astock on Arc, an ERC&#8209;20 you hold in your own wallet. Keep it, send it
          or sell it.
        </p>
      </div>
      <div className="mt-16 grid gap-6 md:gap-10" role="list" aria-label="Stocks in the machine">
        <span role="listitem" className="sr-only">
          {STOCKS.map((s) => `${s.ticker} ${s.name}`).join(", ")}
        </span>
        <div aria-hidden="true" className="grid gap-6 md:gap-10">
          <Row items={ROW_A} dir={1} />
          <Row items={ROW_B} dir={-1} />
        </div>
      </div>
    </section>
  );
}
