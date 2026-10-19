/**
 * The second price source a reprice is checked against. Default on mainnet: Astock's public feed
 * (astock.fi/api/prices, the same feed the landing reads). Any URL answering the same shape works:
 *   { "quotes": [ { "symbol": "NVDA", "mid": 216.27, "halted": false, "generatedAt": "2026-10-18T18:45:01Z" } ] }
 * Fail closed: unreachable, malformed, stale (generatedAt older than maxAgeSec by the wall clock), halted, a missing
 * symbol, or any token more than maxDiffBps away from the on-chain oracle means no reprice.
 */
import { errorLine } from "./alert";
import type { PriceCheck } from "./config";

export type SecondSourceResult =
  | { ok: true; worstBps: bigint; worst: string; skipped?: boolean }
  | { ok: false; reason: string };

type Quote = { symbol?: unknown; mid?: unknown; halted?: unknown; generatedAt?: unknown };

/** USD (float) to 6 dp bigint, rounded. */
const usd6 = (x: number) => BigInt(Math.round(x * 1e6));

export async function checkSecondSource(pc: PriceCheck, oracle: ReadonlyMap<string, bigint>, wallNowMs = Date.now(), fetcher: typeof fetch = fetch): Promise<SecondSourceResult> {
  if (pc.mode === "off") return { ok: true, worstBps: 0n, worst: "", skipped: true };
  let quotes: Quote[];
  try {
    const res = await fetcher(pc.url, { signal: AbortSignal.timeout(6000), headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, reason: `second source HTTP ${res.status}` };
    const json = (await res.json()) as { quotes?: unknown };
    if (!Array.isArray(json.quotes)) return { ok: false, reason: "second source answered without quotes" };
    quotes = json.quotes as Quote[];
  } catch (e) {
    return { ok: false, reason: `second source unreachable: ${errorLine(e, 120)}` };
  }
  const bySymbol = new Map(quotes.filter((q) => typeof q.symbol === "string").map((q) => [String(q.symbol).toUpperCase(), q]));
  let worstBps = 0n;
  let worst = "";
  for (const [symbol, onchain] of oracle) {
    const q = bySymbol.get(symbol);
    if (!q) return { ok: false, reason: `second source has no ${symbol}` };
    if (q.halted === true) return { ok: false, reason: `${symbol} is halted on the second source` };
    const mid = Number(q.mid);
    if (!Number.isFinite(mid) || mid <= 0) return { ok: false, reason: `second source has no price for ${symbol}` };
    if (typeof q.generatedAt === "string") {
      const t = Date.parse(q.generatedAt);
      if (!Number.isFinite(t)) return { ok: false, reason: `second source timestamp unreadable for ${symbol}` };
      const age = (wallNowMs - t) / 1000;
      if (age > pc.maxAgeSec) return { ok: false, reason: `second source is stale for ${symbol} (${Math.round(age)}s old)` };
    }
    const ref = usd6(mid);
    const d = onchain > ref ? onchain - ref : ref - onchain;
    const bps = (d * 10_000n + ref - 1n) / ref;
    if (bps > worstBps) [worstBps, worst] = [bps, symbol];
    if (bps > pc.maxDiffBps) return { ok: false, reason: `${symbol}: oracle ${(Number(onchain) / 1e6).toFixed(4)} vs second source ${mid.toFixed(4)} differ by ${Number(bps) / 100}% (max ${Number(pc.maxDiffBps) / 100}%)` };
  }
  return { ok: true, worstBps, worst };
}
