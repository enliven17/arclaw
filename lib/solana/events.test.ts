import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey, type Connection } from "@solana/web3.js";
import { readSince } from "./events";
import { SOLANA } from "./config";
import { programId } from "./program";

const slot = (SOLANA.deployment?.deploySlot ?? 0) + 1;
const signature = (i: number) => `sig-${i}`;

function connection(count: number, transaction: (sig: string) => unknown = () => ({ meta: { err: null, logMessages: [] } })) {
  return {
    async getSignaturesForAddress(_address: PublicKey, options: { before?: string; until?: string; limit: number }) {
      const start = options.before ? Number(options.before.slice(4)) - 1 : count;
      const end = options.until ? Number(options.until.slice(4)) : 0;
      return Array.from({ length: Math.min(options.limit, Math.max(0, start - end)) }, (_, n) => ({ signature: signature(start - n), slot, err: null }));
    },
    async getTransactions(signatures: string[]) { return signatures.map(transaction); },
  } as unknown as Connection;
}

test("indexer drains a multi-page backlog oldest first without skipping signatures", async () => {
  const conn = connection(237);
  let cursor: string | null = null;
  const seen: string[] = [];
  const original = conn.getTransactions.bind(conn);
  conn.getTransactions = async (...args) => {
    seen.push(...args[0]);
    return original(...args);
  };
  for (let i = 0; i < 6; i++) cursor = (await readSince(conn, cursor, 50)).cursor;
  assert.equal(cursor, signature(237));
  assert.deepEqual(seen, Array.from({ length: 237 }, (_, i) => signature(i + 1)));
});

test("an unavailable transaction stops ingestion so the cursor can be retried", async () => {
  await assert.rejects(readSince(connection(2, (sig) => sig === signature(1) ? null : { meta: { err: null, logMessages: [] } }), null), /without advancing the cursor/);
});

test("failed transactions never contribute events, even when their logs contain a play", async () => {
  const data = Buffer.alloc(8 + 32 + 1 + 4 + 8);
  data.set([131, 196, 243, 0, 54, 250, 232, 133]);
  data.set(PublicKey.default.toBytes(), 8);
  data.writeUInt8(1, 40);
  data.writeUInt32LE(1, 41);
  data.writeBigUInt64LE(1_000_000n, 45);
  const id = programId().toBase58();
  const logMessages = [`Program ${id} invoke [1]`, `Program data: ${data.toString("base64")}`, `Program ${id} failed: insufficient funds`];
  const result = await readSince(connection(1, () => ({ meta: { err: { InstructionError: [0, "error"] }, logMessages } })), null);
  assert.deepEqual(result.plays, []);
  assert.equal(result.cursor, signature(1));
});
