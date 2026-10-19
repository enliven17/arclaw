/**
 * Demand: a machine is only worth repricing when someone can use its table. It has demand when any of these holds:
 *   sealed     boxes of it are outstanding (boxesSold minus opened, plus returned, minus refunded)
 *   opening    a Pending or Fulfilled opening of it exists
 *   played     a Played event of it in the last playWindowSec (24 h, chain time)
 *   wake       a wake request for it in the last wakeWindowSec (60 min, wall clock): a visitor opened its page
 * With no demand its table may go stale and the keeper spends nothing on it.
 *
 * Opened, BoxesReturned, SealedRefunded and Played are read from the logs with a cursor in KeeperState.demand (a few
 * 10k-block windows per tick). Until the cursor has caught up with the chain head, a machine that ever sold a box
 * counts as having demand (fail safe for the players, it costs at most a few reprices).
 */
import type { PublicClient } from "viem";
import { arclawAbi } from "../abi";
import { LOG_SPAN } from "./arclaw";
import type { KeeperConfig, Deployment } from "./config";
import type { OpenOpening } from "./state";
import type { KeeperState } from "./store";

export type DemandLog = {
  /** Last block scanned (string bigint); null before the first scan. */
  cursor: string | null;
  opened: Record<string, number>;
  returned: Record<string, number>;
  refunded: Record<string, number>;
  /** Chain timestamp of the latest Played per machine. */
  lastPlayAt: Record<string, number>;
};

export const emptyDemandLog = (): DemandLog => ({ cursor: null, opened: {}, returned: {}, refunded: {}, lastPlayAt: {} });

const EVENTS = ["Opened", "BoxesReturned", "SealedRefunded", "Played"].map((name) => arclawAbi.find((x) => x.type === "event" && x.name === name)!);

/** Advances the log cursor by up to `windows` windows. Returns true when it reached `head`. */
export async function scanDemand(c: PublicClient, d: Deployment, log: DemandLog, head: bigint, windows: number): Promise<boolean> {
  let from = log.cursor === null ? d.deployBlock : BigInt(log.cursor) + 1n;
  const add = (m: Record<string, number>, id: unknown, n: unknown) => {
    const k = String(Number(id));
    m[k] = (m[k] ?? 0) + Number(n);
  };
  for (let i = 0; i < windows && from <= head; i++) {
    const to = from + LOG_SPAN - 1n < head ? from + LOG_SPAN - 1n : head;
    const logs = (await c.getLogs({ address: d.arclaw, events: EVENTS as never, fromBlock: from, toBlock: to })) as unknown as { eventName: string; args: Record<string, unknown>; blockNumber: bigint }[];
    const lastPlayBlock = new Map<string, bigint>();
    for (const l of logs) {
      const a = l.args;
      if (l.eventName === "Opened") add(log.opened, a.machineId, a.boxes);
      else if (l.eventName === "BoxesReturned") add(log.returned, a.machineId, a.boxes);
      else if (l.eventName === "SealedRefunded") add(log.refunded, a.machineId, a.boxes);
      else if (l.eventName === "Played") lastPlayBlock.set(String(Number(a.machineId)), l.blockNumber);
    }
    for (const [k, bn] of lastPlayBlock) log.lastPlayAt[k] = Number((await c.getBlock({ blockNumber: bn })).timestamp);
    log.cursor = String(to);
    from = to + 1n;
  }
  return from > head;
}

export type Demand = { demand: boolean; reasons: string[] };

export function demandOf(
  machineId: number,
  sold: bigint,
  log: DemandLog,
  caughtUp: boolean,
  openings: readonly OpenOpening[],
  wakes: Record<string, number>,
  chainNow: number,
  wallNowMs: number,
  t: KeeperConfig["thresholds"],
): Demand {
  const k = String(machineId);
  const reasons: string[] = [];
  const sealed = Number(sold) - (log.opened[k] ?? 0) + (log.returned[k] ?? 0) - (log.refunded[k] ?? 0);
  if (caughtUp && sealed > 0) reasons.push(`${sealed} sealed box(es)`);
  const open = openings.filter((o) => o.machineId === machineId).length;
  if (open) reasons.push(`${open} opening(s) in flight`);
  const played = log.lastPlayAt[k];
  if (played !== undefined && chainNow - played < t.playWindowSec) reasons.push(`played ${Math.round((chainNow - played) / 60)} min ago`);
  const wake = wakes[k];
  if (wake !== undefined && wallNowMs - wake < t.wakeWindowSec * 1000) reasons.push("wake request");
  if (!caughtUp && sold > 0n && !reasons.length) reasons.push("history not indexed yet");
  return { demand: reasons.length > 0, reasons };
}

/** Demand of every machine; reads the logs forward first (a failing read counts as not caught up). */
export async function readDemand(
  c: PublicClient,
  cfg: KeeperConfig,
  state: KeeperState,
  head: bigint,
  sold: Map<number, bigint>,
  openings: readonly OpenOpening[],
  wakes: Record<string, number>,
  chainNow: number,
): Promise<Map<number, Demand>> {
  let caughtUp = false;
  try {
    caughtUp = await scanDemand(c, cfg.deployment, state.demand, head, cfg.thresholds.demandLogWindows);
  } catch {
    caughtUp = false;
  }
  const out = new Map<number, Demand>();
  for (const [id, s] of sold) out.set(id, demandOf(id, s, state.demand, caughtUp, openings, wakes, chainNow, Date.now(), cfg.thresholds));
  return out;
}
