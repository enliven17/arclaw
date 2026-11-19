import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { loadWallets, quoteStock, withdrawIx } from "./soak-utils";
import { configPda, treasuryAta, usdcMint } from "../../lib/solana/program";

test("stock quote rounds down and stays exact above JS safe integer", () => {
  assert.equal(quoteStock(123456789n, 8, 250_000_000n), 308641972n);
  assert.equal(quoteStock(9007199254740993n, 8, 100_000_000n), 9007199254740993n);
  assert.equal(quoteStock(1n, 8, 1n), 0n);
  assert.throws(() => quoteStock(-1n, 8, 1n));
});
test("wallet loader rejects duplicates and malformed bytes before any transactions", () => {
  const key = Array.from(Keypair.generate().secretKey);
  assert.equal(loadWallets([key]).length, 1);
  assert.throws(() => loadWallets([key, key]), /Duplicate/);
  assert.throws(() => loadWallets([[...key.slice(1), 256]]), /format/);
  assert.throws(() => loadWallets([]));
});
test("buyback withdrawal has the deployed account layout and preserves u64 amounts", () => {
  const admin = Keypair.generate().publicKey, destination = Keypair.generate().publicKey;
  const ix = withdrawIx(admin, destination, 9007199254740993n);
  assert.equal(ix.data.readBigUInt64LE(8), 9007199254740993n);
  assert.deepEqual(ix.keys.slice(0, 5).map((k) => k.pubkey.toBase58()), [admin, configPda(), usdcMint(), treasuryAta(), destination].map((k) => k.toBase58()));
  assert.ok(ix.keys[0].isSigner);
  assert.throws(() => withdrawIx(admin, destination, 0n));
});
