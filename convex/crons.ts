/**
 * Keep the leaderboard fresh (convex/indexer.ts) and run the keeper (convex/keeperRun.ts): reveals and wake requests
 * every 10 seconds,
 * a full tick (VRF retries, reprice when due, health, alerts) every minute, and a daily prune of its event log.
 * The keeper actions are no-ops until KEEPER_PRIVATE_KEY is set in the Convex env (docs/OPERATIONS.md).
 */
import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
crons.interval("index arclaw events", { minutes: 1 }, makeFunctionReference<"action">("indexer:sync"), {});
crons.interval("keeper reveal", { seconds: 10 }, makeFunctionReference<"action">("keeperRun:reveal"), {});
crons.interval("keeper tick", { minutes: 1 }, makeFunctionReference<"action">("keeperRun:tick"), {});
crons.interval("keeper prune events", { hours: 24 }, makeFunctionReference<"mutation">("keeperState:prune"), {});
export default crons;
