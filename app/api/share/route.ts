/**
 * POST /api/share { txHash, boxIndex }: the signed /pull link for one box of a reveal. The receipt is read from the
 * chain here (never trusted from the client) and must hold arclaw's own OutcomeDrawn/CardDrawn logs. A receipt never
 * changes, so answers are kept per box; new lookups are limited per IP so nobody can drain the RPC through this route.
 */
import { NextResponse, type NextRequest } from "next/server";
import { arcClient } from "@/lib/arc/chain";
import { boxesFromLogs, toUsdc } from "@/lib/arclaw/contract";
import { signPull } from "@/lib/share";
import { allow, clientIp } from "@/lib/rate-limit.server";

export const runtime = "nodejs";

const HASH = /^0x[0-9a-fA-F]{64}$/;
// ponytail: per instance, newest 500 boxes
const signed = new Map<string, string>();

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { txHash?: unknown; boxIndex?: unknown } | null;
  const txHash = typeof body?.txHash === "string" && HASH.test(body.txHash) ? (body.txHash as `0x${string}`) : null;
  const boxIndex = Number.isInteger(body?.boxIndex) ? Number(body?.boxIndex) : null;
  if (!txHash || boxIndex === null || boxIndex < 0 || boxIndex > 99) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const key = `${txHash.toLowerCase()}:${boxIndex}`;
  const hit = signed.get(key);
  if (hit) return NextResponse.json({ path: hit }, { headers: { "Cache-Control": "no-store" } });
  if (!allow(`share:${clientIp(request)}`, 20)) return NextResponse.json({ error: "too many requests" }, { status: 429 });

  try {
    const client = arcClient();
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    const box = (await boxesFromLogs(client, receipt.logs)).find((b) => b.boxIndex === boxIndex);
    if (!box || box.cards.length === 0) return NextResponse.json({ error: "no such box" }, { status: 404 });
    const fields = {
      tickers: box.cards.map((c) => c.ticker).join(","),
      amounts: box.cards.map((c) => toUsdc(c.valueWei).toFixed(2)).join(","),
      tier: box.tierName,
    };
    const sig = signPull(fields);
    if (!sig) return NextResponse.json({ error: "sharing is not configured" }, { status: 503 });
    const path = `/pull?${new URLSearchParams({ ...fields, sig }).toString()}`;
    if (signed.size >= 500) signed.delete(signed.keys().next().value!);
    signed.set(key, path);
    return NextResponse.json({ path }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "could not read that transaction" }, { status: 502 });
  }
}
