/**
 * A test browser wallet for Playwright: a minimal EIP-1193 provider injected into the page that forwards to this
 * Node process, which signs with PRIVATE_KEY from contracts/.env (Arc testnet). The key never reaches the page.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createPublicClient, createWalletClient, http, numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://rpc.testnet.arc.io";
export const CHAIN = { id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };

const key = readFileSync("contracts/.env", "utf8").match(/^PRIVATE_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("PRIVATE_KEY missing");
export const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
export const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });

async function rpc(method, params) {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [account.address];
    case "eth_chainId":
      return numberToHex(CHAIN.id);
    case "net_version":
      return String(CHAIN.id);
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
      return null;
    case "wallet_requestPermissions":
    case "wallet_getPermissions":
      return [{ parentCapability: "eth_accounts" }];
    case "eth_sendTransaction": {
      const tx = params[0];
      return wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, gas: tx.gas ? BigInt(tx.gas) : undefined });
    }
    default:
      return pub.request({ method, params });
  }
}

/** A browser context with the wallet injected; returns { browser, page, errors }. */
export async function openWithWallet({ w = 1440, h = 900 } = {}) {
  const browser = await chromium.launch();
  const mobile = w < 500;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await ctx.exposeFunction("__arclawRpc", async (method, params) => {
    try {
      return { result: await rpc(method, params) };
    } catch (e) {
      return { error: { code: 4001, message: e.shortMessage ?? e.message } };
    }
  });
  await ctx.addInitScript(() => {
    sessionStorage.setItem("arclaw:splash", "1");
    const listeners = {};
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        const r = await window.__arclawRpc(method, params ?? []);
        if (r.error) throw Object.assign(new Error(r.error.message), r.error);
        return r.result;
      },
      on: (e, f) => ((listeners[e] ??= []).push(f), window.ethereum),
      removeListener: (e, f) => ((listeners[e] = (listeners[e] ?? []).filter((x) => x !== f)), window.ethereum),
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { browser, page, errors };
}

/** Connect through the header button and the connect sheet. */
export async function connect(page) {
  await page.getByRole("button", { name: "Connect", exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Connect browser wallet" }).click();
  await page.waitForTimeout(2000);
}
