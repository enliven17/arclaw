"use node";
/**
 * The keeper on Convex crons (convex/crons.ts): `reveal` every 10 seconds (fulfilled openings revealed within
 * seconds, and machines with a new wake request repriced if due), `tick` every minute (reveal, VRF retries, reprice
 * when due, health, alerts). `reprice` is for a manual run: npx convex run keeperRun:reprice '{"force":true}'.
 * Same code as the CLI (lib/keeper), storage in convex/keeperState.ts, the public wake and status in convex/keeper.ts
 * (a "use node" file can only hold actions).
 *
 * Env (npx convex env set ...): KEEPER_PRIVATE_KEY (hot key: gas only, operator + keeper roles), KEEPER_NETWORK,
 * KEEPER_RPC_URL, KEEPER_DEPLOYMENT_JSON (mainnet), KEEPER_PRICE_CHECK, ALERT_TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN.
 * Without KEEPER_PRIVATE_KEY every action is a no-op, so deployments without a keeper are unaffected.
 * The key is read inside lib/keeper/tx.ts only; nothing returned or logged here can contain it.
 */
import { internalActionGeneric, makeFunctionReference, type GenericActionCtx, type GenericDataModel } from "convex/server";
import { v } from "convex/values";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../lib/keeper/config";
import { emptyState, type KeeperEvent, type KeeperState, type KeeperStore } from "../lib/keeper/store";
import { tick as runTick, type TickMode } from "../lib/keeper/tick";
import { Sender, loadSigner, makeClients } from "../lib/keeper/tx";

const ref = {
  load: makeFunctionReference<"query", Record<string, never>, string | null>("keeperState:load"),
  save: makeFunctionReference<"mutation", { value: string }, null>("keeperState:save"),
  log: makeFunctionReference<"mutation", { events: KeeperEvent[] }, null>("keeperState:log"),
  acquire: makeFunctionReference<"mutation", { name: string; owner: string; ttlMs: number }, boolean>("keeperState:acquire"),
  release: makeFunctionReference<"mutation", { name: string; owner: string }, null>("keeperState:release"),
  wakes: makeFunctionReference<"query", Record<string, never>, Record<string, number>>("keeperState:wakes"),
};

function convexStore(ctx: GenericActionCtx<GenericDataModel>): KeeperStore {
  const owner = randomUUID();
  return {
    async load(): Promise<KeeperState> {
      const raw = await ctx.runQuery(ref.load, {});
      if (!raw) return emptyState();
      try {
        const s = JSON.parse(raw) as KeeperState;
        return s.version === 1 ? { ...emptyState(), ...s } : emptyState();
      } catch {
        return emptyState();
      }
    },
    save: async (s) => void (await ctx.runMutation(ref.save, { value: JSON.stringify(s) })),
    log: async (events) => {
      if (!events.length) return;
      // undefined fields are not valid Convex values
      await ctx.runMutation(ref.log, { events: events.map((e) => JSON.parse(JSON.stringify(e)) as KeeperEvent) });
    },
    acquire: (name, ttlMs) => ctx.runMutation(ref.acquire, { name, owner, ttlMs }),
    release: async (name) => void (await ctx.runMutation(ref.release, { name, owner })),
    wakes: () => ctx.runQuery(ref.wakes, {}),
  };
}

async function run(ctx: GenericActionCtx<GenericDataModel>, mode: TickMode, extra: { force?: boolean; only?: number[] } = {}) {
  if (!process.env.KEEPER_PRIVATE_KEY) return { disabled: true };
  const cfg = loadConfig(process.env);
  const signer = loadSigner(process.env);
  const { client, wallet } = makeClients(cfg, signer);
  const r = await runTick({ cfg, client, sender: new Sender(client, wallet, signer.address, cfg.dryRun), me: signer.address, store: convexStore(ctx) }, { mode, ...extra });
  // a summary only: counts and messages, never configuration
  return {
    ok: r.ok,
    skipped: r.skipped,
    revealed: r.revealed,
    retried: r.retried,
    repriced: r.repriced.filter((x) => x.done).map((x) => x.machineId),
    critical: r.health?.issues.filter((i) => i.severity === "critical").map((i) => i.key) ?? [],
    error: r.error,
  };
}

export const tick = internalActionGeneric({ args: {}, handler: (ctx) => run(ctx, "full") });
export const reveal = internalActionGeneric({ args: {}, handler: (ctx) => run(ctx, "reveal") });
export const reprice = internalActionGeneric({
  args: { force: v.optional(v.boolean()), machines: v.optional(v.array(v.number())) },
  handler: (ctx, { force, machines }) => run(ctx, "reprice", { force, only: machines }),
});
