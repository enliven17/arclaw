/**
 * Quotes for the stocks section, from a public stock price feed (astock.fi), for display only: nothing on chain reads
 * it. Server only, cached for five minutes, with a short timeout; any failure falls back to the snapshot in lib/stocks.ts so the page never waits on it.
 */
import "server-only";
import { STOCKS } from "./stocks";

export type Quote = { price: number; changePct: number | null; live: boolean };

const FEED = "https://astock.fi/api/prices";

function snapshot(): Record<string, Quote> {
  return Object.fromEntries(STOCKS.map((s) => [s.ticker, { price: s.price, changePct: null, live: false }]));
}

export async function getQuotes(): Promise<Record<string, Quote>> {
  const out = snapshot();
  try {
    const res = await fetch(FEED, { next: { revalidate: 300 }, signal: AbortSignal.timeout(3500) });
    if (!res.ok) return out;
    const json: unknown = await res.json();
    const quotes = typeof json === "object" && json !== null && Array.isArray((json as { quotes?: unknown }).quotes) ? (json as { quotes: unknown[] }).quotes : [];
    for (const q of quotes) {
      if (typeof q !== "object" || q === null) continue;
      const { symbol, mid, changePct } = q as { symbol?: unknown; mid?: unknown; changePct?: unknown };
      if (typeof symbol !== "string" || !(symbol in out)) continue;
      const price = Number(mid);
      if (!Number.isFinite(price) || price <= 0) continue;
      const change = Number(changePct);
      out[symbol] = { price, changePct: Number.isFinite(change) ? change : null, live: true };
    }
  } catch {
    // Feed down or slow: keep the snapshot.
  }
  return out;
}
