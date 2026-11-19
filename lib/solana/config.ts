/**
 * Solana network config. One switch, NEXT_PUBLIC_SOLANA_NETWORK (`devnet` default | `mainnet`), picks the RPCs, the
 * MagicBlock ephemeral rollup, Circle's USDC and our program (lib/deployments/solana-*.json, written by
 * scripts/solana/setup.ts). Pure and isomorphic: strings only, no SDK imports.
 *
 * USDC is Circle's own mint on both networks (devnet USDC comes from https://faucet.circle.com). Prize stocks are
 * xStocks (Token-2022) on mainnet and test mints made by the setup script on devnet.
 */
import devnetFile from "@/lib/deployments/solana-devnet.json";
import mainnetFile from "@/lib/deployments/solana-mainnet.json";

export type SolanaNetwork = "devnet" | "mainnet";

export type Deployment = {
  programId: string;
  usdcMint: string;
  /** First slot worth reading signatures from. */
  deploySlot: number;
  /** Stock mint by ticker, and its token program ("token" or "token-2022"). */
  stocks: Record<string, { mint: string; decimals: number; program: "token" | "token-2022" }>;
};

export type SolanaConfig = {
  network: SolanaNetwork;
  /** Solana RPC. */
  rpc: string;
  /** MagicBlock ephemeral rollup RPC (the claw runs here). */
  erRpc: string;
  /** ER validator a round is delegated to; null = the delegation program's default (Asia devnet). */
  erValidator: string | null;
  explorer: string;
  deployment: Deployment | null;
};

/** Circle's USDC. */
export const USDC_MINT = { devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } as const;
export const USDC_DECIMALS = 6;

function recordOf(d: Partial<Deployment>): Deployment | null {
  if (!d.programId || !d.usdcMint) return null;
  return { programId: d.programId, usdcMint: d.usdcMint, deploySlot: d.deploySlot ?? 0, stocks: d.stocks ?? {} };
}

function mainnetRecord(): Partial<Deployment> {
  const raw = process.env.NEXT_PUBLIC_SOLANA_MAINNET_DEPLOYMENT;
  if (raw) {
    try {
      return JSON.parse(raw) as Partial<Deployment>;
    } catch {
      return {};
    }
  }
  return mainnetFile as Partial<Deployment>;
}

export function solanaConfig(network: string | undefined = process.env.NEXT_PUBLIC_SOLANA_NETWORK): SolanaConfig {
  const n: SolanaNetwork = network === "mainnet" ? "mainnet" : "devnet";
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  const erRpc = process.env.NEXT_PUBLIC_MAGICBLOCK_RPC_URL?.trim();
  const erValidator = process.env.NEXT_PUBLIC_MAGICBLOCK_VALIDATOR?.trim() || null;
  if (n === "mainnet") {
    return {
      network: n,
      rpc: rpc || "https://api.mainnet-beta.solana.com",
      erRpc: erRpc || "https://as.magicblock.app",
      erValidator,
      explorer: "https://explorer.solana.com",
      deployment: recordOf(mainnetRecord()),
    };
  }
  return {
    network: n,
    rpc: rpc || "https://api.devnet.solana.com",
    erRpc: erRpc || "https://devnet-as.magicblock.app",
    erValidator,
    explorer: "https://explorer.solana.com",
    deployment: recordOf(devnetFile as Partial<Deployment>),
  };
}

export const SOLANA = solanaConfig();

const cluster = (c: SolanaConfig) => (c.network === "devnet" ? "?cluster=devnet" : "");
export const explorerTx = (sig: string, c: SolanaConfig = SOLANA) => `${c.explorer}/tx/${sig}${cluster(c)}`;
export const explorerAddress = (address: string, c: SolanaConfig = SOLANA) => `${c.explorer}/address/${address}${cluster(c)}`;
/** An ER transaction, in MagicBlock's explorer view of the rollup. */
export const explorerErTx = (sig: string, c: SolanaConfig = SOLANA) =>
  `${c.explorer}/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(c.erRpc)}`;
