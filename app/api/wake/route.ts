/**
 * POST /api/wake { machineId }: a visitor opened a machine whose prize table has gone stale; ask the keeper to reprice it.
 * The keeper (Convex, convex/keeper.ts) records the request, ignores repeats within a minute and reprices inside its own
 * limits, so spamming this costs nothing but a database row. No Convex deployment configured means nothing to wake.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export const runtime = "nodejs";

const wakeRef = makeFunctionReference<"mutation", { machineId: number }, unknown>("keeper:wake");

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { machineId?: unknown } | null;
  const machineId = Number(body?.machineId);
  if (!Number.isInteger(machineId) || machineId < 1 || machineId > 3) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return new NextResponse(null, { status: 204 });
  try {
    await new ConvexHttpClient(url).mutation(wakeRef, { machineId });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "could not reach the keeper" }, { status: 502 });
  }
}
