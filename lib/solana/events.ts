/**
 * Plays and pulls from the program's transactions, and the leaderboard built from them. The Convex indexer
 * (convex/indexer.ts) runs readSince on a schedule and stores the rows; the app falls back to running it directly
 * when no Convex deployment is configured.
 *
 * Sources: Played (player, machine, boxes, paid) and RoundSettled (one per pack: machine, tier, value). Both are
 * emitted on Solana; the rollup only holds rounds while they are being played.
 */
import { PublicKey, type Connection } from "@solana/web3.js";
import { eventsFromLogs, programId } from "./program";
import { tierName, toUsdc } from "./client";

export type PullRecord = { id: string; roundId: string; machineId: number; player: string; tier: number; tierName: string; valueUsdc: number; slot: number; signature: string };
export type PlayRecord = { id: string; player: string; machineId: number; boxes: number; paidUsdc: number; slot: number };

/**
 * Program transactions newer than `until` (a signature; null = from the start), oldest first, at most `max`.
 * Returns the newest signature read, the cursor for the next call.
 */
export async function readSince(conn: Connection, until: string | null, max = 400): Promise<{ plays: PlayRecord[]; pulls: PullRecord[]; cursor: string | null }> {
  const sigs: { signature: string; slot: number }[] = [];
  let before: string | undefined;
  while (sigs.length < max) {
    const page = await conn.getSignaturesForAddress(programId(), { before, until: until ?? undefined, limit: 100 }, "confirmed");
    sigs.push(...page.filter((s) => !s.err).map((s) => ({ signature: s.signature, slot: s.slot })));
    if (page.length < 100) break;
    before = page[page.length - 1]!.signature;
  }
  // getSignaturesForAddress pages newest first; take the oldest `max` so the cursor never skips anything.
  const batch = sigs.reverse().slice(0, max);
  const plays: PlayRecord[] = [];
  const pulls: PullRecord[] = [];
  for (let i = 0; i < batch.length; i += 25) {
    const chunk = batch.slice(i, i + 25);
    const txs = await conn.getTransactions(
      chunk.map((s) => s.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
    txs.forEach((tx, j) => {
      const { signature, slot } = chunk[j]!;
      eventsFromLogs(tx?.meta?.logMessages).forEach((e, k) => {
        if (e.kind === "Played") {
          plays.push({ id: `${signature}-${k}`, player: e.player.toBase58(), machineId: e.machineId, boxes: e.boxes, paidUsdc: toUsdc(e.paid), slot });
        } else if (e.kind === "RoundSettled" && !e.void) {
          const player = e.player.toBase58();
          pulls.push({ id: `${player}-${e.roundId}`, roundId: `${e.roundId}`, machineId: e.machineId, player, tier: e.tier, tierName: tierName(e.machineId, e.tier), valueUsdc: toUsdc(e.value), slot, signature });
        }
      });
    });
  }
  return { plays, pulls, cursor: batch.length ? batch[batch.length - 1]!.signature : until };
}

export type PlayerRow = { player: string; totalUsdc: number; packs: number; spentUsdc: number; best: number };
export type Leaderboard = { players: PlayerRow[]; biggest: PullRecord[]; byMachine: Record<number, PullRecord[]>; updatedSlot: number };

/** Top players by total value pulled, the biggest single pulls, and the biggest per machine. */
export function aggregate(plays: PlayRecord[], pulls: PullRecord[], limit = 20): Leaderboard {
  const rows = new Map<string, PlayerRow>();
  const row = (p: string) => {
    let r = rows.get(p);
    if (!r) rows.set(p, (r = { player: p, totalUsdc: 0, packs: 0, spentUsdc: 0, best: 0 }));
    return r;
  };
  for (const x of pulls) {
    const r = row(x.player);
    r.totalUsdc += x.valueUsdc;
    r.packs += 1;
    r.best = Math.max(r.best, x.valueUsdc);
  }
  for (const x of plays) row(x.player).spentUsdc += x.paidUsdc;
  const byValue = [...pulls].sort((a, b) => b.valueUsdc - a.valueUsdc || a.slot - b.slot);
  const byMachine: Record<number, PullRecord[]> = {};
  for (const x of byValue) {
    const list = (byMachine[x.machineId] ??= []);
    if (list.length < limit) list.push(x);
  }
  const updatedSlot = Math.max(0, ...pulls.map((p) => p.slot), ...plays.map((p) => p.slot));
  return {
    players: [...rows.values()].filter((r) => r.packs > 0).sort((a, b) => b.totalUsdc - a.totalUsdc).slice(0, limit),
    biggest: byValue.slice(0, limit),
    byMachine,
    updatedSlot,
  };
}

/** A base58 Solana address (any 32 byte key, on or off curve). */
export const isAddress = (s: string) => {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    return new PublicKey(s).toBytes().length === 32;
  } catch {
    return false;
  }
};
