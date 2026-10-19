/**
 * One keeper pass, the same for the CLI and the Convex crons:
 *
 *   lock      one lease ("signer") for everything that signs: two overlapping ticks never share a nonce stream
 *   unstick   a transaction of ours stuck in the mempool blocks new sends (replaced after 3 minutes)
 *   reveal    fulfilled openings, oldest first
 *   wake      (mode "reveal" only) machines with a new wake request: reprice now if due, then stop
 *   retry     expired VRF requests (one retry each), then a pauseIfVrfDown probe if opens keep failing
 *   demand    which machines anyone can use (demand.ts)
 *   reprice   machines with demand that are due (reprice.ts), or all of them when forced
 *   health    issues and metrics, then alerts (deduplicated) and the state save
 *
 * Errors: a failing step is logged and counted (three in a row raise keeper-failing); state is saved and the lock
 * released in every case, so a crashed or failed tick never wedges the next one (the lease also expires on its own).
 */
import type { Address, PublicClient } from "viem";
import { recentVrfActivity } from "./arclaw";
import { errorLine, notifierOf, reconcileAlerts, type Notify } from "./alert";
import type { KeeperConfig } from "./config";
import { assessHealth } from "./health";
import { probeVrf, retryOrReturn, reveal } from "./ops";
import { reprice, type RepriceOutcome } from "./reprice";
import { readDemand, type Demand } from "./demand";
import { readMarkets, readOpenings, type MarketsView } from "./state";
import { utcDay, type HealthReport, type Issue, type KeeperEvent, type KeeperState, type KeeperStore } from "./store";
import type { Sender } from "./tx";

export const LOCK = "signer";
export const LOCK_TTL_MS = 4 * 60_000;
/** No new transaction starts after this; with one 90 s receipt wait on top it stays inside LOCK_TTL_MS. */
export const TICK_BUDGET_MS = 120_000;

export type TickMode = "full" | "reveal" | "reprice" | "health";
export type TickOptions = { mode: TickMode; force?: boolean; only?: number[]; notify?: Notify | null };
export type TickResult = {
  ok: boolean;
  skipped: string | null;
  revealed: number;
  retried: number;
  repriced: RepriceOutcome[];
  health: HealthReport | null;
  events: KeeperEvent[];
  error: string | null;
};

/** What the status page needs per machine, from the latest read. */
function snapshotMachines(state: KeeperState, markets: MarketsView, maxTableAge: number, maxMoveBps: bigint, demand: ReadonlyMap<number, Demand> | null, now: number) {
  for (const m of markets.machines) {
    state.machines[String(m.id)] = {
      pricedAt: m.tableId === null ? 0 : m.pricedAt,
      maxTableAge,
      moveBps: m.maxMoveBps === null ? null : Number(m.maxMoveBps),
      maxMoveBps: Number(maxMoveBps),
      off: m.off,
      demand: demand?.get(m.id)?.demand ?? state.machines[String(m.id)]?.demand ?? false,
      readAt: now,
    };
  }
}

function addSpend(state: KeeperState, sender: Sender, now: number) {
  if (sender.spentWei === 0n) return;
  const day = utcDay(now);
  const prev = state.spend.day === day ? BigInt(state.spend.wei) : 0n;
  state.spend = { day, wei: String(prev + sender.spentWei) };
  sender.spentWei = 0n;
}

export type KeeperContext = { cfg: KeeperConfig; client: PublicClient; sender: Sender; me: Address; store: KeeperStore };

