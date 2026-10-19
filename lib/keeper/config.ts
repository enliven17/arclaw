/**
 * Keeper configuration from the environment (CLI: process.env plus flags; Convex: the deployment's env vars).
 * The private key is NOT part of the config: signer.ts reads it at the last moment and never returns or logs it.
 *
 *   KEEPER_NETWORK            testnet | mainnet (default NEXT_PUBLIC_ARC_NETWORK, else testnet)
 *   KEEPER_RPC_URL            comma list of RPCs (default: the network's public RPC; use a private one in production)
 *   KEEPER_DEPLOYMENT_JSON    inline deployment JSON (lib/deployments shape); needed on mainnet until
 *                             lib/arc/config.ts knows the mainnet addresses
 *   KEEPER_VRF_IMPLEMENTATION the D20 coordinator's expected implementation (EIP-1967 slot); a change is a critical
 *                             alert (default on mainnet: the one audited in round 10; "off" to skip)
 *   KEEPER_PRICE_CHECK        astock (default on mainnet) | off (default on testnet) | https://... (same JSON shape)
 *   KEEPER_DRY_RUN            1: simulate everything, sign nothing
 *   KEEPER_MIN_GAS_USDC       keeper gas balance under which health warns (default 1); critical under a fifth of it
 *   KEEPER_MAX_VRF_TOPUP_USDC the most the keeper adds to a retry above the house VRF subsidy (default 0.1)
 *   KEEPER_MAX_REPRICES_PER_DAY reprices per machine per UTC day before the keeper stops and alerts (default 6)
 *   KEEPER_MARKET             auto (default) | open | closed: override the US market clock (tests)
 *   ALERT_TELEGRAM_CHAT_ID    where alerts go, through TELEGRAM_BOT_TOKEN (both optional: no chat, no Telegram)
 */
import { getAddress, type Address } from "viem";
import { arcConfig, type ArcConfig } from "../arc/config";
import { SYMBOLS } from "./table";

export type Deployment = {
  chainId: number;
  arclaw: Address;
  priceSource: Address;
  desk: Address;
  vrfCoordinator: Address;
  lens?: Address;
  deployBlock: bigint;
  /** Token by ticker without ".arc", for every SYMBOLS entry. */
  stocks: Record<string, Address>;
};

export type PriceCheck = { mode: "off" } | { mode: "feed"; url: string; maxDiffBps: bigint; maxAgeSec: number };

export type Thresholds = {
  /** Reprice once any card token moved this far from the table's reference (contract refuses opens at 500). */
  moveTriggerBps: bigint;
  /** A machine with demand is repriced once its table is this old (18 h, before the 24 h expiry). */
  refreshAgeSec: number;
  /** Reprices per machine per UTC day (chain clock) before the keeper stops and alerts (forced ones still run). */
  maxRepricesPerDay: number;
  /** A Played event this recent means demand. */
  playWindowSec: number;
  /** A wake request this recent means demand. */
  wakeWindowSec: number;
  /** 10k-block log windows read per tick for the demand index. */
  demandLogWindows: number;
  /** Never reprice the same machine twice inside this window (unless forced). */
  minRepriceIntervalSec: number;
  /** A fulfilled opening still unrevealed after this long is a health warning. */
  revealLagSec: number;
  minGasWei: bigint;
  maxVrfTopUpWei: bigint;
  /** Share of opens retried (last LOG_SPAN blocks) above which health warns. */
  vrfRetryWarn: number;
  retryBackoffMaxSec: number;
  maxRevealsPerTick: number;
  maxRetriesPerTick: number;
};

export type KeeperConfig = {
  network: "testnet" | "mainnet" | "local";
  chain: ArcConfig;
  deployment: Deployment;
  priceCheck: PriceCheck;
  dryRun: boolean;
  market: "auto" | "open" | "closed";
  thresholds: Thresholds;
  telegram: { chatId: string } | null;
  /** The VRF coordinator is an upgradeable proxy whose owner could swap in logic that picks words (audit 10a L-01). */
  vrfImplementation: Address | null;
};

type DeploymentFile = {
  chainId: number;
  arclaw: string;
  priceSource: string;
  desk: string;
  vrfCoordinator: string;
  lens?: string;
  deployBlock: number | string;
  stocks: Record<string, string>;
};

export function parseDeployment(d: DeploymentFile): Deployment {
  const stocks = Object.fromEntries(Object.entries(d.stocks).map(([k, v]) => [k.replace(/\.arc$/i, ""), getAddress(v)]));
  for (const s of SYMBOLS) if (!stocks[s]) throw new Error(`deployment has no ${s}.arc token`);
  return {
    chainId: Number(d.chainId),
    arclaw: getAddress(d.arclaw),
    priceSource: getAddress(d.priceSource),
    desk: getAddress(d.desk),
    vrfCoordinator: getAddress(d.vrfCoordinator),
    lens: d.lens ? getAddress(d.lens) : undefined,
    deployBlock: BigInt(d.deployBlock),
    stocks,
  };
}

