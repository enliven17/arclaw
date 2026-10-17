/**
 * A shared pull: /pull?tickers=NVDA,AAPL,TSLA&amounts=0.10,0.40,0.25&tier=Rare. Shows the three cards and links to
 * the machines; the share card comes from /api/og/pull with the same (validated) params.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { StockCard } from "@/components/landing/StockCard";
import { parsePull } from "@/lib/og/cards";
import { usdc } from "@/lib/stocks";

type Search = Promise<Record<string, string | string[] | undefined>>;

const paramsOf = (s: Record<string, string | string[] | undefined>) => {
  const p = new URLSearchParams();
  for (const k of ["tickers", "amounts", "tier"]) {
    const v = s[k];
    if (typeof v === "string") p.set(k, v);
  }
  return p;
};

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const p = paramsOf(await searchParams);
  const { cards, tier } = parsePull(p);
  const total = cards.reduce((s, c) => s + c.amount, 0);
  const title = `${tier} pack, ${usdc(total)} USDC`;
  const image = { url: `/api/og/pull?${p.toString()}`, width: 1200, height: 630, alt: `${title}: ${cards.map((c) => c.ticker).join(", ")}` };
  return { title, robots: { index: false }, openGraph: { title, images: [image] }, twitter: { card: "summary_large_image", title, images: [image] } };
}

export default async function PullPage({ searchParams }: { searchParams: Search }) {
  const { cards, tier } = parsePull(paramsOf(await searchParams));
  const total = cards.reduce((s, c) => s + c.amount, 0);
  return (
    <main id="main" className="wrap flex min-h-dvh flex-col items-center justify-center gap-10 py-20 text-center">
      <h1 className="h-section !text-[clamp(40px,5vw,80px)]">
        {tier} pack <span className="money">{usdc(total)} USDC</span>
      </h1>
      <div className="grid w-full max-w-[720px] grid-cols-3 gap-3 md:gap-5">
        {cards.map((c, i) => (
          <StockCard key={`${c.ticker}-${i}`} card={c} tier={tier} index={i} />
        ))}
      </div>
      <Link href="/app/play" className="btn">
        Play for <span className="money">1 USDC</span>
      </Link>
    </main>
  );
}
