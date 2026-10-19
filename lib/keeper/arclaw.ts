/**
 * Every Arclaw-specific read and call the keeper makes, in one module. When the contract changes (retry limit and
 * seed, pause-only guardian, daily JIT cap, top-up accounting, refundSealed clock), regenerate lib/abi and adjust this
 * file; the rest of lib/keeper only sees the plain types below.
 *
 * Round 4 (7056ee8): one retry per opening (RetryLimit), every retried or returned expired request is a VRF miss and
 * limits().maxMisses in a UTC day pause the contract, a daily JIT spend cap, topUpReserve, a pause-only guardian,
 * pauseIfVrfDown() (reverts VrfAlive on a working VRF, so a simulation is a free probe), pausedSince is no longer
 * cleared by unpause (use paused() and sealedRefundAt(id)).
 *
 * Units: native USDC 18 dp (wei) for every balance and reserve; prices USD 6 dp from the price source.
 */
import { decodeErrorResult, encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { arclawAbi, astockPriceSourceAbi, d20CoordinatorAbi, mockPriceSourceAbi } from "../abi";
import type { Deployment } from "./config";
import type { ChainOutcome, MachineRules, OutcomeInput } from "./table";

/** Mirrors of Arclaw internal constants (not exposed as getters). */
export const ARCLAW = {
  PUBLIC_REVEAL_AFTER: 3600,
  RESCUE_AFTER: 7 * 86400,
  SEALED_REFUND_AFTER: 3 * 86400,
  /** D20 requests expire this long after they are made. */
  VRF_EXPIRY: 60,
  /** Re-requests allowed per opening (Arclaw.MAX_RETRIES). */
  MAX_RETRIES: 1,
  MAX_BOXES_PER_OPEN: 20,
} as const;

export const STATUS = { None: 0, Pending: 1, Fulfilled: 2, Revealed: 3, Returned: 4 } as const;
export const LOG_SPAN = 9_999n;

const priceAbi = parseAbi(["function priceOf(address token) view returns (uint256)"]);
const erc20Abi = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);
const ERRORS = [...arclawAbi, ...d20CoordinatorAbi, ...astockPriceSourceAbi, ...mockPriceSourceAbi].filter((x) => x.type === "error");

export type Globals = {
  block: bigint;
  now: number;
  paused: boolean;
  pausedSince: number;
  balance: bigint;
  reservedCredit: bigint;
  pendingReserve: bigint;
  sealedReserve: bigint;
  totalOwed: bigint;
  reserveFloor: bigint;
  minBuffer: bigint;
  freeBalance: bigint;
  /** Native above every reserve and IOU (what refunds and JIT buys may use, reserveFloor included). */
  unreserved: bigint;
  topUpReserve: bigint;
  resumedAt: number;
  guardian: Address;
  /** Daily limits (UTC day of the last write; misses and jitSpent read as 0 once a new day started). */
  limits: { day: number; misses: number; maxMisses: number; jitCap: bigint; jitSpent: bigint };
  maxTableAge: number;
  maxPriceMoveBps: bigint;
  nextOpeningId: bigint;
  operator: Address;
  isKeeper: boolean;
  priceSource: Address;
  vrfCoordinator: Address;
  callbackGasLimit: number;
  maxVrfSubsidy: bigint;
  maxBoostBps: bigint;
  machineIds: number[];
};

