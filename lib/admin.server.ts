/**
 * Who may read the admin panel, and how they prove it. Stateless: the admin wallet signs a short message naming this
 * site and an expiry at most 15 minutes ahead; every panel request carries that message and signature, and the server
 * checks the domain, the expiry and the signer (verifyMessage also accepts smart wallets). Read only, so a replay inside
 * the window gains nothing a fresh sign-in would not. Anyone else gets a plain 404.
 */
import "server-only";
import { isHex } from "viem";
import { arcClient } from "./arc/chain";
import { ADMIN, adminMessage } from "./admin";

const MAX_WINDOW_MS = 15 * 60_000;

/** True when `message` is an unexpired sign-in for `host`, signed by the admin wallet. */
export async function isAdmin(host: string | null, message: unknown, signature: unknown, now = Date.now()): Promise<boolean> {
  if (!host || typeof message !== "string" || typeof signature !== "string" || !isHex(signature)) return false;
  const expires = Date.parse(/^expires: (.+)$/m.exec(message)?.[1] ?? "");
  if (!Number.isFinite(expires) || expires <= now || expires > now + MAX_WINDOW_MS) return false;
  if (message !== adminMessage(host, expires)) return false;
  return arcClient()
    .verifyMessage({ address: ADMIN, message, signature })
    .catch(() => false);
}
