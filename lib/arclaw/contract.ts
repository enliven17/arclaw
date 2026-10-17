/**
 * Every call the app makes to the arclaw contracts, in one module, so an ABI change lands in one place.
 *
 *   reads     boxes per machine, the VRF top-up an open needs, an opening's status, link state, holdings
 *   calls     play, open, reveal, retry, returnBoxes, gift to an address, create, claim and reclaim a link,
 *             approve and sell a stock
 *   receipts  the opening an open() created, and the cards a reveal() paid, from the logs
 *
 * Native USDC is 18 dp everywhere here (what msg.value spends). Tickers come from the deployment's token map; tier
 * names from lib/machines.json (the contract emits the tier index).
 *
 * Compatibility: play, open, reveal, retry, returnBoxes and gift are the same on the deployed testnet contract and
 * on the current source; Opened and OutcomeDrawn changed shape, so logs decode with either (legacyAbi). Claim links
 * live in ArclawLinks (one safeTransferFrom with the link data); they are off until the deployment file has a
 * `links` address. stats and quoteVrfFee moved to ArclawLens; the VRF top-up reads the coordinator directly.
 */
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, getAddress, parseAbi, type Address, type Hex, type Log, type PublicClient } from "viem";
import { arclawAbi, arclawLinksAbi, d20CoordinatorAbi } from "@/lib/abi";
import testnet from "@/lib/deployments/arc-testnet.json";
import { ARC } from "@/lib/arc/config";
import type { Call } from "@/lib/arc/account";
import { MACHINES } from "@/lib/machines";
import { stockOf } from "@/lib/stocks";

export const CONTRACTS = ARC.contracts;
export const ARCLAW = CONTRACTS?.arclaw ?? null;
/** ArclawLinks, once deployed (lib/deployments/*.json "links"). */
export const LINKS = ((testnet as { links?: string }).links ?? null) as Address | null;

/** Opening status enum in the contract. */
export const STATUS = { None: 0, Pending: 1, Fulfilled: 2, Revealed: 3, Returned: 4 } as const;
/** D20 requests expire 60 s after they are made; after that the opener can retry or take the boxes back. */
export const VRF_EXPIRY_S = 60;

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
/** The Astock desk's sell side (signatures checked against the mainnet desk's bytecode). */
const deskAbi = parseAbi([
  "function quoteSell(address stock, uint256 sharesIn) view returns (uint256 usdcOut, bool ok)",
  "function sell(address stock, uint256 sharesIn, uint256 minUsdcOut, address to)",
]);
const priceAbi = parseAbi(["function priceOf(address token) view returns (uint256)"]);
/**
 * Events of the contract currently deployed on testnet, before the audit redeploy: Opened had no boost field and
 * OutcomeDrawn had no opener or boost. Logs are decoded with the current ABI first, then these, so the app works on
 * both until lib/deployments points at the new contract.
 */
const legacyAbi = parseAbi([
  "event Opened(uint256 indexed openingId, uint256 indexed requestId, address indexed opener, uint256 machineId, uint256 boxes, uint256 tableId, uint256 vrfFee)",
  "event OutcomeDrawn(uint256 indexed openingId, uint256 boxIndex, uint256 indexed machineId, uint256 tier, uint256 outcomeIndex, uint256 valueUsdc)",
]);

const need = <T,>(v: T | null | undefined, what: string): T => {
  if (v == null) throw new Error(`${what} is not deployed on this network yet.`);
  return v;
};

/* ---------- token map ---------- */

const TICKER_BY_TOKEN = new Map<string, string>(Object.entries(CONTRACTS?.stocks ?? {}).map(([t, a]) => [a.toLowerCase(), t]));
export const tickerOf = (token: string) => TICKER_BY_TOKEN.get(token.toLowerCase()) ?? `${token.slice(0, 6)}`;
export const STOCK_TOKENS = Object.entries(CONTRACTS?.stocks ?? {}).map(([ticker, address]) => ({ ticker, address }));

export const tierName = (machineId: number, tier: number) => MACHINES.find((m) => m.id === machineId)?.tiers[tier]?.name ?? `Tier ${tier + 1}`;

/* ---------- money ---------- */

export const WEI = 10n ** 18n;
/** 18 dp native USDC to a number of dollars (display only). */
export const toUsdc = (wei: bigint) => Number(wei / 10n ** 12n) / 1e6;
export const priceWei = (priceUsdc: number) => BigInt(Math.round(priceUsdc * 1e6)) * 10n ** 12n;

