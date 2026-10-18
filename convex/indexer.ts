/**
 * The leaderboard indexer, in one module. A cron (convex/crons.ts) runs `sync` every minute: it reads the arclaw
 * contract's logs from the cursor forward (a few 10k-block windows per run), decodes Played, OutcomeDrawn and
 * CardDrawn with lib/arclaw/events.ts, and hands the rows to `ingest`, which inserts each pull and play once (keyed,
 * so re-reading a range is harmless) and keeps per-player totals. `leaderboard` is what the app reads.
 *
 * Contract events are being extended; decoding lives in lib/arclaw/contract.ts (current and deployed shapes), so a
 * new field lands there, not here. Written against convex/server directly, so it needs no codegen.
 */
import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, makeFunctionReference, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { arcClient } from "../lib/arc/chain";
import { ARC } from "../lib/arc/config";
import { LOG_SPAN } from "../lib/arclaw/contract";
import { readRange, type PlayRecord, type PullRecord } from "../lib/arclaw/events";

const CURSOR = "arclaw-cursor";
const WINDOWS_PER_RUN = 6n;

const cursorRef = makeFunctionReference<"query", Record<string, never>, number | null>("indexer:cursor");
const ingestRef = makeFunctionReference<"mutation", { plays: PlayRecord[]; pulls: PullRecord[]; block: number }, null>("indexer:ingest");

export const cursor = internalQueryGeneric({
  args: {},
  handler: async (ctx) => (await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", CURSOR)).unique())?.block ?? null,
});

const pullV = v.object({
  id: v.string(),
  openingId: v.string(),
  boxIndex: v.number(),
  machineId: v.number(),
  player: v.string(),
  tier: v.number(),
  tierName: v.string(),
  valueUsdc: v.number(),
  blockNumber: v.number(),
  txHash: v.string(),
});
const playV = v.object({ id: v.string(), player: v.string(), machineId: v.number(), boxes: v.number(), paidUsdc: v.number(), blockNumber: v.number() });

export const ingest = internalMutationGeneric({
  args: { plays: v.array(playV), pulls: v.array(pullV), block: v.number() },
  handler: async (ctx, { plays, pulls, block }) => {
    const player = async (address: string) => {
      const p = address.toLowerCase();
      const row = await ctx.db.query("players").withIndex("by_player", (q) => q.eq("player", p)).unique();
      if (row) return row;
      const id = await ctx.db.insert("players", { player: p, totalUsdc: 0, packs: 0, spentUsdc: 0, best: 0 });
      return (await ctx.db.get(id))!;
    };
    for (const x of pulls) {
      if (await ctx.db.query("pulls").withIndex("by_pull", (q) => q.eq("id", x.id)).unique()) continue;
      await ctx.db.insert("pulls", { ...x, player: x.player.toLowerCase() });
      const r = await player(x.player);
      await ctx.db.patch(r._id, { totalUsdc: r.totalUsdc + x.valueUsdc, packs: r.packs + 1, best: Math.max(r.best, x.valueUsdc) });
    }
    for (const x of plays) {
      if (await ctx.db.query("plays").withIndex("by_play", (q) => q.eq("id", x.id)).unique()) continue;
      await ctx.db.insert("plays", { ...x, player: x.player.toLowerCase() });
      const r = await player(x.player);
      await ctx.db.patch(r._id, { spentUsdc: r.spentUsdc + x.paidUsdc });
    }
    const meta = await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", CURSOR)).unique();
    if (meta) await ctx.db.patch(meta._id, { block });
    else await ctx.db.insert("meta", { key: CURSOR, block });
    return null;
  },
});

export const sync = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    const c = ARC.contracts;
    if (!c) return null;
    const client = arcClient();
    const last = await ctx.runQuery(cursorRef, {});
    const from = last === null ? c.deployBlock : BigInt(last) + 1n;
    const head = await client.getBlockNumber();
    if (from > head) return null;
    const to = from + LOG_SPAN * WINDOWS_PER_RUN - 1n < head ? from + LOG_SPAN * WINDOWS_PER_RUN - 1n : head;
    const { plays, pulls } = await readRange(client, from, to);
    await ctx.runMutation(ingestRef, { plays, pulls, block: Number(to) });
    return null;
  },
});

/** The leaderboard the app reads: top players by value pulled, the biggest pulls, the biggest per machine. */
export const leaderboard = queryGeneric({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // Public query: the page size is capped here, whatever the caller asks for.
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 50);
    const players = await ctx.db.query("players").withIndex("by_total").order("desc").take(limit);
    const biggest = await ctx.db.query("pulls").withIndex("by_value").order("desc").take(limit);
    const byMachine: Record<number, unknown[]> = {};
    for (const m of [1, 2, 3]) byMachine[m] = await ctx.db.query("pulls").withIndex("by_machine_value", (q) => q.eq("machineId", m)).order("desc").take(10);
    const updatedBlock = (await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", CURSOR)).unique())?.block ?? 0;
    return { players: players.filter((p) => p.packs > 0), biggest, byMachine, updatedBlock };
  },
});
