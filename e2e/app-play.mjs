/**
 * App end to end on Arc testnet with a browser wallet: connect, acknowledge, play one Single box (the claw runs),
 * open it, and click through the reveal, with a screenshot of every state. The wallet is a minimal EIP-1193 provider
 * injected into the page; it forwards to this Node process, which signs with PRIVATE_KEY from contracts/.env. The
 * key never reaches the page.
 *   node e2e/app-play.mjs [--w 1440 --h 900] [--base http://localhost:3210] [--no-play]
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createPublicClient, createWalletClient, http, numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const W = Number(flag("w", 1440));
const H = Number(flag("h", 900));
const BASE = flag("base", "http://localhost:3210");
const RPC = "https://rpc.testnet.arc.io";
const CHAIN = { id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };

const key = readFileSync("contracts/.env", "utf8").match(/^PRIVATE_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("PRIVATE_KEY missing");
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
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

const b = await chromium.launch();
const mobile = W < 500;
const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
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
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
const tag = `${W}`;
const shot = (n) => p.screenshot({ path: `shots/app-${tag}-${n}.png` });

await p.goto(`${BASE}/app/play/single`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
await shot("01-machine");
await p.getByRole("button", { name: "Connect", exact: true }).first().click();
await p.waitForTimeout(500);
await shot("02-connect-sheet");
await p.getByRole("button", { name: "Connect browser wallet" }).click();
await p.waitForTimeout(2500);
await shot("03-connected");

if (!args.includes("--no-play")) {
  const ack = p.getByRole("checkbox");
  if (await ack.count()) await ack.click();
  await p.getByRole("button", { name: /^Play for/ }).click();
  await p.waitForTimeout(1800);
  await shot("04-claw-moving");
  await p.waitForFunction(() => /sealed box/i.test(document.querySelector("[role=status]")?.textContent ?? ""), null, { timeout: 120000 });
  await shot("05-played");
}

await p.getByRole("button", { name: "Open one" }).click();
await p.waitForTimeout(1200);
await shot("06-drawing");
const stage = p.locator("dialog [role=button][aria-label]").first();
await p.waitForFunction(() => /Tap the box/.test(document.querySelector("dialog [role=button][aria-label]")?.getAttribute("aria-label") ?? ""), null, { timeout: 180000 });
await shot("07-sealed");
await stage.click();
await p.waitForTimeout(1400);
await shot("08-pack");
await stage.click();
await p.waitForTimeout(1300);
await shot("09-torn");
for (let i = 0; i < 3; i++) {
  await stage.click();
  await p.waitForTimeout(900);
}
await shot("10-dealt");
const cards = p.locator("dialog [data-rv-card]");
for (let i = 0; i < 3; i++) {
  await cards.nth(i).click();
  await p.waitForTimeout(1100);
  if (i === 0) await shot("11-first-flip");
}
await p.waitForTimeout(800);
await shot("12-done");
console.log(errs.length ? `page errors:\n${errs.join("\n")}` : "no page errors");
await b.close();
