/**
 * The keeper's only path to the chain for writes: simulate, then sign and send, one transaction at a time, from one
 * hot key. The key is read from KEEPER_PRIVATE_KEY here and nowhere else; it is never logged, returned or stored.
 *
 *   simulate first     every call is eth_call'ed from the keeper address; a revert never costs gas and comes back
 *                      as the contract error name (TableStale, NotReady, ...)
 *   dry run            simulate only, sign nothing (KEEPER_DRY_RUN=1 or --dry-run; works with KEEPER_ADDRESS alone)
 *   nonces             taken from the pending count right before each send; a nonce error refetches once
 *   stuck              a pending nonce above the mined one blocks new sends; after STUCK_REPLACE_S it is replaced by
 *                      a zero-value self-transfer at 3x fees so the next tick can move again
 *   gas                estimate x 1.3 + 20k, fees from the Arc rule (never under 20 gwei)
 */
import { createPublicClient, createWalletClient, http, fallback, type Address, type PublicClient, type WalletClient, type Hash, type Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcChain } from "../arc/chain";
import { revertName, type TxRequest } from "./arclaw";
import type { KeeperConfig } from "./config";

export const STUCK_REPLACE_S = 180;
const RECEIPT_TIMEOUT_MS = 90_000;

export type SendResult =
  | { ok: true; dryRun: true; hash: null; gas: bigint }
  | { ok: true; dryRun: false; hash: Hash; gasUsed: bigint; status: "success" }
  | { ok: false; reverted: true; error: string; hash: Hash | null }
  | { ok: false; reverted: false; error: string; hash: Hash | null };

export type Signer = { address: Address; account: Account | null };

/**
 * The keeper account. With a key: a local signer. Without one: KEEPER_ADDRESS for read-only and dry runs.
 * Errors never echo the key.
 */
export function loadSigner(env: Record<string, string | undefined> = process.env): Signer {
  const key = env.KEEPER_PRIVATE_KEY?.trim();
  if (key) {
    const hex = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("KEEPER_PRIVATE_KEY is not a 32-byte hex key");
    let account: Account;
    try {
      account = privateKeyToAccount(hex);
    } catch {
      throw new Error("KEEPER_PRIVATE_KEY is not a valid secp256k1 key");
    }
    return { address: account.address, account };
  }
  const addr = env.KEEPER_ADDRESS?.trim();
  if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) return { address: addr as Address, account: null };
  throw new Error("set KEEPER_PRIVATE_KEY (or KEEPER_ADDRESS for a dry run)");
}

export function makeClients(cfg: KeeperConfig, signer: Signer): { client: PublicClient; wallet: WalletClient | null } {
  const chain = arcChain(cfg.chain);
  const urls = cfg.chain.chain.rpcUrls;
  const transport = () => (urls.length === 1 ? http(urls[0], { retryCount: 2, timeout: 20_000 }) : fallback(urls.map((u) => http(u, { retryCount: 2, timeout: 20_000 }))));
  const client = createPublicClient({ chain, transport: transport() }) as PublicClient;
  const wallet = signer.account ? createWalletClient({ account: signer.account, chain, transport: transport() }) : null;
  return { client, wallet };
}

const NONCE_ERR = /nonce too low|nonce too high|already known|replacement transaction underpriced|nonce has already been used|invalid nonce/i;

export class Sender {
  /** Native this sender spent so far (gas of mined transactions plus value sent), wei. */
  spentWei = 0n;
  constructor(
    readonly client: PublicClient,
    readonly wallet: WalletClient | null,
    readonly address: Address,
    readonly dryRun: boolean,
  ) {
    if (!dryRun && !wallet) throw new Error("a live run needs KEEPER_PRIVATE_KEY");
  }

  /** eth_call from the keeper: null when it would succeed, else the revert reason. */
  async simulate(req: TxRequest): Promise<string | null> {
    try {
      await this.client.call({ account: this.address, to: req.to, data: req.data, value: req.value });
      return null;
    } catch (e) {
      return revertName(e);
    }
  }

