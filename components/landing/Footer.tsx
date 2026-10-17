/**
 * Closing call: the headline, the three machines as buttons (the accent spent once, on the first), the cabinet
 * beside them. Then the footer.
 */
import { ClawMachine } from "@/components/claw/ClawMachine";
import type { ClawArt } from "@/components/claw/geometry";
import { variantOf, type Variant } from "@/components/claw/view";
import { Logo } from "@/components/Logo";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import type { Machine } from "@/lib/machines";

const LINKS = [
  { href: "#machines", label: "Machines" },
  { href: "#how", label: "How it works" },
  { href: "#gift", label: "Gift a box" },
  { href: "#odds", label: "Odds" },
];

export function Footer({ art, machines }: { art: Record<Variant, ClawArt>; machines: Machine[] }) {
  return (
    <footer className="border-t border-line">
      <section aria-labelledby="cta-title" className="wrap grid items-center gap-12 py-28 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:py-36">
        <div>
          <SplitHeading as="h2" id="cta-title" onScroll className="h-display" lines={["Your box", "is waiting."]} />
          <p className="lede mt-7 max-w-[26em]" data-reveal>
            Pick a machine and pull. Every play wins three real stocks.
          </p>
          <ul className="mt-10 grid max-w-[560px] gap-3 lg:grid-cols-3" data-reveal>
            {machines.map((m, i) => (
              <li key={m.id}>
                <a href={`/app/play/${m.slug}`} className={`${i === 0 ? "btn" : "btn-ghost"} w-full !justify-between`}>
                  <span>{m.name}</span>
                  <span className="money">{m.priceUsdc} USDC</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="mx-auto w-full max-w-[360px]" data-reveal>
          <ClawMachine art={art[variantOf(machines.at(-1)?.slug)]} machine={machines.at(-1)?.slug} label="The Vault machine at rest, a sealed box on top of the pile." />
        </div>
      </section>

      <div className="border-t border-line">
        <div className="wrap flex flex-col gap-8 py-10 md:flex-row md:items-center md:justify-between">
          <Logo height={24} />
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-muted">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a className="transition-colors hover:text-cream" href={l.href}>
                    {l.label}
                  </a>
                </li>
              ))}
              <li>
                <a className="transition-colors hover:text-cream" href="https://explorer.arc.io" rel="noopener noreferrer" target="_blank">
                  Arc explorer
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <div className="wrap pb-10">
          <p className="max-w-[60em] text-[13px] leading-relaxed text-muted">
            Built on Arc. Prizes are Astock tokenized stocks held in your own wallet, and they can lose value. Nothing here is
            investment advice.
          </p>
        </div>
      </div>
    </footer>
  );
}
