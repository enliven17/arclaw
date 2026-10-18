/**
 * A shared pull: /pull?tickers=..&amounts=..&tier=..&sig=.. . Shows the three cards and links to the machines; the share
 * card comes from /api/og/pull with the same params. Only a link signed by /api/share (after it read the reveal on
 * chain) draws anything; anything else gets a plain notice, so the page cannot be used to show a fake win.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { StockCard } from "@/components/landing/StockCard";
import { parsePull } from "@/lib/og/cards";
import { verifyPull } from "@/lib/share";
import { usdc } from "@/lib/stocks";

type Search = Promise<Record<string, string | string[] | undefined>>;

const paramsOf = (s: Record<string, string | string[] | undefined>) => {
  const p = new URLSearchParams();
  for (const k of ["tickers", "amounts", "tier", "sig"]) {
    const v = s[k];
    if (typeof v === "string") p.set(k, v);
  }
  return p;
};

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const p = paramsOf(await searchParams);
  if (!verifyPull(p)) return { title: "Shared pull", robots: { index: false, follow: false } };
  const { cards, tier } = parsePull(p);
  const total = cards.reduce((s, c) => s + c.amount, 0);
  const title = `${tier} pack, ${usdc(total)} USDC`;
  const image = { url: `/api/og/pull?${p.toString()}`, width: 1200, height: 630, alt: `${title}: ${cards.map((c) => c.ticker).join(", ")}` };
  return {
    title,
    description: `A ${tier.toLowerCase()} arclaw pack containing ${cards.map((c) => c.name).join(", ")}.`,
    alternates: { canonical: "/pull" },
    robots: { index: false, follow: true },
    openGraph: { title, images: [image] },
    twitter: { card: "summary_large_image", title, images: [image] },
  };
}

export default async function PullPage({ searchParams }: { searchParams: Search }) {
  const params = paramsOf(await searchParams);
  if (!verifyPull(params)) {
    return (
      <main id="main" className="wrap flex min-h-dvh flex-col items-center justify-center gap-8 py-20 text-center">
        <h1 className="h-section !text-[clamp(36px,4.4vw,64px)]">This link is not valid.</h1>
        <p className="lede max-w-[28em]">A shared pull has to come from the Share button in the app, which checks the pack on chain.</p>
        <Link href="/app/play" className="btn">
          Play
        </Link>
      </main>
    );
  }
  const { cards, tier } = parsePull(params);
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
