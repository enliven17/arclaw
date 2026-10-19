/**
 * arclaw keeper CLI.
 *
 *   pnpm keeper tick      [--reveal-only]          one full pass (reveal-only: reveals and wake requests): reveal, retry, VRF probe, reprice if due, health, alerts
 *   pnpm keeper reprice   [--force] [--machine 1,3] reprice due machines (all of them with --force)
 *   pnpm keeper health    [--json]                 read-only report, exit code 2 when anything is critical
 *   pnpm keeper state                               what the keeper sees (tables, moves, openings)
 *   pnpm keeper watch     [--interval 5]            loop: reveal (and wakes) every interval, full tick every minute
 *   pnpm keeper wake      --machine 3               record a wake request (what convex keeper:wake does)
 *   pnpm keeper status                              per machine fresh / openable / waking, from the saved state
 *
 * Common flags: --dry-run (simulate, sign nothing, persist nothing), --network testnet|mainnet|local, --rpc URL,
 * --deployment path/to/deployment.json, --state path, --market auto|open|closed, --price-check off|astock|URL, --json.
 * Env: KEEPER_PRIVATE_KEY (or KEEPER_ADDRESS for dry runs) and the KEEPER_* / ALERT_* names in .env.example; read
 * from the environment, then .env.keeper and .env.local if present (never overriding what is already set).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FileStore } from "../../lib/keeper/store";
import { machineFreshness } from "../../lib/keeper/status";
import { MACHINES_FILE } from "../../lib/keeper/table";
import { loadConfig, loadSigner, makeClients, Sender, tick, readState, emptyState, type TickMode, type TickResult } from "../../lib/keeper";
import { usdc } from "../../lib/keeper/health";

const REPO = resolve(import.meta.dirname, "..", "..");
for (const f of process.env.KEEPER_NO_ENV_FILE === "1" ? [] : [".env.keeper", ".env.local"]) {
  const p = join(REPO, f);
  if (existsSync(p)) process.loadEnvFile(p); // does not override variables already set
}

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof Map ? Object.fromEntries(x) : x), 2);
const out = (s: string) => process.stdout.write(s + "\n");

function setup() {
  const dep = opt("deployment");
  const cfg = loadConfig(process.env, {
    deployment: dep ? JSON.parse(readFileSync(resolve(dep), "utf8")) : undefined,
    rpcUrls: opt("rpc")?.split(","),
    network: opt("network"),
    dryRun: flag("dry-run") || undefined,
    market: opt("market"),
    priceCheck: opt("price-check"),
  });
  const signer = loadSigner(process.env);
  const { client, wallet } = makeClients(cfg, signer);
  const sender = new Sender(client, wallet, signer.address, cfg.dryRun);
  const statePath = opt("state") ?? join(REPO, ".cache", "keeper", `${cfg.deployment.chainId}-${cfg.deployment.arclaw.toLowerCase()}.json`);
  return { cfg, client, sender, me: signer.address, store: new FileStore(statePath) };
}

function print(r: TickResult) {
  if (flag("json")) return out(json(r));
  if (r.skipped) return out(`skipped: ${r.skipped}`);
  for (const e of r.events) out(`${e.level.padEnd(5)} ${e.kind.padEnd(16)} ${e.message}${e.tx ? `  tx ${e.tx}` : ""}`);
  for (const x of r.repriced) out(`reprice m${x.machineId} ${x.reason}: ${x.done ? "done" : "skipped"} (${x.note})`);
  if (r.health) {
    out(`health ${r.health.ok ? "OK" : "CRITICAL"} at block ${r.health.block}`);
    for (const i of r.health.issues) out(`  ${i.severity.padEnd(8)} ${i.key}: ${i.message}`);
    out(`  ${Object.entries(r.health.metrics).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }
  if (r.error) out(`error: ${r.error}`);
}

async function main() {
  if (cmd === "help" || flag("help")) {
    out(readFileSync(import.meta.filename, "utf8").split("*/")[0]!.replace(/^\/\*\*?|^ \* ?/gm, ""));
    return;
  }
  const ctx = setup();
  process.stderr.write(`keeper ${ctx.me} on ${ctx.cfg.network} (chain ${ctx.cfg.deployment.chainId}), arclaw ${ctx.cfg.deployment.arclaw}${ctx.cfg.dryRun ? ", DRY RUN" : ""}\n`);
  if (cmd === "wake") {
    const id = Number(opt("machine"));
    if (!MACHINES_FILE.machines.some((m) => m.id === id)) throw new Error("wake needs --machine <id from lib/machines.json>");
    const accepted = await ctx.store.wake(id);
    return out(flag("json") ? json({ accepted }) : accepted ? `wake recorded for machine ${id}` : `machine ${id} was woken less than 60 s ago, ignored`);
  }
  if (cmd === "status") {
    const st = await ctx.store.load();
    const machines = machineFreshness(MACHINES_FILE.machines.map((m) => m.id), st.machines, await ctx.store.wakes(), st.lastHealth?.metrics.paused === true || Number(st.lastHealth?.metrics.opensClosedUntil ?? 0) > Number((await ctx.client.getBlock()).timestamp), Number((await ctx.client.getBlock()).timestamp), Date.now());
    if (flag("json")) return out(json({ lastTick: st.lastTick, spend: st.spend, repriceDay: st.repriceDay, machines }));
    for (const m of machines) out(`machine ${m.id} fresh ${m.fresh} openable ${m.openable} waking ${m.waking} demand ${m.demand} staleAt ${m.staleAt ? new Date(m.staleAt * 1000).toISOString() : "-"}`);
    return;
  }
  if (cmd === "state") {
    const s = await readState(ctx.client, ctx.cfg, ctx.me, emptyState());
    if (flag("json")) return out(json(s));
    out(`block ${s.g.block} time ${new Date(s.g.now * 1000).toISOString()} market ${s.market.open ? "open" : "closed"} paused ${s.g.paused}`);
    out(`balance ${usdc(s.g.balance)} unreserved ${usdc(s.g.unreserved)} free ${usdc(s.g.freeBalance)} floor ${usdc(s.g.reserveFloor)} owed ${usdc(s.g.totalOwed)} keeper gas ${usdc(s.keeperBalance)}`);
    out(`operator ${s.g.operator} keeper ${s.g.isKeeper} maxTableAge ${s.g.maxTableAge}s maxMove ${s.g.maxPriceMoveBps}bps`);
    out(`oracle ${[...s.bySymbol].map(([k, v]) => `${k}=${Number(v) / 1e6}`).join(" ")}${s.oracleErrors.length ? `  errors: ${s.oracleErrors.join("; ")}` : ""}`);
    for (const m of s.machines) out(`machine ${m.id} table ${m.tableId ?? "-"} age ${m.age}s move ${m.maxMoveBps ?? "?"}bps (${m.worstToken ?? "-"}) off ${m.off}`);
    for (const o of s.openings) out(`opening #${o.id} status ${o.status} machine ${o.machineId} boxes ${o.boxes} request ${o.requestId} fulfilled ${o.req.fulfilled} expired ${o.req.expired}`);
    return;
  }
  const modes: Record<string, TickMode> = { tick: "full", reprice: "reprice", health: "health" };
  if (cmd === "watch") {
    const every = Number(opt("interval") ?? 5) * 1000;
    let lastFull = 0;
    for (;;) {
      const full = Date.now() - lastFull >= 60_000;
      const r = await tick(ctx, { mode: full ? "full" : "reveal" });
      if (full && !r.skipped) lastFull = Date.now();
      if (r.events.length || full) print(r);
      await new Promise((res) => setTimeout(res, every));
    }
  }
  const mode = cmd === "tick" && flag("reveal-only") ? "reveal" : modes[cmd];
  if (!mode) throw new Error(`unknown command ${cmd}; try: pnpm keeper help`);
  const only = opt("machine")?.split(",").map(Number);
  const r = await tick(ctx, { mode, force: flag("force"), only });
  print(r);
  if (!r.ok) process.exitCode = 1;
  else if (mode === "health" && r.health && !r.health.ok) process.exitCode = 2;
}

main().catch((e) => {
  // messages only: a stack could carry request bodies, never the key, but keep the output short anyway
  process.stderr.write(`keeper: ${(e as Error).message?.split("\n")[0] ?? e}\n`);
  process.exitCode = 1;
});
