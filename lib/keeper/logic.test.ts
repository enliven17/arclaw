/**
 * Pure keeper logic: the market clock, when a machine is due for a reprice (demand, age, move, daily cap), the
 * status page freshness, the second-source check and alert dedupe.
 * Run: pnpm keeper:test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { usMarket } from "./market";
import { countReprice, repriceReason, repricesToday } from "./reprice";
import { demandOf, emptyDemandLog } from "./demand";
import { machineFreshness } from "./status";
import type { OpenOpening } from "./state";
import { checkSecondSource } from "./prices";
import { RESOLVE_QUIET_S, reconcileAlerts } from "./alert";
import { emptyState } from "./store";
import { loadConfig } from "./config";

const cfg = loadConfig({ KEEPER_NETWORK: "testnet" });
const T = cfg.thresholds;
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

test("US market clock: hours, weekends, holidays, DST", () => {
  assert.equal(usMarket(at("2026-10-19T13:29:00Z")).open, false); // Mon 09:29 EDT
  const mon = usMarket(at("2026-10-19T13:30:00Z"));
  assert.equal(mon.open, true);
  assert.equal(mon.openedAt, at("2026-10-19T13:30:00Z"));
  assert.equal(usMarket(at("2026-10-19T20:00:00Z")).open, false); // 16:00 EDT
  assert.equal(usMarket(at("2026-10-18T15:00:00Z")).open, false); // Sunday
  assert.equal(usMarket(at("2026-11-26T15:00:00Z")).open, false); // Thanksgiving
  assert.equal(usMarket(at("2026-12-01T14:30:00Z")).open, true); // 09:30 EST (UTC-5)
  assert.equal(usMarket(at("2026-12-01T14:29:00Z")).open, false);
  assert.equal(usMarket(at("2026-10-18T15:00:00Z"), "open").open, true);
  assert.equal(usMarket(at("2026-10-19T15:00:00Z"), "closed").open, false);
});

const now = at("2026-10-19T15:00:00Z");
const day = 86400;
const m = (o: Partial<{ tableId: bigint | null; pricedAt: number; maxMoveBps: bigint | null; off: boolean }>) => ({ tableId: 0n, pricedAt: now - 600, maxMoveBps: 0n, off: false, ...o });

test("repriceReason: demand first, then 18 h age or a 2% move, never otherwise", () => {
  // with demand
  assert.equal(repriceReason(m({ tableId: null }), true, now, day, T), "no-table");
  assert.equal(repriceReason(m({ pricedAt: now - day - 1 }), true, now, day, T), "stale");
  assert.equal(repriceReason(m({ pricedAt: now - 18 * 3600 }), true, now, day, T), "aged");
  assert.equal(repriceReason(m({ pricedAt: now - 18 * 3600 + 1 }), true, now, day, T), null);
  assert.equal(repriceReason(m({ maxMoveBps: 200n }), true, now, day, T), "moved");
  assert.equal(repriceReason(m({ maxMoveBps: 199n, pricedAt: now - 17 * 3600 }), true, now, day, T), null, "no hourly reprices");
  assert.equal(repriceReason(m({ pricedAt: now - 30, maxMoveBps: 400n }), true, now, day, T), "moved", "a move bypasses the min interval");
  // a shorter maxTableAge pulls the refresh age to 3/4 of it
  assert.equal(repriceReason(m({ pricedAt: now - 3 * 3600 }), true, now, 4 * 3600, T), "aged");
  // no demand, or switched off: nothing, whatever the table looks like
  for (const x of [m({ tableId: null }), m({ pricedAt: now - 2 * day }), m({ maxMoveBps: 900n })]) assert.equal(repriceReason(x, false, now, day, T), null);
  assert.equal(repriceReason(m({ off: true, pricedAt: now - 2 * day, maxMoveBps: 900n }), true, now, day, T), null);
  // forced ignores all of it
  assert.equal(repriceReason(m({ off: true }), false, now, day, T, true), "forced");
});

const op = (machineId: number) => ({ machineId }) as unknown as OpenOpening;

test("demandOf: sealed boxes, openings, plays in 24 h, wakes in 60 min", () => {
  const log = { ...emptyDemandLog(), cursor: "1", opened: { "1": 5 }, returned: { "1": 1 }, refunded: { "1": 1 }, lastPlayAt: { "2": now - 23 * 3600, "3": now - 25 * 3600 } };
  const wall = Date.now();
  // machine 1: sold 5, opened 5, returned 1, refunded 1 => 0 sealed
  assert.equal(demandOf(1, 5n, log, true, [], {}, now, wall, T).demand, false);
  assert.match(demandOf(1, 6n, log, true, [], {}, now, wall, T).reasons.join(), /1 sealed/);
  assert.match(demandOf(1, 5n, log, true, [op(1)], {}, now, wall, T).reasons.join(), /opening/);
  assert.match(demandOf(2, 0n, log, true, [], {}, now, wall, T).reasons.join(), /played/);
  assert.equal(demandOf(3, 0n, log, true, [], {}, now, wall, T).demand, false, "a play 25 h ago is no demand");
  assert.equal(demandOf(3, 0n, log, true, [], { "3": wall - 59 * 60_000 }, now, wall, T).demand, true);
  assert.equal(demandOf(3, 0n, log, true, [], { "3": wall - 61 * 60_000 }, now, wall, T).demand, false);
  // log not caught up yet: anything that ever sold counts, nothing else does
  assert.equal(demandOf(3, 1n, log, false, [], {}, now, wall, T).demand, true);
  assert.equal(demandOf(3, 0n, log, false, [], {}, now, wall, T).demand, false);
});

test("daily reprice cap counts per machine per UTC day", () => {
  const st = emptyState();
  const t0 = at("2026-10-19T23:00:00Z");
  for (let i = 0; i < 6; i++) countReprice(st, 1, t0);
  countReprice(st, 2, t0);
  assert.equal(repricesToday(st, 1, t0), 6);
  assert.equal(repricesToday(st, 2, t0), 1);
  assert.equal(repricesToday(st, 1, t0 + 3600), 0, "a new UTC day starts at 0");
  assert.equal(T.maxRepricesPerDay, 6);
  assert.equal(loadConfig({ KEEPER_NETWORK: "testnet", KEEPER_MAX_REPRICES_PER_DAY: "2" }).thresholds.maxRepricesPerDay, 2);
});

test("machineFreshness: fresh, stale, moved, off, paused, waking", () => {
  const base = { pricedAt: now - 3600, maxTableAge: day, moveBps: 10, maxMoveBps: 500, off: false, demand: true, readAt: now };
  const wall = now * 1000;
  const r = machineFreshness([1, 2, 3, 4, 5], { "1": base, "2": { ...base, pricedAt: now - day - 1 }, "3": { ...base, moveBps: 501 }, "4": { ...base, off: true } }, { "2": wall - 1000 }, false, now, wall);
  assert.deepEqual(r.map((x) => x.fresh), [true, false, false, false, false]);
  assert.equal(r[1]!.waking, true);
  assert.equal(r[0]!.waking, false);
  assert.equal(machineFreshness([1], { "1": base }, {}, true, now)[0]!.openable, false, "paused is not openable");
});

const feed = (quotes: unknown) => (async () => new Response(JSON.stringify({ quotes }), { status: 200 })) as unknown as typeof fetch;
const pc = { mode: "feed" as const, url: "http://x", maxDiffBps: 100n, maxAgeSec: 900 };

test("second source: agree, disagree, stale, missing, halted, down", async () => {
  const oracle = new Map([["NVDA", 200_000000n]]);
  const fresh = new Date().toISOString();
  assert.equal((await checkSecondSource(pc, oracle, Date.now(), feed([{ symbol: "NVDA", mid: 201.9, generatedAt: fresh }]))).ok, true);
  const off = await checkSecondSource(pc, oracle, Date.now(), feed([{ symbol: "NVDA", mid: 202.2, generatedAt: fresh }]));
  assert.equal(off.ok, false);
  const stale = await checkSecondSource(pc, oracle, Date.now(), feed([{ symbol: "NVDA", mid: 200, generatedAt: new Date(Date.now() - 3600_000).toISOString() }]));
  assert.ok(!stale.ok && /stale/.test(stale.reason));
  assert.equal((await checkSecondSource(pc, oracle, Date.now(), feed([]))).ok, false);
  assert.equal((await checkSecondSource(pc, oracle, Date.now(), feed([{ symbol: "NVDA", mid: 200, halted: true }]))).ok, false);
  const down = (async () => new Response("no", { status: 502 })) as unknown as typeof fetch;
  assert.equal((await checkSecondSource(pc, oracle, Date.now(), down)).ok, false);
  assert.equal((await checkSecondSource({ mode: "off" }, oracle)).ok, true);
});

test("alerts: sent once, re-sent on escalation or after the repeat window, resolved once", async () => {
  const sent: string[] = [];
  const notify = async (t: string) => void sent.push(t);
  const st = emptyState();
  const t0 = 1_000_000;
  await reconcileAlerts(cfg, st, [{ key: "gas", severity: "warn", message: "low" }], t0, notify);
  await reconcileAlerts(cfg, st, [{ key: "gas", severity: "warn", message: "low" }], t0 + 60, notify);
  assert.equal(sent.length, 1);
  await reconcileAlerts(cfg, st, [{ key: "gas", severity: "critical", message: "very low" }], t0 + 120, notify);
  assert.equal(sent.length, 2);
  await reconcileAlerts(cfg, st, [{ key: "gas", severity: "critical", message: "very low" }], t0 + 120 + 3600, notify);
  assert.equal(sent.length, 3);
  await reconcileAlerts(cfg, st, [{ key: "oracle", severity: "info", message: "closed" }], t0 + 4000, notify);
  assert.equal(sent.length, 3, "not resolved until it has been quiet for RESOLVE_QUIET_S");
  await reconcileAlerts(cfg, st, [], t0 + 120 + 3600 + RESOLVE_QUIET_S, notify);
  assert.equal(sent.length, 4);
  assert.match(sent[3]!, /RESOLVED/);
  assert.deepEqual(Object.keys(st.alerts), []);
  // a flapping issue (there one tick, gone the next) is one alert, no resolves in between
  const flap: string[] = [];
  const st3 = emptyState();
  for (let i = 0; i < 20; i++) {
    await reconcileAlerts(cfg, st3, i % 2 ? [] : [{ key: "rpc", severity: "warn", message: "limit" }], t0 + i * 120, async (t) => void flap.push(t));
  }
  assert.equal(flap.length, 1);
  // a failing channel keeps the alert pending
  const st2 = emptyState();
  await reconcileAlerts(cfg, st2, [{ key: "paused", severity: "critical", message: "x" }], t0, async () => {
    throw new Error("down");
  });
  assert.equal(st2.alerts.paused?.lastSentAt, 0);
});
