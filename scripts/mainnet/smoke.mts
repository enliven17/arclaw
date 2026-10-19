/**
 * Mainnet smoke test: from a small test wallet (not a role key), play one Single box, open it, wait for the keeper to
 * reveal (or reveal after 20 s), print the cards and sell them back on the desk. Costs about 0.5 USDC plus fees.
 *
 *   NEXT_PUBLIC_ARC_NETWORK=mainnet npx tsx --tsconfig tsconfig.json scripts/mainnet/smoke.mts <file with TESTER_PRIVATE_KEY=0x..>
 */
import { readFileSync } from "node:fs";
import { createWalletClient, formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_CHAIN, arcClient, arcTransport, type Call } from "../../lib/arc/chain";
import { STATUS, approveCall, openCall, openingFromLogs, playCall, quoteSell, readHoldings, readOpening, readTableId, revealCall, revealedBoxes, sellCall, toUsdc, vrfTopUp, CONTRACTS } from "../../lib/arclaw/contract";

const key = /TESTER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/.exec(readFileSync(process.argv[2]!, "utf8"))![1] as Hex;
const account = privateKeyToAccount(key);
const pub = arcClient();
const wallet = createWalletClient({ account, chain: ARC_CHAIN, transport: arcTransport() });
const usd = async () => Number(formatUnits(await pub.getBalance({ address: account.address }), 18)).toFixed(4);
async function send(c: Call) {
  const tx = { to: c.to, data: c.data, value: c.value ?? 0n };
  const [gas, fees] = await Promise.all([pub.estimateGas({ account: account.address, ...tx }), pub.estimateFeesPerGas()]);
  const hash = await wallet.sendTransaction({ ...tx, gas: (gas * 12n) / 10n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted ${hash}`);
  return r;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log("tester", account.address, "start", await usd(), "USDC");
const played = await send(playCall(1, 1, 1));
console.log("play ok", played.transactionHash);
const opened = await send(openCall(1, 1, await readTableId(pub, 1), await vrfTopUp(pub)));
const o = openingFromLogs(opened.logs)!;
console.log("open ok", opened.transactionHash, "opening", o.openingId, "after", await usd());
const t0 = Date.now();
let revealedBy = "keeper";
for (;;) {
  const s = await readOpening(pub, o.openingId);
  if (s.status === STATUS.Revealed) break;
  if (s.status === STATUS.Fulfilled && Date.now() - t0 > 20_000) { revealedBy = "tester"; await send(revealCall(o.openingId)); break; }
  if (Date.now() - t0 > 180_000) throw new Error(`no draw after 3 min, status ${s.status}`);
  await sleep(2000);
}
console.log(`revealed by ${revealedBy} in ${Math.round((Date.now() - t0) / 1000)}s`);
for (const b of await revealedBoxes(pub, o.openingId, opened.blockNumber)) console.log(`  ${b.tierName}: ${b.cards.map((c) => `${c.ticker} ${toUsdc(c.valueWei).toFixed(4)}`).join(", ")}  total ${b.cards.reduce((t, c) => t + toUsdc(c.valueWei), 0).toFixed(4)}`);
const desk = CONTRACTS!.sellDesk;
for (const h of await readHoldings(pub, account.address)) {
  if (h.balance === 0n) continue;
  const q = await quoteSell(pub, h.address, h.balance);
  console.log(`  sell ${h.ticker} ${formatUnits(h.balance, 18)} sh -> quote ${formatUnits(q.out, 18)} USDC ok=${q.ok}`);
  if (!q.ok) continue;
  await send(approveCall(h.address, desk, h.balance));
  await send(sellCall(h.address, h.balance, (q.out * 98n) / 100n, account.address));
}
console.log("end", await usd(), "USDC");
