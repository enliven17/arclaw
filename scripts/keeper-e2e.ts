/**
 * Keeper end to end on a local anvil, through the real CLI (pnpm keeper ...). Repeatable: pnpm keeper:e2e
 *
 *   1. copies contracts/ to a temp folder (scripts/keeper/snapshot.ts), so nothing in the repo is built or written
 *   2. starts anvil as Arc testnet (chain 5042002), puts MockVRFCoordinator's code at the D20 testnet address
 *   3. deploys with the existing script in testnet mock mode: MOCK_PRICES=1 forge script Deploy.s.sol --broadcast
 *   4. drives the whole loop as a player and as the market, and asserts what the keeper did on chain
 *
 * Needs anvil and forge on PATH. Anvil's well-known dev keys only; nothing here is a secret.
 * Fake Telegram and a fake second price source run in this process (KEEPER_TELEGRAM_API, --price-check URL).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arclawAbi, mockPriceSourceAbi } from "../lib/abi";
import { MACHINES_FILE, SYMBOLS, buildTable, sameTable, type ChainOutcome } from "../lib/keeper/table";
import { REPO, run, snapshotContracts } from "./keeper/snapshot";

// anvil's default dev accounts (public test keys)
const K = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // owner / deployer
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // operator + keeper (the hot key)
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // player
] as const;
const [owner, keeper, player] = K.map((k) => privateKeyToAccount(k));
const D20_TESTNET = "0xd20DA0FF9087d053f0291524Eac12abA1ADBd945" as Address;
const PORT = 18_000 + Math.floor(Math.random() * 2000);
const RPC = `http://127.0.0.1:${PORT}`;
const MOCK = [180e6, 250e6, 230e6, 220e6, 700e6, 190e6, 650e6, 560e6].map(BigInt);

const vrfAbi = parseAbi(["function fulfill(uint256 id, bytes32 word) returns (bool)", "function getRequest(uint256) view returns ((address,uint32,uint64,uint64,uint64,address,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bool,bool,bool,uint64,bytes32))"]);

/* ---------- reporting ---------- */

