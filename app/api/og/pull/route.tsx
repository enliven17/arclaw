/**
 * Share card for an opened pack: /api/og/pull?tickers=NVDA,AAPL,TSLA&amounts=0.10,0.40,0.25
 * Params are untrusted: parsePull validates them and falls back to the sample pack.
 */
import type { NextRequest } from "next/server";
import { ogResponse } from "@/lib/og/response";
import { PullCardImage, parsePull } from "@/lib/og/cards";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const cards = parsePull(request.nextUrl.searchParams);
  return ogResponse(<PullCardImage cards={cards} />, { "Cache-Control": "public, max-age=31536000, immutable" });
}
