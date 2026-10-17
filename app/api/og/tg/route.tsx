/** Telegram message images: /api/og/tg?kind=welcome and ?kind=odds-single|odds-stack|odds-vault. */
import type { NextRequest } from "next/server";
import { machineBySlug } from "@/lib/machines";
import { ogResponse } from "@/lib/og/response";
import { TgOddsImage, TgWelcomeImage } from "@/lib/og/telegram";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") ?? "welcome";
  const headers = { "Cache-Control": "public, max-age=3600" };
  if (kind === "welcome") return ogResponse(<TgWelcomeImage />, headers);
  const machine = kind.startsWith("odds-") ? machineBySlug(kind.slice(5)) : null;
  if (!machine) return new Response(null, { status: 404 });
  return ogResponse(<TgOddsImage machine={machine} />, headers);
}
