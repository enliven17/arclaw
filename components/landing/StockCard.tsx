/**
 * A stock card, 63:88, radius 14. Two faces for a flip: the back carries the mark, the front the stock. Face up by
 * default (globals.css), so no-JS and reduced motion show the result; the pack animation turns it down first.
 * `foil` draws the rarity hairline in the prize colour (the only place that colour is used).
 */
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/cn";
import { usdc, type PullCard } from "@/lib/stocks";

export function StockCard({ card, foil = false, className, index }: { card: PullCard; foil?: boolean; className?: string; index?: number }) {
  return (
    <div className={cn("stock-card", className)} data-card={index}>
      <div className="stock-card-inner" data-card-inner="">
        <div className="stock-card-face flex items-center justify-center border border-line-strong bg-panel" data-side="back" aria-hidden="true">
          <div className="absolute inset-[7%] rounded-[9px] border border-line" />
          <Logo variant="mark" height={44} />
        </div>
        <div
          className={cn("stock-card-face flex flex-col justify-between border bg-panel-2 p-[9%]", foil ? "border-prize/70" : "border-line-strong")}
          data-side="front"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="label !text-[max(9px,6.5cqw)]">{foil ? "Foil" : "Card"}</span>
            <span className="label money !text-[max(9px,6.5cqw)]">{String((index ?? 0) + 1).padStart(2, "0")}/03</span>
          </div>
          <div>
            <p className="money text-[19cqw] leading-none tracking-[-0.04em] text-cream">{card.ticker}</p>
            <p className="mt-[4cqw] truncate text-[max(10px,7.5cqw)] leading-snug text-muted">{card.name}</p>
          </div>
          <p className="money border-t border-line pt-[5cqw] text-[max(10px,7.5cqw)] leading-snug text-cream">
            {usdc(card.amount)} USDC of {card.ticker}
          </p>
        </div>
      </div>
    </div>
  );
}
