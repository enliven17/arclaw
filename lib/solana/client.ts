/**
 * Reads the app makes: connections to Solana and the MagicBlock rollup, sealed boxes, machine status, holdings, pull
 * history, and the drawn box a settle paid. Plus the error text a player sees. Money from the program is USDC 6 dp.
 */
import { Buffer } from "buffer";
import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SOLANA } from "./config";
import {
  decodeConfig,
  decodeMachine,
  decodePlayer,
  decodeRound,
  eventsFromLogs,
  configPda,
  machinePda,
  playerPda,
  type Card,
  type PlayerAccount,
  type RoundAccount,
  type RoundSettledEvent,
} from "./program";
import { MACHINES } from "@/lib/machines";
import { stockOf } from "@/lib/stocks";

const COMMITMENT: Commitment = "confirmed";
let base: Connection | null = null;
let er: Connection | null = null;
export const baseConnection = () => (base ??= new Connection(SOLANA.rpc, COMMITMENT));
export const erConnection = () => (er ??= new Connection(SOLANA.erRpc, COMMITMENT));

/* ---------- money and names ---------- */

export const toUsdc = (v: bigint) => Number(v) / 1e6;
export const usdcUnits = (priceUsdc: number) => BigInt(Math.round(priceUsdc * 1e6));

const TICKER_BY_MINT = new Map(Object.entries(SOLANA.deployment?.stocks ?? {}).map(([t, s]) => [s.mint, t]));
export const tickerOf = (mint: PublicKey | string) => {
  const k = typeof mint === "string" ? mint : mint.toBase58();
  return TICKER_BY_MINT.get(k) ?? k.slice(0, 4);
};
export const STOCK_MINTS = Object.entries(SOLANA.deployment?.stocks ?? {}).map(([ticker, s]) => ({ ticker, ...s }));
export const tierName = (machineId: number, tier: number) => MACHINES.find((m) => m.id === machineId)?.tiers[tier]?.name ?? `Tier ${tier + 1}`;

/* ---------- reads ---------- */

export async function readPlayer(wallet: PublicKey): Promise<PlayerAccount | null> {
  const info = await baseConnection().getAccountInfo(playerPda(wallet));
  return info ? decodePlayer(info.data) : null;
}

/** Sealed boxes the wallet holds, by machine id. */
export async function readBoxes(wallet: PublicKey): Promise<Record<number, number>> {
  const p = await readPlayer(wallet);
  return Object.fromEntries(MACHINES.map((m) => [m.id, p?.sealed[m.id - 1] ?? 0]));
}

/** A round as the chain it lives on sees it: the rollup while delegated, Solana otherwise. */
export async function readRound(address: PublicKey, on: "base" | "er" = "base"): Promise<{ round: RoundAccount; owner: PublicKey } | null> {
  const info = await (on === "er" ? erConnection() : baseConnection()).getAccountInfo(address);
  if (!info) return null;
  try {
    return { round: decodeRound(info.data), owner: info.owner };
  } catch {
    return null;
  }
}

export type MachineState = "ready" | "stale" | "off" | "paused" | "unknown";
/** Rounds refuse a table older than maxTableAge; call it stale a little earlier so a click never lands on the edge. */
const MARGIN_S = 15 * 60;

export async function readMachineStatuses(ids: readonly number[]): Promise<Record<number, MachineState>> {
  const out: Record<number, MachineState> = Object.fromEntries(ids.map((id) => [id, "unknown"]));
  if (!SOLANA.deployment) return out;
  try {
    const [cfg, ...machines] = await baseConnection().getMultipleAccountsInfo([configPda(), ...ids.map(machinePda)]);
    if (!cfg) return out;
    const config = decodeConfig(cfg.data);
    const now = Date.now() / 1000;
    ids.forEach((id, i) => {
      const info = machines[i];
      if (config.paused) return void (out[id] = "paused");
      if (!info) return void (out[id] = "off");
      const m = decodeMachine(info.data);
      if (!m.active || m.outcomes.length === 0) return void (out[id] = "off");
      const age = Number(config.maxTableAge);
      out[id] = age > 0 && now + MARGIN_S >= Number(m.pricedAt) + age ? "stale" : "ready";
    });
  } catch {
    // unknown: the program is the judge
  }
  return out;
}

/** Stock balances of every listed mint (both token programs), with a USD price per whole share when known. */
export async function readHoldings(wallet: PublicKey, prices: Record<string, number> = {}) {
  const conn = baseConnection();
  const [a, b] = await Promise.all([
    conn.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_PROGRAM_ID }),
    conn.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);
  const byMint = new Map<string, number>();
  for (const x of [...a.value, ...b.value]) {
    const info = (x.account.data as { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } }).parsed.info;
    byMint.set(info.mint, (byMint.get(info.mint) ?? 0) + (info.tokenAmount.uiAmount ?? 0));
  }
  return STOCK_MINTS.map((s) => {
    const shares = byMint.get(s.mint) ?? 0;
    const price = prices[s.ticker] ?? stockOf(s.ticker).price;
    return { ticker: s.ticker, name: stockOf(s.ticker).name, mint: s.mint, shares, price, value: shares * price };
  });
}

/* ---------- drawn boxes ---------- */

export type DrawnCard = { ticker: string; name: string; mint: string; amount: bigint; paid: boolean; valueUsdc: number };
export type DrawnBox = { machineId: number; boxIndex: number; tier: number; tierName: string; valueUsdc: number; cards: DrawnCard[]; /** The settle transaction, what a share link is signed from. */ signature?: string };

