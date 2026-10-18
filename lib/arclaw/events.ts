/**
 * Reading plays and pulls from the arclaw contract's logs, and turning them into a leaderboard. Pure functions over a
 * viem client: the Convex indexer (convex/indexer.ts) runs them on a schedule and stores the result; the app falls back
 * to running them directly when no Convex deployment is configured.
 *
 * Sources: Played (player, machine, boxes), OutcomeDrawn (one per box: machine, tier, value) and CardDrawn (carries
 * the opener on the deployed contract, whose OutcomeDrawn has no player field yet).
 */
import type { Address, Log, PublicClient } from "viem";
import { arclawAbi } from "@/lib/abi";
import { ARCLAW, LEGACY_EVENTS, LOG_SPAN, decodeArclaw, tierName, toUsdc, withRetry } from "./contract";

export type PullRecord = { id: string; openingId: string; boxIndex: number; machineId: number; player: Address; tier: number; tierName: string; valueUsdc: number; blockNumber: number; txHash: string };
export type PlayRecord = { id: string; player: Address; machineId: number; boxes: number; paidUsdc: number; blockNumber: number };

const eventsNamed = (names: string[]) => [...arclawAbi, ...LEGACY_EVENTS].filter((x) => x.type === "event" && names.includes((x as { name: string }).name));

async function logsBetween(client: PublicClient, names: string[], from: bigint, to: bigint): Promise<Log[]> {
  const address = ARCLAW;
  if (!address) return [];
  const out: Log[] = [];
  for (let a = from; a <= to; a += LOG_SPAN) {
    const b = a + LOG_SPAN - 1n > to ? to : a + LOG_SPAN - 1n;
    for (const event of eventsNamed(names)) {
      out.push(...((await withRetry(() => client.getLogs({ address, event: event as never, fromBlock: a, toBlock: b }))) as Log[]));
    }
  }
  return out;
}

/** Plays and pulls in a block range, decoded and keyed so re-reading a range is idempotent. */
export async function readRange(client: PublicClient, from: bigint, to: bigint): Promise<{ plays: PlayRecord[]; pulls: PullRecord[] }> {
  const logs = await logsBetween(client, ["Played", "OutcomeDrawn", "CardDrawn"], from, to);
  const decoded = logs.map((l) => ({ l, e: decodeArclaw([l])[0] })).filter((x): x is { l: Log; e: NonNullable<typeof x.e> } => Boolean(x.e));
  const openers = new Map<string, Address>();
  for (const { e } of decoded) if (e.eventName === "CardDrawn") openers.set(String(e.args.openingId), e.args.opener as Address);

  const plays: PlayRecord[] = [];
  const pulls: PullRecord[] = [];
  for (const { l, e } of decoded) {
    if (e.eventName === "Played") {
      plays.push({
        id: `${l.transactionHash}-${l.logIndex}`,
        player: e.args.player as Address,
        machineId: Number(e.args.machineId),
        boxes: Number(e.args.boxes),
        paidUsdc: toUsdc(e.args.paid as bigint),
        blockNumber: Number(l.blockNumber),
      });
    } else if (e.eventName === "OutcomeDrawn") {
      const openingId = String(e.args.openingId);
      const player = (e.args.opener as Address | undefined) ?? openers.get(openingId);
      if (!player) continue;
      const machineId = Number(e.args.machineId);
      const tier = Number(e.args.tier);
      pulls.push({
        id: `${openingId}-${e.args.boxIndex}`,
        openingId,
        boxIndex: Number(e.args.boxIndex),
        machineId,
        player,
        tier,
        tierName: tierName(machineId, tier),
        valueUsdc: toUsdc(e.args.valueUsdc as bigint),
        blockNumber: Number(l.blockNumber),
        txHash: l.transactionHash ?? "",
      });
    }
  }
  return { plays, pulls };
}

export type PlayerRow = { player: Address; totalUsdc: number; packs: number; spentUsdc: number; best: number };
export type Leaderboard = { players: PlayerRow[]; biggest: PullRecord[]; byMachine: Record<number, PullRecord[]>; updatedBlock: number };

/** Top players by total value pulled, the biggest single pulls, and the biggest per machine. */
export function aggregate(plays: PlayRecord[], pulls: PullRecord[], updatedBlock: number, limit = 20): Leaderboard {
  const rows = new Map<string, PlayerRow>();
  const row = (p: Address) => {
    const k = p.toLowerCase();
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { player: p, totalUsdc: 0, packs: 0, spentUsdc: 0, best: 0 }));
    return r;
  };
  for (const x of pulls) {
    const r = row(x.player);
    r.totalUsdc += x.valueUsdc;
    r.packs += 1;
    r.best = Math.max(r.best, x.valueUsdc);
  }
  for (const x of plays) row(x.player).spentUsdc += x.paidUsdc;
  const byValue = [...pulls].sort((a, b) => b.valueUsdc - a.valueUsdc || a.blockNumber - b.blockNumber);
  const byMachine: Record<number, PullRecord[]> = {};
  for (const x of byValue) {
    const list = (byMachine[x.machineId] ??= []);
    if (list.length < limit) list.push(x);
  }
  return {
    players: [...rows.values()].filter((r) => r.packs > 0).sort((a, b) => b.totalUsdc - a.totalUsdc).slice(0, limit),
    biggest: byValue.slice(0, limit),
    byMachine,
    updatedBlock,
  };
}
