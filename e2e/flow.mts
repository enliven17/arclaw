/**
 * Local end-to-end check of lib/arclaw/contract.ts on Arc testnet: play one Single box, open it, wait for the VRF,
 * reveal, and print the cards. The key comes from contracts/.env (PRIVATE_KEY) and never leaves this process.
 * Run: pnpm exec tsx e2e/flow.mts
 */
import { readFileSync } from "node:fs";
import { createWalletClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_CHAIN, arcClient } from "@/lib/arc/chain";
import { STATUS, boxesFromLogs, openCall, openingFromLogs, playCall, readBoxes, readOpening, readTableId, revealCall, vrfTopUp, toUsdc } from "@/lib/arclaw/contract";
import { MACHINES } from "@/lib/machines";

const env = readFileSync("contracts/.env", "utf8");
const key = env.match(/^PRIVATE_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("PRIVATE_KEY missing in contracts/.env");
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const client = arcClient();
const wallet = createWalletClient({ account, chain: ARC_CHAIN, transport: http(ARC_CHAIN.rpcUrls.default.http[0]) });

const send = async (c: { to: `0x${string}`; data: Hex; value?: bigint }) => {
  const hash = await wallet.sendTransaction({ to: c.to, data: c.data, value: c.value ?? 0n });
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted ${hash}`);
  return r;
};

const machine = MACHINES[0]!;
console.log("player", account.address, "balance", formatEther(await client.getBalance({ address: account.address })), "USDC");
console.log("boxes before", await readBoxes(client, account.address));
const played = await send(playCall(machine.id, 1, machine.priceUsdc));
console.log("played", played.transactionHash);
console.log("boxes after play", await readBoxes(client, account.address));
const topUp = await vrfTopUp(client);
console.log("vrf top-up", formatEther(topUp));
const opened = await send(openCall(machine.id, 1, await readTableId(client, machine.id), topUp));
const o = openingFromLogs(opened.logs);
console.log("opened", opened.transactionHash, o);
if (!o) throw new Error("no Opened event");
const t0 = Date.now();
for (;;) {
  const s = await readOpening(client, o.openingId);
  if (s.status === STATUS.Fulfilled) break;
  if (s.status !== STATUS.Pending) throw new Error(`unexpected status ${s.status}`);
  if (Date.now() - t0 > 90_000) throw new Error("VRF not fulfilled in 90 s");
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("fulfilled after", Math.round((Date.now() - t0) / 1000), "s");
const revealed = await send(revealCall(o.openingId));
const boxes = await boxesFromLogs(client, revealed.logs);
console.log("revealed", revealed.transactionHash);
for (const b of boxes) console.log(`box ${b.boxIndex} ${b.tierName} ${toUsdc(b.valueWei)} USDC:`, b.cards.map((c) => `${c.ticker} ${toUsdc(c.valueWei).toFixed(2)}${c.paid ? "" : " (refunded)"}`).join(", "));
