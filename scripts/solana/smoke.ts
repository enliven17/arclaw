/** Devnet end-to-end check: Circle USDC -> box -> delegated claw -> VRF -> Solana -> three stock tokens. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { SOLANA, USDC_MINT, explorerTx } from "../../lib/solana/config";
import { baseConnection, readBoxes, readRound } from "../../lib/solana/client";
import { playIx } from "../../lib/solana/program";
import { ClawDriver, startRound, waitOnRollup, dropAndDraw, finishRound, settle, type Sender } from "../../lib/solana/round";

async function main() {
  assert.equal(SOLANA.network, "devnet", "smoke tests only use devnet");
  assert.equal(SOLANA.deployment?.usdcMint, USDC_MINT.devnet, "use Circle devnet USDC");
  const path = (process.env.SOLANA_KEYPAIR ?? "~/.config/solana/id.json").replace(/^~/, homedir());
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const conn = baseConnection();
  const wallet: Sender = {
    publicKey: payer.publicKey,
    async send(tx, signers = []) {
      const sig = await sendAndConfirmTransaction(conn, tx, [payer, ...signers], { commitment: "confirmed" });
      console.log(explorerTx(sig));
      return sig;
    },
    async sign(tx) { tx.partialSign(payer); return tx; },
  };
  const before = (await readBoxes(payer.publicKey))[1] ?? 0;
  if (before === 0) await wallet.send(new Transaction().add(playIx(payer.publicKey, 1, 1)));
  const h = await startRound(wallet, 1);
  // Keep the session key locally so an interrupted devnet test can be recovered. This directory is ignored.
  mkdirSync(".cache", { recursive: true });
  writeFileSync(".cache/smoke-round.json", JSON.stringify({ player: h.player.toBase58(), round: h.round.toBase58(), roundId: `${h.roundId}`, machineId: h.machineId, driver: Array.from(h.driver!.secretKey) }));
  const initial = await waitOnRollup(h);
  assert.equal(initial.status, "armed");
  console.log("delegated", h.round.toBase58());
  const driver = new ClawDriver(h);
  driver.start();
  try {
    driver.push(50, -25);
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      const r = await readRound(h.round, "er");
      if (r && r.round.moves > 0) {
        console.log("claw moved", r.round.clawX, r.round.clawZ, "moves", r.round.moves);
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok((await readRound(h.round, "er"))!.round.moves > 0, "claw moves execute on the rollup");
  } finally { driver.stop(); }
  const draw = await dropAndDraw(h, console.log);
  assert.equal(draw.status, "drawn", "VRF must deliver a real draw");
  const back = await finishRound(h, wallet, console.log);
  assert.equal(back.status, "drawn");
  const result = await settle(h, back, wallet);
  assert.ok(result.box, "settlement must emit its pack");
  assert.equal(result.box.cards.length, 3);
  assert.ok(result.box.cards.every((c) => c.paid), "all three stock cards are paid from the vault");
  assert.equal(await conn.getAccountInfo(h.round), null, "round rent is returned and account closed");
  console.log("PASS", JSON.stringify({ signature: result.signature, machine: 1, valueUsdc: result.box.valueUsdc, cards: result.box.cards.map((c) => ({ ticker: c.ticker, mint: c.mint, amount: `${c.amount}`, paid: c.paid })) }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
