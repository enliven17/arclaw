/**
 * Convex tables for the leaderboard, filled by convex/indexer.ts from the arclaw contract's events.
 *   pulls    one row per opened box (OutcomeDrawn), keyed `${openingId}-${boxIndex}`
 *   plays    one row per Played event, keyed `${txHash}-${logIndex}`
 *   players  running totals per player (value pulled, packs, USDC spent, best pull)
 *   meta     the indexer's cursor (last block read)
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  pulls: defineTable({
    id: v.string(),
    openingId: v.string(),
    boxIndex: v.number(),
    machineId: v.number(),
    player: v.string(),
    tier: v.number(),
    tierName: v.string(),
    valueUsdc: v.number(),
    blockNumber: v.number(),
    txHash: v.string(),
  })
    .index("by_pull", ["id"])
    .index("by_value", ["valueUsdc"])
    .index("by_machine_value", ["machineId", "valueUsdc"]),
  plays: defineTable({
    id: v.string(),
    player: v.string(),
    machineId: v.number(),
    boxes: v.number(),
    paidUsdc: v.number(),
    blockNumber: v.number(),
  }).index("by_play", ["id"]),
  players: defineTable({
    player: v.string(),
    totalUsdc: v.number(),
    packs: v.number(),
    spentUsdc: v.number(),
    best: v.number(),
  })
    .index("by_player", ["player"])
    .index("by_total", ["totalUsdc"]),
  meta: defineTable({ key: v.string(), block: v.number() }).index("by_key", ["key"]),
});
