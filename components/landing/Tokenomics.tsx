/**
 * The token: where each month's net profit goes (25% buyback, 10% holders, 65% stays with the project) as one bar,
 * what staking ARCLAW does in the contract (a small luck boost), and the token address once it exists. The split is
 * the team's policy, run off-chain, and says so (docs/TOKENOMICS.md). The holders' share is the section's one accent.
 */
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { ARC, explorerAddress } from "@/lib/arc/config";
import { ARCLAW_SYMBOL, ARCLAW_TOKEN } from "@/lib/token";

const SPLIT = [
  { pct: 25, name: "Buyback", note: "Bought on the market every month.", bar: "bg-cream/80" },
  { pct: 10, name: "Holders", note: "Shared with everyone who holds ARCLAW.", bar: "bg-claw" },
  { pct: 65, name: "Project", note: "Prizes, running costs and growth.", bar: "bg-panel-2" },
] as const;

export function Tokenomics() {
  return (
    <section id="token" aria-labelledby="token-title" className="border-t border-line py-28 md:py-36">
      <div className="wrap">
        <div className="grid gap-8 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] md:items-end">
          <SplitHeading as="h2" id="token-title" onScroll className="h-section" lines={[`${ARCLAW_SYMBOL} and`, "the monthly profit."]} />
          <p className="lede max-w-[26em] md:justify-self-end" data-reveal>
            Every month a share of the net profit goes back into the token: part buys ARCLAW on the market, part is shared
            with its holders.
          </p>
        </div>

        <div className="mt-14 rounded-[18px] border border-line bg-panel p-5 md:p-8" data-reveal>
          <p className="text-[14px] text-muted">Each month&apos;s net profit</p>
          <div className="mt-5 flex h-4 overflow-hidden rounded-[6px] border border-line" role="img" aria-label={SPLIT.map((s) => `${s.pct} percent ${s.name.toLowerCase()}`).join(", ")}>
            {SPLIT.map((s) => (
              <div key={s.name} className={s.bar} style={{ width: `${s.pct}%` }} />
            ))}
          </div>
          <dl className="mt-8 grid gap-6 md:grid-cols-3 md:gap-8">
            {SPLIT.map((s) => (
              <div key={s.name} className="flex gap-4 md:flex-col md:gap-3">
                <dd className="money text-[clamp(40px,4.4vw,64px)] leading-none tracking-[-0.04em] text-cream md:order-none">{s.pct}%</dd>
                <dt className="flex flex-col gap-1">
                  <span className="text-[18px] text-cream">{s.name}</span>
                  <span className="text-[14px] leading-relaxed text-muted">{s.note}</span>
                </dt>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2" data-reveal>
          <div className="flex flex-col rounded-[18px] border border-line bg-panel p-5 md:p-8">
            <p className="text-[14px] text-muted">Stake {ARCLAW_SYMBOL}</p>
            <p className="money mt-3 text-[clamp(30px,3vw,44px)] leading-none tracking-[-0.03em] text-cream">Up to 1% luck</p>
            <p className="mt-auto pt-6 text-[15px] leading-relaxed text-muted">
              Lock ARCLAW for a day and every box you open gets a chance to draw twice and keep the better pack. The boost is
              checked into every machine&apos;s odds, so it can never break the guarantees.
            </p>
          </div>
          <div className="flex flex-col rounded-[18px] border border-line bg-panel p-5 md:p-8">
            <p className="text-[14px] text-muted">Token</p>
            <p className="money mt-3 text-[clamp(30px,3vw,44px)] leading-none tracking-[-0.03em] text-cream">{ARCLAW_SYMBOL}</p>
            {ARCLAW_TOKEN ? (
              <a href={explorerAddress(ARCLAW_TOKEN, ARC)} target="_blank" rel="noreferrer" className="money mt-auto break-all pt-6 text-[14px] leading-relaxed text-cream underline decoration-line-strong underline-offset-4">
                {ARCLAW_TOKEN}
              </a>
            ) : (
              <p className="mt-auto pt-6 text-[15px] leading-relaxed text-muted">The contract address is announced at the mainnet launch.</p>
            )}
          </div>
        </div>

        <p className="mt-6 max-w-[56em] text-[13px] leading-relaxed text-muted" data-reveal>
          The split is the team&apos;s current policy. It is run by the team each month, outside the contracts, and can
          change. It is not guaranteed, and if there is no net profit in a month there is nothing to buy or share. Not
          financial advice.
        </p>
      </div>
    </section>
  );
}
