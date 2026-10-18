/**
 * Signed share links. A pulled pack is shared as /pull?tickers=..&amounts=..&tier=..&sig=..; the share card and the
 * page draw only what carries a valid signature, so nobody can mint a fake "Jackpot 300,000 USDC" card on our domain.
 * The signature is an HMAC with SHARE_SECRET (server only). /api/share signs after reading the reveal transaction's
 * receipt from the chain, so what is signed is what the contract paid.
 *
 * No SHARE_SECRET means signing and verifying are both off (fail closed): links do not validate.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export type PullFields = { tickers: string; amounts: string; tier: string };

const secret = () => process.env.SHARE_SECRET?.trim() || null;
const canonical = (f: PullFields) => `pull|${f.tickers}|${f.amounts}|${f.tier}`;

export function signPull(fields: PullFields): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac("sha256", key).update(canonical(fields)).digest("hex").slice(0, 32);
}

/** The params of a /pull URL are valid only with the signature made for exactly these values. */
export function verifyPull(params: URLSearchParams): boolean {
  const key = secret();
  const sig = params.get("sig");
  const fields = { tickers: params.get("tickers") ?? "", amounts: params.get("amounts") ?? "", tier: params.get("tier") ?? "" };
  if (!key || !sig || !fields.tickers) return false;
  const want = Buffer.from(createHmac("sha256", key).update(canonical(fields)).digest("hex").slice(0, 32));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