const drawnCard = (c: Card, paid: boolean): DrawnCard => {
  const ticker = tickerOf(c.mint);
  return { ticker, name: stockOf(ticker).name, mint: c.mint.toBase58(), amount: c.amount, paid, valueUsdc: toUsdc(c.value) };
};

export function boxFromEvent(e: RoundSettledEvent, signature?: string): DrawnBox {
  return {
    machineId: e.machineId,
    boxIndex: 0,
    tier: e.tier,
    tierName: tierName(e.machineId, e.tier),
    valueUsdc: toUsdc(e.value),
    cards: e.cards.map((c, i) => drawnCard(c, e.paid[i] ?? false)),
    signature,
  };
}

/** The pack a settle transaction paid, read back from its logs. */
export async function boxFromSettle(signature: string): Promise<DrawnBox | null> {
  const tx = await baseConnection().getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const e = eventsFromLogs(tx?.meta?.logMessages).find((x): x is RoundSettledEvent => x.kind === "RoundSettled" && !x.void);
  return e ? boxFromEvent(e, signature) : null;
}

export type Pull = DrawnBox & { key: string; roundId: string; blockTime: number };

/** Every pack the wallet settled, newest first, from its Player account's transactions (the last 200). */
export async function pullsOf(wallet: PublicKey): Promise<Pull[]> {
  const conn = baseConnection();
  const sigs = await conn.getSignaturesForAddress(playerPda(wallet), { limit: 200 });
  const ok = sigs.filter((s) => !s.err).map((s) => s.signature);
  const out: Pull[] = [];
  for (let i = 0; i < ok.length; i += 25) {
    const txs = await conn.getTransactions(ok.slice(i, i + 25), { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    txs.forEach((tx, j) => {
      for (const e of eventsFromLogs(tx?.meta?.logMessages)) {
        if (e.kind !== "RoundSettled" || e.void || !e.player.equals(wallet)) continue;
        const sig = ok[i + j]!;
        out.push({ ...boxFromEvent(e, sig), key: `${e.roundId}`, roundId: `${e.roundId}`, blockTime: tx?.blockTime ?? 0 });
      }
    });
  }
  return out.sort((a, b) => b.blockTime - a.blockTime);
}

/* ---------- errors ---------- */

export function userRejected(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 8; x = (x as { cause?: unknown; error?: unknown }).cause ?? (x as { error?: unknown }).error, i++) {
    const err = x as { code?: number; name?: string; message?: string };
    if (err.code === 4001 || err.name === "WalletSignTransactionError" && /reject/i.test(err.message ?? "")) return true;
    if (/user (rejected|denied|cancel)|rejected the request|request rejected|declined/i.test(err.message ?? "")) return true;
  }
  return false;
}

/** Program error names by Anchor code (6000 + index in solana/programs/arclaw/src/errors.rs). */
const ERRORS = [
  "Paused", "UnknownMachine", "MachineOff", "BadMachine", "PriceImmutable", "NoPrizes", "TooManyOutcomes", "BadPrize", "BelowFloor",
  "AboveCap", "RtpOutOfBand", "TableStale", "ZeroAmount", "TooManyBoxes", "NoBoxes", "NotOperator", "NotDriver", "BadRoundState",
  "NotExpired", "BadQueue", "BadCardAccounts", "Reserved", "LinkExpired", "LinkLive", "NothingOwed", "Overflow",
];

function programError(m: string): string | null {
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(m);
  const code = hex ? parseInt(hex[1]!, 16) : Number(/"Custom":\s*(\d+)/.exec(m)?.[1] ?? NaN);
  return code >= 6000 ? (ERRORS[code - 6000] ?? null) : null;
}

/** Any wallet or program error, in words a player can act on. */
export function errorText(e: unknown): string {
  if (userRejected(e)) return "No problem, you declined in your wallet, so nothing was sent. Try again whenever you are ready.";
  const logs = (e as { logs?: string[] })?.logs?.join("\n") ?? "";
  const m = `${e instanceof Error ? e.message : String(e)}\n${logs}`;
  const name = programError(m) ?? /Error Code: (\w+)/.exec(m)?.[1];
  if (/insufficient (funds|lamports)|Attempt to debit an account but found no record of a prior credit/i.test(m))
    return "Your wallet needs a little SOL for fees and enough USDC for the boxes. Top it up and try again.";
  if (/TokenAccountNotFound|could not find account|AccountNotInitialized/i.test(m) || /0x1\b/.test(m))
    return "Your wallet has no USDC yet. On devnet get some from faucet.circle.com.";
  switch (name) {
    case "Paused":
      return "The machines are paused for a moment. Your boxes are safe; try again shortly.";
    case "MachineOff":
    case "NoPrizes":
      return "This machine is not open yet.";
    case "TableStale":
      return "Prices moved since this machine's prizes were set. It opens again once they are updated.";
    case "NoBoxes":
      return "You have no sealed box on this machine. Play first.";
    case "NotExpired":
      return "The draw is still on its way. Give it a moment.";
    case "LinkExpired":
      return "This link has expired. Ask your friend for a new one.";
  }
  const line = (m.split("\n")[0] ?? "").replace(/(?:https?|wss?):\/\/\S+/g, "").trim();
  return line ? (line.length > 160 ? `${line.slice(0, 157)}...` : line) : "That did not go through. Try again in a moment.";
}

export { Buffer };
