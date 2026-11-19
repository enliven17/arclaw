/**
 * One claw round, end to end, across Solana and the MagicBlock ephemeral rollup.
 *
 *   start    wallet signs once on Solana: fund a fresh session key (refunded at settle), burn a sealed box into a
 *            Round, delegate the Round to the rollup
 *   move     the session key signs claw moves on the rollup: no wallet prompt, no fee, a few ms each
 *   drop     the session key asks MagicBlock VRF for the draw on the rollup; the callback writes the pack
 *   finish   the session key commits the Round back to Solana and undelegates it
 *   settle   wallet signs once more on Solana: create the stock token accounts, pay the three cards, close the Round
 *            and send the session key's SOL back
 *
 * The session key is kept in localStorage per round, so a reload can pick a round up where it was left.
 */
import type { Buffer } from "buffer";
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { SOLANA } from "./config";
import { DELEGATION_PROGRAM_ID, delegateRoundIx, dropClawIx, finishRoundIx, moveClawIx, programId, roundPda, settleRoundIx, startRoundIx, stockProgram, voidRoundIx, type RoundAccount } from "./program";
import { baseConnection, boxFromSettle, erConnection, readPlayer, readRound, type DrawnBox } from "./client";

/** SOL for the session key: rent-exempt so it exists for the rollup to clone, swept back at settle. */
const DRIVER_FUND = 1_000_000;
/** The program voids a draw that has not landed after this long (VRF_TIMEOUT_S). */
const VRF_TIMEOUT_MS = 125_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEY = (round: PublicKey) => `arclaw:driver:${round.toBase58()}`;

/** What the round needs from the wallet. Both resolve once the transaction is confirmed. */
export type Sender = {
  publicKey: PublicKey;
  send(tx: Transaction, signers?: Keypair[]): Promise<string>;
  sign(tx: Transaction): Promise<Transaction>;
};

export type RoundHandle = { player: PublicKey; round: PublicKey; roundId: bigint; machineId: number; driver: Keypair | null };

function saveDriver(round: PublicKey, driver: Keypair) {
  try {
    localStorage.setItem(KEY(round), bs58.encode(driver.secretKey));
  } catch {
    // private mode: the player can still finish the round with the wallet
  }
}
function loadDriver(round: PublicKey): Keypair | null {
  try {
    const s = localStorage.getItem(KEY(round));
    return s ? Keypair.fromSecretKey(bs58.decode(s)) : null;
  } catch {
    return null;
  }
}
function forgetDriver(round: PublicKey) {
  try {
    localStorage.removeItem(KEY(round));
  } catch {
    // nothing kept
  }
}

/** Burns one sealed box into a round on the rollup. */
export async function startRound(wallet: Sender, machineId: number): Promise<RoundHandle> {
  const player = wallet.publicKey;
  const roundId = (await readPlayer(player))?.nextRound ?? 0n;
  const round = roundPda(player, roundId);
  const driver = Keypair.generate();
  saveDriver(round, driver);
  const validator = SOLANA.erValidator ? new PublicKey(SOLANA.erValidator) : null;
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: player, toPubkey: driver.publicKey, lamports: DRIVER_FUND }),
    startRoundIx(player, machineId, roundId, driver.publicKey),
    delegateRoundIx(player, roundId, validator),
  );
  await wallet.send(tx);
  return { player, round, roundId, machineId, driver };
}

/** The player's last round if it was never settled (a closed tab, a failed settle). */
export async function pendingRound(player: PublicKey): Promise<(RoundHandle & { state: RoundAccount | null; delegated: boolean }) | null> {
  const p = await readPlayer(player);
  if (!p || p.nextRound === 0n) return null;
  const roundId = p.nextRound - 1n;
  const round = roundPda(player, roundId);
  const info = await baseConnection().getAccountInfo(round);
  if (!info) return null;
  const delegated = info.owner.equals(DELEGATION_PROGRAM_ID);
  const state = delegated ? ((await readRound(round, "er"))?.round ?? null) : ((await readRound(round, "base"))?.round ?? null);
  return { player, round, roundId, machineId: state?.machineId ?? 1, driver: loadDriver(round), state, delegated };
}

/** Sends one rollup transaction signed by the session key (or the wallet, when the key is gone). */
async function sendEr(ixs: TransactionInstruction[], signer: Keypair | Sender): Promise<string> {
  const conn = erConnection();
  const { blockhash } = await conn.getLatestBlockhash();
  const feePayer = signer instanceof Keypair ? signer.publicKey : signer.publicKey;
  const tx = new Transaction({ feePayer, recentBlockhash: blockhash }).add(...ixs);
  let raw: Buffer;
  if (signer instanceof Keypair) {
    tx.sign(signer);
    raw = tx.serialize();
  } else {
    raw = (await signer.sign(tx)).serialize();
  }
  return conn.sendRawTransaction(raw, { skipPreflight: true });
}

