"use client";

/**
 * Odds and payout, per machine, straight from lib/machines.json: every tier with its multiplier, its USDC value and
 * its chance; the guarantees the contract enforces (floor, cap, expected return, verifiable draw); and a simulator
 * that opens 100 boxes with a seeded generator so anyone can rerun the same draw.
 */
import { useMemo, useState } from "react";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { fmtMultiplier, fmtPct, pickTier, seeded, type Machine } from "@/lib/machines";
import { usdc } from "@/lib/stocks";
import { MachineSwitch } from "./MachineSwitch";

const RUN = 100;

const oneIn = (p: number) => (p >= 0.5 ? "Most boxes" : `1 in ${Math.round(1 / p).toLocaleString("en-US")}`);

function simulate(m: Machine, seed: number) {
  const rand = seeded(seed * 7919 + m.id);
  const counts = new Map(m.tiers.map((t) => [t.name, 0]));
  let paid = 0;
  for (let i = 0; i < RUN; i++) {
    const t = pickTier(m, rand());
    counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
    paid += t.valueUsdc;
  }
  return { counts, paid, spent: RUN * m.priceUsdc };
}

export function Odds({ machines }: { machines: Machine[] }) {
  const [id, setId] = useState(machines[0]!.id);
  const [seed, setSeed] = useState(1);
  const m = machines.find((x) => x.id === id) ?? machines[0]!;
  const run = useMemo(() => simulate(m, seed), [m, seed]);
  const maxP = Math.max(...m.tiers.map((t) => t.probability));
  const maxCount = Math.max(1, ...run.counts.values());

  return (
    <section id="odds" aria-labelledby="odds-title" className="border-t border-line py-28 md:py-36">
      <div className="wrap">
        <div className="grid gap-8 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] md:items-end">
          <SplitHeading as="h2" id="odds-title" onScroll className="h-section" lines={["Fair odds,", "on-chain."]} />
          <p className="lede max-w-[26em] md:justify-self-end" data-reveal>
            Each machine draws from a fixed table the contract enforces. Small boxes are common, big ones are rare, and you
            can read every number before you play.
          </p>
        </div>

        <div className="mt-14 max-w-[460px]" data-reveal>
          <MachineSwitch machines={machines} value={id} onChange={setId} label="Machine odds" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" data-reveal>
          {/* The table. */}
          <div className="overflow-hidden rounded-[18px] border border-line bg-panel">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                {m.name} machine, {m.priceUsdc} USDC per box: outcome tiers, multipliers, values and chances
              </caption>
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  <th scope="col" className="px-5 py-4 font-normal md:px-6">
                    Tier
                  </th>
                  <th scope="col" className="px-2 py-4 text-right font-normal">
                    Pays
                  </th>
                  <th scope="col" className="hidden px-2 py-4 text-right font-normal sm:table-cell">
                    Value
                  </th>
                  <th scope="col" className="w-[38%] px-5 py-4 font-normal md:px-6">
                    Chance
                  </th>
                </tr>
              </thead>
              <tbody>
                {m.tiers.map((t) => (
                  <tr key={t.name} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-5 py-4 text-[16px] font-normal text-prize md:px-6">
                      {t.name}
                    </th>
                    <td className="money px-2 py-4 text-right text-[16px] text-cream">{fmtMultiplier(t.multiplier)}</td>
                    <td className="money hidden px-2 py-4 text-right text-[16px] text-cream sm:table-cell">{usdc(t.valueUsdc)}</td>
                    <td className="px-5 py-4 md:px-6">
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <div className="h-2 w-full overflow-hidden rounded-[4px] bg-panel-2 sm:w-auto sm:flex-1" aria-hidden="true">
                          <div className="h-full rounded-[4px] bg-cream/80 transition-[width] duration-500 ease-out" style={{ width: `${Math.max(1.5, (t.probability / maxP) * 100)}%` }} />
                        </div>
                        <span className="money text-right text-[14px] text-cream sm:w-[4.5em]">{fmtPct(t.probability, t.probability < 0.01 ? 2 : 1)}</span>
                      </div>
                      <p className="mt-1 text-right text-[12px] text-muted">{oneIn(t.probability)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The guarantees. */}
          <dl className="grid grid-cols-2 gap-4">
            {[
              { k: "Never less than", v: fmtPct(m.floor, 0), d: `Every box is worth at least ${usdc(m.priceUsdc * m.floor)} USDC in stocks at the prices its table was set with.` },
              { k: "Never more than", v: fmtMultiplier(m.cap), d: `The cap is set per machine and checked on every payout.` },
              { k: "Expected return", v: fmtPct(m.rtp), d: `Computed from this table. The contract keeps it between ${fmtPct(m.rtpMin, 0)} and ${fmtPct(m.rtpMax, 0)}.` },
              { k: "The draw", v: "VRF", d: "Every box comes from a verifiable random draw you can check on the explorer." },
            ].map((g) => (
              <div key={g.k} className="flex flex-col rounded-[18px] border border-line bg-panel p-5 md:p-6">
                <dt className="text-[14px] text-muted">{g.k}</dt>
                <dd className="mt-3 flex flex-1 flex-col">
                  <span className="money text-[clamp(30px,3vw,44px)] leading-none tracking-[-0.03em] text-cream">{g.v}</span>
                  <span className="mt-auto pt-4 text-[14px] leading-relaxed text-muted">{g.d}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Simulator. */}
        <div className="mt-4 rounded-[18px] border border-line bg-panel p-5 md:p-8" data-reveal>
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="text-[clamp(26px,2.4vw,36px)] leading-tight tracking-[-0.02em]">Open {RUN} boxes</h3>
              <p className="mt-2 max-w-[34em] text-[15px] leading-relaxed text-muted">
                A seeded run of the {m.name} table. Same seed, same boxes, so you can check it. One run is noisy; the table
                is the truth.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="money text-[14px] text-muted">Seed {seed}</span>
              <button type="button" className="btn-cream" onClick={() => setSeed((s) => s + 1)}>
                Open {RUN} more
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <ul className="grid gap-3" aria-label={`Run with seed ${seed}`}>
              {m.tiers.map((t) => {
                const n = run.counts.get(t.name) ?? 0;
                return (
                  <li key={t.name} className="grid grid-cols-[6.5em_minmax(0,1fr)_3em] items-center gap-3 text-[14px]">
                    <span className="text-muted">{t.name}</span>
                    <span className="h-6 overflow-hidden rounded-[4px] bg-panel-2" aria-hidden="true">
                      <span className="block h-full rounded-[4px] bg-cream/80 transition-[width] duration-500 ease-out" style={{ width: `${(n / maxCount) * 100}%` }} />
                    </span>
                    <span className="money text-right text-cream">{n}</span>
                  </li>
                );
              })}
            </ul>
            <dl className="grid grid-cols-2 content-start gap-4" aria-live="polite">
              <div className="rounded-[14px] border border-line p-4">
                <dt className="text-[13px] text-muted">Spent</dt>
                <dd className="money mt-2 text-[22px]">{usdc(run.spent)}</dd>
              </div>
              <div className="rounded-[14px] border border-line p-4">
                <dt className="text-[13px] text-muted">Back in stocks</dt>
                <dd className="money mt-2 text-[22px]">{usdc(run.paid)}</dd>
              </div>
              <div className="col-span-2 rounded-[14px] border border-line p-4">
                <dt className="text-[13px] text-muted">This run returned</dt>
                <dd className="money mt-2 text-[clamp(32px,3.4vw,48px)] leading-none tracking-[-0.03em]">{fmtPct(run.paid / run.spent)}</dd>
                <p className="mt-2 text-[13px] text-muted">Table expects {fmtPct(m.rtp)} over many boxes.</p>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
