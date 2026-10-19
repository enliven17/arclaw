/**
 * Per-machine freshness for a status page, from the keeper's saved state (no chain reads). Pure and runtime free, so
 * convex/keeper.ts (default runtime) and the CLI (`pnpm keeper status`) share it.
 *   fresh     switched on, has a table younger than maxTableAge, every card within maxPriceMoveBps at the last read
 *   openable  fresh, the contract is not paused and the VRF miss breaker has not closed opens (pass both as `closed`)
 *   waking    not fresh and a wake request in the last 60 minutes (the keeper is on it)
 */
import type { MachineStatus } from "./store";

export const WAKE_WINDOW_MS = 3_600_000;

export type MachineFreshness = {
  id: number;
  fresh: boolean;
  openable: boolean;
  pricedAt: number | null;
  staleAt: number | null;
  off: boolean | null;
  moveBps: number | null;
  demand: boolean | null;
  waking: boolean;
  readAt: number | null;
};

/** `chainNowS` judges the tables (chain time; Date.now() on Arc is close enough), `wallNowMs` the wake requests. */
export function machineFreshness(ids: readonly number[], machines: Record<string, MachineStatus> | undefined, wakes: Record<string, number>, paused: boolean, chainNowS: number, wallNowMs = chainNowS * 1000): MachineFreshness[] {
  const nowS = chainNowS;
  const nowMs = wallNowMs;
  return ids.map((id) => {
    const m = machines?.[String(id)];
    const w = wakes[String(id)];
    const recentWake = w !== undefined && nowMs - w < WAKE_WINDOW_MS;
    if (!m) return { id, fresh: false, openable: false, pricedAt: null, staleAt: null, off: null, moveBps: null, demand: null, waking: recentWake, readAt: null };
    const staleAt = m.pricedAt ? m.pricedAt + m.maxTableAge : 0;
    const fresh = !m.off && m.pricedAt > 0 && nowS < staleAt && m.moveBps !== null && m.moveBps <= m.maxMoveBps;
    return { id, fresh, openable: fresh && !paused, pricedAt: m.pricedAt || null, staleAt: staleAt || null, off: m.off, moveBps: m.moveBps, demand: m.demand, waking: !fresh && recentWake, readAt: m.readAt };
  });
}
