/**
 * The arclaw Solana program, client side: addresses, account decoders, instruction builders and event parsing. No
 * Anchor client and no IDL at runtime. Layouts follow solana/programs/arclaw/src/state.rs (Borsh after Anchor's 8 byte
 * discriminator); account orders follow solana/idl/arclaw.json, which is generated from the program (solana/README.md).
 * Discriminators are precomputed: sha256 of "global:<ix>", "account:<Name>" and "event:<Name>", first 8 bytes.
 *
 * Isomorphic: used by the app, the server routes, the Convex indexer and scripts/solana.
 */
import { PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Buffer } from "buffer";
import { SOLANA, type Deployment } from "./config";

/* ---------- ids ---------- */

export const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
export const MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
export const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");
export const VRF_PROGRAM_ID = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
/** MagicBlock VRF queues: the ephemeral one serves rounds on the rollup, the base one the Solana-only fallback. */
export const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const VRF_BASE_QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");

const dep = (): Deployment => {
  if (!SOLANA.deployment) throw new Error("arclaw is not deployed on this network yet.");
  return SOLANA.deployment;
};
export const programId = () => new PublicKey(dep().programId);
export const usdcMint = () => new PublicKey(dep().usdcMint);

export const IX = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  setAdmin: [251, 163, 0, 52, 91, 194, 187, 92],
  setMachine: [94, 242, 229, 57, 15, 153, 161, 60],
  setTable: [184, 194, 161, 111, 110, 108, 162, 197],
  withdraw: [183, 18, 70, 156, 148, 109, 161, 34],
  sweep: [40, 23, 234, 175, 14, 61, 154, 177],
  play: [213, 157, 193, 142, 228, 56, 248, 150],
  gift: [166, 241, 165, 114, 166, 138, 63, 165],
  createLink: [103, 114, 207, 84, 216, 71, 234, 61],
  claimLink: [87, 206, 8, 104, 149, 12, 185, 250],
  reclaimLink: [82, 250, 235, 95, 109, 75, 223, 30],
  startRound: [144, 144, 43, 7, 193, 42, 217, 215],
  delegateRound: [4, 60, 37, 224, 19, 130, 106, 111],
  moveClaw: [203, 22, 32, 45, 79, 124, 91, 113],
  dropClaw: [176, 101, 112, 189, 15, 40, 96, 244],
  finishRound: [23, 104, 163, 186, 110, 225, 11, 242],
  voidRound: [102, 72, 126, 187, 12, 18, 16, 96],
  settleRound: [40, 101, 18, 1, 31, 129, 52, 77],
  claimOwed: [200, 254, 0, 109, 32, 151, 223, 144],
} as const;
const ACCOUNT = {
  Config: [155, 12, 170, 224, 30, 250, 204, 130],
  Machine: [25, 102, 22, 13, 58, 243, 138, 79],
  Player: [205, 222, 112, 7, 165, 155, 206, 218],
  Round: [87, 127, 165, 51, 73, 78, 116, 174],
  Link: [90, 57, 179, 207, 13, 91, 161, 190],
} as const;
const EVENT = {
  Played: [131, 196, 243, 0, 54, 250, 232, 133],
  Gifted: [96, 147, 3, 4, 137, 57, 92, 202],
  RoundSettled: [249, 225, 66, 54, 157, 200, 234, 222],
} as const;

/* ---------- PDAs ---------- */

const u64le = (n: bigint | number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};
const pda = (seeds: Uint8Array[], program = programId()) => PublicKey.findProgramAddressSync(seeds, program)[0];
const enc = (s: string) => new TextEncoder().encode(s);

export const configPda = () => pda([enc("config")]);
export const machinePda = (id: number) => pda([enc("machine"), Uint8Array.of(id)]);
export const playerPda = (wallet: PublicKey) => pda([enc("player"), wallet.toBytes()]);
export const roundPda = (wallet: PublicKey, roundId: bigint | number) => pda([enc("round"), wallet.toBytes(), u64le(roundId)]);
export const linkPda = (linkKey: PublicKey) => pda([enc("link"), linkKey.toBytes()]);
export const treasuryAta = () => getAssociatedTokenAddressSync(usdcMint(), configPda(), true, TOKEN_PROGRAM_ID);
export const programIdentityPda = () => pda([enc("identity")]);

/* ---------- Borsh ---------- */

