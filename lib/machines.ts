/**
 * The three machines and their odds, read from lib/machines.json at build time (the same file the deploy script
 * reads). Nothing in the UI hardcodes a multiplier, a weight or an RTP: everything below is derived from the table.
 *
 * Example packs: when lib/machines.resolved.json exists (written by the deploy tooling) its cards are used through
 * `withResolved()` (server only, lib/machines.server.ts). Otherwise `examplePack()` splits a tier's value over three
 * stocks deterministically, clearly an illustration.
 */
import raw from "./machines.json";
import { stockOf, type PullCard } from "./stocks";

type RawTier = { name: string; multiplierBps: number; weight: number };
type RawMachine = {
  id: number;
  name: string;
  priceUsdc: number;
  capBps: number;
  rtpMinBps: number;
  rtpMaxBps: number;
  tiers: RawTier[];
};
type Raw = { policy: { floorBps: number; cardsPerBox: number }; machines: RawMachine[] };

export type Tier = {
  name: string;
  /** Position in the table, 0 = most common. */
  rank: number;
  multiplier: number;
  probability: number;
  valueUsdc: number;
  /** Cards for this tier from machines.resolved.json, when present. */
  cards?: PullCard[];
};

export type Machine = {
  id: number;
  name: string;
  slug: "single" | "stack" | "vault" | string;
  priceUsdc: number;
  cap: number;
  floor: number;
  /** Expected return as a fraction of the price, from the table. */
  rtp: number;
  /** On-chain RTP band of this machine (fractions). rtpMin only moves up after deploy: it is what a sold box keeps. */
  rtpMin: number;
  rtpMax: number;
  tiers: Tier[];
};

const data = raw as Raw;

/** Rules shared by every machine. The RTP band is per machine: `Machine.rtpMin` and `Machine.rtpMax`. */
export const POLICY = {
  floor: data.policy.floorBps / 10_000,
  cardsPerBox: data.policy.cardsPerBox,
} as const;

function build(m: RawMachine): Machine {
  const total = m.tiers.reduce((s, t) => s + t.weight, 0);
  const tiers = m.tiers.map((t, rank) => ({
    name: t.name,
    rank,
    multiplier: t.multiplierBps / 10_000,
    probability: t.weight / total,
    valueUsdc: (m.priceUsdc * t.multiplierBps) / 10_000,
  }));
  return {
    id: m.id,
    name: m.name,
    slug: m.name.toLowerCase(),
    priceUsdc: m.priceUsdc,
    cap: m.capBps / 10_000,
    // The promise on chain (every box is worth at least this much of the price), not the lowest tier, which is built a little above it.
    floor: POLICY.floor,
    rtp: tiers.reduce((s, t) => s + t.multiplier * t.probability, 0),
    rtpMin: m.rtpMinBps / 10_000,
    rtpMax: m.rtpMaxBps / 10_000,
    tiers,
  };
}

export const MACHINES: readonly Machine[] = data.machines.map(build);
export const machineById = (id: number) => MACHINES.find((m) => m.id === id) ?? MACHINES[0]!;
export const machineBySlug = (slug: string) => MACHINES.find((m) => m.slug === slug) ?? null;

/** Highest multiplier across all machines (the "up to" figure). */
export const MAX_MULTIPLIER = Math.max(...MACHINES.flatMap((m) => m.tiers.map((t) => t.multiplier)));

/** Draw a tier for a uniform `u` in [0, 1): the same cumulative walk the contract does over weights. */
export function pickTier(m: Machine, u: number): Tier {
  let acc = 0;
  for (const t of m.tiers) {
    acc += t.probability;
    if (u < acc) return t;
  }
  return m.tiers[m.tiers.length - 1]!;
}

/** Small seeded PRNG (mulberry32) for the simulator: same seed, same 100 boxes. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = ["NVDA", "AAPL", "TSLA", "MSFT", "AMZN", "META", "GOOGL", "AMD", "SPY", "QQQ", "AVGO", "GLD"];
const SPLIT = [0.45, 0.33, 0.22];

/** Three cards for a tier: the resolved cards when known, otherwise an illustrative split of the tier's value. */
export function examplePack(m: Machine, tier: Tier, offset = 0): PullCard[] {
  if (tier.cards?.length === POLICY.cardsPerBox) return tier.cards;
  return SPLIT.map((share, i) => {
    const s = stockOf(POOL[(offset + tier.rank * 3 + i) % POOL.length]!);
    return { ticker: s.ticker, name: s.name, amount: Math.round(tier.valueUsdc * share * 100) / 100 };
  });
}

export const fmtMultiplier = (x: number) => `${Number.isInteger(x) ? x : x.toFixed(2).replace(/0$/, "")}x`;
export const fmtPct = (p: number, digits = 1) => `${(p * 100).toFixed(digits)}%`;
