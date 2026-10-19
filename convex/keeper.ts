/**
 * The keeper's public surface (default runtime; the signing actions are in convex/keeperRun.ts, "use node").
 *
 *   wake({ machineId })  a visitor opened a machine whose table is stale: ask the keeper to reprice it. Deduplicated
 *                        (one per machine per 60 s), machineId must be one of lib/machines.json, nothing else is taken.
 *                        The 10 s keeper loop picks it up, so the table is fresh about 10 to 20 s later. A wake also
 *                        counts as demand for 60 minutes (docs/OPERATIONS.md, reprice policy).
 *   status({ secret })   last tick, last reprice, health, alerts, recent events, and per machine whether its table is
 *                        fresh. Admin only (ADMIN_QUERY_SECRET, convex/admin.ts): health and events describe the
 *                        treasury and the keeper's errors. The app reads machine state from the chain instead.
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import machinesFile from "../lib/machines.json";
import { machineFreshness } from "../lib/keeper/status";
import type { MachineStatus } from "../lib/keeper/store";
import { adminSecretOk } from "./admin";

const MACHINE_IDS = new Set((machinesFile as { machines: { id: number }[] }).machines.map((m) => m.id));
const WAKE_DEDUP_MS = 60_000;

export const wake = mutationGeneric({
  args: { machineId: v.number() },
  handler: async (ctx, { machineId }) => {
    if (!Number.isInteger(machineId) || !MACHINE_IDS.has(machineId)) return { accepted: false, reason: "unknown machine" };
    const now = Date.now();
    const row = await ctx.db.query("keeperWakes").withIndex("by_machine", (q) => q.eq("machineId", machineId)).unique();
    if (row && now - row.at < WAKE_DEDUP_MS) return { accepted: false, reason: "already requested" };
    if (row) await ctx.db.patch(row._id, { at: now });
    else await ctx.db.insert("keeperWakes", { machineId, at: now });
    return { accepted: true, reason: null };
  },
});

type State = {
  lastTick?: unknown;
  lastReprice?: unknown;
  lastHealth?: { metrics?: { paused?: boolean; opensClosedUntil?: number | null } } | null;
  alerts?: unknown;
  failures?: number;
  machines?: Record<string, MachineStatus>;
};

export const status = queryGeneric({
  args: { secret: v.string(), events: v.optional(v.number()) },
  handler: async (ctx, { secret, events = 30 }) => {
    if (!adminSecretOk(secret)) throw new Error("not found");
    const raw = (await ctx.db.query("keeperKv").withIndex("by_key", (q) => q.eq("key", "state")).unique())?.value;
    const s = raw ? (JSON.parse(raw) as State) : null;
    const recent = await ctx.db.query("keeperEvents").withIndex("by_at").order("desc").take(Math.min(Math.max(events, 1), 100));
    const wakes: Record<string, number> = Object.fromEntries((await ctx.db.query("keeperWakes").take(100)).map((w) => [String(w.machineId), w.at]));
    const paused = s?.lastHealth?.metrics?.paused === true;
    // the miss breaker closes open() until 00:00 UTC without pausing
    const closedUntil = s?.lastHealth?.metrics?.opensClosedUntil ?? null;
    const opensClosed = closedUntil !== null && Date.now() / 1000 < closedUntil;
    // Date.now() is as of the last state write (Convex caches queries); staleAt lets the UI judge by itself
    const machines = machineFreshness([...MACHINE_IDS], s?.machines, wakes, paused || opensClosed, Math.floor(Date.now() / 1000), Date.now());
    return {
      lastTick: s?.lastTick ?? null,
      lastReprice: s?.lastReprice ?? {},
      health: s?.lastHealth ?? null,
      alerts: s?.alerts ?? {},
      failures: s?.failures ?? 0,
      paused,
      opensClosedUntil: opensClosed ? closedUntil : null,
      machines,
      events: recent.map(({ at, kind, level, message, tx }) => ({ at, kind, level, message, tx: tx ?? null })),
    };
  },
});
