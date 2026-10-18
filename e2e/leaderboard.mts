/** Debug the leaderboard read: pnpm exec tsx e2e/leaderboard.mts */
import { arcClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { aggregate, readRange } from "@/lib/arclaw/events";
const client = arcClient();
const head = await client.getBlockNumber();
const { plays, pulls } = await readRange(client, ARC.contracts!.deployBlock, head);
const lb = aggregate(plays, pulls, Number(head));
console.log("plays", plays.length, "pulls", pulls.length);
console.log(lb.players.map((p) => `${p.player.slice(0, 8)} ${p.totalUsdc.toFixed(2)} in ${p.packs} packs, spent ${p.spentUsdc}`).join("\n"));
console.log(lb.biggest.slice(0, 3).map((p) => `${p.tierName} ${p.valueUsdc}`).join(", "));