export async function readGlobals(c: PublicClient, d: Deployment, me: Address): Promise<Globals> {
  const a = { address: d.arclaw, abi: arclawAbi } as const;
  const block = await c.getBlock();
  const at = { blockNumber: block.number } as const;
  const r = <T>(functionName: string, args: readonly unknown[] = []) => c.readContract({ ...a, ...at, functionName: functionName as never, args: args as never }) as Promise<T>;
  const [paused, pausedSince, balance, reservedCredit, pendingReserve, sealedReserve, totalOwed, reserveFloor, minBuffer, freeBalance, maxTableAge, maxPriceMoveBps, nextOpeningId, operator, isKeeper, priceSource, vrfCoordinator, callbackGasLimit, maxVrfSubsidy, maxBoostBps, machineIds, topUpReserve, resumedAt, guardian, limits] =
    await Promise.all([
      r<boolean>("paused"),
      r<bigint>("pausedSince"),
      c.getBalance({ address: d.arclaw, ...at }),
      r<bigint>("reservedCredit"),
      r<bigint>("pendingReserve"),
      r<bigint>("sealedReserve"),
      r<bigint>("totalOwed"),
      r<bigint>("reserveFloor"),
      r<bigint>("minBuffer"),
      r<bigint>("freeBalance"),
      r<bigint>("maxTableAge"),
      r<bigint>("maxPriceMoveBps"),
      r<bigint>("nextOpeningId"),
      r<Address>("operator"),
      r<boolean>("keepers", [me]),
      r<Address>("priceSource"),
      r<Address>("vrfCoordinator"),
      r<number>("callbackGasLimit"),
      r<bigint>("maxVrfSubsidy"),
      r<bigint>("MAX_BOOST_BPS"),
      r<readonly bigint[]>("machineIds"),
      r<bigint>("topUpReserve"),
      r<bigint>("resumedAt"),
      r<Address>("guardian"),
      r<readonly [number, number, number, bigint, bigint]>("limits"),
    ]);
  const res = reservedCredit + pendingReserve + sealedReserve + totalOwed + topUpReserve;
  const today = Math.floor(Number(block.timestamp) / 86_400);
  const [lDay, lMisses, lMax, lCap, lSpent] = limits;
  const sameDay = Number(lDay) === today;
  return {
    block: block.number,
    now: Number(block.timestamp),
    paused,
    pausedSince: Number(pausedSince),
    balance,
    reservedCredit,
    pendingReserve,
    sealedReserve,
    totalOwed,
    reserveFloor,
    minBuffer,
    freeBalance,
    unreserved: balance > res ? balance - res : 0n,
    topUpReserve,
    resumedAt: Number(resumedAt),
    guardian,
    limits: { day: Number(lDay), misses: sameDay ? Number(lMisses) : 0, maxMisses: Number(lMax), jitCap: BigInt(lCap), jitSpent: sameDay ? BigInt(lSpent) : 0n },
    maxTableAge: Number(maxTableAge),
    maxPriceMoveBps,
    nextOpeningId,
    operator,
    isKeeper,
    priceSource,
    vrfCoordinator,
    callbackGasLimit: Number(callbackGasLimit),
    maxVrfSubsidy,
    maxBoostBps,
    machineIds: machineIds.map(Number),
  };
}

export type MachineState = { id: number; rules: MachineRules; off: boolean; tableId: bigint | null; pricedAt: number; outcomes: ChainOutcome[]; boxesSold: bigint; sealedRefundAt: number };

export async function readMachine(c: PublicClient, d: Deployment, id: number): Promise<MachineState> {
  const a = { address: d.arclaw, abi: arclawAbi } as const;
  const [m, cur, off, outs, sold, refundAt] = await Promise.all([
    c.readContract({ ...a, functionName: "machines", args: [BigInt(id)] }),
    c.readContract({ ...a, functionName: "currentTable", args: [BigInt(id)] }),
    c.readContract({ ...a, functionName: "offSince", args: [BigInt(id)] }),
    c.readContract({ ...a, functionName: "outcomes", args: [BigInt(id)] }),
    c.readContract({ ...a, functionName: "boxesSold", args: [BigInt(id)] }),
    c.readContract({ ...a, functionName: "sealedRefundAt", args: [BigInt(id)] }),
  ]);
  const [price, floorBps, capBps, rtpMinBps, rtpMaxBps] = m as readonly [bigint, number, number, number, number];
  const tableId = (cur as bigint) === 0n ? null : (cur as bigint) - 1n;
  const pricedAt = tableId === null ? 0 : Number(await readTablePricedAt(c, d, tableId));
  const outcomes = (outs as readonly { weight: bigint; tier: number; value: bigint; cards: readonly { token: Address; value: bigint; amount: bigint }[] }[]).map((o) => ({
    weight: BigInt(o.weight),
    tier: Number(o.tier),
    value: BigInt(o.value),
    cards: o.cards.map((k) => ({ token: k.token, value: BigInt(k.value), amount: BigInt(k.amount) })),
  }));
  return { id, rules: { price, floorBps: Number(floorBps), capBps: Number(capBps), rtpMinBps: Number(rtpMinBps), rtpMaxBps: Number(rtpMaxBps) }, off: (off as bigint) !== 0n, tableId, pricedAt, outcomes, boxesSold: sold as bigint, sealedRefundAt: Number(refundAt as bigint) };
}

