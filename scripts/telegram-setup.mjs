/**
 * One-time bot setup: webhook, commands, descriptions.
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... APP_ORIGIN=https://... node scripts/telegram-setup.mjs
 * The profile photo is set by hand in @BotFather (/setuserpic) with brand/social/profile.png.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const origin = process.env.APP_ORIGIN?.replace(/\/+$/, "");
if (!token || !secret || !origin) throw new Error("set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_ORIGIN");
if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) throw new Error("TELEGRAM_WEBHOOK_SECRET: 16 to 256 of A-Z a-z 0-9 _ -");

const call = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  console.log(`${method}: ok`);
};

await call("setWebhook", { url: `${origin}/api/telegram`, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
await call("setMyCommands", {
  commands: [
    { command: "play", description: "Pick a machine" },
    { command: "odds", description: "Odds for every machine" },
    { command: "start", description: "The intro" },
  ],
});
await call("setMyShortDescription", { short_description: "Claw machines on Arc. Every box opens into three tokenized stock cards." });
await call("setMyDescription", {
  description:
    "Grab a box. Pull real stocks.\n\nPick a machine (1, 5 or 10 USDC), the claw grabs a sealed box, and it opens into a pack of three tokenized stock cards paid to your wallet. Every box returns at least half.",
});