export async function tick(ctx: KeeperContext, opts: TickOptions): Promise<TickResult> {
  const { cfg, client, sender, me, store } = ctx;
  const result: TickResult = { ok: true, skipped: null, revealed: 0, retried: 0, repriced: [], health: null, events: [], error: null };
  const wall = () => Math.floor(Date.now() / 1000);
  const signs = opts.mode !== "health";
  // a dry run computes everything but persists nothing and messages nobody
  const persist = signs && !cfg.dryRun;
  const notifier = () => (cfg.dryRun ? null : opts.notify === undefined ? notifierOf(cfg) : opts.notify);
  if (signs && !(await store.acquire(LOCK, LOCK_TTL_MS))) return { ...result, skipped: "another tick holds the signer lock" };

  const deadline = Date.now() + TICK_BUDGET_MS;
  const state = await store.load();
  const issues: Issue[] = [];
  const ev = (e: KeeperEvent[]) => result.events.push(...e);
  let stuck: string | null = null;
  try {
    const open = await readOpenings(client, cfg, me, state);
    let canSend = true;
    if (signs) {
      const u = await sender.unstick(wall(), state.stuckSince);
      state.stuckSince = u.stuckSince;
      if (!u.clear) {
        canSend = false;
        stuck = u.note ?? "pending transaction";
        ev([{ at: open.g.now, kind: "stuck", level: "warn", message: stuck }]);
      }
    }
    if (canSend && (opts.mode === "full" || opts.mode === "reveal")) {
      const r = await reveal(cfg, sender, open.g, open.openings, state, deadline);
      result.revealed = r.done;
      ev(r.events);
      issues.push(...r.issues);
    }
    if (opts.mode === "reveal") {
      // a visitor woke a machine: reprice it within this 10 s cycle if it is due, without waiting for the full tick
      const wakes = await store.wakes();
      const fresh = Object.entries(wakes).filter(([id, at]) => at > (state.wakesHandled[id] ?? 0) && Date.now() - at < cfg.thresholds.wakeWindowSec * 1000);
      if (canSend && fresh.length) {
        const ids = fresh.map(([id]) => Number(id));
        const markets = await readMarkets(client, cfg, open.g);
        const demand = new Map<number, Demand>(ids.map((id) => [id, { demand: true, reasons: ["wake request"] }]));
        const r = await reprice({ client, cfg, sender, me, g: open.g, market: open.market, view: markets, state, demand, only: ids, deadline });
        result.repriced = r.results;
        ev(r.events);
        for (const [id, at] of fresh) state.wakesHandled[id] = at;
        ev([{ at: open.g.now, kind: "wake", level: "info", message: `wake for machine(s) ${ids.join(", ")}: ${r.results.filter((x) => x.done).length ? `repriced ${r.results.filter((x) => x.done).map((x) => x.machineId).join(", ")}` : "nothing due"}` }]);
        snapshotMachines(state, r.results.some((x) => x.done) && !cfg.dryRun ? await readMarkets(client, cfg, open.g) : markets, open.g.maxTableAge, open.g.maxPriceMoveBps, null, open.g.now);
      }
      addSpend(state, sender, open.g.now);
      state.lastTick = { at: open.g.now, ok: true, summary: `reveal: ${result.revealed}${fresh.length ? `, wake: ${fresh.map(([id]) => id).join(",")}` : ""}` };
      state.failures = 0;
      return result;
    }
    if (canSend && opts.mode === "full") {
      const r = await retryOrReturn(client, cfg, sender, open.g, open.openings, state, deadline);
      result.retried = r.done;
      ev(r.events);
      issues.push(...r.issues);
      const p = await probeVrf(cfg, sender, open.g, state, r.vrfSuspect ?? false);
      ev(p.events);
      issues.push(...p.issues);
    }
    let markets: MarketsView | null = null;
    try {
      markets = await readMarkets(client, cfg, open.g);
    } catch (e) {
      issues.push({ key: "read-markets", severity: "warn", message: `could not read tables or prices: ${errorLine(e)}` });
    }
    let demand: Map<number, Demand> | null = null;
    if (markets) {
      const wakes = await store.wakes();
      demand = await readDemand(client, cfg, state, open.g.block, new Map(markets.machines.map((m) => [m.id, m.boxesSold])), open.openings, wakes, open.g.now);
      // the full tick serves wakes too: mark them so the 10 s loop does not run them again
      for (const [id, at] of Object.entries(wakes)) if (at > (state.wakesHandled[id] ?? 0)) state.wakesHandled[id] = at;
    }
    if (canSend && markets && demand && (opts.mode === "full" || opts.mode === "reprice")) {
      const r = await reprice({ client, cfg, sender, me, g: open.g, market: open.market, view: markets, state, demand, force: opts.force, only: opts.only, deadline });
      result.repriced = r.results;
      ev(r.events);
      issues.push(...r.issues);
      // the health below should judge the tables as they are now
      if (r.results.some((x) => x.done) && !cfg.dryRun) markets = await readMarkets(client, cfg, open.g).catch(() => markets);
    }
    let vrf: { opened: number; rerequested: number } | null = null;
    try {
      vrf = await recentVrfActivity(client, cfg.deployment, open.g.block);
    } catch {
      // logs are a nice-to-have for the retry rate; RPCs that cap eth_getLogs just lose that metric
    }
    state.failures = 0;
    if (markets) snapshotMachines(state, markets, open.g.maxTableAge, open.g.maxPriceMoveBps, demand, open.g.now);
    addSpend(state, sender, open.g.now);
    const health = assessHealth({ cfg, me, open, markets, vrf, state, stuck, demand });
    // one issue per key, the most severe wins (reprice may know an oracle outage is urgent, health only sees it)
    const rank = { info: 0, warn: 1, critical: 2 } as const;
    const merged = new Map<string, Issue>();
    for (const i of [...health.issues, ...issues]) {
      const prev = merged.get(i.key);
      if (!prev || rank[i.severity] > rank[prev.severity]) merged.set(i.key, i);
    }
    health.issues = [...merged.values()];
    health.ok = !health.issues.some((i) => i.severity === "critical");
    result.health = health;
    state.lastHealth = health;
    // health mode is a read-only report: alerts and state belong to the tick that holds the lock
    if (signs) ev(await reconcileAlerts(cfg, state, health.issues, wall(), notifier()));
    const summary = `revealed ${result.revealed}, retried ${result.retried}, repriced ${result.repriced.filter((x) => x.done).length}/${result.repriced.length}, ${health.issues.filter((i) => i.severity !== "info").length} issue(s)`;
    state.lastTick = { at: open.g.now, ok: true, summary };
    return result;
  } catch (e) {
    const msg = errorLine(e, 300);
    state.failures++;
    addSpend(state, sender, wall());
    result.ok = false;
    result.error = msg;
    ev([{ at: wall(), kind: "tick-failed", level: "error", message: `${opts.mode} tick failed (${state.failures} in a row): ${msg}` }]);
    state.lastTick = { at: wall(), ok: false, summary: msg };
    if (state.failures >= 3) {
      try {
        ev(await reconcileAlerts(cfg, state, [{ key: "keeper-failing", severity: "critical", message: `${state.failures} ticks failed in a row, last: ${msg}` }, ...Object.entries(state.alerts).filter(([k]) => k !== "keeper-failing").map(([key, a]) => ({ key, severity: a.severity, message: a.message }))], wall(), notifier()));
      } catch {
        // alerting must never mask the original failure
      }
    }
    return result;
  } finally {
    try {
      if (persist) await store.save(state);
      if (signs) await store.log(result.events);
    } finally {
      if (signs) await store.release(LOCK);
    }
  }
}