/* ---------- reads ---------- */

/** Sealed boxes the address holds, by machine id. */
export async function readBoxes(client: PublicClient, owner: Address, ids = MACHINES.map((m) => m.id)): Promise<Record<number, number>> {
  const arclaw = need(ARCLAW, "arclaw");
  const balances = await client.readContract({
    address: arclaw,
    abi: arclawAbi,
    functionName: "balanceOfBatch",
    args: [ids.map(() => owner), ids.map((id) => BigInt(id))],
  });
  return Object.fromEntries(ids.map((id, i) => [id, Number(balances[i] ?? 0n)]));
}

/**
 * The msg.value an open needs: the VRF fee above the house subsidy, quoted at the latest base fee with headroom
 * (the contract returns any change). Zero when the subsidy covers it.
 */
export async function vrfTopUp(client: PublicClient): Promise<bigint> {
  const arclaw = need(ARCLAW, "arclaw");
  const [coordinator, gas, subsidy, block] = await Promise.all([
    client.readContract({ address: arclaw, abi: arclawAbi, functionName: "vrfCoordinator" }),
    client.readContract({ address: arclaw, abi: arclawAbi, functionName: "callbackGasLimit" }),
    client.readContract({ address: arclaw, abi: arclawAbi, functionName: "maxVrfSubsidy" }),
    client.getBlock(),
  ]);
  const base = block.baseFeePerGas ?? (await client.getGasPrice());
  const fee = await client.readContract({ address: coordinator as Address, abi: d20CoordinatorAbi, functionName: "quoteFeeAt", args: [gas as number, base * 2n] });
  const required = (fee as bigint) > (subsidy as bigint) ? (fee as bigint) - (subsidy as bigint) : 0n;
  return required === 0n ? 0n : (required * 13n) / 10n;
}

export type OpeningState = { status: number; requestedAt: number; machineId: number; boxes: number; opener: Address };

export async function readOpening(client: PublicClient, openingId: bigint): Promise<OpeningState> {
  const r = (await client.readContract({ address: need(ARCLAW, "arclaw"), abi: arclawAbi, functionName: "openings", args: [openingId] })) as readonly unknown[];
  // openings(id) -> (opener, boxes, tableId, machineId, status, requestedAt, requestId, word)
  return { opener: r[0] as Address, boxes: Number(r[1]), machineId: Number(r[3]), status: Number(r[4]), requestedAt: Number(r[5]) };
}

/** Live value of a card in 18 dp USDC at the price source's price. */
export async function cardValue(client: PublicClient, token: Address, amount: bigint): Promise<bigint> {
  try {
    return (await client.readContract({ address: need(ARCLAW, "arclaw"), abi: arclawAbi, functionName: "valueOf", args: [token, amount] })) as bigint;
  } catch {
    return 0n;
  }
}

/** Holdings of every .arc stock, with the price source's USD price (6 dp). */
export async function readHoldings(client: PublicClient, owner: Address) {
  const c = need(CONTRACTS, "arclaw");
  return Promise.all(
    STOCK_TOKENS.map(async ({ ticker, address }) => {
      const [balance, price] = await Promise.all([
        client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
        client.readContract({ address: c.priceSource, abi: priceAbi, functionName: "priceOf", args: [address] }).catch(() => 0n),
      ]);
      return { ticker, name: stockOf(ticker).name, address, balance, priceUsd6: price };
    }),
  );
}

/** What selling `shares` pays now (18 dp) and whether the desk can pay it. */
export async function quoteSell(client: PublicClient, token: Address, shares: bigint): Promise<{ out: bigint; ok: boolean }> {
  try {
    const [out, ok] = (await client.readContract({ address: need(CONTRACTS, "desk").sellDesk, abi: deskAbi, functionName: "quoteSell", args: [token, shares] })) as readonly [bigint, boolean];
    return { out, ok };
  } catch {
    return { out: 0n, ok: false };
  }
}

/* ---------- calls ---------- */

const arclawCall = (functionName: string, args: readonly unknown[], value?: bigint): Call => ({
  to: need(ARCLAW, "arclaw"),
  // The ABI is generated and typed; the names here are checked by the build of each caller.
  data: encodeFunctionData({ abi: arclawAbi, functionName: functionName as never, args: args as never }),
  ...(value ? { value } : {}),
});

