/**
 * Health: what an operator needs to know, as issues (key, severity, message) plus metrics for a status page.
 * Pure: it only reads the views a tick already gathered. Every key is explained in docs/OPERATIONS.md.
 */
import { STATUS } from "./arclaw";
import type { KeeperConfig } from "./config";
import type { MarketClock } from "./market";
import type { MarketsView, OpeningsView } from "./state";
import type { Demand } from "./demand";
import { refreshAge, repricesToday } from "./reprice";
import { utcDay, type HealthReport, type Issue, type KeeperState } from "./store";
import { MACHINES_FILE } from "./table";

export const usdc = (wei: bigint) => (Number(wei / 10n ** 12n) / 1e6).toFixed(2);
const ago = (s: number) => (s >= 7200 ? `${(s / 3600).toFixed(1)}h` : s >= 120 ? `${Math.round(s / 60)}m` : `${s}s`);

export type HealthInput = {
  cfg: KeeperConfig;
  me: string;
  open: OpeningsView;
  markets: MarketsView | null;
  vrf: { opened: number; rerequested: number } | null;
  state: KeeperState;
  stuck: string | null;
  /** Demand per machine (demand.ts); null when it could not be read. */
  demand: ReadonlyMap<number, Demand> | null;
};

/** The biggest single pack the given machines (default all) can pay (cap less the 1% edge), in wei. */
export function biggestPackWei(ids?: readonly number[]): bigint {
  return MACHINES_FILE.machines.filter((m) => !ids || ids.includes(m.id)).reduce((mx, m) => {
    const v = (BigInt(m.priceUsdc) * 10n ** 18n * BigInt(m.capBps) * 9_900n) / 10_000n / 10_000n;
    return v > mx ? v : mx;
  }, 0n);
}

