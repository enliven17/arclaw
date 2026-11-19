/**
 * Convex tables for the leaderboard, filled by convex/indexer.ts from the arclaw program's events on Solana.
 *   pulls    one row per settled pack (RoundSettled), keyed `${player}-${roundId}`
 *   plays    one row per Played event, keyed `${signature}-${index}`
 *   players  running totals per player (value pulled, packs, USDC spent, best pull)
 *   meta     the indexer's cursor (the newest program signature read)
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  pulls: defineTable({
    id: v.string(),
    roundId: v.string(),
    machineId: v.number(),
    player: v.string(),
    tier: v.number(),
    tierName: v.string(),
    valueUsdc: v.number(),
    slot: v.number(),
    signature: v.string(),
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
    slot: v.number(),
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
  meta: defineTable({ key: v.string(), cursor: v.union(v.string(), v.null()), slot: v.number() }).index("by_key", ["key"]),
});