export const playCall = (machineId: number, boxes: number, priceUsdc: number) => arclawCall("play", [BigInt(machineId), BigInt(boxes)], priceWei(priceUsdc) * BigInt(boxes));
export const openCall = (machineId: number, boxes: number, topUp: bigint) => arclawCall("open", [BigInt(machineId), BigInt(boxes)], topUp);
export const revealCall = (openingId: bigint) => arclawCall("reveal", [openingId]);
export const retryCall = (openingId: bigint, topUp: bigint) => arclawCall("retry", [openingId], topUp);
export const returnBoxesCall = (openingId: bigint) => arclawCall("returnBoxes", [openingId]);

/** Send `boxes` of a machine to an address: one transfer of the ERC-1155 balance. */
export const giftCall = (from: Address, to: Address, machineId: number, boxes: number) =>
  arclawCall("safeTransferFrom", [from, getAddress(to), BigInt(machineId), BigInt(boxes), "0x"]);

/** Create a claim link: transfer the boxes into ArclawLinks with (linkKey, expiresAt) as data. */
export const createLinkCall = (from: Address, linkKey: Address, machineId: number, boxes: number, expiresAt: number) =>
  arclawCall("safeTransferFrom", [
    from,
    need(LINKS, "Claim links"),
    BigInt(machineId),
    BigInt(boxes),
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [linkKey, BigInt(expiresAt)]),
  ]);

const linksCall = (functionName: "claimLink" | "reclaimLink", args: readonly unknown[]): Call => ({
  to: need(LINKS, "Claim links"),
  data: encodeFunctionData({ abi: arclawLinksAbi, functionName, args: args as never }),
});
export const claimLinkCall = (linkId: bigint, recipient: Address, signature: Hex) => linksCall("claimLink", [linkId, recipient, signature]);
export const reclaimLinkCall = (linkId: bigint) => linksCall("reclaimLink", [linkId]);

export async function claimDigest(client: PublicClient, linkId: bigint, recipient: Address): Promise<Hex> {
  return (await client.readContract({ address: need(LINKS, "Claim links"), abi: arclawLinksAbi, functionName: "claimDigest", args: [linkId, recipient] })) as Hex;
}

export type LinkState = { sender: Address; boxes: number; machineId: number; expiresAt: number; status: number };
export async function readLink(client: PublicClient, linkId: bigint): Promise<LinkState> {
  const r = (await client.readContract({ address: need(LINKS, "Claim links"), abi: arclawLinksAbi, functionName: "links", args: [linkId] })) as readonly unknown[];
  return { sender: r[0] as Address, boxes: Number(r[1]), machineId: Number(r[2]), expiresAt: Number(r[3]), status: Number(r[4]) };
}

export const approveCall = (token: Address, spender: Address, amount: bigint): Call => ({ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }) });
export const sellCall = (token: Address, shares: bigint, minOut: bigint, to: Address): Call => ({
  to: need(CONTRACTS, "desk").sellDesk,
  data: encodeFunctionData({ abi: deskAbi, functionName: "sell", args: [token, shares, minOut, to] }),
});

/* ---------- receipts and logs ---------- */

type Decoded = { eventName: string; args: Record<string, unknown> };
function decode(logs: readonly Log[], abi: readonly unknown[], address: string | null): Decoded[] {
  const out: Decoded[] = [];
  for (const l of logs) {
    if (address && l.address.toLowerCase() !== address.toLowerCase()) continue;
    for (const a of abi === arclawAbi ? [arclawAbi, legacyAbi] : [abi]) {
      try {
        out.push(decodeEventLog({ abi: a as never, data: l.data, topics: l.topics }) as unknown as Decoded);
        break;
      } catch {
        // Not this shape, or not one of ours (a token Transfer, a coordinator event).
      }
    }
  }
  return out;
}

/** The opening an open() receipt created. */
export function openingFromLogs(logs: readonly Log[]): { openingId: bigint; requestId: bigint; machineId: number; boxes: number } | null {
  const e = decode(logs, arclawAbi, ARCLAW).find((d) => d.eventName === "Opened");
  if (!e) return null;
  return { openingId: e.args.openingId as bigint, requestId: e.args.requestId as bigint, machineId: Number(e.args.machineId), boxes: Number(e.args.boxes) };
}