class Writer {
  private parts: number[] = [];
  bytes(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.parts.push(b[i]!);
    return this;
  }
  u8(n: number) {
    return this.bytes([n & 0xff]);
  }
  bool(v: boolean) {
    return this.u8(v ? 1 : 0);
  }
  private num(n: bigint | number, size: 2 | 4 | 8, signed = false) {
    const b = new Uint8Array(size);
    const v = new DataView(b.buffer);
    if (size === 2 && signed) v.setInt16(0, Number(n), true);
    else if (size === 2) v.setUint16(0, Number(n), true);
    else if (size === 4) v.setUint32(0, Number(n), true);
    else if (signed) v.setBigInt64(0, BigInt(n), true);
    else v.setBigUint64(0, BigInt(n), true);
    return this.bytes(b);
  }
  u16(n: number) {
    return this.num(n, 2);
  }
  i16(n: number) {
    return this.num(n, 2, true);
  }
  u32(n: number) {
    return this.num(n, 4);
  }
  u64(n: bigint | number) {
    return this.num(n, 8);
  }
  i64(n: bigint | number) {
    return this.num(n, 8, true);
  }
  key(k: PublicKey) {
    return this.bytes(k.toBytes());
  }
  done() {
    return Buffer.from(this.parts);
  }
}

class Reader {
  private v: DataView;
  constructor(
    private b: Uint8Array,
    public o = 0,
  ) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8() {
    return this.b[this.o++]!;
  }
  bool() {
    return this.u8() !== 0;
  }
  u16() {
    const x = this.v.getUint16(this.o, true);
    this.o += 2;
    return x;
  }
  i16() {
    const x = this.v.getInt16(this.o, true);
    this.o += 2;
    return x;
  }
  u32() {
    const x = this.v.getUint32(this.o, true);
    this.o += 4;
    return x;
  }
  u64() {
    const x = this.v.getBigUint64(this.o, true);
    this.o += 8;
    return x;
  }
  i64() {
    const x = this.v.getBigInt64(this.o, true);
    this.o += 8;
    return x;
  }
  key() {
    const k = new PublicKey(this.b.slice(this.o, this.o + 32));
    this.o += 32;
    return k;
  }
  fixed(n: number) {
    const x = this.b.slice(this.o, this.o + n);
    this.o += n;
    return x;
  }
}

const same = (a: Uint8Array, d: readonly number[]) => d.every((x, i) => a[i] === x);
function reader(data: Uint8Array, disc: readonly number[], name: string) {
  if (!same(data, disc)) throw new Error(`not a ${name} account`);
  return new Reader(data, 8);
}

/* ---------- accounts ---------- */

export type Card = { mint: PublicKey; amount: bigint; value: bigint };
export type Outcome = { weight: number; tier: number; value: bigint; cards: Card[] };
const card = (r: Reader): Card => ({ mint: r.key(), amount: r.u64(), value: r.u64() });
const cards = (r: Reader) => [card(r), card(r), card(r)];

export type ConfigAccount = { admin: PublicKey; operator: PublicKey; usdcMint: PublicKey; paused: boolean; sealedReserve: bigint; owedTotal: bigint; maxTableAge: bigint; rounds: bigint };
export function decodeConfig(data: Uint8Array): ConfigAccount {
  const r = reader(data, ACCOUNT.Config, "Config");
  return { admin: r.key(), operator: r.key(), usdcMint: r.key(), paused: r.bool(), sealedReserve: r.u64(), owedTotal: r.u64(), maxTableAge: r.i64(), rounds: r.u64() };
}

export type MachineAccount = {
  id: number;
  price: bigint;
  floorBps: number;
  capBps: number;
  rtpMinBps: number;
  rtpMaxBps: number;
  active: boolean;
  tableId: number;
  pricedAt: bigint;
  totalWeight: bigint;
  rtpBps: number;
  outcomes: Outcome[];
};
export function decodeMachine(data: Uint8Array): MachineAccount {
  const r = reader(data, ACCOUNT.Machine, "Machine");
  const head = { id: r.u8(), price: r.u64(), floorBps: r.u16(), capBps: r.u32(), rtpMinBps: r.u16(), rtpMaxBps: r.u16(), active: r.bool(), tableId: r.u32(), pricedAt: r.i64(), totalWeight: r.u64(), rtpBps: r.u16() };
  const n = r.u32();
  const outcomes: Outcome[] = [];
  for (let i = 0; i < n; i++) outcomes.push({ weight: r.u32(), tier: r.u8(), value: r.u64(), cards: cards(r) });
  return { ...head, outcomes };
}

