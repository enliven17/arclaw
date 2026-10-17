/**
 * The marketplace: three machines side by side, each with its price and its odds in brief, and a way in.
 * Odds come from lib/machines.json; the cabinets are built here on the server.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ClawMachine } from "@/components/claw/ClawMachine";
import { clawArt } from "@/components/claw/geometry";
import { variantOf } from "@/components/claw/view";
import { fmtMultiplier, fmtPct } from "@/lib/machines";
import { withResolved } from "@/lib/machines.server";
import { usdc } from "@/lib/stocks";

export const metadata: Metadata = { title: "Machines" };

const ART = { single: clawArt("single"), stack: clawArt("stack"), vault: clawArt("vault") };

export default function PlayPage() {
  const machines = withResolved();
  return (
    <div className="wrap py-10 md:py-14">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h1 className="h-section !text-[clamp(40px,5vw,80px)]">Pick a machine.</h1>
        <p className="lede max-w-[24em]">Every play wins a box. Bigger machines pay back more on average.</p>
      </div>
      <ul className="mt-10 grid gap-4 lg:grid-cols-3">
        {machines.map((m) => {
          const top = m.tiers[m.tiers.length - 1]!;
          return (
            <li key={m.id} className="flex flex-col overflow-hidden rounded-[18px] border border-line bg-panel">
              <Link href={`/app/play/${m.slug}`} className="group flex flex-1 flex-col" aria-label={`Enter ${m.name}, ${m.priceUsdc} USDC per play`}>
                <div className="mx-auto w-full max-w-[320px] px-6 pt-6 transition-transform duration-500 ease-[var(--ease-out-quint)] group-hover:-translate-y-1">
                  <ClawMachine art={ART[variantOf(m.slug)]} machine={m.slug} label={`The ${m.name} machine.`} />
                </div>
                <div className="flex flex-1 flex-col border-t border-line p-6">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="text-[clamp(30px,2.8vw,42px)] leading-none tracking-[-0.03em]">{m.name}</h2>
                    <p className="money text-[clamp(20px,1.8vw,26px)] leading-none">
                      {m.priceUsdc} <span className="text-muted">USDC</span>
                    </p>
                  </div>
                  <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
                    <div>
                      <dt className="text-[13px] text-muted">Expected</dt>
                      <dd className="money mt-1 text-[16px]">{fmtPct(m.rtp)}</dd>
                    </div>
                    <div>
                      <dt className="text-[13px] text-muted">At least</dt>
                      <dd className="money mt-1 text-[16px]">{usdc(m.priceUsdc * m.floor)}</dd>
                    </div>
                    <div>
                      <dt className="text-[13px] text-muted">Up to</dt>
                      <dd className="money mt-1 text-[16px]">
                        {usdc(top.valueUsdc)} <span className="text-muted">{fmtMultiplier(top.multiplier)}</span>
                      </dd>
                    </div>
                  </dl>
                  <span className="btn-cream mt-6 w-full">Enter</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