  /** Nonces: mined (latest) and including the mempool (pending). */
  async nonces(): Promise<{ latest: number; pending: number }> {
    const [latest, pending] = await Promise.all([
      this.client.getTransactionCount({ address: this.address, blockTag: "latest" }),
      this.client.getTransactionCount({ address: this.address, blockTag: "pending" }),
    ]);
    return { latest, pending };
  }

  private async fees(mult = 1n) {
    // viem applies the chain's own rule (lib/arc/chain.ts: never under 20 gwei)
    const { maxFeePerGas, maxPriorityFeePerGas } = await this.client.estimateFeesPerGas({ chain: this.client.chain, type: "eip1559" } as never) as { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
    return { maxFeePerGas: maxFeePerGas * mult, maxPriorityFeePerGas: maxPriorityFeePerGas * mult };
  }

  /** Simulate, then (unless dry run) sign, send and wait for the receipt. Never throws for chain-side failures. */
  async send(req: TxRequest): Promise<SendResult> {
    const revert = await this.simulate(req);
    if (revert) return { ok: false, reverted: true, error: revert, hash: null };
    let gas: bigint;
    try {
      gas = await this.client.estimateGas({ account: this.address, to: req.to, data: req.data, value: req.value });
    } catch (e) {
      return { ok: false, reverted: true, error: revertName(e), hash: null };
    }
    if (this.dryRun) return { ok: true, dryRun: true, hash: null, gas };
    const limit = (gas * 13n) / 10n + 20_000n;
    let hash: Hash | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const nonce = await this.client.getTransactionCount({ address: this.address, blockTag: "pending" });
        hash = await this.wallet!.sendTransaction({ account: this.wallet!.account!, chain: this.client.chain, to: req.to, data: req.data, value: req.value ?? 0n, gas: limit, nonce, ...(await this.fees()) });
        break;
      } catch (e) {
        const msg = revertName(e);
        if (attempt === 0 && NONCE_ERR.test(`${msg} ${(e as Error).message ?? ""}`)) continue;
        return { ok: false, reverted: false, error: /insufficient funds/i.test((e as Error).message ?? "") ? "keeper is out of gas money (insufficient funds)" : msg, hash: null };
      }
    }
    if (!hash) return { ok: false, reverted: false, error: "send failed", hash: null };
    try {
      const r = await this.client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      this.spentWei += r.gasUsed * r.effectiveGasPrice + (r.status === "success" ? (req.value ?? 0n) : 0n);
      if (r.status !== "success") return { ok: false, reverted: true, error: "reverted on chain", hash };
      return { ok: true, dryRun: false, hash, gasUsed: r.gasUsed, status: "success" };
    } catch (e) {
      // Not mined in time: the next tick sees it as a pending nonce (stuck) or as done on chain.
      return { ok: false, reverted: false, error: `no receipt yet: ${revertName(e)}`, hash };
    }
  }

  /**
   * Blocks sends while a transaction of ours sits in the mempool. Past STUCK_REPLACE_S, replaces the lowest stuck
   * nonce with a zero-value self-transfer at 3x fees. `stuckSince` is the caller's memory of when it was first seen.
   */
  async unstick(now: number, stuckSince: number | null): Promise<{ clear: boolean; stuckSince: number | null; note?: string }> {
    const { latest, pending } = await this.nonces();
    if (pending <= latest) return { clear: true, stuckSince: null };
    const since = stuckSince ?? now;
    if (this.dryRun || now - since < STUCK_REPLACE_S) return { clear: false, stuckSince: since, note: `nonce ${latest} pending for ${now - since}s` };
    try {
      const hash = await this.wallet!.sendTransaction({ account: this.wallet!.account!, chain: this.client.chain, to: this.address, value: 0n, gas: 21_000n, nonce: latest, ...(await this.fees(3n)) });
      return { clear: false, stuckSince: since, note: `replaced stuck nonce ${latest} with ${hash}` };
    } catch (e) {
      return { clear: false, stuckSince: since, note: `could not replace stuck nonce ${latest}: ${revertName(e)}` };
    }
  }
}

