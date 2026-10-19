/**
 * Bankroll risk, Monte Carlo: how likely is the float (reserveFloor plus what the house has earned so far) to run
 * dry, so that a big pack becomes an IOU and Arclaw pauses itself? Uses lib/machines.json as built on chain (the
 * floor tier lifted to 0.5265x, the jackpot 1% under the cap), the desk spread on every card bought just in time and
 * the VRF fee per open. Ignores the luck boost (+0.16 points of RTP at most).
 *
 *   pnpm keeper:simulate [--plays 500] [--days 30] [--runs 5000] [--mix 60,30,10] [--floats 100,250,500,1000] [--seed 7]
 *
 * --plays is boxes per day across all machines, --mix the % of them per machine (Single, Stack, Vault).
 */
import { MACHINES_FILE, EDGE_MARGIN_BPS, FLOOR_MARGIN_BPS } from "../../lib/keeper/table";

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1]! : d;
};
const PLAYS = Number(opt("plays", "500"));
const DAYS = Number(opt("days", "30"));
const RUNS = Number(opt("runs", "5000"));
const MIX = opt("mix", "60,30,10").split(",").map(Number);
const FLOATS = opt("floats", "100,250,500,1000").split(",").map(Number);
const SEED = Number(opt("seed", "7"));
const SPREAD = 0.0035; // desk spread on cards bought at reveal
const VRF_FEE = 0.02; // per open; assume one box per open (worst case)

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const floor = MACHINES_FILE.policy.floorBps;
const lifted = (floor * (10_000 + Number(FLOOR_MARGIN_BPS))) / 10_000;
const machines = MACHINES_FILE.machines.map((m, i) => {
  const total = m.tiers.reduce((s, t) => s + t.weight, 0);
  const tiers = m.tiers.map((t) => {
    const mult = t.multiplierBps >= m.capBps ? (m.capBps * (10_000 - Number(EDGE_MARGIN_BPS))) / 10_000 : Math.max(t.multiplierBps, lifted);
    return { p: t.weight / total, payout: (m.priceUsdc * mult) / 10_000 };
  });
  return { id: m.id, name: m.name, price: m.priceUsdc, share: (MIX[i] ?? 0) / 100, tiers, ev: tiers.reduce((s, t) => s + t.p * t.payout, 0) };
});

const draw = (m: (typeof machines)[number], u: number) => {
  let acc = 0;
  for (const t of m.tiers) {
    acc += t.p;
    if (u < acc) return t.payout;
  }
  return m.tiers[m.tiers.length - 1]!.payout;
};

const r = rng(SEED);
const pickMachine = (u: number) => {
  let acc = 0;
  for (const m of machines) {
    acc += m.share;
    if (u < acc) return m;
  }
  return machines[machines.length - 1]!;
};

type Run = { pnl: number; minBalance: number; worstDay: number };
const runs: Run[] = [];
for (let k = 0; k < RUNS; k++) {
  let bal = 0;
  let min = 0;
  let worstDay = 0;
  for (let d = 0; d < DAYS; d++) {
    const start = bal;
    for (let p = 0; p < PLAYS; p++) {
      const m = pickMachine(r());
      const payout = draw(m, r());
      bal += m.price - payout * (1 + SPREAD) - VRF_FEE;
      if (bal < min) min = bal;
    }
    worstDay = Math.min(worstDay, bal - start);
  }
  runs.push({ pnl: bal, minBalance: min, worstDay });
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]!;
};
const f = (x: number) => x.toFixed(2).padStart(10);
const out = (s: string) => process.stdout.write(s + "\n");

out(`arclaw bankroll simulation: ${PLAYS} boxes/day for ${DAYS} days, ${RUNS} runs, mix ${machines.map((m) => `${m.name} ${Math.round(m.share * 100)}%`).join(" ")}`);
for (const m of machines) out(`  ${m.name.padEnd(7)} price ${m.price} USDC  EV ${m.ev.toFixed(4)}  edge ${(100 * (1 - m.ev / m.price)).toFixed(2)}%  top pack ${Math.max(...m.tiers.map((t) => t.payout)).toFixed(2)}`);
out("");
out(`P&L after ${DAYS} days (USDC):  p1 ${f(q(runs.map((x) => x.pnl), 0.01))}  p5 ${f(q(runs.map((x) => x.pnl), 0.05))}  median ${f(q(runs.map((x) => x.pnl), 0.5))}`);
out(`deepest drawdown below start:   p50 ${f(q(runs.map((x) => x.minBalance), 0.5))}  p5 ${f(q(runs.map((x) => x.minBalance), 0.05))}  p0.1 ${f(q(runs.map((x) => x.minBalance), 0.001))}`);
out(`worst single day:               p50 ${f(q(runs.map((x) => x.worstDay), 0.5))}  p5 ${f(q(runs.map((x) => x.worstDay), 0.05))}  p0.1 ${f(q(runs.map((x) => x.worstDay), 0.001))}`);
out("");
out("float (USDC)   P(float runs dry at least once in the period: an IOU and an automatic pause)");
for (const fl of FLOATS) {
  const dry = runs.filter((x) => fl + x.minBalance < 0).length / RUNS;
  out(`${String(fl).padStart(12)}   ${(dry * 100).toFixed(2)}%`);
}
