/**
 * The leaderboard indexer. A cron (convex/crons.ts) runs `sync` every minute: it reads the arclaw program's
 * transactions on Solana after the cursor (lib/solana/events.ts), and hands the rows to `ingest`, which inserts each
 * pull and play once (keyed, so re-reading is harmless) and keeps per-player totals. `leaderboard` is what the app
 * reads. Written against convex/server directly, so it needs no codegen.
 */
import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, makeFunctionReference, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { baseConnection } from "../lib/solana/client";
import { SOLANA } from "../lib/solana/config";
import { readSince, type PlayRecord, type PullRecord } from "../lib/solana/events";

const CURSOR = "arclaw-cursor";

const cursorRef = makeFunctionReference<"query", Record<string, never>, string | null>("indexer:cursor");
const ingestRef = makeFunctionReference<"mutation", { plays: PlayRecord[]; pulls: PullRecord[]; cursor: string | null }, null>("indexer:ingest");

export const cursor = internalQueryGeneric({
  args: {},
  handler: async (ctx) => (await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", CURSOR)).unique())?.cursor ?? null,
});

const pullV = v.object({
  id: v.string(),
  roundId: v.string(),
  machineId: v.number(),
  player: v.string(),
  tier: v.number(),
  tierName: v.string(),
  valueUsdc: v.number(),
  slot: v.number(),
  signature: v.string(),
});
const playV = v.object({ id: v.string(), player: v.string(), machineId: v.number(), boxes: v.number(), paidUsdc: v.number(), slot: v.number() });

export const ingest = internalMutationGeneric({
  args: { plays: v.array(playV), pulls: v.array(pullV), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { plays, pulls, cursor }) => {
    const player = async (p: string) => {
      const row = await ctx.db.query("players").withIndex("by_player", (q) => q.eq("player", p)).unique();
      if (row) return row;
      const id = await ctx.db.insert("players", { player: p, totalUsdc: 0, packs: 0, spentUsdc: 0, best: 0 });
      return (await ctx.db.get(id))!;
    };
    let slot = 0;
    for (const x of pulls) {
      slot = Math.max(slot, x.slot);
      if (await ctx.db.query("pulls").withIndex("by_pull", (q) => q.eq("id", x.id)).unique()) continue;
      await ctx.db.insert("pulls", x);
      const r = await player(x.player);
      await ctx.db.patch(r._id, { totalUsdc: r.totalUsdc + x.valueUsdc, packs: r.packs + 1, best: Math.max(r.best, x.valueUsdc) });
    }
    for (const x of plays) {
      slot = Math.max(slot, x.slot);
      if (await ctx.db.query("plays").withIndex("by_play", (q) => q.eq("id", x.id)).unique()) continue;
      await ctx.db.insert("plays", x);
      const r = await player(x.player);
      await ctx.db.patch(r._id, { spentUsdc: r.spentUsdc + x.paidUsdc });
    }
    const meta = await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", CURSOR)).unique();
    if (meta) await ctx.db.patch(meta._id, { cursor, slot: Math.max(slot, meta.slot) });
    else await ctx.db.insert("meta", { key: CURSOR, cursor, slot });
    return null;
  },
});

export const sync = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    if (!SOLANA.deployment) return null;
    const last = await ctx.runQuery(cursorRef, {});
    const { plays, pulls, cursor } = await readSince(baseConnection(), last, 300);
    if (cursor === last) return null;
    await ctx.runMutation(ingestRef, { plays, pulls, cursor });
    return null;
  },
});

/** The leaderboard the app reads: top players by value pulled, the biggest pulls, the biggest per machine. */
export const leaderboard = queryGeneric({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 50);
    const players = await ctx.db.query("players").withIndex("by_total").order("desc").take(limit);
    const biggest = await ctx.db.query("pulls").withIndex("by_value").order("desc").take(Math.min(limit, 8));
    const byMachine: Record<number, unknown[]> = {};
    for (const m of [1, 2, 3]) byMachine[m] = await ctx.db.query("pulls").withIndex("by_machine_value", (q) => q.eq("machineId", m)).order("desc").take(1);
    const updatedSlot = (await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", CURSOR)).unique())?.slot ?? 0;
    return { players: players.filter((p) => p.packs > 0), biggest, byMachine, updatedSlot };
  },
});