const usdcWei = (v: string | undefined, dflt: string) => {
  const s = (v ?? dflt).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error(`bad USDC amount: ${s}`);
  const [i, f = ""] = s.split(".");
  return BigInt(i!) * 10n ** 18n + BigInt((f + "000000").slice(0, 6)) * 10n ** 12n;
};

export type ConfigOverrides = { deployment?: DeploymentFile; rpcUrls?: string[]; network?: string; dryRun?: boolean; market?: string; priceCheck?: string };

export function loadConfig(env: Record<string, string | undefined> = process.env, o: ConfigOverrides = {}): KeeperConfig {
  const netRaw = o.network ?? env.KEEPER_NETWORK ?? env.NEXT_PUBLIC_ARC_NETWORK ?? "testnet";
  const network = netRaw === "mainnet" ? "mainnet" : netRaw === "local" ? "local" : "testnet";
  const base = arcConfig(network === "mainnet" ? "mainnet" : "testnet");
  const rpc = o.rpcUrls ?? (env.KEEPER_RPC_URL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const inline = env.KEEPER_DEPLOYMENT_JSON ? (JSON.parse(env.KEEPER_DEPLOYMENT_JSON) as DeploymentFile) : undefined;
  const file = o.deployment ?? inline;
  let deployment: Deployment;
  if (file) deployment = parseDeployment(file);
  else if (base.contracts) {
    const c = base.contracts;
    deployment = { chainId: base.chain.id, arclaw: c.arclaw, priceSource: c.priceSource, desk: c.desk, vrfCoordinator: c.vrfCoordinator, deployBlock: c.deployBlock, stocks: c.stocks };
  } else throw new Error(`no arclaw deployment for ${network}: set KEEPER_DEPLOYMENT_JSON`);

  const chain: ArcConfig = {
    network: base.network,
    chain: { ...base.chain, id: deployment.chainId, rpcUrls: rpc.length ? rpc : base.chain.rpcUrls },
    contracts: null,
  };
  if (network === "local" && !rpc.length) chain.chain.rpcUrls = ["http://127.0.0.1:8545"];

  const pc = (o.priceCheck ?? env.KEEPER_PRICE_CHECK ?? (network === "mainnet" ? "astock" : "off")).trim();
  const priceCheck: PriceCheck =
    pc === "off"
      ? { mode: "off" }
      : { mode: "feed", url: pc === "astock" ? "https://astock.fi/api/prices" : pc, maxDiffBps: 100n, maxAgeSec: 15 * 60 };
  if (priceCheck.mode === "feed" && !/^https?:\/\//.test(priceCheck.url)) throw new Error("KEEPER_PRICE_CHECK must be astock, off or an http(s) URL");

  const maxPerDay = Number(env.KEEPER_MAX_REPRICES_PER_DAY ?? 6);
  if (!Number.isInteger(maxPerDay) || maxPerDay < 1) throw new Error("KEEPER_MAX_REPRICES_PER_DAY must be a positive integer");
  const market = (o.market ?? env.KEEPER_MARKET ?? "auto") as KeeperConfig["market"];
  if (!["auto", "open", "closed"].includes(market)) throw new Error("KEEPER_MARKET must be auto, open or closed");

  return {
    network,
    chain,
    deployment,
    priceCheck,
    dryRun: o.dryRun ?? env.KEEPER_DRY_RUN === "1",
    market,
    thresholds: {
      moveTriggerBps: 200n,
      refreshAgeSec: 18 * 3600,
      maxRepricesPerDay: Number(env.KEEPER_MAX_REPRICES_PER_DAY ?? 6),
      playWindowSec: 86_400,
      wakeWindowSec: 3600,
      demandLogWindows: 30,
      minRepriceIntervalSec: 60,
      revealLagSec: 60,
      minGasWei: usdcWei(env.KEEPER_MIN_GAS_USDC, "1"),
      maxVrfTopUpWei: usdcWei(env.KEEPER_MAX_VRF_TOPUP_USDC, "0.1"),
      vrfRetryWarn: 0.2,
      retryBackoffMaxSec: 3600,
      maxRevealsPerTick: 10,
      maxRetriesPerTick: 10,
    },
    telegram: env.ALERT_TELEGRAM_CHAT_ID && env.TELEGRAM_BOT_TOKEN ? { chatId: env.ALERT_TELEGRAM_CHAT_ID } : null,
    vrfImplementation: vrfImplOf(env.KEEPER_VRF_IMPLEMENTATION, network),
  };
}

/** D20 mainnet coordinator 0xd20da057...0571: implementation as of audit round 10 (2026-10-19). */
const D20_MAINNET_IMPL = "0xd20da000125643b4db5a6a36a3b853c17745df44";
function vrfImplOf(raw: string | undefined, network: string): Address | null {
  const v = raw?.trim();
  if (v === "off") return null;
  if (v) return getAddress(v);
  return network === "mainnet" ? getAddress(D20_MAINNET_IMPL) : null;
}

/** Token addresses in SYMBOLS order (Deploy.s.sol's tokens array). */
export const tokensOf = (d: Deployment): Address[] => SYMBOLS.map((s) => d.stocks[s]!);
