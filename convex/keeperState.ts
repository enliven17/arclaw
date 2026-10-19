/**
 * The keeper's storage in Convex (default runtime; the signing actions live in convex/keeper.ts, "use node"):
 *   keeperKv      one JSON document, key "state": scan cursor, retry backoff, alert dedupe, last tick/reprice/health
 *   keeperLocks   the signer lease: one tick at a time, expires on its own if an action dies
 *   keeperEvents  what the keeper did and saw (reveals, retries, reprices, alerts, failures), pruned after 14 days
 *   keeperWakes   one row per machine: the latest wake request (convex/keeper.ts wake)
 * The public wake and status live in convex/keeper.ts. Nothing here is secret: the key never leaves the action.
 */
import { internalMutationGeneric, internalQueryGeneric } from "convex/server";
import { v } from "convex/values";

const STATE = "state";
const KEEP_EVENTS_MS = 14 * 86_400_000;

export const load = internalQueryGeneric({
  args: {},
  handler: async (ctx) => (await ctx.db.query("keeperKv").withIndex("by_key", (q) => q.eq("key", STATE)).unique())?.value ?? null,
});

export const save = internalMutationGeneric({
  args: { value: v.string() },
  handler: async (ctx, { value }) => {
    const row = await ctx.db.query("keeperKv").withIndex("by_key", (q) => q.eq("key", STATE)).unique();
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("keeperKv", { key: STATE, value, updatedAt: Date.now() });
    return null;
  },
});

const dataV = v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null())));
const eventV = v.object({ at: v.number(), kind: v.string(), level: v.string(), message: v.string(), tx: v.optional(v.string()), data: dataV });

export const log = internalMutationGeneric({
  args: { events: v.array(eventV) },
  handler: async (ctx, { events }) => {
    for (const e of events.slice(0, 200)) await ctx.db.insert("keeperEvents", e);
    return null;
  },
});

/** Mutations are serialisable: two actions racing for the lease cannot both get it. */
export const acquire = internalMutationGeneric({
  args: { name: v.string(), owner: v.string(), ttlMs: v.number() },
  handler: async (ctx, { name, owner, ttlMs }) => {
    const now = Date.now();
    const row = await ctx.db.query("keeperLocks").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (row && row.until > now && row.owner !== owner) return false;
    if (row) await ctx.db.patch(row._id, { owner, until: now + ttlMs });
    else await ctx.db.insert("keeperLocks", { name, owner, until: now + ttlMs });
    return true;
  },
});

export const release = internalMutationGeneric({
  args: { name: v.string(), owner: v.string() },
  handler: async (ctx, { name, owner }) => {
    const row = await ctx.db.query("keeperLocks").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (row && row.owner === owner) await ctx.db.delete(row._id);
    return null;
  },
});

export const prune = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("keeperEvents").withIndex("by_at", (q) => q.lt("at", Math.floor((Date.now() - KEEP_EVENTS_MS) / 1000))).take(500);
    for (const e of old) await ctx.db.delete(e._id);
    return old.length;
  },
});

/** Latest wake request per machine (wall-clock ms), written by keeper:wake. */
export const wakes = internalQueryGeneric({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("keeperWakes").take(100);
    return Object.fromEntries(rows.map((r) => [String(r.machineId), r.at]));
  },
});
