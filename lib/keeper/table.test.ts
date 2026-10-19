/**
 * The buildTable port against Deploy.s.sol's own output (fixture written by scripts/keeper/fixture.ts with forge),
 * plus the validation port on the deployed shape. Run: pnpm keeper:test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fixture from "./__fixtures__/buildTable.sol.json";
import { MACHINES_FILE, buildTable, checkRules, moveBps, refPrices, sameTable, validate, WEI, type ChainOutcome } from "./table";

type Fx = { sets: { prices: string[]; machines: { id: number; outcomes: { weight: string; tier: number; tokens: number[]; amounts: string[] }[] }[] }[] };
const fx = fixture as Fx;
const TOK = Array.from({ length: 8 }, (_, i) => `0x${(0x1000 + i).toString(16).padStart(40, "0")}` as `0x${string}`);
const idx = (a: string) => TOK.findIndex((t) => t.toLowerCase() === a.toLowerCase());

test("fixture covers every machine in machines.json", () => {
  assert.equal(fx.sets.length, 4);
  for (const s of fx.sets) assert.deepEqual(s.machines.map((m) => m.id), MACHINES_FILE.machines.map((m) => m.id));
});

for (const [si, set] of fx.sets.entries()) {
  test(`buildTable matches Deploy.s.sol, price set ${si}`, () => {
    const px = set.prices.map(BigInt);
    for (const sm of set.machines) {
      const m = MACHINES_FILE.machines.find((x) => x.id === sm.id)!;
      const t = buildTable(m, MACHINES_FILE.policy.floorBps, TOK, px);
      assert.equal(t.length, sm.outcomes.length, `machine ${m.id} outcome count`);
      t.forEach((o, k) => {
        const want = sm.outcomes[k]!;
        assert.equal(o.weight, BigInt(want.weight), `m${m.id} k${k} weight`);
        assert.equal(o.tier, want.tier, `m${m.id} k${k} tier`);
        assert.deepEqual(o.tokens.map(idx), want.tokens, `m${m.id} k${k} tokens`);
        assert.deepEqual(o.amounts, want.amounts.map(BigInt), `m${m.id} k${k} amounts`);
      });
    }
  });
}

test("machines.json passes checkRules", () => {
  for (const m of MACHINES_FILE.machines) checkRules(m, MACHINES_FILE.policy.floorBps);
  assert.throws(() => checkRules({ ...MACHINES_FILE.machines[0]!, rtpMaxBps: 9100 }, 5000), /MAX_RTP_BPS/);
});

const rulesOf = (id: number) => {
  const m = MACHINES_FILE.machines.find((x) => x.id === id)!;
  return { price: BigInt(m.priceUsdc) * WEI, floorBps: MACHINES_FILE.policy.floorBps, capBps: m.capBps, rtpMinBps: m.rtpMinBps, rtpMaxBps: m.rtpMaxBps };
};

test("validate accepts every built table at its own prices and reports the realised RTP", () => {
  for (const set of fx.sets) {
    const px = set.prices.map(BigInt);
    for (const m of MACHINES_FILE.machines) {
      const t = buildTable(m, MACHINES_FILE.policy.floorBps, TOK, px);
      const r = validate(t, rulesOf(m.id), (tok) => px[idx(tok)]!, () => 18);
      assert.ok(r.ok, `machine ${m.id}: ${!r.ok ? r.reason : ""}`);
      if (r.ok) {
        assert.ok(r.rtpBps >= BigInt(m.rtpMinBps) && r.luckyRtpBps <= BigInt(m.rtpMaxBps));
        assert.ok(r.minBps >= 5265n && r.maxBps < BigInt(m.capBps));
      }
    }
  }
});

test("validate refuses a table priced 6% low (floor) and one whose band is broken", () => {
  const px = fx.sets[0]!.prices.map(BigInt);
  const m = MACHINES_FILE.machines[0]!;
  const t = buildTable(m, 5000, TOK, px);
  const low = validate(t, rulesOf(m.id), (tok) => (px[idx(tok)]! * 94n) / 100n, () => 18);
  assert.equal(low.ok, false);
  const heavy = t.map((o, k) => (k === 5 ? { ...o, weight: o.weight * 50n } : o));
  const r = validate(heavy, rulesOf(m.id), (tok) => px[idx(tok)]!, () => 18);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /RtpOutOfBand/);
});

test("refPrices recovers the table prices from card values, and moveBps measures moves", () => {
  const px = fx.sets[1]!.prices.map(BigInt);
  const m = MACHINES_FILE.machines[2]!;
  const t = buildTable(m, 5000, TOK, px);
  const chain: ChainOutcome[] = t.map((o) => ({
    weight: o.weight,
    tier: o.tier,
    value: 0n,
    cards: o.tokens.map((token, c) => ({ token, amount: o.amounts[c]!, value: (o.amounts[c]! * px[idx(token)]! * 10n ** 12n) / 10n ** 18n })),
  }));
  const ref = refPrices(chain, () => 18);
  for (const [tok, p] of ref) {
    const want = px[idx(tok)]!;
    assert.ok(moveBps(p, want) <= 1n, `${tok}: ${p} vs ${want}`);
  }
  assert.ok(sameTable(t, chain));
  assert.equal(moveBps(102n, 100n), 200n);
  assert.equal(moveBps(98n, 100n), 200n);
  assert.equal(moveBps(1001n, 1000n), 10n);
});