const proved: string[] = [];
const log = (s: string) => process.stdout.write(`${s}\n`);
function ok(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${what}`);
  proved.push(what);
  log(`  PASS ${what}`);
}

/* ---------- fake Telegram + second source ---------- */

const telegram: string[] = [];
let feedMode: "ok" | "disagree" | "stale" | "down" = "ok";
let prices = [...MOCK];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url?.includes("/sendMessage")) {
      telegram.push((JSON.parse(body) as { text: string }).text);
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (req.url?.startsWith("/prices")) {
      if (feedMode === "down") return void res.writeHead(502).end("bad gateway");
      const at = new Date(Date.now() - (feedMode === "stale" ? 3600_000 : 0)).toISOString();
      const quotes = SYMBOLS.map((symbol, i) => ({ symbol, mid: (Number(prices[i]) / 1e6) * (feedMode === "disagree" && symbol === "NVDA" ? 1.015 : 1), halted: false, generatedAt: at }));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ quotes }));
      return;
    }
    res.writeHead(404).end();
  });
});
const FAKE_PORT = PORT + 1;
const FAKE = `http://127.0.0.1:${FAKE_PORT}`;

/* ---------- chain helpers ---------- */

const chain = defineChain({ id: 5042002, name: "anvil-arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = (i: number) => createWalletClient({ account: privateKeyToAccount(K[i]!), chain, transport: http(RPC) });

async function rpc(method: string, params: unknown[] = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const warp = async (s: number) => {
  await rpc("evm_increaseTime", [s]);
  await rpc("evm_mine");
};

let dep: { arclaw: Address; priceSource: Address; stocks: Record<string, Address> };
const tokens = () => SYMBOLS.map((s) => dep.stocks[`${s}.arc`]!);

async function send(i: number, address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[], value?: bigint, gas?: bigint) {
  const hash = await wallet(i).writeContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, value, gas } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
  return r;
}
const read = <T>(functionName: string, args: readonly unknown[] = []) => pub.readContract({ address: dep.arclaw, abi: arclawAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
const tableId = async (m: number) => (await read<bigint>("currentTable", [BigInt(m)])) - 1n;
const status = async (id: bigint) => Number((await read<readonly unknown[]>("openings", [id]))[4]);
const requestOf = async (id: bigint) => (await read<readonly unknown[]>("openings", [id]))[6] as bigint;

async function playAndOpen(machine: number, boxes: number): Promise<{ openingId: bigint; requestId: bigint }> {
  const price = BigInt(MACHINES_FILE.machines.find((x) => x.id === machine)!.priceUsdc) * 10n ** 18n;
  await send(2, dep.arclaw, arclawAbi, "play", [BigInt(machine), BigInt(boxes)], price * BigInt(boxes));
  const r = await send(2, dep.arclaw, arclawAbi, "open", [BigInt(machine), BigInt(boxes), await tableId(machine)]);
  for (const l of r.logs) {
    try {
      const e = decodeEventLog({ abi: arclawAbi, data: l.data, topics: l.topics });
      if (e.eventName === "Opened") return { openingId: e.args.openingId, requestId: e.args.requestId };
    } catch {
      // not ours
    }
  }
  throw new Error("no Opened event");
}
// explicit gas: the mock swallows a starved callback, so an estimate would find that cheaper (undelivered) path
/** Opens one sealed box the player already holds. */
async function openSealed(machine: number): Promise<{ openingId: bigint; requestId: bigint }> {
  const r = await send(2, dep.arclaw, arclawAbi, "open", [BigInt(machine), 1n, await tableId(machine)]);
  for (const l of r.logs) {
    try {
      const e = decodeEventLog({ abi: arclawAbi, data: l.data, topics: l.topics });
      if (e.eventName === "Opened") return { openingId: e.args.openingId, requestId: e.args.requestId };
    } catch {
      // not ours
    }
  }
  throw new Error("no Opened event");
}
const fulfill = (requestId: bigint) => send(0, D20_TESTNET, vrfAbi, "fulfill", [requestId, keccak256(toHex(`word-${requestId}`))], undefined, 600_000n);
async function setPrice(symbol: string, px: bigint) {
  const i = SYMBOLS.indexOf(symbol as never);
  prices[i] = px;
  await send(0, dep.priceSource, mockPriceSourceAbi, "setPrices", [[tokens()[i]!], [px]]);
}
async function chainTable(m: number): Promise<ChainOutcome[]> {
  const outs = (await read<readonly { weight: bigint; tier: number; value: bigint; cards: readonly { token: Address; value: bigint; amount: bigint }[] }[]>("outcomes", [BigInt(m)])) ?? [];
  return outs.map((o) => ({ weight: BigInt(o.weight), tier: Number(o.tier), value: BigInt(o.value), cards: o.cards.map((c) => ({ token: c.token, value: BigInt(c.value), amount: BigInt(c.amount) })) }));
}
async function tablesMatch(px: readonly bigint[], ids: readonly number[] = MACHINES_FILE.machines.map((m) => m.id)) {
  for (const m of MACHINES_FILE.machines.filter((x) => ids.includes(x.id))) {
    if (!sameTable(buildTable(m, MACHINES_FILE.policy.floorBps, tokens(), px), await chainTable(m.id))) return false;
  }
  return true;
}

/* ---------- the CLI ---------- */

let depPath = "";
let statePath = "";
type Event = { kind: string; level: string; message: string };
type CliOut = {
  code: number;
  stdout: string;
  stderr: string;
  json: {
    ok: boolean;
    skipped: string | null;
    events: Event[];
    repriced: { machineId: number; reason: string; done: boolean; note: string }[];
    health: { ok: boolean; issues: { key: string; severity: string; message: string }[]; metrics: Record<string, string | number | boolean | null> } | null;
    error: string | null;
    accepted?: boolean;
    machines?: { id: number; fresh: boolean; waking: boolean }[];
  };
};

const baseEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(KEEPER_|ALERT_|TELEGRAM_)/.test(k)) env[k] = v;
  return {
    ...env,
    KEEPER_NO_ENV_FILE: "1",
    KEEPER_PRIVATE_KEY: K[1],
    KEEPER_NETWORK: "local",
    KEEPER_RPC_URL: RPC,
    KEEPER_PRICE_CHECK: "off",
    KEEPER_MARKET: "closed",
    TELEGRAM_BOT_TOKEN: "e2e-token",
    ALERT_TELEGRAM_CHAT_ID: "42",
    KEEPER_TELEGRAM_API: FAKE,
  };
};

/** Native crashes of the CLI process seen on Windows (0xC0000409 at exit, no output), counted in the summary. */
let nativeCrashes = 0;

/**
 * Runs the CLI. A native crash (exit code above 255, nothing printed) is retried once: a tick is idempotent (the chain
 * is the source of truth, every call is simulated first), so the retry also shows a crashed tick does not wedge or
 * double-send.
 */
async function cli(args: string[], env: Record<string, string> = {}): Promise<CliOut> {
  const r = await cliOnce(args, env);
  if (r.code > 255 && !r.stdout) {
    nativeCrashes++;
    log(`      (CLI process crashed natively, exit ${r.code}; retrying once)`);
    return cliOnce(args, env);
  }
  return r;
}

function cliOnce(args: string[], env: Record<string, string> = {}): Promise<CliOut> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), join(REPO, "scripts", "keeper", "cli.ts"), ...args, "--json", "--deployment", depPath, "--state", statePath], { cwd: REPO, env: { ...baseEnv(), ...env } as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => {
      let json: CliOut["json"];
      try {
        json = { ok: true, skipped: null, events: [], repriced: [], health: null, error: null, ...JSON.parse(stdout) };
      } catch {
        json = { ok: false, skipped: null, events: [], repriced: [], health: null, error: `exit ${code}, stderr: ${stderr.trim()} | stdout(${stdout.length}): ${stdout.slice(0, 200)}` };
      }
      resolve({ code: code ?? 1, stdout, stderr, json });
    });
  });
}
const kinds = (o: CliOut) => o.json.events.map((e) => e.kind);
const doneIds = (o: CliOut) => o.json.repriced.filter((r) => r.done).map((r) => r.machineId).sort();
const severityOf = (o: CliOut, key: string) => o.json.health?.issues.find((i) => i.key === key)?.severity ?? null;
const issueKeys = (o: CliOut) => (o.json.health?.issues ?? []).map((i) => i.key);
const show = (o: CliOut) => {
  for (const e of o.json.events) log(`      ${e.kind}: ${e.message}`);
  for (const r of o.json.repriced) log(`      reprice m${r.machineId} ${r.reason} ${r.done ? "done" : "skipped"}: ${r.note}`);
  if (o.json.error) log(`      error: ${o.json.error.replace(/\n/g, " / ")}`);
  if (o.json.skipped) log(`      skipped: ${o.json.skipped}`);
  if (!o.json.events.length && !o.json.repriced.length) log(`      (quiet tick) issues: ${(o.json.health?.issues ?? []).map((i) => `${i.key}=${i.severity}`).join(" ")}`);
};

