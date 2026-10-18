/**
 * Telegram webhook. Telegram sends the secret set in scripts/ops/telegram-setup.mjs in a header; anything without it
 * is rejected before the body is read. Always answers 200 once authenticated so Telegram doesn't retry forever.
 */
import { timingSafeEqual } from "node:crypto";
import { handleUpdate } from "@/lib/telegram";

export const runtime = "nodejs";

function authorised(req: Request): boolean {
  const want = process.env.TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (!want || !got || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

export async function POST(req: Request) {
  if (!authorised(req)) return new Response(null, { status: 401 });
  try {
    await handleUpdate(await req.json());
  } catch (error) {
    console.error("telegram update failed:", error);
  }
  return new Response(null, { status: 200 });
}
