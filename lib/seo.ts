/** Site identity for metadata and share cards. Metadata only: never use SITE_URL for auth decisions. */
export const SITE_NAME = "arclaw";
export const TAGLINE = "A claw machine that pays in stocks.";
export const SITE_DESCRIPTION =
  "Pay 1 USDC on Solana, steer the claw, win a sealed box. Every box opens into three cards, and every card is a real tokenized stock.";

export const SITE_URL = new URL(process.env.APP_ORIGIN?.replace(/\/+$/, "") || "https://arclaw.app");

export const SITE_CARD_ALT = "arclaw: a claw machine that pays in tokenized stocks on Solana";

