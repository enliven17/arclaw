/**
 * Repricing: decide which machines need a fresh table, check the prices twice, build the table exactly as
 * Deploy.s.sol would (table.ts), validate it against the on-chain rules, simulate, send. Fails closed: any doubt
 * (oracle down, second source stale or off by more than 1%, rules drift between machines.json and the chain, a table
 * that would not validate, the keeper not being the operator) skips the reprice and raises an issue.
 *
 * Spend policy (a reprice of all three machines costs about 0.2 USDC; the project must not drain itself idle):
 *   only machines that are switched on, of a contract that is not paused and whose opens are not closed by the VRF
 *   miss breaker (VrfMisses until 00:00 UTC)
 *   only machines with demand (demand.ts: sealed boxes, an opening in flight, a play in 24 h, a wake in 60 min)
 *   and then only when (repriceReason):
 *     no-table   it has no table
 *     moved      a card token moved >= 2% from the table's reference (opens refuse past 5%; the floor tier sits 5.3%
 *                over the floor), at any hour the oracle answers
 *     stale      the table is past maxTableAge (opens refused right now)
 *     aged       the table is older than refreshAgeSec (18 h, before the 24 h expiry)
 *   forced       operator asked (CLI `keeper reprice --force`, keeperRun:reprice): ignores demand and the cap
 * At most maxRepricesPerDay (6) per machine per UTC day; past that the machine is skipped and reprice-cap:N alerts.
 * No demand: the table is allowed to go stale and nothing is spent. A visitor's wake request brings it back.
 */
import type { Address, PublicClient } from "viem";
import { calls, type Globals } from "./arclaw";
import { tokensOf, type KeeperConfig } from "./config";
import type { Demand } from "./demand";
import type { MarketClock } from "./market";
import { checkSecondSource } from "./prices";
import type { MarketsView, MachineView } from "./state";
import { utcDay, type Issue, type KeeperEvent, type KeeperState } from "./store";
import { MACHINES_FILE, SYMBOLS, buildTable, checkRules, validate } from "./table";
import type { Sender } from "./tx";

export type RepriceReason = "no-table" | "stale" | "aged" | "moved" | "forced";

/** The age at which a machine with demand is refreshed: refreshAgeSec, or 3/4 of a shorter maxTableAge. */
export const refreshAge = (maxTableAge: number, t: KeeperConfig["thresholds"]) => Math.min(t.refreshAgeSec, Math.floor((maxTableAge * 3) / 4));

export function repriceReason(
  m: { tableId: bigint | null; pricedAt: number; maxMoveBps: bigint | null; off: boolean },
  demand: boolean,
  now: number,
  maxTableAge: number,
  t: KeeperConfig["thresholds"],
  force = false,
): RepriceReason | null {
  if (force) return "forced";
  if (m.off || !demand) return null;
  if (m.tableId === null) return "no-table";
  // a move is never thrash: a table set moments ago at current prices does not read as moved
  if (m.maxMoveBps !== null && m.maxMoveBps >= t.moveTriggerBps) return "moved";
  const age = now - m.pricedAt;
  if (age < t.minRepriceIntervalSec) return null;
  if (age > maxTableAge) return "stale";
  if (age >= refreshAge(maxTableAge, t)) return "aged";
  return null;
}

/** Reprices of a machine so far on the chain's current UTC day. */
export function repricesToday(state: KeeperState, machineId: number, now: number): number {
  return state.repriceDay.day === utcDay(now) ? (state.repriceDay.counts[String(machineId)] ?? 0) : 0;
}

export function countReprice(state: KeeperState, machineId: number, now: number) {
  const day = utcDay(now);
  if (state.repriceDay.day !== day) state.repriceDay = { day, counts: {} };
  state.repriceDay.counts[String(machineId)] = (state.repriceDay.counts[String(machineId)] ?? 0) + 1;
}

export type RepriceOutcome = { machineId: number; reason: RepriceReason; done: boolean; note: string; tx: string | null };

const pct = (bps: bigint) => `${(Number(bps) / 100).toFixed(2)}%`;

