/**
 * Share card for a gift claim link: /api/og/gift?from=Ada
 * `from` is optional and sanitised (parseFrom). The claim secret never goes in this URL.
 */
import type { NextRequest } from "next/server";
import { ogResponse } from "@/lib/og/response";
import { GiftCardImage, parseFrom } from "@/lib/og/cards";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const from = parseFrom(request.nextUrl.searchParams);
  return ogResponse(<GiftCardImage from={from} />, { "Cache-Control": "public, max-age=86400" });
}
