/**
 * Share card for an opened pack: /api/og/pull?tickers=..&amounts=..&tier=..&sig=.. . Only params signed by /api/share
 * (lib/share.ts) draw a card; anything else is a 404, so the route cannot be used to render a fake win.
 */
import type { NextRequest } from "next/server";
import { ogResponse } from "@/lib/og/response";
import { PullCardImage, parsePull } from "@/lib/og/cards";
import { verifyPull } from "@/lib/share";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!verifyPull(request.nextUrl.searchParams)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const { cards, tier } = parsePull(request.nextUrl.searchParams);
  return ogResponse(<PullCardImage cards={cards} tier={tier} />, { "Cache-Control": "public, max-age=31536000, immutable" });
}
