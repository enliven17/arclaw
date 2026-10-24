/**
 * Keep the leaderboard fresh (convex/indexer.ts) and run one keeper heartbeat (convex/keeperRun.ts) every 30 seconds.
 * The heartbeat handles reveals and wake requests, and promotes itself to a full tick every five minutes. The event
 * log is pruned daily.
 * The keeper actions are no-ops until KEEPER_PRIVATE_KEY is set in the Convex env (docs/OPERATIONS.md).
 */
import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
crons.interval("index arclaw events", { minutes: 1 }, makeFunctionReference<"action">("indexer:sync"), {});
crons.interval("keeper heartbeat", { seconds: 30 }, makeFunctionReference<"action">("keeperRun:heartbeat"), {});
crons.interval("keeper prune events", { hours: 24 }, makeFunctionReference<"mutation">("keeperState:prune"), {});
export default crons;
