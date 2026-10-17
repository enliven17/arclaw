/**
 * Share card for a gift: /api/og/gift?machine=stack&n=2&note=Happy%20birthday&from=Ada
 * Every param is optional and sanitised (parseGift). The claim secret never goes in this URL.
 */
import type { NextRequest } from "next/server";
import { ogResponse } from "@/lib/og/response";
import { GiftCardImage, parseGift } from "@/lib/og/cards";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gift = parseGift(request.nextUrl.searchParams);
  return ogResponse(<GiftCardImage {...gift} />, { "Cache-Control": "public, max-age=86400" });
}
