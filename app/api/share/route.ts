/**
 * POST /api/share { txHash, boxIndex }: the signed /pull link for one box of a reveal. The receipt is read from the
 * chain here (never trusted from the client) and must hold arclaw's own OutcomeDrawn/CardDrawn logs.
 */
import { NextResponse, type NextRequest } from "next/server";
import { arcClient } from "@/lib/arc/chain";
import { boxesFromLogs, toUsdc } from "@/lib/arclaw/contract";
import { signPull } from "@/lib/share";

export const runtime = "nodejs";

const HASH = /^0x[0-9a-fA-F]{64}$/;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { txHash?: unknown; boxIndex?: unknown } | null;
  const txHash = typeof body?.txHash === "string" && HASH.test(body.txHash) ? (body.txHash as `0x${string}`) : null;
  const boxIndex = Number.isInteger(body?.boxIndex) ? Number(body?.boxIndex) : null;
  if (!txHash || boxIndex === null || boxIndex < 0 || boxIndex > 99) return NextResponse.json({ error: "bad request" }, { status: 400 });

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
    const p = new URLSearchParams({ ...fields, sig });
    return NextResponse.json({ path: `/pull?${p.toString()}` }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "could not read that transaction" }, { status: 502 });
  }
}
