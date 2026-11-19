/** Reuses Kondora's devnet wallets. No wallet keys are copied or generated.
 * pnpm solana:soak --audit
 * pnpm solana:soak --limit 200 --concurrency 8 --passes 1
 * pnpm solana:soak --cleanup-only
 * Repeating a command resumes its checkpoint; choose --run NAME for a new test.
 */
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { SOLANA, USDC_MINT } from "../../lib/solana/config";
import { baseConnection, boxFromSettle, readPlayer, readRound, STOCK_MINTS } from "../../lib/solana/client";
import { configPda, decodeConfig, decodeMachine, machinePda, playIx, programId, treasuryAta, usdcMint } from "../../lib/solana/program";
import { ClawDriver, dropAndDraw, finishRound, pendingRound, settle, startRound, voidOnBase, waitForDraw, waitOnRollup, type Sender, type RoundHandle } from "../../lib/solana/round";
import { stockOf } from "../../lib/stocks";
import { loadWallets, quoteStock, withdrawIx } from "./soak-utils";

const { values } = parseArgs({ options: {
  wallets: { type: "string", default: "../kondora/.keys/faucet/wallets.json" },
  limit: { type: "string", default: "200" }, concurrency: { type: "string", default: "8" },
  passes: { type: "string", default: "1" }, machines: { type: "string", default: "1" },
  run: { type: "string", default: "kondora-200" }, audit: { type: "boolean", default: false },
  "cleanup-only": { type: "boolean", default: false },
} });
function integer(value: string, max: number) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`Expected an integer between 1 and ${max}.`);
  return n;
}
const limit = integer(values.limit!, 200), concurrency = integer(values.concurrency!, 20), passes = integer(values.passes!, 1000);
const machines = values.machines!.split(",").map((v) => integer(v, 3));
if (!/^[a-zA-Z0-9_-]+$/.test(values.run!)) throw new Error("Invalid run name.");
const wallets = loadWallets(JSON.parse(readFileSync(resolve(values.wallets!), "utf8"))).slice(0, limit);
assert.equal(wallets.length, limit, "The input file has fewer wallets than requested.");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync((process.env.SOLANA_KEYPAIR ?? "~/.config/solana/id.json").replace(/^~/, homedir()), "utf8"))));
assert.ok(!wallets.some((w) => w.publicKey.equals(admin.publicKey)), "Admin must not also be a test wallet.");
const conn = baseConnection();
const root = resolve(".cache/solana-soak", values.run!);
mkdirSync(root, { recursive: true });
const json = (path: string, value: unknown) => { writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(`${path}.tmp`, path); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/(?:https?|wss?):\/\/\S+/g, "[rpc]").slice(0, 500);
type Sale = { items: { mint: string; amount: string; decimals: number; value: string }[]; value: string; signature?: string; lastValidBlockHeight?: number; raw?: string };
type Progress = { completed: number; attempts: number; round?: { address: string; id: string; machineId: number; settleSignature?: string }; sale?: Sale; error?: string; voids: number };
type State = { version: number; program: string; wallets: string[]; machines: number[]; passes: number; startedAt: string; rows: Record<string, Progress>; initial?: Inventory; finishedAt?: string };
type Inventory = { wallets: { wallet: string; usdc: string; lamports: number; stocks: Record<string, string> }[]; treasury: string; adminUsdc: string; adminLamports: number };
const statePath = join(root, "state.json");
const identities = wallets.map((w) => w.publicKey.toBase58());
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { version: 1, program: programId().toBase58(), wallets: identities, machines, passes, startedAt: new Date().toISOString(), rows: {} };
assert.equal(state.program, programId().toBase58());
assert.deepEqual(state.wallets, identities, "Use the same wallet selection when resuming, or choose another --run.");
assert.deepEqual(state.machines, machines, "Machine selection changed; choose another --run.");
assert.equal(state.passes, passes, "Pass count changed; choose another --run.");
const save = () => json(statePath, state);
// startRound persists the driver BEFORE broadcasting. Keep that same recovery behavior in Node.
const sessionsPath = join(root, "sessions.json");
const sessions: Record<string, string> = existsSync(sessionsPath) ? JSON.parse(readFileSync(sessionsPath, "utf8")) : {};
Object.assign(globalThis, { localStorage: {
  getItem: (k: string) => sessions[k] ?? null,
  setItem: (k: string, v: string) => { sessions[k] = v; json(sessionsPath, sessions); },
  removeItem: (k: string) => { delete sessions[k]; json(sessionsPath, sessions); },
} });
function log(event: string, wallet?: Keypair, extra: Record<string, unknown> = {}) {
  const row = { at: new Date().toISOString(), event, wallet: wallet?.publicKey.toBase58(), ...extra };
  appendFileSync(join(root, "events.jsonl"), `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify(row));
}
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; log("stop-requested", undefined, { note: "Finishing active rounds and converting stocks before stopping." }); });
// Serializes shared-bank decisions, without serializing rollup rounds.
let bankTail: Promise<unknown> = Promise.resolve();
const active = new Set<string>();
function bank<T>(fn: () => Promise<T>): Promise<T> {
  const next = bankTail.then(fn); bankTail = next.catch(() => {}); return next;
}
const ata = (owner: PublicKey, mint = usdcMint(), offCurve = false) => getAssociatedTokenAddressSync(mint, owner, offCurve);
async function amount(address: PublicKey) { return (await conn.getAccountInfo(address))?.data.readBigUInt64LE(64) ?? 0n; }
async function infos(keys: PublicKey[]) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) { out.push(...await conn.getMultipleAccountsInfo(keys.slice(i, i + 100))); await sleep(70); }
  return out;
}
async function inventory(): Promise<Inventory> {
  const owners = [...wallets.map((w) => w.publicKey), admin.publicKey];
  const keys = owners.flatMap((o) => [o, ata(o), ...STOCK_MINTS.map((s) => ata(o, new PublicKey(s.mint)))]);
  const accounts = await infos([...keys, treasuryAta()]);
  const width = STOCK_MINTS.length + 2;
  const rows = owners.map((o, i) => ({ wallet: o.toBase58(), lamports: accounts[i * width]?.lamports ?? 0, usdc: `${accounts[i * width + 1]?.data.readBigUInt64LE(64) ?? 0n}`, stocks: Object.fromEntries(STOCK_MINTS.map((s, j) => [s.ticker, `${accounts[i * width + j + 2]?.data.readBigUInt64LE(64) ?? 0n}`])) }));
  return { wallets: rows.slice(0, -1), treasury: `${accounts.at(-1)?.data.readBigUInt64LE(64) ?? 0n}`, adminUsdc: rows.at(-1)!.usdc, adminLamports: rows.at(-1)!.lamports };
}
async function send(tx: Transaction, signers: Keypair[], onSigned?: (signature: string, raw: string, lastValidBlockHeight: number) => void) {
  const bh = await conn.getLatestBlockhash("confirmed");
  tx.feePayer = admin.publicKey; tx.recentBlockhash = bh.blockhash;
  tx.sign(...[...new Map([admin, ...signers].map((k) => [k.publicKey.toBase58(), k])).values()]);
  const signature = bs58.encode(tx.signature!);
  const raw = tx.serialize();
  onSigned?.(signature, raw.toString("base64"), bh.lastValidBlockHeight);
  await conn.sendRawTransaction(raw, { maxRetries: 5 });
  const result = await conn.confirmTransaction({ signature, ...bh }, "confirmed");
  if (result.value.err) throw new Error(`Transaction ${signature}: ${JSON.stringify(result.value.err)}`);
  return signature;
}
function sender(wallet: Keypair, progress: Progress): Sender {
  return { publicKey: wallet.publicKey, async sign(tx) { tx.partialSign(wallet); return tx; },
    send: (tx, signers = []) => send(tx, [wallet, ...signers], (signature) => {
      // A crash after settlement must not lose the signature used to verify paid prizes.
      if (progress.round && tx.instructions.some((ix) => ix.programId.equals(programId()) && ix.data.subarray(0, 8).equals(Buffer.from([40, 101, 18, 1, 31, 129, 52, 77])))) {
        progress.round.settleSignature = signature; save();
      }
    }),
  };
}
/** Moves existing devnet USDC, never mints it. Leave a small USDC remainder in donors. */
async function fundUsdc(destination: PublicKey, needed: bigint, exclude?: PublicKey) {
  let left = needed;
  const candidates = [admin, ...wallets].filter((w) => !exclude?.equals(w.publicKey) && !active.has(w.publicKey.toBase58()));
  const balances = await infos(candidates.map((w) => ata(w.publicKey)));
  const donors = candidates.map((w, i) => ({ w, available: (balances[i]?.data.readBigUInt64LE(64) ?? 0n) - 10_000n })).filter((d) => d.available > 0n).sort((a, b) => a.available > b.available ? -1 : 1);
  assert.ok(donors.reduce((a, d) => a + d.available, 0n) >= left, "Insufficient shared devnet USDC. No new boxes were purchased; top up a test wallet and resume.");
  for (const d of donors) {
    const take = d.available < left ? d.available : left;
    await send(new Transaction().add(createTransferCheckedInstruction(ata(d.w.publicKey), usdcMint(), destination, d.w.publicKey, take, 6)), [d.w]);
    log("rotate-usdc", d.w, { amount: `${take}`, destination: destination.toBase58() });
    left -= take; if (left === 0n) return;
  }
}
async function ensurePlayable(wallet: Keypair, price: bigint) {
  await bank(async () => {
    const ownAta = ata(wallet.publicKey);
    const balance = await amount(ownAta);
    // Wallet pays account rent/session funding; admin sponsors fees and tops up test SOL.
    const lamports = await conn.getBalance(wallet.publicKey);
    const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ownAta, wallet.publicKey, usdcMint()));
    if (lamports < 25_000_000) tx.add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: wallet.publicKey, lamports: 40_000_000 - lamports }));
    await send(tx, []);
    if (balance < price) await fundUsdc(ownAta, price - balance, wallet.publicKey);
  });
}
async function confirmSale(sale: Sale) {
  assert.ok(sale.signature && sale.raw && sale.lastValidBlockHeight, "Incomplete sale checkpoint.");
  let status = (await conn.getSignatureStatuses([sale.signature], { searchTransactionHistory: true })).value[0];
  if (!status && await conn.getBlockHeight("confirmed") <= sale.lastValidBlockHeight) {
    await conn.sendRawTransaction(Buffer.from(sale.raw, "base64"), { maxRetries: 5 }).catch(() => {});
    const result = await conn.confirmTransaction({ signature: sale.signature, blockhash: Transaction.from(Buffer.from(sale.raw, "base64")).recentBlockhash!, lastValidBlockHeight: sale.lastValidBlockHeight }, "confirmed");
    if (result.value.err) throw new Error(`Buyback failed: ${JSON.stringify(result.value.err)}`);
    status = (await conn.getSignatureStatuses([sale.signature], { searchTransactionHistory: true })).value[0];
  }
  if (status?.err) throw new Error(`Buyback failed: ${JSON.stringify(status.err)}`);
  if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return true;
  // Do not generate another signed payment after an ambiguous outcome.
  throw new Error(`Unresolved buyback ${sale.signature}; inspect this signature before replacing its checkpoint.`);
}
async function sellStocks(wallet: Keypair, progress: Progress) {
  await bank(async () => {
    if (progress.sale?.signature) {
      await confirmSale(progress.sale);
      log("buyback-confirmed", wallet, { signature: progress.sale.signature, usdc: progress.sale.value });
      delete progress.sale; save();
    }
    const accounts = await infos(STOCK_MINTS.map((s) => ata(wallet.publicKey, new PublicKey(s.mint))));
    const items = STOCK_MINTS.flatMap((s, i) => {
      const held = accounts[i]?.data.readBigUInt64LE(64) ?? 0n;
      if (held === 0n) return [];
      assert.equal(s.program, "token", "This devnet harness only buys classic SPL test mints.");
      return [{ mint: s.mint, amount: `${held}`, decimals: s.decimals, value: `${quoteStock(held, s.decimals, BigInt(Math.round(stockOf(s.ticker).price * 1e6)))}` }];
    });
    // At most three stock transfers per atomic transaction to stay below Solana's packet limit.
    for (let i = 0; i < items.length; i += 3) {
      const group = items.slice(i, i + 3);
      const value = group.reduce((a, s) => a + BigInt(s.value), 0n);
      const cfg = decodeConfig((await conn.getAccountInfo(configPda()))!.data);
      const free = (await amount(treasuryAta())) - cfg.sealedReserve - cfg.owedTotal;
      if (free < value) await fundUsdc(treasuryAta(), value - free, wallet.publicKey);
      const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata(wallet.publicKey), wallet.publicKey, usdcMint()));
      for (const item of group) {
        const mint = new PublicKey(item.mint), source = ata(wallet.publicKey, mint);
        tx.add(createTransferCheckedInstruction(source, mint, ata(configPda(), mint, true), wallet.publicKey, BigInt(item.amount), item.decimals));
        tx.add(createCloseAccountInstruction(source, wallet.publicKey, wallet.publicKey));
      }
      if (value > 0n) tx.add(withdrawIx(admin.publicKey, ata(wallet.publicKey), value));
      progress.sale = { items: group, value: `${value}` }; save();
      const signature = await send(tx, [wallet], (signature, raw, lastValidBlockHeight) => {
        Object.assign(progress.sale!, { signature, raw, lastValidBlockHeight }); save();
      });
      log("stocks-to-usdc", wallet, { signature, microUsdc: `${value}`, stocks: group.length });
      delete progress.sale; save();
    }
  });
}
async function move(h: RoundHandle) {
  const driver = new ClawDriver(h); driver.start();
  try {
    for (let i = 0; i < 4; i++) { driver.push(Math.round(Math.random() * 180 - 90), Math.round(Math.random() * 180 - 90)); await sleep(250); }
    for (let i = 0; i < 20; i++) {
      const r = await readRound(h.round, "er");
      if (r && r.round.moves > 0) return;
      await sleep(250);
    }
    throw new Error("Claw moves were not observed on the rollup.");
  } finally { driver.stop(); }
}
async function oneRound(wallet: Keypair, progress: Progress, machineId: number) {
  const walletSender = sender(wallet, progress);
  let h = await pendingRound(wallet.publicKey);
  if (!h && progress.round) {
    const sig = progress.round.settleSignature;
    const box = sig ? await boxFromSettle(sig) : null;
    assert.ok(box && box.cards.every((c) => c.paid), "Closed round has no verified paid settlement; inspect its checkpoint.");
    await sellStocks(wallet, progress);
    delete progress.round; progress.completed++; delete progress.error; save();
    log("pass-recovered", wallet, { signature: sig, completed: progress.completed }); return;
  }
  if (!h) {
    const machine = decodeMachine((await conn.getAccountInfo(machinePda(machineId)))!.data);
    const player = await readPlayer(wallet.publicKey);
    if (!(player?.sealed[machineId - 1])) {
      await ensurePlayable(wallet, machine.price);
      await walletSender.send(new Transaction().add(playIx(wallet.publicKey, machineId, 1)));
    }
    const started = await startRound(walletSender, machineId);
    h = { ...started, state: null, delegated: true };
  }
  progress.round = { ...progress.round, address: h.round.toBase58(), id: `${h.roundId}`, machineId: h.machineId }; save();
  log("round", wallet, { round: h.round.toBase58(), machine: h.machineId });
  let stateOnChain = h.state;
  if (h.delegated) {
    stateOnChain = await waitOnRollup(h, 45_000);
    if (stateOnChain.status === "armed") {
      assert.ok(h.driver, "Session key missing; retain this run's sessions.json.");
      await move(h);
      stateOnChain = await dropAndDraw(h);
    } else if (stateOnChain.status === "requested") stateOnChain = await waitForDraw(h);
    stateOnChain = await finishRound(h, walletSender);
  } else if (stateOnChain?.status !== "drawn" && stateOnChain?.status !== "void") {
    await voidOnBase(h, walletSender);
    stateOnChain = (await readRound(h.round))!.round;
  }
  assert.ok(stateOnChain);
  const result = await settle(h, stateOnChain, walletSender);
  assert.equal(await conn.getAccountInfo(h.round), null, "Round must close and return its rent.");
  if (stateOnChain.status === "void") {
    progress.voids++; delete progress.round; save();
    throw new Error("VRF round voided; sealed box returned. This is not a successful draw.");
  }
  let box = result.box;
  for (let i = 0; !box && i < 5; i++) { await sleep(1000); box = await boxFromSettle(result.signature); }
  assert.ok(box && box.cards.length === 3 && box.cards.every((c) => c.paid), "Every stock card must actually be paid.");
  await sellStocks(wallet, progress);
  progress.completed++; delete progress.round; delete progress.error; save();
  log("pass", wallet, { completed: progress.completed, machine: h.machineId, signature: result.signature, valueUsdc: box.valueUsdc });
}
async function main() {
  assert.equal(SOLANA.network, "devnet");
  assert.equal(SOLANA.deployment?.usdcMint, USDC_MINT.devnet);
  assert.equal(await conn.getGenesisHash(), "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", "RPC is not Solana devnet.");
  const cfg = decodeConfig((await conn.getAccountInfo(configPda()))!.data);
  assert.ok(cfg.admin.equals(admin.publicKey), "SOLANA_KEYPAIR must be the program admin for test-stock buyback.");
  assert.ok((await conn.getAccountInfo(programId()))?.executable);
  const before = await inventory();
  if (!state.initial) state.initial = before;
  json(join(root, values.audit ? "audit.json" : "before.json"), before);
  log("inventory", undefined, { wallets: wallets.length, walletMicroUsdc: `${before.wallets.reduce((a, r) => a + BigInt(r.usdc), 0n)}`, treasuryMicroUsdc: before.treasury, adminSol: before.adminLamports / 1e9, mode: values.audit ? "audit" : values["cleanup-only"] ? "cleanup" : "soak" });
  if (values.audit) return;
  const lockPath = join(root, "lock.json");
  if (existsSync(lockPath)) {
    const old = JSON.parse(readFileSync(lockPath, "utf8"));
    let alive = false; try { process.kill(old.pid, 0); alive = true; } catch {}
    assert.ok(!alive, `Run is already active with PID ${old.pid}.`);
    unlinkSync(lockPath);
  }
  const fd = openSync(lockPath, "wx"); writeFileSync(fd, JSON.stringify({ pid: process.pid })); closeSync(fd);
  save();
  try {
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor++; if (index >= wallets.length || stopping) return;
        const wallet = wallets[index], key = wallet.publicKey.toBase58();
        active.add(key);
        const p = state.rows[key] ??= { completed: 0, attempts: 0, voids: 0 };
        for (let retry = 0; retry < 4; retry++) {
          try {
            if (values["cleanup-only"]) {
              if (await pendingRound(wallet.publicKey) || p.round) await oneRound(wallet, p, machines[index % machines.length]);
              await sellStocks(wallet, p); delete p.error; save();
            } else {
              while (p.completed < passes && !stopping) {
                p.attempts++; save();
                await oneRound(wallet, p, machines[(index + p.completed) % machines.length]);
              }
            }
            break;
          } catch (e) { p.error = clean(e); save(); log("retry", wallet, { attempt: retry + 1, error: p.error }); await sleep(2000 * (retry + 1)); }
        }
        active.delete(key);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    // Always attempt stock cleanup, including wallets whose round encountered an error.
    for (const wallet of wallets) {
      const p = state.rows[wallet.publicKey.toBase58()] ??= { completed: 0, attempts: 0, voids: 0 };
      try { await sellStocks(wallet, p); } catch (e) { p.error = clean(e); save(); log("cleanup-error", wallet, { error: p.error }); }
    }
    const after = await inventory();
    const pending: string[] = [];
    for (const wallet of wallets) if (await pendingRound(wallet.publicKey)) pending.push(wallet.publicKey.toBase58());
    const failed = wallets.filter((w) => { const p = state.rows[w.publicKey.toBase58()]; return p.error || (!values["cleanup-only"] && p.completed < passes); }).map((w) => w.publicKey.toBase58());
    const stocksRemaining = after.wallets.filter((r) => Object.values(r.stocks).some((v) => BigInt(v) !== 0n)).map((r) => r.wallet);
    const totalUsdc = (i: Inventory) => i.wallets.reduce((a, r) => a + BigInt(r.usdc), BigInt(i.treasury) + BigInt(i.adminUsdc));
    const usdcConserved = totalUsdc(state.initial!) === totalUsdc(after);
    const report = { run: values.run, mode: values["cleanup-only"] ? "cleanup" : "soak", startedAt: state.startedAt, finishedAt: new Date().toISOString(), interrupted: stopping, wallets: wallets.length, passes, completedRounds: Object.values(state.rows).reduce((a, p) => a + p.completed, 0), voids: Object.values(state.rows).reduce((a, p) => a + p.voids, 0), failed, pending, stocksRemaining, usdcConserved, before: state.initial, after };
    json(join(root, "summary.json"), report);
    state.finishedAt = report.finishedAt; save();
    log("summary", undefined, { completedRounds: report.completedRounds, failed: failed.length, pending: pending.length, stocksRemaining: stocksRemaining.length, usdcConserved, walletMicroUsdc: `${after.wallets.reduce((a, r) => a + BigInt(r.usdc), 0n)}`, report: join(root, "summary.json") });
    if (failed.length || pending.length || stocksRemaining.length || stopping || !usdcConserved) process.exitCode = 1;
  } finally { unlinkSync(lockPath); }
}
main().then(() => process.exit(process.exitCode ?? 0), (error: unknown) => { console.error(clean(error)); process.exit(1); });
