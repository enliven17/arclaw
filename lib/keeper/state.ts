/**
 * readState: one consistent look at everything the keeper decides on. Two halves, so the fast reveal loop only pays
 * for what it needs:
 *   readOpenings   globals plus every opening that is not final (Pending or Fulfilled), with the coordinator's view
 *   readMarkets    each machine's rules and live table, the oracle price of every card token, and how far each
 *                  token moved from the price its table was set at
 * Openings are found with a cursor kept in KeeperState.scan (new ids since the last tick, plus the ones still open),
 * so a tick never rereads the whole history.
 */
import { getAddress, type Address, type PublicClient } from "viem";
import { arclawAbi } from "../abi";
import { MULTICALL3_ADDRESS, STATUS, decimalsOf, priceOf, readGlobals, readMachine, readOpening, readRequest, type Globals, type MachineState, type Opening, type PriceRead, type RequestState } from "./arclaw";
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
export type OpeningsView = { g: Globals; market: MarketClock; keeperBalance: bigint; openings: OpenOpening[]; vrfImpl: Address | null };

/** The small chain snapshot needed by the frequent reveal heartbeat. */
export type RevealView = { block: bigint; now: number; isKeeper: boolean; vrfCoordinator: Address; openings: OpenOpening[] };

/** The EIP-1967 implementation slot of a proxy, or null when it cannot be read. */
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
async function implementationOf(c: PublicClient, proxy: Address): Promise<Address | null> {
  const raw = await c.getStorageAt({ address: proxy, slot: IMPL_SLOT }).catch(() => undefined);
  return raw && raw.length === 66 ? getAddress(`0x${raw.slice(26)}`) : null;
}

export async function readOpenings(c: PublicClient, cfg: KeeperConfig, me: Address, st: KeeperState): Promise<OpeningsView> {
  const d = cfg.deployment;
  const [g, keeperBalance] = await Promise.all([readGlobals(c, d, me), c.getBalance({ address: me })]);
  const vrfImpl = cfg.vrfImplementation ? await implementationOf(c, g.vrfCoordinator) : null;
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
  return { g, market: usMarket(g.now, cfg.market), keeperBalance, openings: withReq.sort((a, b) => (a.id < b.id ? -1 : 1)), vrfImpl };
}

/**
 * Cheap path for the reveal heartbeat. It avoids the full globals snapshot, balance and proxy implementation
 * checks until a full tick or a wake actually needs them. On an idle deployment this is one block read plus one
 * multicall instead of the keeper's full contract snapshot on every heartbeat.
 */
export async function readRevealOpenings(c: PublicClient, cfg: KeeperConfig, me: Address, st: KeeperState): Promise<RevealView> {
  const d = cfg.deployment;
  const block = await c.getBlock();
  const [nextOpeningId, isKeeper, vrfCoordinator] = (await c.multicall({
    multicallAddress: MULTICALL3_ADDRESS,
    blockNumber: block.number,
    allowFailure: false,
    contracts: [
      { address: d.arclaw, abi: arclawAbi, functionName: "nextOpeningId" },
      { address: d.arclaw, abi: arclawAbi, functionName: "keepers", args: [me] },
      { address: d.arclaw, abi: arclawAbi, functionName: "vrfCoordinator" },
    ] as never,
  })) as [bigint, boolean, Address];
  const next = BigInt(st.scan.next);
  const end = nextOpeningId < next + SCAN_PER_TICK ? nextOpeningId : next + SCAN_PER_TICK;
  const ids = [...new Set([...st.scan.open.map(BigInt), ...Array.from({ length: Number(end > next ? end - next : 0n) }, (_, k) => next + BigInt(k))].map(String))].map(BigInt);
  const read = await mapLimit(ids, 8, (id) => readOpening(c, d, id));
  const open = read.filter((o) => o.status === STATUS.Pending || o.status === STATUS.Fulfilled);
  const withReq = await mapLimit(open, 8, async (o) => ({
    ...o,
    req: o.status === STATUS.Pending ? await readRequest(c, vrfCoordinator, o.requestId, Number(block.timestamp)) : { fulfilled: true, refunded: false, deadline: 0, expired: false, readable: true },
  }));
  st.scan = { next: String(end > next ? end : next), open: open.map((o) => String(o.id)) };
  return { block: block.number, now: Number(block.timestamp), isKeeper, vrfCoordinator, openings: withReq.sort((a, b) => (a.id < b.id ? -1 : 1)) };
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
