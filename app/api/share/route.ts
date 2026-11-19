/**
 * POST /api/share { signature }: the signed /pull link for the pack a settle transaction paid. The transaction is read
 * from Solana here (never trusted from the client) and must carry the arclaw program's own RoundSettled event. A
 * transaction never changes, so answers are kept; new lookups are limited per IP so nobody can drain the RPC.
 */
import { NextResponse, type NextRequest } from "next/server";
import { boxFromSettle } from "@/lib/solana/client";
import { signPull } from "@/lib/share";
import { allow, clientIp } from "@/lib/rate-limit.server";

export const runtime = "nodejs";

const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
// per instance, newest 500 packs
const signed = new Map<string, string>();

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { signature?: unknown } | null;
  const signature = typeof body?.signature === "string" && SIG.test(body.signature) ? body.signature : null;
  if (!signature) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const hit = signed.get(signature);
  if (hit) return NextResponse.json({ path: hit }, { headers: { "Cache-Control": "no-store" } });
  if (!allow(`share:${clientIp(request)}`, 20)) return NextResponse.json({ error: "too many requests" }, { status: 429 });

  try {
    const box = await boxFromSettle(signature);
    if (!box || box.cards.length === 0) return NextResponse.json({ error: "no such pack" }, { status: 404 });
    const fields = {
      tickers: box.cards.map((c) => c.ticker).join(","),
      amounts: box.cards.map((c) => c.valueUsdc.toFixed(2)).join(","),
      tier: box.tierName,
    };
    const sig = signPull(fields);
    if (!sig) return NextResponse.json({ error: "sharing is not configured" }, { status: 503 });
    const path = `/pull?${new URLSearchParams({ ...fields, sig }).toString()}`;
    if (signed.size >= 500) signed.delete(signed.keys().next().value!);
    signed.set(signature, path);
    return NextResponse.json({ path }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "could not read that transaction" }, { status: 502 });
  }
}