export async function reprice(args: {
  client: PublicClient;
  cfg: KeeperConfig;
  sender: Sender;
  me: Address;
  g: Globals;
  market: MarketClock;
  view: MarketsView;
  state: KeeperState;
  demand: ReadonlyMap<number, Demand>;
  force?: boolean;
  only?: number[];
  /** Date.now() past which no new transaction is started (the tick budget). */
  deadline?: number;
}): Promise<{ results: RepriceOutcome[]; issues: Issue[]; events: KeeperEvent[] }> {
  const { cfg, sender, me, g, market, view, state } = args;
  const results: RepriceOutcome[] = [];
  const issues: Issue[] = [];
  const events: KeeperEvent[] = [];
  // nothing can open (paused, or the miss breaker closed opens until 00:00 UTC): no table is worth paying for
  if ((g.paused || g.missCapped) && !args.force) return { results, issues, events };
  const cap = cfg.thresholds.maxRepricesPerDay;
  const due = view.machines
    .filter((m) => !args.only || args.only.includes(m.id))
    .map((m) => ({ m, reason: repriceReason(m, args.demand.get(m.id)?.demand ?? false, g.now, g.maxTableAge, cfg.thresholds, args.force) }))
    .filter((x): x is { m: MachineView; reason: RepriceReason } => x.reason !== null)
    .filter(({ m, reason }) => {
      const n = repricesToday(state, m.id, g.now);
      if (reason === "forced" || n < cap) return true;
      const msg = `machine ${m.id}: daily reprice cap reached (${n}/${cap} today), ${reason} reprice skipped until 00:00 UTC`;
      issues.push({ key: `reprice-cap:${m.id}`, severity: "warn", message: msg });
      results.push({ machineId: m.id, reason, done: false, note: "daily cap reached", tx: null });
      events.push({ at: g.now, kind: "reprice-capped", level: "warn", message: msg });
      return false;
    });
  if (!due.length) return { results, issues, events };

  const urgent = due.some((x) => x.reason === "stale" || x.reason === "moved" || x.reason === "no-table");
  const sev = market.open && urgent ? "critical" : "warn";
  const skipAll = (key: string, message: string, severity: Issue["severity"] = sev) => {
    issues.push({ key, severity, message });
    for (const { m, reason } of due) results.push({ machineId: m.id, reason, done: false, note: message, tx: null });
    events.push({ at: g.now, kind: "reprice-skipped", level: severity === "critical" ? "error" : "warn", message, data: { machines: due.map((x) => `${x.m.id}:${x.reason}`).join(",") } });
    return { results, issues, events };
  };

  // 1. the oracle must answer for every token
  if (view.oracleErrors.length) {
    const closed = !market.open && !urgent;
    return skipAll("oracle", `oracle unavailable (${view.oracleErrors.join("; ")}), no reprice${closed ? " (market closed)" : ""}`, closed ? "info" : sev);
  }
  // 2. and agree with the second source
  const second = await checkSecondSource(cfg.priceCheck, view.bySymbol);
  if (!second.ok) return skipAll("price-check", `${second.reason}; reprice skipped`);
  // 3. only the operator may reprice
  if (g.operator.toLowerCase() !== me.toLowerCase()) return skipAll("not-operator", `keeper ${me} is not the operator (${g.operator}); cannot reprice`, "critical");

  const toks = tokensOf(cfg.deployment);
  const px = SYMBOLS.map((s) => view.bySymbol.get(s)!);
  const priceOfTok = (t: string) => {
    const r = view.oracle.get(t.toLowerCase());
    return r?.ok ? r.price : 0n;
  };
  const decOf = (t: string) => view.decimals.get(t.toLowerCase()) ?? 18;

  for (const { m, reason } of due) {
    if (args.deadline && Date.now() > args.deadline) {
      results.push({ machineId: m.id, reason, done: false, note: "tick budget spent, next tick", tx: null });
      continue;
    }
    const cfgM = MACHINES_FILE.machines.find((x) => x.id === m.id);
    const fail = (key: string, note: string, severity: Issue["severity"] = "critical") => {
      issues.push({ key: `${key}:${m.id}`, severity, message: `machine ${m.id}: ${note}` });
      results.push({ machineId: m.id, reason, done: false, note, tx: null });
      events.push({ at: g.now, kind: "reprice-failed", level: severity === "critical" ? "error" : "warn", message: `machine ${m.id} (${reason}): ${note}` });
    };
    if (!cfgM) {
      fail("rules", "not in lib/machines.json");
      continue;
    }
    const floor = MACHINES_FILE.policy.floorBps;
    try {
      checkRules(cfgM, floor);
    } catch (e) {
      fail("rules", `machines.json: ${(e as Error).message}`);
      continue;
    }
    const r = m.rules;
    if (r.price !== BigInt(cfgM.priceUsdc) * 10n ** 18n || r.floorBps !== floor || r.capBps !== cfgM.capBps || r.rtpMinBps !== cfgM.rtpMinBps || r.rtpMaxBps !== cfgM.rtpMaxBps) {
      fail("rules", `machines.json rules differ from the chain (chain floor ${r.floorBps} cap ${r.capBps} rtp ${r.rtpMinBps}..${r.rtpMaxBps}); fix one of them first`);
      continue;
    }
    const table = buildTable(cfgM, floor, toks, px);
    const check = validate(table, r, priceOfTok, decOf, g.maxBoostBps);
    if (!check.ok) {
      fail("table-invalid", `built table would revert: ${check.reason}`);
      continue;
    }
    const sent = await sender.send(calls.setPrizes(cfg.deployment, m.id, table));
    if (!sent.ok) {
      fail("reprice-tx", `operatorSetPrizes failed: ${sent.error}`, sent.reverted ? "critical" : "warn");
      continue;
    }
    const tx = sent.dryRun ? null : sent.hash;
    const why = args.demand.get(m.id)?.reasons ?? [];
    const note = `${reason}, rtp ${pct(check.rtpBps)} (max boost ${pct(check.luckyRtpBps)}), packs ${pct(check.minBps)}..${pct(check.maxBps)}${m.maxMoveBps ? `, moved ${pct(m.maxMoveBps)} (${m.worstToken})` : ""}${second.skipped ? ", second source off" : `, second source within ${pct(second.worstBps)}`}${why.length ? `, demand: ${why.join(", ")}` : ""}`;
    results.push({ machineId: m.id, reason, done: true, note: sent.dryRun ? `dry run: ${note}` : note, tx });
    events.push({ at: g.now, kind: sent.dryRun ? "reprice-dry-run" : "repriced", level: "info", message: `machine ${m.id}: ${note}`, tx: tx ?? undefined, data: { machineId: m.id, reason } });
    if (!sent.dryRun) {
      state.lastReprice[String(m.id)] = { at: g.now, reason, tx, tableId: null };
      countReprice(state, m.id, g.now);
    }
  }
  return { results, issues, events };
}
