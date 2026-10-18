/** Shared helpers for the mainnet scripts: the Arc chain, the key bundle file, clients. Plain ESM, viem only. */
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, parseGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const DEFAULT_KEYS = join(homedir(), "Desktop", "arclaw-mainnet-keys.txt");
export const MAINNET_RPC = "https://rpc.mainnet.arc.io";

/** Arc: USDC is the native gas token with 18 decimals. Transactions priced under 20 gwei are dropped. */
export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [MAINNET_RPC] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
});

export const FEES = { maxFeePerGas: parseGwei("30"), maxPriorityFeePerGas: parseGwei("1") };

export function args(argv = process.argv.slice(2)) {
  const get = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  return { argv, flag: (name) => argv.includes(name), get };
}

/** { deployer: { address, key }, ... } from the bundle written by keys.mjs. */
export function readKeys(path = DEFAULT_KEYS) {
  const text = readFileSync(path, "utf8");
  const out = {};
  const re = /^([A-Z0-9]+)\n\s+address:\s+(0x[0-9a-fA-F]{40})\n\s+private key:\s+(0x[0-9a-fA-F]{64})/gm;
  for (const m of text.matchAll(re)) out[m[1].toLowerCase()] = { address: m[2], key: m[3] };
  if (!out.deployer) throw new Error(`No wallets found in ${path}. Was it written by keys.mjs?`);
  return out;
}

/** Appends a block to the bundle (an append-only log of what the scripts created). */
export function appendLog(path, title, lines) {
  appendFileSync(path, `\n${"-".repeat(78)}\n${title}  (${new Date().toISOString()})\n${"-".repeat(78)}\n${lines.join("\n")}\n`);
}

export function clients(rpc = MAINNET_RPC, key) {
  const transport = http(rpc);
  const publicClient = createPublicClient({ chain: arcMainnet, transport });
  const walletClient = key ? createWalletClient({ chain: arcMainnet, transport, account: privateKeyToAccount(key) }) : undefined;
  return { publicClient, walletClient };
}

export const explorer = (kind, value) => `https://explorer.arc.io/${kind}/${value}`;
