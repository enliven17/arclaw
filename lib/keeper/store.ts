/**
 * What the keeper remembers between ticks, and where. The chain is the source of truth for every opening and table;
 * this only holds what the chain cannot tell: retry backoff, alert dedupe, the scan cursor, a stuck-nonce clock and
 * the last tick/reprice/health for a status page. Losing it is safe (the next tick rebuilds it from the chain).
 *
 *   FileStore    CLI: JSON state + JSONL events under .cache/keeper/, an exclusive lock file with a TTL
 *   MemoryStore  tests
 *   Convex       convex/keeperState.ts implements the same interface over the keeper tables
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, openSync, closeSync } from "node:fs";
import { dirname } from "node:path";
import { emptyDemandLog, type DemandLog } from "./demand";

export type Severity = "info" | "warn" | "critical";
export type Issue = { key: string; severity: Severity; message: string };

export type KeeperEvent = {
  at: number;
  kind: string;
  level: "info" | "warn" | "error";
  message: string;
  tx?: string;
  data?: Record<string, string | number | boolean | null>;
};

export type RetryRecord = { attempts: number; lastAt: number; lastRequestId: string | null; consecutiveExpired: number; gaveUp: string | null };
export type AlertRecord = { severity: Severity; message: string; firstAt: number; lastSentAt: number };

/** JSON-safe health snapshot (amounts as decimal USDC strings). */
export type HealthReport = {
  at: number;
  block: string;
  network: string;
  ok: boolean;
  issues: Issue[];
  metrics: Record<string, string | number | boolean | null>;
};

export type KeeperState = {
  version: 1;
  scan: { next: string; open: string[] };
  retries: Record<string, RetryRecord>;
  revealFailures: Record<string, number>;
  alerts: Record<string, AlertRecord>;
  stuckSince: number | null;
  failures: number;
  lastTick: { at: number; ok: boolean; summary: string } | null;
  lastReprice: Record<string, { at: number; reason: string; tx: string | null; tableId: string | null }>;
  lastHealth: HealthReport | null;
  /** Log index behind the demand check (demand.ts). */
  demand: DemandLog;
  /** Wall-clock ms of the latest wake request already acted on, per machine. */
  wakesHandled: Record<string, number>;
  /** Reprices per machine on one UTC day (chain clock), for the daily cap. */
  repriceDay: { day: string; counts: Record<string, number> };
  /** Native spent by the keeper key (gas plus any value sent) on one UTC day (chain clock), wei as a string. */
  spend: { day: string; wei: string };
  /** Per machine, as last read: what the status page needs to tell fresh from stale. */
  machines: Record<string, MachineStatus>;
  /** Chain time of the last pauseIfVrfDown probe. */
  lastVrfProbeAt: number;
};

export type MachineStatus = { pricedAt: number; maxTableAge: number; moveBps: number | null; maxMoveBps: number; off: boolean; demand: boolean; readAt: number };

export const emptyState = (): KeeperState => ({
  version: 1,
  scan: { next: "0", open: [] },
  retries: {},
  revealFailures: {},
  alerts: {},
  stuckSince: null,
  failures: 0,
  lastTick: null,
  lastReprice: {},
  lastHealth: null,
  demand: emptyDemandLog(),
  wakesHandled: {},
  repriceDay: { day: "", counts: {} },
  spend: { day: "", wei: "0" },
  machines: {},
  lastVrfProbeAt: 0,
});

/** UTC day of a unix timestamp, YYYY-MM-DD. */
export const utcDay = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

/** Wake requests are deduplicated over this window. */
export const WAKE_DEDUP_MS = 60_000;

export interface KeeperStore {
  load(): Promise<KeeperState>;
  save(s: KeeperState): Promise<void>;
  log(events: KeeperEvent[]): Promise<void>;
  /** Exclusive lease on `name` for ttlMs; false while someone else holds a live one. */
  acquire(name: string, ttlMs: number): Promise<boolean>;
  release(name: string): Promise<void>;
  /** Latest wake request per machine id, wall-clock ms. */
  wakes(): Promise<Record<string, number>>;
}

export class MemoryStore implements KeeperStore {
  state = emptyState();
  events: KeeperEvent[] = [];
  private locks = new Map<string, number>();
  async load() {
    return structuredClone(this.state);
  }
  async save(s: KeeperState) {
    this.state = structuredClone(s);
  }
  async log(e: KeeperEvent[]) {
    this.events.push(...e);
  }
  async acquire(name: string, ttlMs: number) {
    const until = this.locks.get(name);
    if (until && until > Date.now()) return false;
    this.locks.set(name, Date.now() + ttlMs);
    return true;
  }
  async release(name: string) {
    this.locks.delete(name);
  }
  wakeAt: Record<string, number> = {};
  async wakes() {
    return { ...this.wakeAt };
  }
}

export class FileStore implements KeeperStore {
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  async load(): Promise<KeeperState> {
    try {
      const s = JSON.parse(readFileSync(this.path, "utf8")) as KeeperState;
      return s.version === 1 ? { ...emptyState(), ...s } : emptyState();
    } catch {
      return emptyState();
    }
  }
  async save(s: KeeperState) {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2));
    // Windows: a scanner or a reader may hold the target for a moment (EPERM/EBUSY); retry briefly
    await retryFs(() => renameSync(tmp, this.path));
  }
  async log(events: KeeperEvent[]) {
    if (events.length) appendFileSync(this.path.replace(/\.json$/, ".events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  private lockPath = (name: string) => `${this.path}.${name}.lock`;
  async acquire(name: string, ttlMs: number) {
    const p = this.lockPath(name);
    for (let i = 0; i < 20; i++) {
      try {
        const fd = openSync(p, "wx");
        writeFileSync(fd, JSON.stringify({ pid: process.pid, until: Date.now() + ttlMs }));
        closeSync(fd);
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
          // EPERM/EBUSY on Windows: the previous holder's delete is still pending; try again shortly
          await sleep(50);
          continue;
        }
        // held: take it over only once its lease ran out (a crashed tick)
        let until: number | null = null;
        try {
          until = (JSON.parse(readFileSync(p, "utf8")) as { until: number }).until;
        } catch {
          // being written by its holder, or being deleted: judge by its age, never steal a fresh one
          try {
            until = statSync(p).mtimeMs + ttlMs;
          } catch {
            await sleep(50); // gone meanwhile: try to create it again
            continue;
          }
        }
        if (until > Date.now()) return false;
        try {
          rmSync(p, { force: true });
        } catch {
          await sleep(50);
        }
      }
    }
    return false;
  }
  async release(name: string) {
    await retryFs(() => rmSync(this.lockPath(name), { force: true }));
  }
  private wakePath = () => this.path.replace(/\.json$/, ".wakes.json");
  async wakes(): Promise<Record<string, number>> {
    try {
      return JSON.parse(readFileSync(this.wakePath(), "utf8")) as Record<string, number>;
    } catch {
      return {};
    }
  }
  /** Records a wake request (the CLI's stand-in for keeper:wake); false when one is younger than WAKE_DEDUP_MS. */
  async wake(machineId: number, now = Date.now()): Promise<boolean> {
    const w = await this.wakes();
    if (now - (w[String(machineId)] ?? 0) < WAKE_DEDUP_MS) return false;
    w[String(machineId)] = now;
    writeFileSync(this.wakePath(), JSON.stringify(w));
    return true;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries a filesystem call that Windows can refuse for a moment (EPERM, EBUSY, EACCES) while another handle closes. */
async function retryFs(fn: () => void, tries = 20): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= tries || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) throw e;
      await sleep(50);
    }
  }
}