/** Waits until the rollup has the delegated round (it clones on first touch). */
export async function waitOnRollup(h: RoundHandle, timeoutMs = 20_000): Promise<RoundAccount> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await readRound(h.round, "er").catch(() => null);
    if (r && r.owner.equals(programId())) return r.round;
    if (Date.now() > end) throw new Error("The rollup did not pick up the round. Try again in a moment.");
    await sleep(400);
  }
}

/**
 * The joystick: moves are coalesced and sent at most every 80 ms, fire and forget. The rollup confirms in a few ms,
 * so the claw on screen is the state on chain a moment later.
 */
export class ClawDriver {
  private dx = 0;
  private dz = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hash: { blockhash: string; at: number } | null = null;

  constructor(private h: RoundHandle) {}

  start() {
    this.timer ??= setInterval(() => void this.flush(), 80);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  push(dx: number, dz: number) {
    this.dx += dx;
    this.dz += dz;
  }

  private async flush() {
    const driver = this.h.driver;
    if (!driver || (this.dx === 0 && this.dz === 0)) return;
    const clamp = (v: number) => Math.max(-120, Math.min(120, Math.round(v)));
    const dx = clamp(this.dx);
    const dz = clamp(this.dz);
    this.dx -= dx;
    this.dz -= dz;
    const conn = erConnection();
    if (!this.hash || Date.now() - this.hash.at > 20_000) this.hash = { blockhash: (await conn.getLatestBlockhash()).blockhash, at: Date.now() };
    const tx = new Transaction({ feePayer: driver.publicKey, recentBlockhash: this.hash.blockhash }).add(moveClawIx(driver.publicKey, this.h.round, dx, dz));
    tx.sign(driver);
    void conn.sendRawTransaction(tx.serialize(), { skipPreflight: true }).catch(() => undefined);
  }
}

/** Drops the claw and waits for the VRF callback on the rollup. Resolves with the drawn (or void) round. */
export async function dropAndDraw(h: RoundHandle, onStatus?: (s: string) => void): Promise<RoundAccount> {
  if (!h.driver) throw new Error("This round's session key is gone; finish it from your wallet.");
  const seed = crypto.getRandomValues(new Uint8Array(32));
  await sendEr([dropClawIx(h.driver.publicKey, h.round, h.machineId, seed)], h.driver);
  onStatus?.("Drawing your pack");
  const end = Date.now() + VRF_TIMEOUT_MS;
  for (;;) {
    const r = await readRound(h.round, "er").catch(() => null);
    if (r && (r.round.status === "drawn" || r.round.status === "void")) return r.round;
    if (Date.now() > end) return (r?.round ?? null) as RoundAccount;
    await sleep(r?.round.status === "requested" ? 400 : 700);
  }
}

/** Commits the round back to Solana and waits until it is the program's again there. */
export async function finishRound(h: RoundHandle, wallet: Sender, onStatus?: (s: string) => void): Promise<RoundAccount> {
  onStatus?.("Sending the round back to Solana");
  await sendEr([finishRoundIx(h.driver?.publicKey ?? wallet.publicKey, h.round)], h.driver ?? wallet);
  const end = Date.now() + 90_000;
  for (;;) {
    const r = await readRound(h.round, "base").catch(() => null);
    if (r && r.owner.equals(programId()) && (r.round.status === "drawn" || r.round.status === "void")) return r.round;
    if (Date.now() > end) throw new Error("The round is still on its way back to Solana. Reload in a minute to finish it.");
    await sleep(1000);
  }
}

/** For a round that never reached the rollup: marks it void on Solana so settle returns the box. */
export async function voidOnBase(h: RoundHandle, wallet: Sender) {
  await wallet.send(new Transaction().add(voidRoundIx(wallet.publicKey, h.round)));
}

/** Pays the pack (or returns a void round's box) and sweeps the session key's SOL back. */
export async function settle(h: RoundHandle, round: RoundAccount, wallet: Sender): Promise<{ signature: string; box: DrawnBox | null }> {
  const player = wallet.publicKey;
  const tx = new Transaction();
  const drawn = round.status === "drawn";
  if (drawn) {
    for (const c of round.cards) {
      const program = stockProgram(c.mint);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(player, getAssociatedTokenAddressSync(c.mint, player, false, program), player, c.mint, program));
    }
  }
  const ix = settleRoundIx(player, round);
  // A void round reads no card accounts.
  if (!drawn) ix.keys = ix.keys.slice(0, 12);
  tx.add(ix);
  const signers: Keypair[] = [];
  if (h.driver) {
    const left = await baseConnection().getBalance(h.driver.publicKey).catch(() => 0);
    if (left > 0) {
      tx.add(SystemProgram.transfer({ fromPubkey: h.driver.publicKey, toPubkey: player, lamports: left }));
      signers.push(h.driver);
    }
  }
  const signature = await wallet.send(tx, signers);
  forgetDriver(h.round);
  return { signature, box: drawn ? await boxFromSettle(signature) : null };
}