export const readTablePricedAt = (c: PublicClient, d: Deployment, tableId: bigint) =>
  c.readContract({ address: d.arclaw, abi: arclawAbi, functionName: "tablePricedAt", args: [tableId] }) as Promise<bigint>;

export type Opening = { id: bigint; opener: Address; boxes: number; tableId: bigint; machineId: number; status: number; requestedAt: number; requestId: bigint; retries: number };

export async function readOpening(c: PublicClient, d: Deployment, id: bigint): Promise<Opening> {
  const [r, retries] = (await Promise.all([
    c.readContract({ address: d.arclaw, abi: arclawAbi, functionName: "openings", args: [id] }),
    c.readContract({ address: d.arclaw, abi: arclawAbi, functionName: "openingRetries", args: [id] }),
  ])) as [readonly unknown[], bigint];
  // openings(id) -> (opener, boxes, tableId, machineId, status, requestedAt, requestId, word)
  return { id, opener: r[0] as Address, boxes: Number(r[1]), tableId: BigInt(r[2] as number), machineId: Number(r[3]), status: Number(r[4]), requestedAt: Number(r[5]), requestId: r[6] as bigint, retries: Number(retries) };
}

export type RequestState = { fulfilled: boolean; refunded: boolean; deadline: number; expired: boolean; readable: boolean };

/** The coordinator's view of a request (D20Randomness._randomnessStatus). A failing read counts as unreadable. */
export async function readRequest(c: PublicClient, coordinator: Address, requestId: bigint, now: number): Promise<RequestState> {
  try {
    const r = (await c.readContract({ address: coordinator, abi: d20CoordinatorAbi, functionName: "getRequest", args: [requestId] })) as { fulfilled: boolean; refunded: boolean; deadline: bigint };
    const deadline = Number(r.deadline);
    return { fulfilled: r.fulfilled, refunded: r.refunded, deadline, expired: !r.fulfilled && deadline !== 0 && now > deadline, readable: true };
  } catch {
    return { fulfilled: false, refunded: false, deadline: 0, expired: false, readable: false };
  }
}

/** msg.value a subsidised retry needs: the VRF fee above maxVrfSubsidy, quoted at 2x the base fee, plus 30%. */
export async function retryTopUp(c: PublicClient, g: Globals): Promise<bigint> {
  const block = await c.getBlock();
  const base = block.baseFeePerGas ?? (await c.getGasPrice());
  const fee = (await c.readContract({ address: g.vrfCoordinator, abi: d20CoordinatorAbi, functionName: "quoteFeeAt", args: [g.callbackGasLimit, base * 2n] })) as bigint;
  const required = fee > g.maxVrfSubsidy ? fee - g.maxVrfSubsidy : 0n;
  return required === 0n ? 0n : (required * 13n) / 10n;
}

export type PriceRead = { ok: true; price: bigint } | { ok: false; error: string };

/** IPriceSource.priceOf; a revert (Stale, Unmapped, Unpriced) comes back as its error name. */
export async function priceOf(c: PublicClient, priceSource: Address, token: Address): Promise<PriceRead> {
  try {
    const p = (await c.readContract({ address: priceSource, abi: priceAbi, functionName: "priceOf", args: [token] })) as bigint;
    return p > 0n ? { ok: true, price: p } : { ok: false, error: "zero price" };
  } catch (e) {
    return { ok: false, error: revertName(e) };
  }
}