export const MAX_MACHINES = 4;
export type PlayerAccount = { authority: PublicKey; sealed: number[]; plays: number; packs: number; spent: bigint; won: bigint; owed: bigint; nextRound: bigint };
export function decodePlayer(data: Uint8Array): PlayerAccount {
  const r = reader(data, ACCOUNT.Player, "Player");
  const authority = r.key();
  const sealed = Array.from({ length: MAX_MACHINES }, () => r.u32());
  return { authority, sealed, plays: r.u32(), packs: r.u32(), spent: r.u64(), won: r.u64(), owed: r.u64(), nextRound: r.u64() };
}

export const ROUND_STATUS = ["armed", "requested", "drawn", "void"] as const;
export type RoundStatus = (typeof ROUND_STATUS)[number];
export type RoundAccount = {
  player: PublicKey;
  driver: PublicKey;
  roundId: bigint;
  machineId: number;
  tableId: number;
  status: RoundStatus;
  clawX: number;
  clawZ: number;
  moves: number;
  startedAt: bigint;
  requestedAt: bigint;
  randomness: Uint8Array;
  outcome: number;
  tier: number;
  value: bigint;
  cards: Card[];
};
export function decodeRound(data: Uint8Array): RoundAccount {
  const r = reader(data, ACCOUNT.Round, "Round");
  return {
    player: r.key(),
    driver: r.key(),
    roundId: r.u64(),
    machineId: r.u8(),
    tableId: r.u32(),
    status: ROUND_STATUS[r.u8()] ?? "void",
    clawX: r.i16(),
    clawZ: r.i16(),
    moves: r.u16(),
    startedAt: r.i64(),
    requestedAt: r.i64(),
    randomness: r.fixed(32),
    outcome: r.u8(),
    tier: r.u8(),
    value: r.u64(),
    cards: cards(r),
  };
}

export type LinkAccount = { sender: PublicKey; linkKey: PublicKey; machineId: number; boxes: number; expiresAt: number };
export function decodeLink(data: Uint8Array): LinkAccount {
  const r = reader(data, ACCOUNT.Link, "Link");
  return { sender: r.key(), linkKey: r.key(), machineId: r.u8(), boxes: r.u32(), expiresAt: Number(r.i64()) };
}

/* ---------- instructions ---------- */

const m = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isWritable, isSigner });
const ix = (keys: AccountMeta[], data: Buffer) => new TransactionInstruction({ programId: programId(), keys, data });
const w = (disc: readonly number[]) => new Writer().bytes(disc);

export function playIx(payer: PublicKey, machineId: number, boxes: number) {
  const mint = usdcMint();
  return ix(
    [
      m(payer, true, true),
      m(configPda(), true),
      m(machinePda(machineId)),
      m(playerPda(payer), true),
      m(mint),
      m(getAssociatedTokenAddressSync(mint, payer, false, TOKEN_PROGRAM_ID), true),
      m(treasuryAta(), true),
      m(TOKEN_PROGRAM_ID),
      m(SystemProgram.programId),
    ],
    w(IX.play).u8(machineId).u32(boxes).done(),
  );
}

export function giftIx(sender: PublicKey, recipient: PublicKey, machineId: number, boxes: number) {
  return ix(
    [m(sender, true, true), m(playerPda(sender), true), m(recipient), m(playerPda(recipient), true), m(SystemProgram.programId)],
    w(IX.gift).u8(machineId).u32(boxes).done(),
  );
}

export function createLinkIx(sender: PublicKey, linkKey: PublicKey, machineId: number, boxes: number, expiresAt: number) {
  return ix(
    [m(sender, true, true), m(playerPda(sender), true), m(linkPda(linkKey), true), m(SystemProgram.programId)],
    w(IX.createLink).key(linkKey).u8(machineId).u32(boxes).i64(expiresAt).done(),
  );
}

export function claimLinkIx(recipient: PublicKey, linkKey: PublicKey, sender: PublicKey) {
  return ix(
    [m(recipient, true, true), m(linkKey, false, true), m(linkPda(linkKey), true), m(sender, true), m(playerPda(recipient), true), m(SystemProgram.programId)],
    w(IX.claimLink).done(),
  );
}

