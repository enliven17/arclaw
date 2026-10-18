/**
 * The leaderboard, server side. From the Convex indexer when NEXT_PUBLIC_CONVEX_URL is set (convex/indexer.ts);
 * otherwise read straight from the chain's logs with the same decoding (lib/arclaw/events.ts), which is fine while the
 * chain is young. Either way the page caches it for a minute.
 */
import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { arcClient } from "./arc/chain";
import { ARC } from "./arc/config";
import { aggregate, readRange, type Leaderboard } from "./arclaw/events";

export type LeaderboardSource = "convex" | "chain";

const leaderboardRef = makeFunctionReference<"query", { limit?: number }, Leaderboard>("indexer:leaderboard");

type Result = { board: Leaderboard; source: LeaderboardSource };
/** In-process memo: one chain read a minute at most, and the last good board if a read fails. */
let memo: { at: number; value: Result } | null = null;
const TTL_MS = 60_000;

export async function getLeaderboard(): Promise<Result | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.value;
  const fresh = await readLeaderboard();
  if (fresh) memo = { at: Date.now(), value: fresh };
  return fresh ?? memo?.value ?? null;
}

async function readLeaderboard(): Promise<Result | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (url) {
    try {
      return { board: await new ConvexHttpClient(url).query(leaderboardRef, { limit: 20 }), source: "convex" };
    } catch {
      // Fall through to the chain.
    }
  }
  if (!ARC.contracts) return null;
  try {
    const client = arcClient();
    const head = await client.getBlockNumber();
    const { plays, pulls } = await readRange(client, ARC.contracts.deployBlock, head);
    return { board: aggregate(plays, pulls, Number(head)), source: "chain" };
  } catch (e) {
    console.error("leaderboard: chain read failed", e instanceof Error ? e.message.slice(0, 300) : e);
    return null;
  }
}
