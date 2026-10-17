/**
 * Odds and payout: the band the contract enforces, where the randomness comes from, what happens when the pool
 * runs short. Numbers count up as they enter (data-count); the server renders the final values.
 */
import { SplitHeading } from "@/components/motion/SmoothScroll";

const FACTS = [
  {
    title: "Paid on-chain",
    body: "Every box pays between 70 and 80% of its price in stocks. The contract checks the band before it pays, so nobody can quietly change it.",
  },
  {
    title: "Verifiable random",
    body: "Contents come from a VRF draw you can check on the explorer. The claw is the show; the draw decides the box.",
  },
  {
    title: "Never short",
    body: "Prizes come from stock the contract already holds. If the pool cannot cover a box, you get your 1 USDC back.",
  },
];

export function Odds() {
  return (
    <section id="odds" aria-labelledby="odds-title" className="border-t border-line py-28 md:py-36">
      <div className="wrap">
        <p className="label" data-reveal>
          Odds and payout
        </p>
        <SplitHeading as="h2" id="odds-title" onScroll className="h-section mt-5 max-w-[14em]" lines={["The house edge,", "written in the contract."]} />

        <div className="mt-16 grid items-start gap-4 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="rounded-[18px] border border-line bg-panel p-6 md:p-10" data-reveal>
            <p className="label">Returned per box</p>
            <p className="money mt-6 flex flex-wrap items-baseline gap-x-[0.18em] text-[clamp(56px,9vw,128px)] leading-none tracking-[-0.05em]">
              <span data-count="70" data-suffix="%">
                <span data-count-out="">70%</span>
              </span>
              <span className="text-[0.4em] tracking-normal text-muted">to</span>
              <span data-count="80" data-suffix="%">
                <span data-count-out="">80%</span>
              </span>
            </p>
            {/* The band on a 0 to 100% scale: hairline frame, the band filled in cream. */}
            <div className="mt-10" aria-hidden="true">
              <div className="relative h-10 rounded-[4px] border border-line-strong">
                <div className="absolute inset-y-0 left-[70%] w-[10%] bg-cream/80" />
              </div>
              <div className="money relative mt-3 h-4 text-[12px] text-muted">
                <span className="absolute left-0">0</span>
                <span className="absolute left-[75%] -translate-x-1/2 whitespace-nowrap text-cream">0.70 to 0.80</span>
                <span className="absolute right-0">1 USDC</span>
              </div>
            </div>
          </div>

          <dl className="grid gap-4">
            {FACTS.map((f) => (
              <div key={f.title} className="rounded-[18px] border border-line bg-panel p-6" data-reveal>
                <dt className="h-card">{f.title}</dt>
                <dd className="mt-3 text-[15px] leading-relaxed text-muted">{f.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