/* ---------- run ---------- */

async function main() {
  const snap = snapshotContracts({}, process.argv.includes("--worktree") ? "worktree" : "head");
  let anvil: ChildProcess | null = null;
  try {
    log(`snapshot ${snap.root}`);
    log("forge build (snapshot)...");
    run("forge", ["build"], { cwd: snap.contracts });
    const vrfArt = JSON.parse(readFileSync(join(snap.contracts, "out", "MockVRFCoordinator.sol", "MockVRFCoordinator.json"), "utf8")) as { deployedBytecode: { object: Hex } };

    anvil = spawn("anvil", ["--chain-id", "5042002", "--port", String(PORT), "--silent"], { stdio: "ignore" });
    for (let i = 0; ; i++) {
      try {
        await rpc("eth_chainId");
        break;
      } catch {
        if (i > 100) throw new Error("anvil did not start");
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    await new Promise<void>((r) => server.listen(FAKE_PORT, "127.0.0.1", r));
    log(`anvil ${RPC}, fakes ${FAKE}`);

    // the D20 testnet coordinator address gets the mock's code; constructor storage set by hand (fee, nextId)
    await rpc("anvil_setCode", [D20_TESTNET, vrfArt.deployedBytecode.object]);
    await rpc("anvil_setStorageAt", [D20_TESTNET, toHex(0, { size: 32 }), toHex(2n * 10n ** 16n, { size: 32 })]);
    await rpc("anvil_setStorageAt", [D20_TESTNET, toHex(1, { size: 32 }), toHex(1, { size: 32 })]);

    log("deploy: MOCK_PRICES=1 forge script Deploy.s.sol --broadcast (snapshot)...");
    run("forge", ["script", "script/Deploy.s.sol", "--tc", "Deploy", "--rpc-url", RPC, "--private-key", K[0], "--broadcast", "--slow"], {
      cwd: snap.contracts,
      env: { MOCK_PRICES: "1", OPERATOR: keeper!.address, OWNER: owner!.address },
    });
    depPath = join(snap.lib, "deployments", "arc-testnet.json");
    statePath = join(snap.root, "keeper-state.json");
    dep = JSON.parse(readFileSync(depPath, "utf8"));
    log(`arclaw ${dep.arclaw}`);

    log("\n[1] the TypeScript buildTable equals what Deploy.s.sol put on chain");
    ok(await tablesMatch(MOCK), "deploy tables (Solidity buildTable, MOCK prices) == TS buildTable for all 3 machines");

    log("\n[2] health on a fresh deploy");
    let o = await cli(["health"]);
    show(o);
    ok(o.json.health && o.json.health.issues.every((i) => i.severity !== "critical"), "fresh deploy: no critical issue (keeper role, operator role, tables fresh)");

    log("\n[3] play, open, VRF fulfils, the keeper reveals");
    const a = await playAndOpen(1, 3);
    await fulfill(a.requestId);
    ok((await status(a.openingId)) === 2, `opening #${a.openingId} fulfilled by the mock VRF`);
    o = await cli(["tick"]);
    show(o);
    ok(kinds(o).includes("revealed") && (await status(a.openingId)) === 3, `keeper revealed opening #${a.openingId} (3 boxes)`);

    log("\n[4] dry run signs nothing (KEEPER_ADDRESS only, no key)");
    const b = await playAndOpen(2, 1);
    await fulfill(b.requestId);
    o = await cli(["tick", "--dry-run"], { KEEPER_PRIVATE_KEY: "", KEEPER_ADDRESS: keeper!.address });
    show(o);
    ok(kinds(o).includes("reveal-dry-run") && (await status(b.openingId)) === 2, "dry run simulated the reveal and left the opening fulfilled");

    log("\n[5] two ticks at once: one signer, no double send");
    const [t1, t2] = await Promise.all([cli(["tick"]), cli(["tick"])]);
    const reveals = [...kinds(t1), ...kinds(t2)].filter((k) => k === "revealed").length;
    ok(reveals === 1 && (await status(b.openingId)) === 3 && t1.json.ok && t2.json.ok, `parallel ticks: exactly one reveal (${t1.json.skipped ?? "ran"} / ${t2.json.skipped ?? "ran"})`);

    log("\n[6] the lock: a live lease blocks, an expired one is taken over");
    writeFileSync(`${statePath}.signer.lock`, JSON.stringify({ pid: 1, until: Date.now() + 60_000 }));
    o = await cli(["tick"]);
    ok(o.json.skipped !== null, `held lock: tick skipped (${o.json.skipped})`);
    writeFileSync(`${statePath}.signer.lock`, JSON.stringify({ pid: 1, until: Date.now() - 1 }));
    o = await cli(["tick"]);
    ok(o.json.skipped === null && o.json.ok && !existsSync(`${statePath}.signer.lock`), "expired lease taken over, tick ran and released the lock");

    log("\n[7] an expired VRF request: the keeper retries it once (Arclaw allows one), logged with openingRetries");
    const c = await playAndOpen(1, 1);
    await warp(61);
    o = await cli(["tick"]);
    show(o);
    const req1 = await requestOf(c.openingId);
    ok(kinds(o).includes("retried") && req1 !== c.requestId && o.json.events.some((e) => e.kind === "retried" && /openingRetries 1\/1/.test(e.message)), `retry: request ${c.requestId} -> ${req1}, openingRetries 1/1`);
    o = await cli(["tick"]);
    ok(!kinds(o).includes("retried"), "no retry while the new request is live");
    await fulfill(req1);
    o = await cli(["tick"]);
    show(o);
    ok((await status(c.openingId)) === 3, "VRF answers the retry: keeper reveals");

    log("\n[8] demand policy: a 3% move reprices the machines people use, the idle one is left alone");
    const m3before = await tableId(3);
    let before = await tableId(1);
    await setPrice("NVDA", (prices[0]! * 103n) / 100n);
    o = await cli(["tick"]);
    show(o);
    ok(doneIds(o).join() === "1,2" && (await tableId(1)) > before, "moved: machines 1 and 2 (played today) repriced");
    ok((await tableId(3)) === m3before, "machine 3 (never played, no sealed boxes, no wake) not repriced, nothing spent on it");
    ok(await tablesMatch(prices, [1, 2]), "repriced tables == TS buildTable at the new oracle prices");

    log("\n[9] a 6% move: the contract refuses opens, health flags it (by demand), the keeper unfreezes it");
    await setPrice("TSLA", (prices[1]! * 106n) / 100n);
    const t1id = await tableId(1);
    let refused = "";
    try {
      await pub.simulateContract({ account: player!, address: dep.arclaw, abi: arclawAbi, functionName: "open", args: [1n, 1n, t1id] });
    } catch (e) {
      refused = String((e as Error).message);
    }
    o = await cli(["health"]);
    ok(/TableStale|reverted/.test(refused) && severityOf(o, "frozen:1") === "warn" && severityOf(o, "frozen:3") === "info", "open reverts TableStale; frozen:1 warns (demand), frozen:3 is info (idle)");
    o = await cli(["tick"]);
    show(o);
    ok(doneIds(o).join() === "1,2", "keeper repriced machines 1 and 2 only");
    const f = await playAndOpen(1, 1);
    await fulfill(f.requestId);
    o = await cli(["tick"]);
    ok((await status(f.openingId)) === 3, "opens work again on machine 1 and the keeper reveals");

    log("\n[10] oracle outage: no reprice; back: tables older than 18 h with demand are refreshed");
    await warp(19 * 3600);
    before = await tableId(1);
    await send(0, dep.priceSource, mockPriceSourceAbi, "setPrices", [[tokens()[5]!], [0n]]); // GOOGL unpriced
    o = await cli(["tick"]);
    show(o);
    ok(issueKeys(o).includes("oracle") && (await tableId(1)) === before, "oracle down: aged reprice skipped (fail closed), oracle issue raised");
    await setPrice("GOOGL", prices[5]!);
    o = await cli(["tick"]);
    show(o);
    ok(doneIds(o).join() === "1,2" && o.json.repriced.every((r) => r.reason === "aged") && (await tablesMatch(prices, [1, 2])), "oracle back: machines 1 and 2 repriced as aged (19 h, demand), machine 3 not");

    log("\n[11] second source: agree, disagree by 1.5%, stale, down (forced reprice ignores demand)");
    const pcFlag = ["--price-check", `${FAKE}/prices`];
    feedMode = "ok";
    before = await tableId(1);
    o = await cli(["reprice", "--force", ...pcFlag]);
    show(o);
    ok(o.json.repriced.length === 3 && o.json.repriced.every((r) => r.done) && (await tableId(1)) > before, "second source agrees: forced reprice of all 3 lands");
    for (const mode of ["disagree", "stale", "down"] as const) {
      feedMode = mode;
      before = await tableId(1);
      o = await cli(["reprice", "--force", ...pcFlag]);
      show(o);
      ok(o.json.repriced.every((r) => !r.done) && issueKeys(o).includes("price-check") && (await tableId(1)) === before, `second source ${mode}: reprice skipped, price-check issue`);
    }
    feedMode = "ok";

    log("\n[12] the daily cap: at most N reprices per machine per UTC day, then an alert; gas spend per day in health");
    const now0 = Number((await pub.getBlock()).timestamp);
    await warp(86_400 - (now0 % 86_400) + 60); // 00:01 UTC of the next chain day
    await send(2, dep.arclaw, arclawAbi, "play", [1n, 1n], 10n ** 18n); // a sealed box: demand on machine 1
    const capEnv = { KEEPER_MAX_REPRICES_PER_DAY: "2" };
    for (let i = 1; i <= 2; i++) {
      await setPrice("NVDA", (prices[0]! * 103n) / 100n);
      o = await cli(["tick"], capEnv);
      show(o);
      ok(doneIds(o).includes(1), `move ${i}: machine 1 repriced (${i}/2 today)`);
    }
    ok(Number(o.json.health?.metrics.gasSpentTodayUsdc) > 0 && o.json.health?.metrics.m1RepricesToday === 2, `health: gas spent today ${o.json.health?.metrics.gasSpentTodayUsdc} USDC, machine 1 repriced 2 times today`);
    await setPrice("NVDA", (prices[0]! * 103n) / 100n);
    o = await cli(["tick"], capEnv);
    show(o);
    ok(!doneIds(o).includes(1) && kinds(o).includes("reprice-capped") && telegram.some((t) => t.includes("reprice-cap:1")), "move 3: cap reached, machine 1 skipped, reprice-cap:1 alerted");

    log("\n[13] no demand: tables go stale and nothing is spent");
    const g1 = await openSealed(1);
    await fulfill(g1.requestId);
    o = await cli(["tick"], capEnv);
    ok((await status(g1.openingId)) === 3, "the sealed box is opened and revealed (machine 1 has no sealed boxes left)");
    await warp(25 * 3600);
    const idle = [await tableId(1), await tableId(2), await tableId(3)];
    o = await cli(["tick"]);
    show(o);
    ok(!o.json.repriced.some((r) => r.done) && (await Promise.all([1, 2, 3].map(tableId))).join() === idle.join(), "25 h later with no plays, boxes or openings: no reprice at all");
    ok(["stale:1", "stale:2", "stale:3"].every((k) => severityOf(o, k) === "info") && Number(o.json.health?.metrics.gasSpentTodayUsdc) === 0, "stale idle tables are info only, 0 USDC spent today");
    let st = await cli(["status"]);
    ok(st.json.machines?.every((m) => !m.fresh) === true, "status: every machine reads not fresh");

    log("\n[14] wake: a visitor wakes machine 3, the 10 s loop reprices it, the status page sees it fresh");
    let w = await cli(["wake", "--machine", "3"]);
    const w2 = await cli(["wake", "--machine", "3"]);
    ok(w.json.accepted === true && w2.json.accepted === false, "wake recorded once, the second within 60 s ignored");
    st = await cli(["status"]);
    ok(st.json.machines?.find((m) => m.id === 3)?.waking === true, "status: machine 3 waking");
    o = await cli(["tick", "--reveal-only"]);
    show(o);
    // its table is both stale (25 h) and moved (the cap step moved NVDA 9%): "moved" is checked first
    ok(doneIds(o).join() === "3" && /stale|moved/.test(o.json.repriced[0]!.reason), `reveal loop: machine 3 repriced (${o.json.repriced[0]?.reason} + wake), 1 and 2 left asleep`);
    st = await cli(["status"]);
    const fr = st.json.machines ?? [];
    ok(fr.find((m) => m.id === 3)?.fresh === true && fr.find((m) => m.id === 3)?.waking === false && fr.find((m) => m.id === 1)?.fresh === false, "status: machine 3 fresh, machine 1 still stale");
    o = await cli(["tick", "--reveal-only"]);
    ok(!o.json.repriced.length, "the same wake is not acted on twice");
    o = await cli(["tick"]);
    ok(!o.json.repriced.some((r) => r.done), "full tick: machine 3 fresh, 1 and 2 without demand: nothing to do");
    w = await cli(["wake", "--machine", "9"]);
    ok(w.code !== 0, "wake for an unknown machine refused");

    log("\n[15] VRF down on one opening: its one retry expires too; alert once, pauseIfVrfDown probe (free when alive), returnBoxes after the table ages");
    const d = await playAndOpen(3, 2);
    await warp(61);
    o = await cli(["tick"]);
    show(o);
    ok(kinds(o).includes("retried"), "first expiry: retried once");
    await warp(61);
    o = await cli(["tick"]);
    show(o);
    const gasBefore = await pub.getBalance({ address: keeper!.address });
    ok(kinds(o).includes("retry-stopped") && issueKeys(o).includes("vrf-retry-expired") && telegram.filter((t) => t.startsWith("CRITICAL") && t.includes("vrf-retry-expired")).length === 1, "retry used and expired again: no second retry (RetryLimit), vrf-retry-expired alerted");
    ok(kinds(o).includes("vrf-probe") && !(await read<boolean>("paused")), "opens failing: pauseIfVrfDown probed, VRF alive (mock answers requests), contract not paused, nothing signed");
    ok(Number(o.json.health?.metrics.vrfMissesToday) >= 1 && o.json.health?.metrics.maxMisses === 10, `health: VRF misses today ${o.json.health?.metrics.vrfMissesToday}/${o.json.health?.metrics.maxMisses}, JIT ${o.json.health?.metrics.jitSpentTodayUsdc}/${o.json.health?.metrics.jitCapUsdc}`);
    o = await cli(["tick"]);
    ok(!kinds(o).includes("vrf-probe") && !kinds(o).includes("retried") && telegram.filter((t) => t.includes("vrf-retry-expired") && t.startsWith("CRITICAL")).length === 1 && (await pub.getBalance({ address: keeper!.address })) === gasBefore, "next tick: no probe (10 min spacing), no retry, alert not re-sent, no gas spent");
    await warp(86_400 + 120);
    o = await cli(["health"]);
    ok(severityOf(o, "stale:3") === "warn" && severityOf(o, "stale:1") === "info", "health: stale:3 warns (opening in flight), stale:1 info (idle)");
    o = await cli(["tick"]);
    show(o);
    ok(doneIds(o).join() === "3" && o.json.repriced[0]!.reason === "stale", "machine 3 repriced as stale (demand: opening in flight)");
    const back = await send(2, dep.arclaw, arclawAbi, "returnBoxes", [d.openingId]).then(() => true, () => false);
    ok(back && (await status(d.openingId)) === 4, `opener took boxes of opening #${d.openingId} back (returnBoxes)`);
    o = await cli(["tick"]);
    ok(telegram.some((t) => t.startsWith("RESOLVED") && t.includes("vrf-retry-expired")), "opening closed: vrf-retry-expired resolved on Telegram");

    log("\n[16] a stuck keeper transaction blocks sends until it clears");
    const e = await playAndOpen(3, 1);
    await fulfill(e.requestId);
    await rpc("evm_setAutomine", [false]);
    await wallet(1).sendTransaction({ to: keeper!.address, value: 0n });
    o = await cli(["tick"]);
    show(o);
    ok(kinds(o).includes("stuck") && !kinds(o).includes("revealed"), "pending keeper nonce: tick sends nothing");
    await rpc("evm_setAutomine", [true]);
    await rpc("evm_mine");
    o = await cli(["tick"]);
    ok(kinds(o).includes("revealed") && (await status(e.openingId)) === 3, "nonce mined: next tick reveals");

    log("\n[17] failing ticks never wedge the next one; three in a row alert");
    for (let i = 0; i < 3; i++) {
      o = await cli(["tick"], { KEEPER_RPC_URL: "http://127.0.0.1:1" });
      ok(o.code === 1 && !o.json.ok, `tick with a dead RPC fails cleanly (${i + 1})`);
    }
    ok(telegram.some((t) => t.startsWith("CRITICAL") && t.includes("keeper-failing")), "keeper-failing alert after 3 failures");
    o = await cli(["tick"]);
    ok(o.json.ok && o.json.skipped === null && telegram.some((t) => t.startsWith("RESOLVED") && t.includes("keeper-failing")), "next good tick runs (lock released) and resolves the alert");

    log("\n[18] D20 dies with an opening in flight: the keeper's pauseIfVrfDown probe pauses the contract");
    const v = await playAndOpen(3, 1);
    await rpc("anvil_setCode", [D20_TESTNET, "0xfe"]); // every call to the coordinator now fails
    await warp(601); // past the request deadline and the 10 min probe spacing
    o = await cli(["tick"]);
    show(o);
    ok(issueKeys(o).includes("vrf-unreadable") && kinds(o).includes("vrf-paused") && (await read<boolean>("paused")), `coordinator dead: vrf-unreadable raised, pauseIfVrfDown sent, Arclaw paused (opening #${v.openingId} waits for returnBoxes)`);
    o = await cli(["health"]);
    ok(severityOf(o, "paused") === "critical" && telegram.some((t) => t.includes("vrf-down")), "vrf-down alerted; next health: paused critical");

    log("\n[19] final health");
    o = await cli(["health"]);
    show(o);
    for (const i of o.json.health?.issues ?? []) log(`      ${i.severity} ${i.key}: ${i.message}`);
    ok(o.json.health !== null, "health report readable");

    log(`\nALL PASSED: ${proved.length} checks. Telegram messages: ${telegram.length}. Native CLI crashes retried: ${nativeCrashes}`);
  } finally {
    anvil?.kill();
    server.close();
    snap.cleanup();
  }
}

main().catch((e) => {
  log(`\n${(e as Error).message}`);
  process.exit(1);
});