export function assessHealth(x: HealthInput): HealthReport {
  const { cfg, open, markets, vrf, state } = x;
  const { g } = open;
  const market: MarketClock = open.market;
  const t = cfg.thresholds;
  const issues: Issue[] = [];
  const add = (key: string, severity: Issue["severity"], message: string) => issues.push({ key, severity, message });
  const live = market.open ? "critical" : "warn";

  // contract
  // pausedSince survives unpause now: paused() says whether it is paused, sealedRefundAt(id) when refunds open
  const refundAt = markets?.machines.length ? Math.min(...markets.machines.map((m) => m.sealedRefundAt)) : null;
  if (g.paused) add("paused", "critical", `Arclaw is paused (pause clock since ${ago(Math.max(0, g.now - g.pausedSince))})${refundAt !== null ? `; sealed boxes refundable ${refundAt <= g.now ? "now" : `in ${ago(refundAt - g.now)}`}` : ""}`);
  // the VRF miss breaker: maxMisses expired requests (retried or returned) in a UTC day pause the contract
  const { misses, maxMisses, jitCap, jitSpent } = g.limits;
  // round 5/6: the breaker closes open() (VrfMisses) until 00:00 UTC; it does not pause
  if (g.missCapped) add("vrf-misses", "critical", `${misses}/${maxMisses} VRF misses today: opens closed (VrfMisses) until 00:00 UTC, in ${ago(Math.max(0, (g.opensClosedUntil ?? g.now) - g.now))}; plays, reveals, retries and returns go on. Repeated trips or a dead VRF: guardian pause or pauseIfVrfDown`);
  else if (maxMisses > 0 && misses * 2 >= maxMisses) add("vrf-misses", "warn", `${misses}/${maxMisses} VRF misses today: at ${maxMisses} opens close until 00:00 UTC`);
  if (jitCap > 0n && jitSpent * 100n >= jitCap * 80n) add("jit-cap", "warn", `just-in-time buys spent ${usdc(jitSpent)} of the ${usdc(jitCap)} USDC daily cap: past it short cards are refunded, not bought`);
  if (cfg.vrfImplementation && open.vrfImpl && open.vrfImpl !== cfg.vrfImplementation) {
    add("vrf-upgraded", "critical", `the VRF coordinator's implementation changed to ${open.vrfImpl} (expected ${cfg.vrfImplementation}): new logic could pick the random words. Guardian: pause now, then review the new implementation before unpausing`);
  }
  if (g.guardian.toLowerCase() === x.me.toLowerCase()) add("guardian-is-keeper", "warn", "the pause-only guardian is the keeper hot key; give it to a separate key");
  // a funded IOU no longer pauses anything, so an unfunded one is only visible here
  if (g.totalOwed > 0n && g.balance < g.liabilities) add("owed", "warn", `${usdc(g.totalOwed)} USDC of IOUs outstanding and unfunded: balance ${usdc(g.balance)} is under reserves plus IOUs ${usdc(g.liabilities)}; fund ${usdc(g.liabilities - g.balance)} USDC`);
  else if (g.totalOwed > 0n) add("owed", "info", `${usdc(g.totalOwed)} USDC of IOUs outstanding, funded and claimable (claimOwed)`);
  // a reveal that leaves less than minBuffer (1 wei on deploy) unreserved pauses play: urgent only with openings in flight
  if (g.unreserved < g.minBuffer) add("buffer", open.openings.length ? "critical" : "warn", `unreserved ${usdc(g.unreserved)} USDC is under minBuffer (${g.minBuffer} wei): a reveal that does not leave more pauses play${open.openings.length ? `, ${open.openings.length} opening(s) in flight` : ""}; fund the float`);
  // round 6: the VRF subsidy is paid from the unreserved balance only; without it players pay the whole fee to open
  if (g.maxVrfSubsidy > 0n && g.unreserved < g.maxVrfSubsidy) add("vrf-subsidy", "warn", `unreserved ${usdc(g.unreserved)} USDC cannot fund the VRF subsidy (${usdc(g.maxVrfSubsidy)}): players and the keeper pay the whole VRF fee; fund the float`);
  if (g.unreserved < g.reserveFloor) add("float-low", "warn", `unreserved ${usdc(g.unreserved)} USDC is under reserveFloor ${usdc(g.reserveFloor)}: the float is being spent on big wins, top it up`);
  // only machines that are switched on can pay a pack (mainnet launches with Single only)
  const jackpot = biggestPackWei(markets ? markets.machines.filter((m) => !m.off).map((m) => m.id) : undefined);
  if (g.unreserved < jackpot) add("float-jackpot", "warn", `unreserved ${usdc(g.unreserved)} USDC cannot pay one top pack (${usdc(jackpot)}); a jackpot would become an IOU`);

  // roles
  if (!g.isKeeper) add("not-keeper", "critical", `${x.me} is not a keeper: it cannot reveal other players' openings at once`);
  if (g.operator.toLowerCase() !== x.me.toLowerCase()) add("not-operator", "critical", `${x.me} is not the operator (${g.operator}): it cannot reprice`);
  if (open.keeperBalance < t.minGasWei / 5n) add("gas", "critical", `keeper gas balance ${usdc(open.keeperBalance)} USDC, top it up now`);
  else if (open.keeperBalance < t.minGasWei) add("gas", "warn", `keeper gas balance ${usdc(open.keeperBalance)} USDC (min ${usdc(t.minGasWei)})`);
  if (x.stuck) add("stuck-tx", "warn", `keeper transaction stuck: ${x.stuck}`);
  if (state.failures >= 3) add("keeper-failing", "critical", `${state.failures} keeper ticks failed in a row`);

  // tables and prices
  if (markets) {
    if (markets.oracleErrors.length) add("oracle", market.open ? "critical" : "info", `oracle unavailable: ${markets.oracleErrors.join("; ")}${market.open ? "" : " (market closed)"}`);
    for (const m of markets.machines) {
      if (m.tableId === null) {
        add(`no-table:${m.id}`, "critical", `machine ${m.id} has no table`);
        continue;
      }
      if (m.off) add(`machine-off:${m.id}`, "info", `machine ${m.id} is switched off`);
      // without demand a stale or frozen table is the policy (nothing spent), not a problem
      const d = x.demand?.get(m.id);
      const wanted = !m.off && (d ? d.demand : true);
      const why = d?.reasons.length ? ` (demand: ${d.reasons.join(", ")})` : " (no demand, left to sleep)";
      const left = g.maxTableAge - m.age;
      if (left < 0) add(`stale:${m.id}`, wanted ? live : "info", `machine ${m.id} table is ${ago(m.age)} old (max ${ago(g.maxTableAge)}): opens refused${wanted ? `, sealed refunds ${m.sealedRefundAt <= g.now ? "open now" : `open in ${ago(m.sealedRefundAt - g.now)}`}` : ""}${why}`);
      else if (wanted && m.age > refreshAge(g.maxTableAge, t) + 3600) add(`overdue:${m.id}`, "warn", `machine ${m.id} table is ${ago(m.age)} old with demand and was not refreshed; goes stale in ${ago(left)}${why}`);
      if (m.maxMoveBps !== null && m.maxMoveBps > g.maxPriceMoveBps) add(`frozen:${m.id}`, wanted ? live : "info", `machine ${m.id}: ${m.worstToken} moved ${(Number(m.maxMoveBps) / 100).toFixed(2)}% from its table (max ${Number(g.maxPriceMoveBps) / 100}%): opens refused until repriced${why}`);
    }
  }

  // openings
  const revealLag = open.openings.filter((o) => (o.status === STATUS.Fulfilled || o.req.fulfilled) && g.now - o.requestedAt > t.revealLagSec);
  if (revealLag.length) add("reveal-lag", "warn", `${revealLag.length} fulfilled opening(s) unrevealed for over ${t.revealLagSec}s (oldest #${revealLag[0]!.id}, ${ago(g.now - revealLag[0]!.requestedAt)})`);
  const expired = open.openings.filter((o) => o.status === STATUS.Pending && o.req.expired);
  const waiting = expired.filter((o) => !state.retries[String(o.id)]?.gaveUp);
  const oldestExpired = waiting.reduce((mx, o) => Math.max(mx, g.now - o.req.deadline), 0);
  if (waiting.length && oldestExpired > 600) add("retry-lag", "warn", `${waiting.length} expired VRF request(s) not re-requested, oldest expired ${ago(oldestExpired)} ago`);
  const returnable = expired.length - waiting.length;
  if (returnable) add("await-return", "info", `${returnable} opening(s) can only be returned by their opener (pinned table aged out)`);
  if (vrf && vrf.opened >= 5 && vrf.rerequested / vrf.opened > t.vrfRetryWarn) add("vrf-retry-rate", "warn", `VRF retry rate ${((vrf.rerequested / vrf.opened) * 100).toFixed(0)}% over the last ${ARCLAW_LOG_BLOCKS} blocks (${vrf.rerequested}/${vrf.opened})`);

  const metrics: HealthReport["metrics"] = {
    paused: g.paused,
    balanceUsdc: usdc(g.balance),
    unreservedUsdc: usdc(g.unreserved),
    freeUsdc: usdc(g.freeBalance),
    reserveFloorUsdc: usdc(g.reserveFloor),
    minBufferUsdc: usdc(g.minBuffer),
    totalOwedUsdc: usdc(g.totalOwed),
    pendingUsdc: usdc(g.pendingReserve),
    sealedUsdc: usdc(g.sealedReserve),
    keeperGasUsdc: usdc(open.keeperBalance),
    openOpenings: open.openings.length,
    marketOpen: market.open,
    nextOpeningId: Number(g.nextOpeningId),
    vrfOpened: vrf?.opened ?? null,
    vrfRetried: vrf?.rerequested ?? null,
    vrfMissesToday: misses,
    opensClosedUntil: g.opensClosedUntil,
    maxMisses,
    jitSpentTodayUsdc: usdc(jitSpent),
    jitCapUsdc: usdc(jitCap),
    topUpReserveUsdc: usdc(g.topUpReserve),
    guardian: g.guardian,
    gasSpentTodayUsdc: (Number(state.spend.day === utcDay(g.now) ? BigInt(state.spend.wei) / 10n ** 12n : 0n) / 1e6).toFixed(6),
    gasDay: utcDay(g.now),
  };
  if (markets) {
    for (const m of markets.machines) {
      metrics[`m${m.id}TableAgeS`] = Number.isFinite(m.age) ? m.age : null;
      metrics[`m${m.id}MoveBps`] = m.maxMoveBps === null ? null : Number(m.maxMoveBps);
    }
    metrics.oracleOk = markets.oracleErrors.length === 0;
    for (const m of markets.machines) {
      metrics[`m${m.id}Demand`] = x.demand?.get(m.id)?.demand ?? null;
      metrics[`m${m.id}RepricesToday`] = repricesToday(state, m.id, g.now);
    }
  }
  return {
    at: g.now,
    block: String(g.block),
    network: cfg.network,
    ok: !issues.some((i) => i.severity === "critical"),
    issues,
    metrics,
  };
}

const ARCLAW_LOG_BLOCKS = 9_999;
