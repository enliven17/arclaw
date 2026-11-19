/** Keep the leaderboard fresh (convex/indexer.ts): read the program's new transactions every minute. */
import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
crons.interval("index arclaw events", { minutes: 1 }, makeFunctionReference<"action">("indexer:sync"), {});
export default crons;
