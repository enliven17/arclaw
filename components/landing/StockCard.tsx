/**
 * The stock card, 63:88, radius 14. One component everywhere on the site; lib/og/frame.tsx OgCard mirrors it.
 *
 *   top      ticker in mono, rarity tier in the prize colour
 *   centre   a framed logo window (hairline, about 45% of the height), the logo in cream
 *   bottom   company name muted, amount in mono
 *
 * Sizes are in container units against a 210px reference card, so it reads the same at every size. Two faces
 * for a flip: face up by default (globals.css), so no-JS and reduced motion show the result.
 */
/* eslint-disable @next/next/no-img-element -- small local SVG logos; next/image adds nothing here */
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/cn";
import { logoOf, usdc, type PullCard } from "@/lib/stocks";

export function StockCard({ card, tier, className, index }: { card: PullCard; tier: string; className?: string; index?: number }) {
  const logo = logoOf(card.ticker);
  return (
    <div className={cn("stock-card", className)} data-card={index}>
      <div className="stock-card-inner" data-card-inner="">
        <div className="stock-card-face flex items-center justify-center border border-line-strong bg-panel" data-side="back" aria-hidden="true">
          <div className="absolute inset-[6%] rounded-[10px] border border-line" />
          <div className="absolute inset-[12%] rounded-[8px] border border-line" />
          <Logo variant="mark" height={44} className="relative !h-[24cqw] !w-[24cqw]" />
        </div>
        <article
          className="stock-card-face flex flex-col border border-line-strong bg-panel px-[9.5cqw] py-[8.6cqw]"
          data-side="front"
          aria-label={`${tier} card: ${usdc(card.amount)} USDC of ${card.name}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="money text-[8.6cqw] leading-none text-cream">{card.ticker}</span>
            <span className="text-[6.2cqw] leading-none text-prize">{tier}</span>
          </div>
          <div className="my-[4.8cqw] flex flex-1 items-center justify-center rounded-[10px] border border-line">
            {logo ? <img src={logo} alt="" className="size-[45cqw]" /> : <span className="money text-[16cqw]">{card.ticker}</span>}
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[7.1cqw] leading-none text-muted">{card.name}</span>
            <span className="money shrink-0 text-[7.6cqw] leading-none text-cream">{usdc(card.amount)} USDC</span>
          </div>
        </article>
      </div>
    </div>
  );
}
