/** Debug: pnpm exec tsx e2e/pulls.mts <address> */
import { arcClient } from "@/lib/arc/chain";
import { arclawLogs, pullsOf, toUsdc } from "@/lib/arclaw/contract";
const client = arcClient();
const who = process.argv[2] as `0x${string}`;
const t = Date.now();
try {
  const logs = await arclawLogs(client, "CardDrawn", { opener: who });
  console.log("logs", logs.length, (Date.now() - t) / 1000, "s");
  for (const p of await pullsOf(client, who)) console.log(p.tierName, p.cards.map((c) => `${c.ticker} ${toUsdc(c.valueWei).toFixed(2)}`).join(", "));
} catch (e) {
  console.log("error", (e as Error).message.slice(0, 400));
}