/** The link a createLink transfer made. */
export function linkFromLogs(logs: readonly Log[]): { linkId: bigint; expiresAt: number } | null {
  const e = decode(logs, arclawLinksAbi, LINKS).find((d) => d.eventName === "LinkCreated");
  return e ? { linkId: e.args.linkId as bigint, expiresAt: Number(e.args.expiresAt) } : null;
}

export type DrawnCard = { ticker: string; name: string; token: Address; amount: bigint; paid: boolean; valueWei: bigint };
export type DrawnBox = { machineId: number; boxIndex: number; tier: number; tierName: string; valueWei: bigint; boosted: boolean; cards: DrawnCard[] };

/** The boxes a reveal() paid, from its receipt: one OutcomeDrawn per box, three CardDrawn per box. */
export async function boxesFromLogs(client: PublicClient, logs: readonly Log[]): Promise<DrawnBox[]> {
  const events = decode(logs, arclawAbi, ARCLAW);
  const boxes = new Map<number, DrawnBox>();
  for (const e of events) {
    if (e.eventName !== "OutcomeDrawn") continue;
    const b = Number(e.args.boxIndex);
    const machineId = Number(e.args.machineId);
    const tier = Number(e.args.tier);
    boxes.set(b, { machineId, boxIndex: b, tier, tierName: tierName(machineId, tier), valueWei: e.args.valueUsdc as bigint, boosted: Boolean(e.args.boosted), cards: [] });
  }
  const cards = events.filter((e) => e.eventName === "CardDrawn");
  await Promise.all(
    cards.map(async (e) => {
      const box = boxes.get(Number(e.args.boxIndex));
      if (!box) return;
      const token = e.args.token as Address;
      const amount = e.args.amount as bigint;
      const ticker = tickerOf(token);
      box.cards[Number(e.args.cardIndex)] = { ticker, name: stockOf(ticker).name, token, amount, paid: Boolean(e.args.paid), valueWei: await cardValue(client, token, amount) };
    }),
  );
  return [...boxes.values()].sort((a, b) => a.boxIndex - b.boxIndex);
}

/**
 * Logs of the arclaw contract since the deploy block, in 1000-block windows (the public RPC refuses larger ranges),
 * filtered by an event and indexed arguments. Fine while the chain is young; the leaderboard indexes in Convex.
 */
export async function arclawLogs(client: PublicClient, eventName: "CardDrawn" | "OutcomeDrawn" | "Played" | "Opened", args: Record<string, unknown>, address: Address | null = ARCLAW) {
  const c = need(CONTRACTS, "arclaw");
  const ev = (eventName === "CardDrawn" || eventName === "OutcomeDrawn" || eventName === "Played" || eventName === "Opened" ? arclawAbi : arclawLinksAbi).find(
    (x) => (x as { type: string; name?: string }).type === "event" && (x as { name?: string }).name === eventName,
  );
  const head = await client.getBlockNumber();
  const out: Log[] = [];
  const windows: [bigint, bigint][] = [];
  for (let from = c.deployBlock; from <= head; from += 1000n) windows.push([from, from + 999n > head ? head : from + 999n]);
  for (let i = 0; i < windows.length; i += 6) {
    const batch = await Promise.all(
      windows.slice(i, i + 6).map(([fromBlock, toBlock]) =>
        client.getLogs({ address: address ?? undefined, event: ev as never, args: args as never, fromBlock, toBlock }).catch(() => [] as Log[]),
      ),
    );
    batch.forEach((b) => out.push(...(b as Log[])));
  }
  return out;
}

/** The boxes of an opening that was revealed by someone else's transaction, read back from its logs. */
export async function revealedBoxes(client: PublicClient, openingId: bigint, fromBlock: bigint): Promise<DrawnBox[]> {
  const arclaw = need(ARCLAW, "arclaw");
  const head = await client.getBlockNumber();
  const events = [...arclawAbi, ...legacyAbi].filter((x) => x.type === "event" && (x.name === "OutcomeDrawn" || x.name === "CardDrawn"));
  const logs: Log[] = [];
  for (let from = fromBlock; from <= head; from += 1000n) {
    const to = from + 999n > head ? head : from + 999n;
    for (const event of events) {
      const got = await client.getLogs({ address: arclaw, event: event as never, args: { openingId } as never, fromBlock: from, toBlock: to });
      logs.push(...(got as Log[]));
    }
  }
  return boxesFromLogs(client, logs);
}
