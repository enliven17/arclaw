/**
 * Devnet setup, after `anchor deploy` (solana/README.md). Idempotent: run it again to refresh tables or top up stock.
 *
 *   1. test stock mints (classic SPL, 8 decimals like xStocks), one per ticker below, unless the deployment has them
 *   2. stock inventory minted into the vault (the config PDA's token accounts)
 *   3. initialize the program with Circle's devnet USDC, if it is not yet
 *   4. every machine of lib/machines.json: its rules, then its outcome table (one pack per tier, priced from the
 *      snapshot in lib/stocks.ts), checked locally against the same floor, cap and RTP rules the program enforces
 *   5. lib/deployments/solana-devnet.json (stock mints) and lib/machines.resolved.json (the example packs the site shows)
 *
 * USDC is Circle's real devnet mint: players get it from https://faucet.circle.com. Nothing here mints USDC.
 *
 *   SOLANA_KEYPAIR=~/.config/solana/id.json NEXT_PUBLIC_SOLANA_RPC_URL=... pnpm solana:setup
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMint, getAssociatedTokenAddressSync, getMint, mintTo } from "@solana/spl-token";
import machines from "../../lib/machines.json";
import { SOLANA, USDC_MINT } from "../../lib/solana/config";
import { configPda, decodeMachine, initializeIx, machinePda, setMachineIx, setTableIx, type OutcomeInput } from "../../lib/solana/program";
import { stockOf } from "../../lib/stocks";

const TICKERS = ["NVDA", "AAPL", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "SPY", "QQQ"];
const DECIMALS = 8;
/** Shares of each stock minted into the vault on every run that finds it under this. */
const INVENTORY = 100_000;
/**
 * Card splits of a pack's value, one pack per split per tier. One split keeps a six tier table (six packs, about 900
 * bytes of instruction data) inside Solana's 1232 byte transaction limit.
 */
const SPLITS = [[0.45, 0.33, 0.22]];

const DEPLOYMENT = join(process.cwd(), "lib/deployments/solana-devnet.json");
const RESOLVED = join(process.cwd(), "lib/machines.resolved.json");

function keypair(): Keypair {
  const path = (process.env.SOLANA_KEYPAIR ?? "~/.config/solana/id.json").replace(/^~/, homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

async function send(conn: Connection, payer: Keypair, ...ixs: TransactionInstruction[]) {
  return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer], { commitment: "confirmed" });
}

