"use client";

/**
 * The stocks: two rows of logo, ticker and price that move only while the page scrolls, faster when you scroll
 * faster, in opposite directions. No idle loop. Reduced motion: still rows that wrap.
 */
/* eslint-disable @next/next/no-img-element -- small local SVG logos */
import { useRef } from "react";
import { REDUCED, ScrollTrigger, gsap, useGSAP } from "@/lib/motion";
import { STOCKS, logoOf, type Stock } from "@/lib/stocks";
import type { Quote } from "@/lib/prices";
import { SplitHeading } from "@/components/motion/SmoothScroll";

const fmtPrice = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtChange = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

function Item({ s, q }: { s: Stock; q?: Quote }) {
  const logo = logoOf(s.ticker);
  return (
    <li className="flex items-center gap-5 pr-[clamp(40px,6vw,96px)]">
      <span className="flex size-[clamp(56px,6vw,84px)] shrink-0 items-center justify-center rounded-[14px] border border-line bg-panel">
        {logo ? <img src={logo} alt={`${s.name} logo`} width={64} height={64} className="size-[52%]" /> : null}
      </span>
      <span className="flex flex-col">
        <span className="money text-[clamp(44px,6.4vw,96px)] leading-[0.9] tracking-[-0.05em] text-cream">{s.ticker}</span>
        <span className="mt-2 flex items-baseline gap-3 text-[14px]">
          <span className="text-muted">{s.name}</span>
          {q ? <span className="money text-cream">${fmtPrice(q.price)}</span> : null}
          {q?.changePct != null ? <span className="money text-muted">{fmtChange(q.changePct)}</span> : null}
        </span>
      </span>
    </li>
  );
}

function Row({ items, dir, quotes }: { items: readonly Stock[]; dir: 1 | -1; quotes: Record<string, Quote> }) {
  return (
    <div className="overflow-hidden" data-row={dir}>
      <div data-track="" className="flex w-max motion-reduce:w-full motion-reduce:flex-wrap">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0 motion-reduce:flex-wrap motion-reduce:gap-y-8" aria-hidden={copy === 1 ? true : undefined}>
            {items.map((s) => (
              <Item key={s.ticker} s={s} q={quotes[s.ticker]} />
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export function StocksMarquee({ quotes }: { quotes: Record<string, Quote> }) {
  const root = useRef<HTMLElement>(null);
  const half = Math.ceil(STOCKS.length / 2);
  const live = Object.values(quotes).some((q) => q.live);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || window.matchMedia(REDUCED).matches) return;
      const rows = gsap.utils.toArray<HTMLElement>("[data-row]", el).map((row) => {
        const track = row.querySelector<HTMLElement>("[data-track]")!;
        const dir = Number(row.dataset.row);
        const width = () => track.scrollWidth / 2;
        // The offset grows without bound; the modifier wraps what is drawn, so the glide never jumps a seam.
        const setX = gsap.quickTo(track, "x", {
          duration: 0.9,
          ease: "power3.out",
          modifiers: { x: (x: string) => `${gsap.utils.wrap(-width(), 0, parseFloat(x))}px` },
        });
        return { dir, setX, offset: 0 };
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
      <div className="wrap grid gap-8 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] md:items-end">
        <SplitHeading as="h2" id="stocks-title" onScroll className="h-section" lines={["Real names.", "Real shares."]} />
        <p className="lede max-w-[26em] md:justify-self-end" data-reveal>
          Every card is a tokenized stock from Astock on Arc, an ERC&#8209;20 you hold in your own wallet. Keep it, send it
          or sell it.{live ? " Prices update every few minutes." : null}
        </p>
      </div>
      <div className="mt-16">
        <ul className="sr-only">
          {STOCKS.map((s) => (
            <li key={s.ticker}>
              {s.ticker} {s.name}
              {quotes[s.ticker] ? `, ${fmtPrice(quotes[s.ticker]!.price)} US dollars` : ""}
            </li>
          ))}
        </ul>
        <div aria-hidden="true" className="grid gap-8 md:gap-12">
          <Row items={STOCKS.slice(0, half)} dir={1} quotes={quotes} />
          <Row items={STOCKS.slice(half)} dir={-1} quotes={quotes} />
        </div>
      </div>
    </section>
  );
}
