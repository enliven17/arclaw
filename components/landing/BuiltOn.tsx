/**
 * The things arclaw stands on, as a quiet strip under the machines: Solana (the chain), MagicBlock (the real time claw
 * and the verifiable draw), Circle (USDC, what every play is paid in) and xStocks (the stocks the cards are made of).
 * Marks come from simple-icons where it has one, drawn in currentColor so the strip keeps the screen's one accent; the
 * others are plain wordmarks in the site's type.
 */
import type { ReactNode } from "react";
import { SplitHeading } from "@/components/motion/SmoothScroll";

// Paths from simple-icons (solana.svg, circle.svg).
const SOLANA = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m23.8764 18.0313-3.962 4.1393a.9201.9201 0 0 1-.306.2106.9407.9407 0 0 1-.367.0742H.4599a.4689.4689 0 0 1-.2522-.0733.4513.4513 0 0 1-.1696-.1962.4375.4375 0 0 1-.0314-.2545.4438.4438 0 0 1 .117-.2298l3.9649-4.1393a.92.92 0 0 1 .3052-.2102.9407.9407 0 0 1 .3658-.0746H23.54a.4692.4692 0 0 1 .2523.0734.4531.4531 0 0 1 .1697.196.438.438 0 0 1 .0313.2547.4442.4442 0 0 1-.1169.2297zm-3.962-8.3355a.9202.9202 0 0 0-.306-.2106.941.941 0 0 0-.367-.0742H.4599a.4687.4687 0 0 0-.2522.0734.4513.4513 0 0 0-.1696.1961.4376.4376 0 0 0-.0314.2546.444.444 0 0 0 .117.2297l3.9649 4.1394a.9204.9204 0 0 0 .3052.2102c.1154.049.24.0744.3658.0746H23.54a.469.469 0 0 0 .2523-.0734.453.453 0 0 0 .1697-.1961.4382.4382 0 0 0 .0313-.2546.4444.4444 0 0 0-.1169-.2297zM.46 6.7225h18.7815a.9411.9411 0 0 0 .367-.0742.9202.9202 0 0 0 .306-.2106l3.962-4.1394a.4442.4442 0 0 0 .117-.2297.4378.4378 0 0 0-.0314-.2546.453.453 0 0 0-.1697-.196.469.469 0 0 0-.2523-.0734H4.7596a.941.941 0 0 0-.3658.0745.9203.9203 0 0 0-.3052.2102L.1246 5.9687a.4438.4438 0 0 0-.1169.2295.4375.4375 0 0 0 .0312.2544.4512.4512 0 0 0 .1692.196.4689.4689 0 0 0 .2518.0739z" />
  </svg>
);
const CIRCLE = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20.788 3.832c-.101-.105-.197-.213-.301-.317-.103-.103-.211-.202-.32-.302A11.903 11.903 0 0 0 12 0a11.926 11.926 0 0 0-8.486 3.514C-1.062 8.09-1.16 15.47 3.213 20.168c.099.108.197.214.3.32.104.103.21.2.317.3A11.92 11.92 0 0 0 12 24c3.206 0 6.22-1.247 8.487-3.512 4.576-4.576 4.673-11.956.301-16.656zm-16.655.301A11.057 11.057 0 0 1 12 .874c2.825 0 5.49 1.048 7.55 2.958l-1.001 1.002A9.646 9.646 0 0 0 12 2.292a9.644 9.644 0 0 0-6.865 2.844A9.644 9.644 0 0 0 2.292 12c0 2.448.9 4.753 2.542 6.549L3.831 19.55C-.201 15.191-.101 8.367 4.133 4.133zm13.798 1.318v.002l-1.015 1.014A7.346 7.346 0 0 0 12 4.589 7.357 7.357 0 0 0 6.761 6.76 7.362 7.362 0 0 0 4.589 12a7.34 7.34 0 0 0 1.877 4.913l-1.014 1.016A8.77 8.77 0 0 1 3.167 12a8.77 8.77 0 0 1 2.588-6.245A8.771 8.771 0 0 1 12 3.167c2.213 0 4.301.809 5.931 2.284zM18.537 12c0 1.745-.681 3.387-1.916 4.622S13.746 18.538 12 18.538a6.491 6.491 0 0 1-4.296-1.621l-.001-.004c-.11-.094-.22-.188-.324-.291a6.027 6.027 0 0 1-.293-.326A6.47 6.47 0 0 1 5.466 12c0-1.746.679-3.387 1.914-4.621A6.488 6.488 0 0 1 12 5.465c1.599 0 3.105.576 4.295 1.62.111.096.224.19.326.295.104.104.2.214.295.324A6.482 6.482 0 0 1 18.537 12zM7.084 17.534h.001A7.349 7.349 0 0 0 12 19.413a7.35 7.35 0 0 0 5.239-2.174A7.354 7.354 0 0 0 19.412 12a7.364 7.364 0 0 0-1.876-4.916l1.013-1.012A8.777 8.777 0 0 1 20.834 12a8.765 8.765 0 0 1-2.589 6.246A8.764 8.764 0 0 1 12 20.834a8.782 8.782 0 0 1-5.93-2.285l1.014-1.015zm12.783 2.333A11.046 11.046 0 0 1 12 23.125a11.042 11.042 0 0 1-7.551-2.957l1.004-1.001a9.64 9.64 0 0 0 6.549 2.542 9.639 9.639 0 0 0 6.865-2.846A9.642 9.642 0 0 0 21.71 12a9.64 9.64 0 0 0-2.543-6.548l1.001-1.002c4.031 4.359 3.935 11.182-.301 15.417z" />
  </svg>
);

const PARTNERS: { name: string; role: string; note: string; href: string; mark?: ReactNode }[] = [
  { name: "Solana", role: "The chain", note: "Every box, round and card settles on Solana. Fees are paid in SOL.", href: "https://solana.com", mark: SOLANA },
  {
    name: "MagicBlock",
    role: "The claw and the draw",
    note: "Ephemeral rollups run the claw live, with no wallet prompt per move. MagicBlock VRF draws every pack.",
    href: "https://www.magicblock.gg",
  },
  { name: "Circle", role: "The money", note: "Every play is paid in Circle's USDC, and refunds come back in it.", href: "https://www.circle.com", mark: CIRCLE },
  { name: "xStocks", role: "The stocks", note: "Tokenized equities on Solana. Every card is a token you hold in your own wallet.", href: "https://xstocks.com" },
];

export function BuiltOn() {
  return (
    <section id="built-on" aria-labelledby="built-on-title" className="border-t border-line py-20 md:py-28">
      <div className="wrap">
        <SplitHeading as="h2" id="built-on-title" onScroll className="h-card !text-[clamp(26px,2.6vw,36px)] text-muted" lines={["Built on."]} />
        <ul className="mt-10 grid gap-4 md:grid-cols-2" data-reveal>
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
                  {p.mark ? <span className="h-[0.8em] [&>svg]:h-full [&>svg]:w-auto [&>svg]:fill-current">{p.mark}</span> : null}
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
