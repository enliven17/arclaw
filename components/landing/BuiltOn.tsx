/**
 * The three things arclaw stands on, as a quiet strip under the machines: Arc (the chain, USDC is its gas), Astock (the
 * stocks the cards are made of) and D20DAO (the verifiable draw behind every box). Wordmarks in the site's own type; the
 * partners' official marks can replace them as files in public/partners without touching this layout.
 */
import { SplitHeading } from "@/components/motion/SmoothScroll";

const PARTNERS = [
  { name: "Arc", role: "The chain", note: "Circle's Layer-1 where USDC is the gas. Every play, box and card lives on it.", href: "https://www.arc.io" },
  { name: "Astock", role: "The stocks", note: "Tokenized equities. Every card is an Astock token you hold in your own wallet.", href: "https://astock.fi" },
  { name: "D20DAO", role: "The draw", note: "Verifiable randomness (VRF) on Arc. Anyone can replay the proof behind a box.", href: "https://d20dao.org" },
] as const;

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
                <span className="mt-4 text-[clamp(40px,4.4vw,64px)] leading-none tracking-[-0.04em] text-cream">{p.name}</span>
                <span className="mt-auto pt-8 text-[15px] leading-relaxed text-muted">{p.note}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