export function reclaimLinkIx(sender: PublicKey, linkKey: PublicKey) {
  return ix([m(sender, true, true), m(linkPda(linkKey), true), m(playerPda(sender), true)], w(IX.reclaimLink).done());
}

export function startRoundIx(player: PublicKey, machineId: number, roundId: bigint, driver: PublicKey) {
  return ix(
    [m(player, true, true), m(configPda(), true), m(machinePda(machineId)), m(playerPda(player), true), m(roundPda(player, roundId), true), m(SystemProgram.programId)],
    w(IX.startRound).u8(machineId).key(driver).done(),
  );
}

export function delegateRoundIx(player: PublicKey, roundId: bigint, validator: PublicKey | null) {
  const round = roundPda(player, roundId);
  const program = programId();
  const buffer = PublicKey.findProgramAddressSync([enc("buffer"), round.toBytes()], program)[0];
  const record = PublicKey.findProgramAddressSync([enc("delegation"), round.toBytes()], DELEGATION_PROGRAM_ID)[0];
  const meta = PublicKey.findProgramAddressSync([enc("delegation-metadata"), round.toBytes()], DELEGATION_PROGRAM_ID)[0];
  const data = w(IX.delegateRound).u64(roundId);
  if (validator) data.u8(1).key(validator);
  else data.u8(0);
  return ix(
    [m(player, true, true), m(buffer, true), m(record, true), m(meta, true), m(round, true), m(program), m(DELEGATION_PROGRAM_ID), m(SystemProgram.programId)],
    data.done(),
  );
}

export function moveClawIx(driver: PublicKey, round: PublicKey, dx: number, dz: number) {
  return ix([m(driver, false, true), m(round, true)], w(IX.moveClaw).i16(dx).i16(dz).done());
}

export function dropClawIx(driver: PublicKey, round: PublicKey, machineId: number, seed: Uint8Array, queue = VRF_EPHEMERAL_QUEUE) {
  return ix(
    [
      m(driver, true, true),
      m(round, true),
      m(machinePda(machineId)),
      m(queue, true),
      m(SYSVAR_SLOT_HASHES_PUBKEY),
      m(programIdentityPda()),
      m(VRF_PROGRAM_ID),
      m(SystemProgram.programId),
    ],
    w(IX.dropClaw).bytes(seed).done(),
  );
}

export function finishRoundIx(payer: PublicKey, round: PublicKey) {
  return ix([m(payer, true, true), m(round, true), m(MAGIC_PROGRAM_ID), m(MAGIC_CONTEXT_ID, true)], w(IX.finishRound).done());
}

export function voidRoundIx(signer: PublicKey, round: PublicKey) {
  return ix([m(signer, false, true), m(round, true)], w(IX.voidRound).done());
}

