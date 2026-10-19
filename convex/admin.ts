/**
 * Totals for the admin panel (app/app/admin), from the indexer's tables: players, plays, boxes, USDC in and out, per
 * machine and per tier, plus the latest plays and pulls. Public like the leaderboard: every number here is derived
 * from public contract events, so it guards nothing; the panel's sign-in (lib/admin.server.ts) is what is gated.
 */
import { queryGeneric } from "convex/server";

export const overview = queryGeneric({
  args: {},
  handler: async (ctx) => {
    // ponytail: full scans, fine to a few thousand rows; keep running totals in `ingest` when Convex's read limit nears
    const players = await ctx.db.query("players").collect();
    const plays = await ctx.db.query("plays").collect();
    const pulls = await ctx.db.query("pulls").collect();

    const machines: Record<number, { plays: number; boxes: number; inUsdc: number; packs: number; outUsdc: number }> = {};
    const m = (id: number) => (machines[id] ??= { plays: 0, boxes: 0, inUsdc: 0, packs: 0, outUsdc: 0 });
    for (const p of plays) {
      const x = m(p.machineId);
      x.plays += 1;
      x.boxes += p.boxes;
      x.inUsdc += p.paidUsdc;
    }
    const tiers: Record<string, number> = {};
    for (const p of pulls) {
      const x = m(p.machineId);
      x.packs += 1;
      x.outUsdc += p.valueUsdc;
      tiers[p.tierName] = (tiers[p.tierName] ?? 0) + 1;
    }

    const byBlock = <T extends { blockNumber: number }>(rows: T[]) => [...rows].sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 25);
    return {
      players: players.filter((p) => p.spentUsdc > 0 || p.packs > 0).length,
      plays: plays.length,
      boxes: plays.reduce((s, p) => s + p.boxes, 0),
      packs: pulls.length,
      inUsdc: plays.reduce((s, p) => s + p.paidUsdc, 0),
      outUsdc: pulls.reduce((s, p) => s + p.valueUsdc, 0),
      machines,
      tiers,
      topPlayers: [...players].sort((a, b) => b.spentUsdc - a.spentUsdc).slice(0, 15),
      recentPlays: byBlock(plays).map(({ id, player, machineId, boxes, paidUsdc, blockNumber }) => ({ id, player, machineId, boxes, paidUsdc, blockNumber })),
      recentPulls: byBlock(pulls).map(({ id, player, machineId, tierName, valueUsdc, blockNumber, txHash }) => ({ id, player, machineId, tierName, valueUsdc, blockNumber, txHash })),
      indexedBlock: (await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", "arclaw-cursor")).unique())?.block ?? 0,
    };
  },
});