const decimalsCache = new Map<string, number>();
export async function decimalsOf(c: PublicClient, token: Address): Promise<number> {
  const k = token.toLowerCase();
  const hit = decimalsCache.get(k);
  if (hit !== undefined) return hit;
  const dec = Number(await c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }));
  decimalsCache.set(k, dec);
  return dec;
}

/** Opens and VRF re-requests in the last LOG_SPAN blocks (the retry rate health reports). */
export async function recentVrfActivity(c: PublicClient, d: Deployment, head: bigint): Promise<{ opened: number; rerequested: number; fromBlock: bigint }> {
  const fromBlock = head > LOG_SPAN ? head - LOG_SPAN : 0n;
  const ev = (name: "Opened" | "Rerequested") => arclawAbi.find((x) => x.type === "event" && x.name === name)!;
  const [opened, rerequested] = await Promise.all([
    c.getLogs({ address: d.arclaw, event: ev("Opened") as never, fromBlock, toBlock: head }),
    c.getLogs({ address: d.arclaw, event: ev("Rerequested") as never, fromBlock, toBlock: head }),
  ]);
  return { opened: opened.length, rerequested: rerequested.length, fromBlock };
}

/* ---------- calls the keeper signs ---------- */

export type TxRequest = { label: string; to: Address; data: Hex; value?: bigint };

const call = (d: Deployment, label: string, functionName: string, args: readonly unknown[], value?: bigint): TxRequest => ({
  label,
  to: d.arclaw,
  data: encodeFunctionData({ abi: arclawAbi, functionName: functionName as never, args: args as never }),
  ...(value ? { value } : {}),
});

export const calls = {
  /** Keeper: reveal any fulfilled opening at once. */
  reveal: (d: Deployment, openingId: bigint) => call(d, `reveal #${openingId}`, "reveal", [openingId]),
  /** Keeper: settle a fulfilled opening whose reveal keeps failing, RESCUE_AFTER its request. */
  rescue: (d: Deployment, openingId: bigint) => call(d, `rescue #${openingId}`, "rescue", [openingId]),
  /** Keeper or operator: re-request an expired VRF request on the house subsidy (msg.value tops up above it). */
  retry: (d: Deployment, openingId: bigint, topUp: bigint) => call(d, `retry #${openingId}`, "retry", [openingId], topUp),
  /** Anyone: pauses the contract if a real VRF request fails; reverts VrfAlive (nothing spent) when D20 works. */
  pauseIfVrfDown: (d: Deployment) => call(d, "pauseIfVrfDown", "pauseIfVrfDown", []),
  /** Operator: a new table for a machine. */
  setPrizes: (d: Deployment, machineId: number, table: readonly OutcomeInput[]) =>
    call(d, `reprice machine ${machineId}`, "operatorSetPrizes", [
      BigInt(machineId),
      table.map((o) => ({ weight: o.weight, tier: o.tier, tokens: [...o.tokens], amounts: [...o.amounts] })),
    ]),
};

/* ---------- errors ---------- */

function revertData(e: unknown): Hex | undefined {
  let x: unknown = e;
  for (let i = 0; i < 8 && x; i++) {
    const o = x as { data?: unknown; cause?: unknown };
    if (typeof o.data === "string" && o.data.startsWith("0x") && o.data.length >= 10) return o.data as Hex;
    if (o.data && typeof o.data === "object" && typeof (o.data as { data?: unknown }).data === "string") return (o.data as { data: Hex }).data;
    x = o.cause;
  }
  return undefined;
}

/** The contract error a call reverted with (e.g. "TableStale", "NotReady"), else viem's short message. */
export function revertName(e: unknown): string {
  const data = revertData(e);
  if (data) {
    try {
      const r = decodeErrorResult({ abi: ERRORS, data });
      return r.args && r.args.length ? `${r.errorName}(${r.args.map(String).join(", ")})` : r.errorName;
    } catch {
      return `revert ${data.slice(0, 10)}`;
    }
  }
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  return m.split("\n")[0]!.slice(0, 200);
}
