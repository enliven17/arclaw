/**
 * The arclaw Telegram bot: replies to commands with designed images (app/api/og/tg) and plays the launch video on
 * /start. Stateless: no database, every reply is built from lib/machines and the site URL.
 * Server only: it reads TELEGRAM_BOT_TOKEN.
 */
import "server-only";
import { MACHINES, fmtPct } from "@/lib/machines";
import { SITE_URL } from "@/lib/seo";
import { usdc } from "@/lib/stocks";

type Button = { text: string; url: string };
type Keyboard = { inline_keyboard: Button[][] };

const abs = (path: string) => new URL(path, SITE_URL).toString();

export async function tg(method: string, body: Record<string, unknown>): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`telegram ${method} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const PLAY: Keyboard = {
  inline_keyboard: [
    MACHINES.map((m) => ({ text: `${m.name} ${usdc(m.priceUsdc)}`, url: abs(`/app/play/${m.slug}`) })),
    [
      { text: "Open arclaw", url: abs("/app/play") },
      { text: "Follow on X", url: "https://x.com/arclawapp" },
    ],
  ],
};

const WELCOME = [
  "<b>Grab a box. Pull real stocks.</b>",
  "",
  "Pick a machine, pay in USDC on Arc, and the claw grabs you a sealed box. Every box opens into a pack of three tokenized stock cards, paid straight to your wallet.",
  "",
  MACHINES.map((m) => `${m.name}: ${usdc(m.priceUsdc)} USDC, ${fmtPct(m.rtp, 0)} expected return`).join("\n"),
  "",
  "Every box is set to be worth at least half its price at table prices. Up to 10x on a jackpot.",
].join("\n");

const HELP = [
  "/play  pick a machine",
  "/odds  the full odds for every machine",
  "/start  the intro again",
  "",
  `Risk disclaimer: ${abs("/disclaimer")}`,
].join("\n");

async function start(chat: number) {
  const video = process.env.TELEGRAM_LAUNCH_VIDEO_URL || abs("/video/launch-square.mp4");
  // ponytail: no per-user "seen it" state; /start is rare enough that replaying the video every time is fine.
  await tg("sendVideo", { chat_id: chat, video, caption: WELCOME, parse_mode: "HTML", supports_streaming: true, reply_markup: PLAY });
}

async function odds(chat: number) {
  await tg("sendMediaGroup", {
    chat_id: chat,
    media: MACHINES.map((m, i) => ({
      type: "photo",
      media: abs(`/api/og/tg?kind=odds-${m.slug}`),
      ...(i === 0 ? { caption: "Odds are set on-chain. Every box is set to be worth at least half its price at table prices, and at most 10x." } : {}),
    })),
  });
}

/** Handles one Telegram update. Only private-chat commands get a reply; everything else is ignored. */
export async function handleUpdate(update: unknown): Promise<void> {
  const msg = (update as { message?: { chat?: { id?: number; type?: string }; text?: string } }).message;
  const chat = msg?.chat?.id;
  if (typeof chat !== "number" || msg?.chat?.type !== "private" || typeof msg.text !== "string") return;
  const command = msg.text.trim().split(/[\s@]/)[0]!.toLowerCase();
  if (command === "/start") return start(chat);
  if (command === "/play") return void (await tg("sendPhoto", { chat_id: chat, photo: abs("/api/og/tg?kind=welcome"), caption: "Pick a machine.", reply_markup: PLAY }));
  if (command === "/odds") return odds(chat);
  await tg("sendMessage", { chat_id: chat, text: HELP, reply_markup: PLAY, link_preview_options: { is_disabled: true } });
}

