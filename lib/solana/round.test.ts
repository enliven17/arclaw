import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { Keypair, PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { ClawDriver } from "./round";

test("identical claw directions have distinct signatures with a cached blockhash", async () => {
  const driver = Keypair.generate();
  const transactions: Transaction[] = [];
  const conn = {
    async getLatestBlockhash() { return { blockhash: PublicKey.default.toBase58() }; },
    async sendRawTransaction(bytes: Uint8Array) {
      transactions.push(Transaction.from(bytes));
      return "sent";
    },
  } as unknown as Connection;
  const claw = new ClawDriver({ player: driver.publicKey, round: Keypair.generate().publicKey, roundId: 0n, machineId: 1, driver }, conn);
  const waitForMove = async (count: number) => {
    const end = Date.now() + 2000;
    while (transactions.length < count && Date.now() < end) await setTimeout(10);
    assert.equal(transactions.length, count);
  };
  claw.start();
  try {
    claw.push(10, 0);
    await waitForMove(1);
    claw.push(10, 0);
    await waitForMove(2);
    assert.deepEqual(transactions[0]!.instructions[0]!.data, transactions[1]!.instructions[0]!.data);
    assert.notDeepEqual(transactions[0]!.signature, transactions[1]!.signature);
    assert.ok(transactions.every((tx) => tx.verifySignatures()));
  } finally {
    claw.stop();
  }
});
