/**
 * The per-opening work of a tick:
 *   reveal         every fulfilled opening (callback delivered, or the coordinator has the word but the callback
 *                  failed), oldest first. A reveal that keeps reverting is rescued once RESCUE_AFTER has passed.
 *   retryOrReturn  every Pending opening whose VRF request expired: retry on the house subsidy, ONCE (Arclaw allows
 *                  one re-request per opening, RetryLimit after; each retried or returned expiry is a VRF miss). A retry
 *                  the pinned table blocks (TableStale, BelowFloor) reverts without using it and is tried again with
 *                  backoff (60 s doubling to 1 h). Once the retry is used or the pinned table aged out, the opener's way
 *                  out is returnBoxes (opener-only); the keeper stops and says so. A used retry that expired again is
 *                  the dead-VRF signal (vrfSuspect: the tick then probes pauseIfVrfDown).
 * Both simulate before sending, so a reveal raced by the opener (NotPending) costs nothing.
 */
import { ARCLAW, STATUS, calls, readOpening, readTablePricedAt, retryTopUp, type Globals } from "./arclaw";
import type { KeeperConfig } from "./config";
import type { OpenOpening } from "./state";
import type { Issue, KeeperEvent, KeeperState } from "./store";
import type { Sender } from "./tx";
import type { PublicClient } from "viem";

type Result = { events: KeeperEvent[]; issues: Issue[]; done: number; vrfSuspect?: boolean };

const fmtUsdc = (wei: bigint) => (Number(wei / 10n ** 12n) / 1e6).toFixed(6);

export const revealable = (o: OpenOpening) => o.status === STATUS.Fulfilled || (o.status === STATUS.Pending && o.req.fulfilled);

export async function reveal(cfg: KeeperConfig, sender: Sender, g: Pick<Globals, "now" | "isKeeper">, openings: readonly OpenOpening[], state: KeeperState, deadline = Infinity): Promise<Result> {
  const events: KeeperEvent[] = [];
  const issues: Issue[] = [];
  let done = 0;
  const ready = openings.filter(revealable).slice(0, cfg.thresholds.maxRevealsPerTick);
  if (ready.length && !g.isKeeper) issues.push({ key: "not-keeper", severity: "critical", message: `keeper address is not in Arclaw.keepers; it cannot reveal other players' openings` });
  for (const o of ready) {
    if (Date.now() > deadline) break;
    const id = String(o.id);
    const res = await sender.send(calls.reveal(cfg.deployment, o.id));
    if (res.ok) {
      done++;
      delete state.revealFailures[id];
      events.push({ at: g.now, kind: res.dryRun ? "reveal-dry-run" : "revealed", level: "info", message: `opening #${id}: ${o.boxes} box(es) of machine ${o.machineId}, ${g.now - o.requestedAt}s after the request`, tx: res.hash ?? undefined, data: { openingId: id, boxes: o.boxes } });
      continue;
    }
    if (/NotPending|NotReady/.test(res.error)) continue; // revealed by the opener meanwhile, or the word is not there yet
    const n = (state.revealFailures[id] ?? 0) + 1;
    state.revealFailures[id] = n;
    events.push({ at: g.now, kind: "reveal-failed", level: "warn", message: `opening #${id} reveal failed (${n}x): ${res.error}`, tx: res.hash ?? undefined });
    if (g.now >= o.requestedAt + ARCLAW.RESCUE_AFTER) {
      const r2 = await sender.send(calls.rescue(cfg.deployment, o.id));
      events.push({ at: g.now, kind: r2.ok ? "rescued" : "rescue-failed", level: r2.ok ? "warn" : "error", message: `opening #${id} rescue: ${r2.ok ? "settled in USDC" : r2.error}`, tx: (r2.ok ? r2.hash : r2.hash) ?? undefined });
      if (r2.ok) delete state.revealFailures[id];
    } else if (n >= 3) {
      issues.push({ key: `reveal-stuck:${id}`, severity: "critical", message: `opening #${id} reveal keeps failing (${res.error}); rescue possible from ${new Date((o.requestedAt + ARCLAW.RESCUE_AFTER) * 1000).toISOString()}` });
    }
  }
  return { events, issues, done };
}

