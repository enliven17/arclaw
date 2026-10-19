/**
 * readState: one consistent look at everything the keeper decides on. Two halves, so the fast reveal loop only pays
 * for what it needs:
 *   readOpenings   globals plus every opening that is not final (Pending or Fulfilled), with the coordinator's view
 *   readMarkets    each machine's rules and live table, the oracle price of every card token, and how far each
 *                  token moved from the price its table was set at
 * Openings are found with a cursor kept in KeeperState.scan (new ids since the last tick, plus the ones still open),
 * so a tick never rereads the whole history.
 */
import type { Address, PublicClient } from "viem";
import { STATUS, decimalsOf, priceOf, readGlobals, readMachine, readOpening, readRequest, type Globals, type MachineState, type Opening, type PriceRead, type RequestState } from "./arclaw";
import { tokensOf, type KeeperConfig } from "./config";
import { usMarket, type MarketClock } from "./market";
import type { KeeperState } from "./store";
import { SYMBOLS, moveBps, refPrices } from "./table";

export const SCAN_PER_TICK = 300n;

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

export type OpenOpening = Opening & { req: RequestState };
export type OpeningsView = { g: Globals; market: MarketClock; keeperBalance: bigint; openings: OpenOpening[] };

export async function readOpenings(c: PublicClient, cfg: KeeperConfig, me: Address, st: KeeperState): Promise<OpeningsView> {
  const d = cfg.deployment;
  const [g, keeperBalance] = await Promise.all([readGlobals(c, d, me), c.getBalance({ address: me })]);
  const next = BigInt(st.scan.next);
  const end = g.nextOpeningId < next + SCAN_PER_TICK ? g.nextOpeningId : next + SCAN_PER_TICK;
  const ids = [...new Set([...st.scan.open.map(BigInt), ...Array.from({ length: Number(end > next ? end - next : 0n) }, (_, k) => next + BigInt(k))].map(String))].map(BigInt);
  const read = await mapLimit(ids, 8, (id) => readOpening(c, d, id));
  const open = read.filter((o) => o.status === STATUS.Pending || o.status === STATUS.Fulfilled);
  const withReq = await mapLimit(open, 8, async (o) => ({
    ...o,
    req: o.status === STATUS.Pending ? await readRequest(c, g.vrfCoordinator, o.requestId, g.now) : { fulfilled: true, refunded: false, deadline: 0, expired: false, readable: true },
  }));
  st.scan = { next: String(end > next ? end : next), open: open.map((o) => String(o.id)) };
  return { g, market: usMarket(g.now, cfg.market), keeperBalance, openings: withReq.sort((a, b) => (a.id < b.id ? -1 : 1)) };
}

export type MachineView = MachineState & {
  /** Reference price per card token (lowercase address), recovered from the table. */
  ref: Map<string, bigint>;
  /** Largest live move of any card token from its reference, bps; null when a price is unavailable. */
  maxMoveBps: bigint | null;
  worstToken: string | null;
  age: number;
};

export type MarketsView = {
  machines: MachineView[];
  /** Oracle reads by token (lowercase). */
  oracle: Map<string, PriceRead>;
  /** Successful oracle prices by symbol (SYMBOLS order). */
  bySymbol: Map<string, bigint>;
  /** Oracle failures as "SYMBOL: error". */
  oracleErrors: string[];
  decimals: Map<string, number>;
};

export async function readMarkets(c: PublicClient, cfg: KeeperConfig, g: Globals): Promise<MarketsView> {
  const d = cfg.deployment;
  const toks = tokensOf(d);
  const [machines, reads, decs] = await Promise.all([
    mapLimit(g.machineIds, 4, (id) => readMachine(c, d, id)),
    mapLimit(toks, 8, (t) => priceOf(c, g.priceSource, t)),
    mapLimit(toks, 8, (t) => decimalsOf(c, t)),
  ]);
  const oracle = new Map<string, PriceRead>();
  const decimals = new Map<string, number>();
  const bySymbol = new Map<string, bigint>();
  const oracleErrors: string[] = [];
  toks.forEach((t, i) => {
    const r = reads[i]!;
    oracle.set(t.toLowerCase(), r);
    decimals.set(t.toLowerCase(), decs[i]!);
    if (r.ok) bySymbol.set(SYMBOLS[i]!, r.price);
    else oracleErrors.push(`${SYMBOLS[i]}: ${r.error}`);
  });
  const nameOf = new Map(toks.map((t, i) => [t.toLowerCase(), SYMBOLS[i]!]));
  // a table may hold a token outside SYMBOLS (an owner-set table): read it too
  for (const m of machines) {
    for (const o of m.outcomes) {
      for (const k of o.cards) {
        const key = k.token.toLowerCase();
        if (!oracle.has(key)) {
          oracle.set(key, await priceOf(c, g.priceSource, k.token));
          decimals.set(key, await decimalsOf(c, k.token));
        }
      }
    }
  }
  const views = machines.map((m): MachineView => {
    const ref = refPrices(m.outcomes, (t) => decimals.get(t.toLowerCase()) ?? 18);
    let maxMoveBps: bigint | null = 0n;
    let worstToken: string | null = null;
    for (const [tok, r] of ref) {
      const live = oracle.get(tok);
      if (!live?.ok) {
        maxMoveBps = null;
        worstToken = nameOf.get(tok) ?? tok;
        break;
      }
      const mv = moveBps(live.price, r);
      if (maxMoveBps !== null && mv > maxMoveBps) [maxMoveBps, worstToken] = [mv, nameOf.get(tok) ?? tok];
    }
    return { ...m, ref, maxMoveBps: m.tableId === null ? null : maxMoveBps, worstToken, age: m.tableId === null ? Infinity : g.now - m.pricedAt };
  });
  return { machines: views, oracle, bySymbol, oracleErrors, decimals };
}

/** Both halves: what `pnpm keeper state` prints. */
export async function readState(c: PublicClient, cfg: KeeperConfig, me: Address, st: KeeperState) {
  const o = await readOpenings(c, cfg, me, st);
  const m = await readMarkets(c, cfg, o.g);
  return { ...o, ...m };
}