export const tokenProgramOf = (program: "token" | "token-2022") => (program === "token-2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);

/** The stock's token program from the deployment's map (classic Token for mints it does not list). */
export function stockProgram(mint: PublicKey): PublicKey {
  const s = Object.values(SOLANA.deployment?.stocks ?? {}).find((x) => x.mint === mint.toBase58());
  return tokenProgramOf(s?.program ?? "token");
}

/** settle_round, with the four accounts per card it reads after its own. The player's stock ATAs must exist. */
export function settleRoundIx(payer: PublicKey, round: RoundAccount) {
  const mint = usdcMint();
  const config = configPda();
  const rest = round.cards.flatMap((c) => {
    const program = stockProgram(c.mint);
    return [
      m(c.mint),
      m(getAssociatedTokenAddressSync(c.mint, config, true, program), true),
      m(getAssociatedTokenAddressSync(c.mint, round.player, false, program), true),
      m(program),
    ];
  });
  return ix(
    [
      m(payer, true, true),
      m(round.player, true),
      m(playerPda(round.player), true),
      m(roundPda(round.player, round.roundId), true),
      m(config, true),
      m(machinePda(round.machineId)),
      m(mint),
      m(treasuryAta(), true),
      m(getAssociatedTokenAddressSync(mint, round.player, false, TOKEN_PROGRAM_ID), true),
      m(TOKEN_PROGRAM_ID),
      m(ASSOCIATED_TOKEN_PROGRAM_ID),
      m(SystemProgram.programId),
      ...rest,
    ],
    w(IX.settleRound).done(),
  );
}

export function claimOwedIx(player: PublicKey) {
  const mint = usdcMint();
  return ix(
    [
      m(player, false, true),
      m(playerPda(player), true),
      m(configPda(), true),
      m(mint),
      m(treasuryAta(), true),
      m(getAssociatedTokenAddressSync(mint, player, false, TOKEN_PROGRAM_ID), true),
      m(TOKEN_PROGRAM_ID),
    ],
    w(IX.claimOwed).done(),
  );
}

/* ---------- admin (scripts/solana/setup.ts) ---------- */

export function initializeIx(admin: PublicKey, operator: PublicKey, maxTableAge: number) {
  return ix(
    [m(admin, true, true), m(configPda(), true), m(usdcMint()), m(treasuryAta(), true), m(TOKEN_PROGRAM_ID), m(ASSOCIATED_TOKEN_PROGRAM_ID), m(SystemProgram.programId)],
    w(IX.initialize).key(operator).i64(maxTableAge).done(),
  );
}

export type MachineRules = { id: number; price: bigint; floorBps: number; capBps: number; rtpMinBps: number; rtpMaxBps: number; active: boolean };
export function setMachineIx(admin: PublicKey, r: MachineRules) {
  return ix(
    [m(admin, true, true), m(configPda()), m(machinePda(r.id), true), m(SystemProgram.programId)],
    w(IX.setMachine).u8(r.id).u64(r.price).u16(r.floorBps).u32(r.capBps).u16(r.rtpMinBps).u16(r.rtpMaxBps).bool(r.active).done(),
  );
}

export type OutcomeInput = { weight: number; tier: number; cards: Card[] };
export function setTableIx(authority: PublicKey, machineId: number, outcomes: OutcomeInput[]) {
  const data = w(IX.setTable).u8(machineId).u32(outcomes.length);
  for (const o of outcomes) {
    data.u32(o.weight).u8(o.tier);
    for (const c of o.cards) data.key(c.mint).u64(c.amount).u64(c.value);
  }
  return ix([m(authority, false, true), m(configPda()), m(machinePda(machineId), true)], data.done());
}

export function setAdminIx(admin: PublicKey, next: { admin: PublicKey; operator: PublicKey; paused: boolean; maxTableAge: number }) {
  return ix([m(admin, false, true), m(configPda(), true)], w(IX.setAdmin).key(next.admin).key(next.operator).bool(next.paused).i64(next.maxTableAge).done());
}

/* ---------- events ---------- */

export type PlayedEvent = { kind: "Played"; player: PublicKey; machineId: number; boxes: number; paid: bigint };
export type GiftedEvent = { kind: "Gifted"; from: PublicKey; to: PublicKey; machineId: number; boxes: number };
export type RoundSettledEvent = {
  kind: "RoundSettled";
  player: PublicKey;
  roundId: bigint;
  machineId: number;
  void: boolean;
  tier: number;
  value: bigint;
  refund: bigint;
  cards: Card[];
  paid: boolean[];
};
export type ArclawEvent = PlayedEvent | GiftedEvent | RoundSettledEvent;

export function decodeEvent(data: Uint8Array): ArclawEvent | null {
  const r = new Reader(data, 8);
  if (same(data, EVENT.Played)) return { kind: "Played", player: r.key(), machineId: r.u8(), boxes: r.u32(), paid: r.u64() };
  if (same(data, EVENT.Gifted)) return { kind: "Gifted", from: r.key(), to: r.key(), machineId: r.u8(), boxes: r.u32() };
  if (same(data, EVENT.RoundSettled)) {
    return {
      kind: "RoundSettled",
      player: r.key(),
      roundId: r.u64(),
      machineId: r.u8(),
      void: r.bool(),
      tier: r.u8(),
      value: r.u64(),
      refund: r.u64(),
      cards: cards(r),
      paid: [r.bool(), r.bool(), r.bool()],
    };
  }
  return null;
}

/** Events emitted by our program in a transaction's logs ("Program data: <base64>" lines inside our invocation). */
export function eventsFromLogs(logs: readonly string[] | null | undefined): ArclawEvent[] {
  if (!logs) return [];
  const id = programId().toBase58();
  const stack: string[] = [];
  const out: ArclawEvent[] = [];
  for (const line of logs) {
    const invoke = /^Program (\S+) invoke/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program (\S+) (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === id) {
      const e = decodeEvent(Buffer.from(line.slice(14), "base64"));
      if (e) out.push(e);
    }
  }
  return out;
}
