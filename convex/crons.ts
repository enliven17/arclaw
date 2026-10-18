/** Keep the leaderboard fresh: read new contract events every minute (convex/indexer.ts). */
import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
crons.interval("index arclaw events", { minutes: 1 }, makeFunctionReference<"action">("indexer:sync"), {});
export default crons;
