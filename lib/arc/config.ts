/**
 * Arc network config (pattern from mimir-solana/lib/arc/config.ts). One switch, NEXT_PUBLIC_ARC_NETWORK
 * (`testnet` default | `mainnet`), picks the chain, the RPCs and our contract addresses (lib/deployments/*.json).
 * Pure and isomorphic: strings only, no SDK imports.
 *
 * Until a deployment record exists for a network (lib/deployments/arc-<network>.json, written by the deploy script),
 * `contracts` is null there and the app says so instead of pointing anywhere.
 */
import mainnetFile from "@/lib/deployments/arc-mainnet.json";
import testnet from "@/lib/deployments/arc-testnet.json";

export type ArcNetwork = "testnet" | "mainnet";

export type Contracts = {
  arclaw: `0x${string}`;
  /** The desk Arclaw buys prizes from (and, on mainnet, where shares sell back). */
  desk: `0x${string}`;
  /** Where shares sell back: a separate MockAstockDesk with sell() on testnet once deployed, else the desk. */
  sellDesk: `0x${string}`;
  priceSource: `0x${string}`;
  vrfCoordinator: `0x${string}`;
  /** First block worth reading logs from. */
  deployBlock: bigint;
  /** ".arc" token address by ticker (without the .arc suffix). */
  stocks: Record<string, `0x${string}`>;
};

export type ArcConfig = {
  network: ArcNetwork;
  chain: { id: number; name: string; rpcUrls: string[]; explorer: string };
  contracts: Contracts | null;
};

/** USDC on Arc: the native gas token (18 dp) with an ERC-20 view (6 dp) at this address. */
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
/** Arc drops transactions priced under 20 gwei. */
export const MIN_FEE_PER_GAS = 20_000_000_000n;

/** The record as the deploy script writes it; null while the file is the empty placeholder. */
function recordOf(d: Partial<typeof testnet>): Contracts | null {
  const address = /^0x[0-9a-fA-F]{40}$/;
  if (!d.arclaw || !address.test(d.arclaw) || !d.desk || !d.priceSource || !d.vrfCoordinator || d.deployBlock == null || !d.stocks) return null;
  return contractsOf(d as typeof testnet);
}

function contractsOf(d: typeof testnet): Contracts {
  const stocks = Object.fromEntries(Object.entries(d.stocks).map(([k, v]) => [k.replace(/\.arc$/i, ""), v as `0x${string}`]));
  const sell = (d as { sellDesk?: string }).sellDesk;
  return {
    arclaw: d.arclaw as `0x${string}`,
    desk: d.desk as `0x${string}`,
    sellDesk: (sell ?? d.desk) as `0x${string}`,
    priceSource: d.priceSource as `0x${string}`,
    vrfCoordinator: d.vrfCoordinator as `0x${string}`,
    deployBlock: BigInt(d.deployBlock),
    stocks,
  };
}

export function arcConfig(network: string | undefined = process.env.NEXT_PUBLIC_ARC_NETWORK): ArcConfig {
  const n: ArcNetwork = network === "mainnet" ? "mainnet" : "testnet";
  const rpc = (process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (n === "mainnet") {
    return {
      network: n,
      chain: { id: 5042, name: "Arc", rpcUrls: rpc.length ? rpc : ["https://rpc.mainnet.arc.io"], explorer: "https://explorer.arc.io" },
      contracts: recordOf(mainnetFile as Partial<typeof testnet>),
    };
  }
  return {
    network: n,
    chain: { id: 5042002, name: "Arc Testnet", rpcUrls: rpc.length ? rpc : ["https://rpc.testnet.arc.io"], explorer: "https://explorer.testnet.arc.io" },
    contracts: contractsOf(testnet),
  };
}

export const ARC = arcConfig();

export const explorerTx = (hash: string, c: ArcConfig = ARC) => `${c.chain.explorer}/tx/${hash}`;
export const explorerAddress = (address: string, c: ArcConfig = ARC) => `${c.chain.explorer}/address/${address}`;
