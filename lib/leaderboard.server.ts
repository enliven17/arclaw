/**
 * The leaderboard, server side. From the Convex indexer when NEXT_PUBLIC_CONVEX_URL is set (convex/indexer.ts);
 * otherwise read straight from the program's transactions with the same decoding (lib/solana/events.ts), which is
 * fine while the program is young. Either way the page caches it for a minute.
 */
import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { baseConnection } from "./solana/client";
import { SOLANA } from "./solana/config";
import { aggregate, readSince, type Leaderboard } from "./solana/events";

export type LeaderboardSource = "convex" | "chain";

const leaderboardRef = makeFunctionReference<"query", { limit?: number }, Leaderboard>("indexer:leaderboard");

type Result = { board: Leaderboard; source: LeaderboardSource };
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
  if (!SOLANA.deployment) return null;
  try {
    const { plays, pulls } = await readSince(baseConnection(), null, 1000);
    return { board: aggregate(plays, pulls), source: "chain" };
  } catch (e) {
    console.error("leaderboard: chain read failed", e instanceof Error ? e.message.slice(0, 300) : e);
    return null;
  }
}