/** Minimum chain seconds between two pauseIfVrfDown probes. */
export const VRF_PROBE_EVERY_S = 600;

/**
 * pauseIfVrfDown, only when opens have been failing (a used retry expired again, or 2+ VRF misses today), never on a
 * healthy contract, at most every VRF_PROBE_EVERY_S. The simulation is the probe: VrfAlive reverts it and nothing is
 * signed or spent; when it would succeed (D20 really is down) it is sent and the contract pauses.
 */
export async function probeVrf(cfg: KeeperConfig, sender: Sender, g: Globals, state: KeeperState, suspect: boolean): Promise<Result> {
  const events: KeeperEvent[] = [];
  const issues: Issue[] = [];
  const failing = suspect || g.limits.misses >= 2;
  if (g.paused || !failing) return { events, issues, done: 0 };
  if (g.now - state.lastVrfProbeAt < VRF_PROBE_EVERY_S) {
    events.push({ at: g.now, kind: "vrf-probe-wait", level: "info", message: `opens failing; next pauseIfVrfDown probe in ${state.lastVrfProbeAt + VRF_PROBE_EVERY_S - g.now}s` });
    return { events, issues, done: 0 };
  }
  state.lastVrfProbeAt = g.now;
  const res = await sender.send(calls.pauseIfVrfDown(cfg.deployment));
  if (!res.ok && /VrfAlive/.test(res.error)) {
    events.push({ at: g.now, kind: "vrf-probe", level: "info", message: `pauseIfVrfDown probe: VRF alive (misses today ${g.limits.misses}/${g.limits.maxMisses}), nothing spent` });
    return { events, issues, done: 0 };
  }
  if (res.ok) {
    issues.push({ key: "vrf-down", severity: "critical", message: `D20 VRF is down: ${res.dryRun ? "pauseIfVrfDown would pause the contract (dry run)" : "the keeper paused the contract with pauseIfVrfDown"}; dead-VRF runbook` });
    events.push({ at: g.now, kind: res.dryRun ? "vrf-probe-dry-run" : "vrf-paused", level: "error", message: "pauseIfVrfDown: VRF down, contract paused", tx: res.hash ?? undefined });
    return { events, issues, done: 1 };
  }
  events.push({ at: g.now, kind: "vrf-probe-failed", level: "warn", message: `pauseIfVrfDown probe failed: ${res.error}` });
  return { events, issues, done: 0 };
}

