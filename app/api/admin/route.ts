/**
 * POST /api/admin { message, signature }: everything the admin panel shows, for the admin wallet only (lib/admin.server.ts).
 *   stats   players, plays, USDC in and out, per machine and tier, latest plays and pulls (convex/admin.ts)
 *   keeper  last tick, health metrics (treasury, reserves, gas), alerts and recent events (convex/keeper.ts status)
 *   chain   read now: block, paused, the contract's USDC and its stock inventory
 * Each part fails on its own, so one dead service shows as an error instead of blanking the panel. Anyone else: 404.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { erc20Abi, formatUnits } from "viem";
import { arcClient } from "@/lib/arc/chain";
import { ARC, ARC_USDC } from "@/lib/arc/config";
import { arclawAbi } from "@/lib/abi/arclaw";
import { isAdmin } from "@/lib/admin.server";
import { allow, clientIp } from "@/lib/rate-limit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const overviewRef = makeFunctionReference<"query", { secret: string }, unknown>("admin:overview");
const statusRef = makeFunctionReference<"query", { secret: string; events?: number }, unknown>("keeper:status");

const settle = async <T,>(fn: () => Promise<T>) => {
  try {
    return { ok: true as const, data: await fn() };
  } catch (e) {
    return { ok: false as const, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
};

async function chain() {
  const c = ARC.contracts;
  if (!c) throw new Error("no contracts on this network");
  const client = arcClient();
  const [block, paused, usdc, inventory] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: c.arclaw, abi: arclawAbi, functionName: "paused" }),
    client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [c.arclaw] }),
    Promise.all(
      Object.entries(c.stocks).map(async ([ticker, address]) => ({
        ticker,
        shares: formatUnits(await client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [c.arclaw] }), 18),
      })),
    ),
  ]);
  return {
    network: ARC.network,
    arclaw: c.arclaw,
    block: String(block),
    paused,
    usdc: formatUnits(usdc, 6),
    inventory: inventory.filter((s) => Number(s.shares) > 0),
  };
}

export async function POST(request: NextRequest) {
  // The panel refreshes every 30 s; 20 a minute is plenty for it and caps what a stranger can make this route read.
  if (!allow(`admin:${clientIp(request)}`, 20)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { message?: unknown; signature?: unknown } | null;
  if (!(await isAdmin(request.headers.get("host"), body?.message, body?.signature))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const secret = process.env.ADMIN_QUERY_SECRET ?? "";
  const convex = () => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
    if (!secret) throw new Error("ADMIN_QUERY_SECRET is not set");
    return new ConvexHttpClient(url);
  };
  const [stats, keeper, onchain] = await Promise.all([
    settle(() => convex().query(overviewRef, { secret })),
    settle(() => convex().query(statusRef, { secret, events: 25 })),
    settle(chain),
  ]);
  return NextResponse.json({ at: Date.now(), stats, keeper, chain: onchain }, { headers: { "cache-control": "no-store" } });
}
