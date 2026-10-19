/**
 * The three things arclaw stands on, as a quiet strip under the machines: Arc (the chain, USDC is its gas), Astock (the
 * stocks the cards are made of) and D20DAO (the verifiable draw behind every box). Each partner's own mark, drawn in
 * currentColor so the strip keeps the screen's one accent, beside its name in the site's type.
 */
import type { ReactNode } from "react";
import { SplitHeading } from "@/components/motion/SmoothScroll";

// Paths from each partner's own logo files (Arc's network icon, astock.fi/favicon.svg, d20dao.org/icon.svg).
const ARC = (
  <svg viewBox="0 0 31 32" aria-hidden="true">
    <path d="M0 32C0.260374 24.166 1.59328 16.8547 3.82135 11.1696C6.64316 3.96673 10.728 0 15.3227 0C19.9174 0 24.0016 3.96673 26.824 11.1696C28.292 14.9157 29.372 19.3668 30.0119 24.2089C30.0691 24.6414 30.1178 25.0809 30.1678 25.5195C30.184 25.5466 30.1938 25.5718 30.1905 25.5923C30.1905 25.5923 30.5666 27.9326 30.6465 32H30.604C30.0462 31.5439 23.4681 26.3931 12.5636 27.8845C12.7282 26.0457 12.9544 24.2565 13.2467 22.5415C13.2617 22.4538 13.2789 22.3692 13.2942 22.2821C17.5711 22.1536 21.3146 22.6486 24.1853 23.2972C24.1746 23.2293 24.1657 23.1594 24.1547 23.0918C23.5647 19.4302 22.6941 16.0779 21.5717 13.2131C19.7364 8.52888 17.3416 5.61852 15.3227 5.61852C13.3038 5.61852 10.909 8.52888 9.07379 13.2131C8.62954 14.3462 8.22512 15.5545 7.86244 16.8291C7.35258 18.615 6.92424 20.5296 6.58214 22.5413C6.0758 25.5124 5.75944 28.6987 5.64292 32H0Z" />
  </svg>
);
const ASTOCK = (
  <svg viewBox="0 0 4 4" aria-hidden="true">
    <path d="M0 2 A2 2 0 0 1 4 2 L3 2 A1 1 0 0 0 1 2 L1 3 L2 3 L2 4 L0 4 Z" />
    <path d="M2 2 H3 V3 H2 Z" />
  </svg>
);
const D20 = (
  <svg viewBox="0 0 174 200" aria-hidden="true">
    <path d="M0 8L38 38L38 162L0 192Z" />
    <path d="M0 0L101 0L169 49L132 76L89 40L48 40Z" />
    <path d="M174 58L174 149L101 200L0 200L48 160L89 160L134 127L134 86Z" />
  </svg>
);

const PARTNERS: { name: string; role: string; note: string; href: string; mark: ReactNode }[] = [
  { name: "Arc", role: "The chain", note: "Circle's Layer-1 where USDC is the gas. Every play, box and card lives on it.", href: "https://www.arc.io", mark: ARC },
  { name: "Astock", role: "The stocks", note: "Tokenized equities. Every card is an Astock token you hold in your own wallet.", href: "https://astock.fi", mark: ASTOCK },
  { name: "D20DAO", role: "The draw", note: "Verifiable randomness (VRF) on Arc. Anyone can replay the proof behind a box.", href: "https://d20dao.org", mark: D20 },
];

export function BuiltOn() {
  return (
    <section id="built-on" aria-labelledby="built-on-title" className="border-t border-line py-20 md:py-28">
      <div className="wrap">
        <SplitHeading as="h2" id="built-on-title" onScroll className="h-card !text-[clamp(26px,2.6vw,36px)] text-muted" lines={["Built on."]} />
        <ul className="mt-10 grid gap-4 md:grid-cols-3" data-reveal>
          {PARTNERS.map((p) => (
            <li key={p.name}>
              <a
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full flex-col rounded-[18px] border border-line bg-panel p-6 transition-colors hover:border-line-strong md:p-8"
              >
                <span className="text-[14px] text-muted">{p.role}</span>
                <span className="mt-4 flex items-center gap-[0.3em] text-[clamp(40px,4.4vw,64px)] leading-none tracking-[-0.04em] text-cream">
                  <span className="h-[0.8em] [&>svg]:h-full [&>svg]:w-auto [&>svg]:fill-current">{p.mark}</span>
                  {p.name}
                </span>
                <span className="mt-auto pt-8 text-[15px] leading-relaxed text-muted">{p.note}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