export async function retryOrReturn(client: PublicClient, cfg: KeeperConfig, sender: Sender, g: Globals, openings: readonly OpenOpening[], state: KeeperState, deadline = Infinity): Promise<Result> {
  const t = cfg.thresholds;
  const events: KeeperEvent[] = [];
  const issues: Issue[] = [];
  let done = 0;
  const openIds = new Set(openings.map((o) => String(o.id)));
  for (const k of Object.keys(state.retries)) if (!openIds.has(k)) delete state.retries[k];
  for (const k of Object.keys(state.revealFailures)) if (!openIds.has(k)) delete state.revealFailures[k];

  let topUp: bigint | null = null;
  let sent = 0;
  let vrfSuspect = false;
  for (const o of openings) {
    if (o.status !== STATUS.Pending || o.req.fulfilled) continue;
    const id = String(o.id);
    if (!o.req.readable) {
      vrfSuspect = true;
      issues.push({ key: "vrf-unreadable", severity: "critical", message: `coordinator getRequest reverts (opening #${id}): retries impossible; openers can returnBoxes ${new Date((o.requestedAt + ARCLAW.RESCUE_AFTER) * 1000).toISOString()} at the latest` });
      continue;
    }
    if (!o.req.expired) continue;
    const rec = state.retries[id] ?? { attempts: 0, lastAt: 0, lastRequestId: null, consecutiveExpired: 0, gaveUp: null };
    // our last retry's request expired too: the VRF did not answer it
    if (rec.lastRequestId === String(o.requestId)) {
      rec.consecutiveExpired++;
      rec.lastRequestId = null;
    }
    state.retries[id] = rec;
    // the one retry Arclaw allows was used (by us or anyone) and its request expired too: D20 is not answering
    if (o.retries >= ARCLAW.MAX_RETRIES) {
      vrfSuspect = true;
      issues.push({ key: "vrf-retry-expired", severity: "critical", message: `the VRF retry of opening #${id} went unanswered too (retries ${o.retries}/${ARCLAW.MAX_RETRIES}); see the dead-VRF runbook` });
      if (!rec.gaveUp) {
        rec.gaveUp = "retry-limit";
        const pricedAt = Number(await readTablePricedAt(client, cfg.deployment, o.tableId));
        events.push({ at: g.now, kind: "retry-stopped", level: "warn", message: `opening #${id}: its one retry is used (openingRetries ${o.retries}/${ARCLAW.MAX_RETRIES}); opener ${o.opener} can returnBoxes from ${new Date((pricedAt + g.maxTableAge) * 1000).toISOString()}`, data: { openingId: id, retries: o.retries } });
      }
      continue;
    }
    if (rec.gaveUp) continue;

    const pricedAt = Number(await readTablePricedAt(client, cfg.deployment, o.tableId));
    if (g.now > pricedAt + g.maxTableAge) {
      rec.gaveUp = "table-aged-out";
      events.push({ at: g.now, kind: "retry-stopped", level: "warn", message: `opening #${id}: pinned table ${o.tableId} aged out, retry can never land; opener ${o.opener} can returnBoxes now` });
      continue;
    }
    const wait = rec.attempts === 0 ? 0 : Math.min(60 * 2 ** (rec.attempts - 1), t.retryBackoffMaxSec);
    if (g.now < rec.lastAt + wait) continue;
    if (sent >= t.maxRetriesPerTick || Date.now() > deadline) break;

    topUp ??= await retryTopUp(client, g);
    if (topUp > t.maxVrfTopUpWei) {
      issues.push({ key: "vrf-fee", severity: "warn", message: `VRF fee needs ${fmtUsdc(topUp)} USDC above the subsidy per retry (keeper max ${fmtUsdc(t.maxVrfTopUpWei)}); raise maxVrfSubsidy or KEEPER_MAX_VRF_TOPUP_USDC` });
      break;
    }
    rec.attempts++;
    rec.lastAt = g.now;
    sent++;
    const res = await sender.send(calls.retry(cfg.deployment, o.id, topUp));
    if (res.ok) {
      done++;
      if (!res.dryRun) rec.lastRequestId = String((await readOpening(client, cfg.deployment, o.id)).requestId);
      events.push({ at: g.now, kind: res.dryRun ? "retry-dry-run" : "retried", level: "info", message: `opening #${id}: VRF re-requested (openingRetries ${o.retries + 1}/${ARCLAW.MAX_RETRIES}, attempt ${rec.attempts}; request ${o.requestId} expired ${g.now - o.req.deadline}s ago)`, tx: res.hash ?? undefined, data: { openingId: id, attempt: rec.attempts, openingRetries: o.retries + 1, oldRequestId: String(o.requestId), topUp: fmtUsdc(topUp) } });
      continue;
    }
    if (/RetryLimit/.test(res.error)) {
      rec.gaveUp = "retry-limit";
      events.push({ at: g.now, kind: "retry-stopped", level: "warn", message: `opening #${id}: RetryLimit, only returnBoxes remains for opener ${o.opener}` });
      continue;
    }
    const blocked = /TableStale|BelowFloor/.test(res.error);
    events.push({
      at: g.now,
      kind: "retry-failed",
      level: "warn",
      message: `opening #${id}: retry attempt ${rec.attempts} ${blocked ? "blocked by the pinned table" : "failed"}: ${res.error}; next try in ${Math.min(60 * 2 ** (rec.attempts - 1), t.retryBackoffMaxSec)}s`,
      tx: res.hash ?? undefined,
      data: { openingId: id, attempt: rec.attempts },
    });
  }
  return { events, issues, done, vrfSuspect };
}
