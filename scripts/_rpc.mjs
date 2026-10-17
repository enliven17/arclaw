import { createPublicClient, http } from "viem";
const c = createPublicClient({ transport: http("https://rpc.testnet.arc.io") });
const head = await c.getBlockNumber();
console.log("head", head, "since deploy", head - 67701518n);
for (const span of [1000n, 10000n, 100000n]) {
  try { const l = await c.getLogs({ address: "0xaa4303fC468EEa6428dDA370ad9Fc79057C73a6C", fromBlock: head - span, toBlock: head }); console.log("span", span, "ok", l.length); } catch (e) { console.log("span", span, "fail", e.shortMessage?.slice(0, 120)); }
}
const g = await c.getGasPrice(); console.log("gasPrice gwei", Number(g) / 1e9);
