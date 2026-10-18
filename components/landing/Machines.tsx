/**
 * The three machines side by side: each cabinet in its finish, its price, its expected return and its range, all
 * from lib/machines.json. The claws are the only accent here.
 */
import { ClawMachine } from "@/components/claw/ClawMachine";
import type { ClawArt } from "@/components/claw/geometry";
import { variantOf, type Variant } from "@/components/claw/view";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { fmtMultiplier, fmtPct, type Machine } from "@/lib/machines";
import { usdc } from "@/lib/stocks";
import { ClawLink } from "@/components/motion/PageTransitions";

export function Machines({ art, machines }: { art: Record<Variant, ClawArt>; machines: Machine[] }) {
  return (
    <section id="machines" aria-labelledby="machines-title" className="border-t border-line py-28 md:py-36">
      <div className="wrap">
        <div className="grid gap-8 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] md:items-end">
          <SplitHeading as="h2" id="machines-title" onScroll className="h-section" lines={["Three machines.", "Pick your stake."]} />
          <p className="lede max-w-[26em] md:justify-self-end" data-reveal>
            Bigger machine, better odds: the expected return climbs from {fmtPct(machines[0]!.rtp, 0)} on {machines[0]!.name} to{" "}
            {fmtPct(machines.at(-1)!.rtp, 0)} on {machines.at(-1)!.name}. Every box is set to pay at least {fmtPct(Math.min(...machines.map((m) => m.floor)), 0)} back at the
            table's prices, and up to {fmtMultiplier(Math.max(...machines.map((m) => m.cap)))}.
          </p>
        </div>

        <ul className="mt-16 grid gap-4 lg:grid-cols-3">
          {machines.map((m) => {
            const top = m.tiers[m.tiers.length - 1]!;
            return (
              <li key={m.id} className="flex flex-col rounded-[18px] border border-line bg-panel md:flex-row lg:flex-col" data-reveal>
                <div className="mx-auto w-full max-w-[300px] px-6 pt-6 md:w-[38%] md:pb-6 lg:w-full lg:pb-0">
                  <ClawMachine art={art[variantOf(m.slug)]} machine={m.slug} label={`The ${m.name} machine, ${m.priceUsdc} USDC per play.`} />
                </div>
                <div className="flex flex-1 flex-col justify-center border-t border-line p-6 md:border-l md:border-t-0 lg:border-l-0 lg:border-t">
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="text-[clamp(32px,3vw,44px)] leading-none tracking-[-0.03em]">{m.name}</h3>
                    <p className="money text-[clamp(22px,2vw,28px)] leading-none">
                      {m.priceUsdc} <span className="text-muted">USDC</span>
                    </p>
                  </div>
                  <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-line pt-5">
                    <div>
                      <dt className="text-[13px] text-muted">Expected return</dt>
                      <dd className="money mt-1 text-[17px]">{fmtPct(m.rtp)}</dd>
                    </div>
                    <div>
                      <dt className="text-[13px] text-muted">Smallest box</dt>
                      <dd className="money mt-1 text-[17px]">{usdc(m.priceUsdc * m.floor)}</dd>
                    </div>
                    <div>
                      <dt className="text-[13px] text-muted">Top prize</dt>
                      <dd className="money mt-1 text-[17px]">{usdc(top.valueUsdc)}</dd>
                    </div>
                  </dl>
                  <div className="mt-6 grid grid-cols-2 gap-2">
                    <ClawLink href={`/app/play/${m.slug}`} className="btn-cream w-full">
                      Play {m.name}
                    </ClawLink>
                    <a href="#odds" className="btn-ghost w-full">
                      Odds
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
