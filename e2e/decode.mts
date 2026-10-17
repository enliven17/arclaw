/** Decode a reveal receipt with lib/arclaw/contract.ts: pnpm exec tsx e2e/decode.mts <txHash> */
import { arcClient } from "@/lib/arc/chain";
import { boxesFromLogs, toUsdc } from "@/lib/arclaw/contract";
const client = arcClient();
const r = await client.getTransactionReceipt({ hash: process.argv[2] as `0x${string}` });
for (const b of await boxesFromLogs(client, r.logs)) console.log(b.tierName, toUsdc(b.valueWei), b.cards.map((c) => `${c.ticker} ${toUsdc(c.valueWei).toFixed(2)}`).join(", "));