async function main() {
  if (SOLANA.network !== "devnet") throw new Error("This script sets up devnet only.");
  const dep = SOLANA.deployment;
  if (!dep) throw new Error("lib/deployments/solana-devnet.json has no programId.");
  if (dep.usdcMint !== USDC_MINT.devnet) throw new Error("The deployment's USDC is not Circle's devnet USDC.");
  const conn = new Connection(SOLANA.rpc, "confirmed");
  const admin = keypair();
  console.log(`admin ${admin.publicKey.toBase58()}  ${(await conn.getBalance(admin.publicKey)) / 1e9} SOL`);
  const program = await conn.getAccountInfo(new PublicKey(dep.programId));
  if (!program?.executable) throw new Error(`Program ${dep.programId} is not deployed on devnet. Run anchor deploy first.`);
  const config = configPda();

  // 1 and 2: stocks and inventory.
  const stocks = { ...dep.stocks };
  for (const ticker of TICKERS) {
    if (!stocks[ticker]) {
      const mint = await createMint(conn, admin, admin.publicKey, null, DECIMALS);
      stocks[ticker] = { mint: mint.toBase58(), decimals: DECIMALS, program: "token" };
      writeFileSync(DEPLOYMENT, `${JSON.stringify({ ...dep, stocks }, null, 2)}\n`);
      console.log(`mint ${ticker} ${mint.toBase58()}`);
    }
    const mint = new PublicKey(stocks[ticker]!.mint);
    const vault = getAssociatedTokenAddressSync(mint, config, true, TOKEN_PROGRAM_ID);
    await send(conn, admin, createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, vault, config, mint, TOKEN_PROGRAM_ID));
    const have = Number((await conn.getTokenAccountBalance(vault)).value.uiAmount ?? 0);
    if (have < INVENTORY) {
      await mintTo(conn, admin, mint, vault, admin, BigInt(Math.round((INVENTORY - have) * 10 ** DECIMALS)));
      console.log(`vault ${ticker} topped up to ${INVENTORY}`);
    }
  }
  writeFileSync(DEPLOYMENT, `${JSON.stringify({ ...dep, stocks }, null, 2)}\n`);

  // 3: initialize.
  if (!(await conn.getAccountInfo(config))) {
    await send(conn, admin, initializeIx(admin.publicKey, admin.publicKey, 0));
    console.log(`initialized, config ${config.toBase58()}`);
  }

  // 4: machines and tables.
  const resolved: unknown[] = [];
  for (const m of machines.machines) {
    const price = BigInt(Math.round(m.priceUsdc * 1e6));
    await send(conn, admin, setMachineIx(admin.publicKey, { id: m.id, price, floorBps: machines.policy.floorBps, capBps: m.capBps, rtpMinBps: m.rtpMinBps, rtpMaxBps: m.rtpMaxBps, active: true }));
    const outcomes: OutcomeInput[] = [];
    const tiers: unknown[] = [];
    m.tiers.forEach((t, tier) => {
      const value = (price * BigInt(t.multiplierBps)) / 10_000n;
      SPLITS.forEach((split, k) => {
        const picks = [0, 1, 2].map((i) => TICKERS[(tier * 3 + k * 4 + i + m.id) % TICKERS.length]!);
        let left = value;
        const cards = picks.map((ticker, i) => {
          const v = i === 2 ? left : (value * BigInt(Math.round(split[i]! * 1000))) / 1000n;
          left -= v;
          const usd = stockOf(ticker).price;
          const amount = BigInt(Math.max(1, Math.round((Number(v) / 1e6 / usd) * 10 ** DECIMALS)));
          return { ticker, mint: new PublicKey(stocks[ticker]!.mint), amount, value: v };
        });
        const weight = SPLITS.length === 1 ? t.weight : k === 0 ? Math.ceil(t.weight / 2) : Math.floor(t.weight / 2);
        if (weight > 0) outcomes.push({ weight, tier, cards: cards.map(({ mint, amount, value }) => ({ mint, amount, value })) });
        if (k === 0) tiers.push({ name: t.name, cards: cards.map((c) => ({ ticker: c.ticker, valueUsdc: Number(c.value) / 1e6 })) });
      });
    });

    // The program's rules, checked here first so a bad table never costs a transaction.
    const total = outcomes.reduce((s, o) => s + BigInt(o.weight), 0n);
    const ev = outcomes.reduce((s, o) => s + BigInt(o.weight) * o.cards.reduce((a, c) => a + c.value, 0n), 0n);
    const rtp = Number((ev * 10_000n) / (total * price));
    for (const o of outcomes) {
      const v = o.cards.reduce((a, c) => a + c.value, 0n) * 10_000n;
      if (v < price * BigInt(machines.policy.floorBps) || v > price * BigInt(m.capBps)) throw new Error(`${m.name}: a pack breaks the floor or the cap`);
    }
    if (rtp < m.rtpMinBps || rtp > m.rtpMaxBps) throw new Error(`${m.name}: RTP ${rtp} outside ${m.rtpMinBps}..${m.rtpMaxBps}`);

    await send(conn, admin, setTableIx(admin.publicKey, m.id, outcomes));
    const info = await conn.getAccountInfo(machinePda(m.id));
    const onChain = info ? decodeMachine(info.data) : null;
    console.log(`${m.name}: table ${onChain?.tableId} with ${onChain?.outcomes.length} packs, RTP ${(onChain?.rtpBps ?? 0) / 100}%`);
    resolved.push({ id: m.id, priceUsdc: m.priceUsdc, rtpBps: onChain?.rtpBps ?? rtp, tiers });
  }

  // 5: the example packs the site shows.
  writeFileSync(RESOLVED, `${JSON.stringify({ network: "devnet", programId: dep.programId, machines: resolved }, null, 2)}\n`);
  const slot = await conn.getSlot();
  if (!dep.deploySlot) writeFileSync(DEPLOYMENT, `${JSON.stringify({ ...dep, stocks, deploySlot: slot }, null, 2)}\n`);
  // A sanity read: the mints exist with the decimals recorded.
  for (const [ticker, s] of Object.entries(stocks)) if ((await getMint(conn, new PublicKey(s.mint))).decimals !== s.decimals) throw new Error(`${ticker}: decimals mismatch`);
  console.log("done");
}

main().then(() => process.exit(0)).catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
