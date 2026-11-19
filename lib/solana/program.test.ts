/**
 * The hand-written client against the program's IDL (solana/idl/arclaw.json): every instruction's discriminator,
 * account count and writable/signer flags match, and the biggest transactions fit Solana's 1232 byte limit.
 *
 *   pnpm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import * as p from "./program";

type IdlIx = { name: string; discriminator: number[]; accounts: { name: string; writable?: boolean; signer?: boolean }[] };
const idl = JSON.parse(readFileSync(join(process.cwd(), "solana/idl/arclaw.json"), "utf8")) as { address: string; instructions: IdlIx[] };
const byName = new Map(idl.instructions.map((i) => [i.name, i]));
const k = () => Keypair.generate().publicKey;
const card = () => ({ mint: k(), amount: 1n, value: 1n });

const round: p.RoundAccount = {
  player: k(),
  driver: k(),
  roundId: 3n,
  machineId: 1,
  tableId: 1,
  status: "drawn",
  clawX: 0,
  clawZ: 0,
  moves: 0,
  startedAt: 0n,
  requestedAt: 0n,
  randomness: new Uint8Array(32),
  outcome: 0,
  tier: 0,
  value: 0n,
  cards: [card(), card(), card()],
};

const cases: [string, () => TransactionInstruction, number?][] = [
  ["play", () => p.playIx(k(), 1, 1)],
  ["gift", () => p.giftIx(k(), k(), 1, 1)],
  ["create_link", () => p.createLinkIx(k(), k(), 1, 1, 1)],
  ["claim_link", () => p.claimLinkIx(k(), k(), k())],
  ["reclaim_link", () => p.reclaimLinkIx(k(), k())],
  ["start_round", () => p.startRoundIx(k(), 1, 0n, k())],
  ["delegate_round", () => p.delegateRoundIx(k(), 0n, null)],
  ["move_claw", () => p.moveClawIx(k(), k(), 1, -1)],
  ["drop_claw", () => p.dropClawIx(k(), k(), 1, new Uint8Array(32))],
  ["finish_round", () => p.finishRoundIx(k(), k())],
  ["void_round", () => p.voidRoundIx(k(), k())],
  // settle_round reads four accounts per card after its own twelve
  ["settle_round", () => p.settleRoundIx(k(), round), 12],
  ["claim_owed", () => p.claimOwedIx(k())],
  ["initialize", () => p.initializeIx(k(), k(), 0)],
  ["set_machine", () => p.setMachineIx(k(), { id: 1, price: 1n, floorBps: 5000, capBps: 100000, rtpMinBps: 7400, rtpMaxBps: 7600, active: true })],
  ["set_table", () => p.setTableIx(k(), 1, [])],
  ["set_admin", () => p.setAdminIx(k(), { admin: k(), operator: k(), paused: false, maxTableAge: 0 })],
];

test("the deployment's program id is the IDL's", () => {
  assert.equal(p.programId().toBase58(), idl.address);
});

for (const [name, make, own] of cases) {
  test(`${name} matches the IDL`, () => {
    const want = byName.get(name);
    assert.ok(want, `${name} is in the IDL`);
    const ix = make();
    assert.deepEqual([...ix.data.subarray(0, 8)], want.discriminator, "discriminator");
    const keys = ix.keys.slice(0, own ?? ix.keys.length);
    assert.equal(keys.length, want.accounts.length, "account count");
    want.accounts.forEach((a, i) => {
      assert.equal(keys[i]!.isWritable, Boolean(a.writable), `${a.name} writable`);
      assert.equal(keys[i]!.isSigner, Boolean(a.signer), `${a.name} signer`);
    });
  });
}

const size = (payer: Keypair, ...ixs: TransactionInstruction[]) => {
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: PublicKey.default.toBase58() }).add(...ixs);
  tx.sign(payer);
  return tx.serialize().length;
};

test("a six pack table fits one transaction", () => {
  const a = Keypair.generate();
  const outcomes = Array.from({ length: 6 }, (_, tier) => ({ weight: 100, tier, cards: [card(), card(), card()] }));
  assert.ok(size(a, p.setTableIx(a.publicKey, 1, outcomes)) <= 1232);
});

test("a round decodes what the layout says", () => {
  // Built by hand in the order of state.rs, so a field moved in either place fails here.
  const b: number[] = [87, 127, 165, 51, 73, 78, 116, 174];
  const push = (n: bigint, bytes: number) => {
    for (let i = 0; i < bytes; i++) b.push(Number((n >> BigInt(8 * i)) & 0xffn));
  };
  b.push(...round.player.toBytes(), ...round.driver.toBytes());
  push(7n, 8); // round_id
  b.push(2); // machine_id
  push(9n, 4); // table_id
  b.push(2); // status Drawn
  push(BigInt(-5 & 0xffff), 2); // claw_x
  push(40n, 2); // claw_z
  push(12n, 2); // moves
  push(100n, 8);
  push(101n, 8);
  b.push(...new Uint8Array(32));
  b.push(4, 3); // outcome, tier
  push(5_000_000n, 8); // value
  for (const c of round.cards) {
    b.push(...c.mint.toBytes());
    push(2n, 8);
    push(3n, 8);
  }
  b.push(254);
  const r = p.decodeRound(Uint8Array.from(b));
  assert.equal(r.roundId, 7n);
  assert.equal(r.machineId, 2);
  assert.equal(r.status, "drawn");
  assert.equal(r.clawX, -5);
  assert.equal(r.clawZ, 40);
  assert.equal(r.moves, 12);
  assert.equal(r.tier, 3);
  assert.equal(r.value, 5_000_000n);
  assert.equal(r.cards[2]!.value, 3n);
});
