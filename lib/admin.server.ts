/**
 * Who may read the admin panel, and how they prove it. Stateless: the admin wallet signs a short message naming this
 * site and an expiry about 10 minutes ahead; every panel request carries that message and signature, and the server
 * checks the domain, the expiry and the signer (verifyMessage also accepts smart wallets). Read only, so a replay inside
 * the window gains nothing a fresh sign-in would not. Anyone else gets a plain 404.
 */
import "server-only";
import { isHex } from "viem";
import { arcClient } from "./arc/chain";
import { ADMIN, ADMIN_SESSION_MS, adminMessage } from "./admin";

// The panel signs 10 minutes ahead (lib/admin.ts); the slack covers a browser clock that runs ahead of the server's.
const MAX_WINDOW_MS = ADMIN_SESSION_MS + 10 * 60_000;

/** The hosts a sign-in may name: the site's own (APP_ORIGIN, with and without www) and localhost for development. A
 *  spoofed Host header naming anything else is refused before the signature is even looked at. */
export function allowedHost(host: string | null, origin = process.env.APP_ORIGIN): boolean {
  if (!host) return false;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return true;
  let site: string;
  try {
    site = new URL(origin || "https://arclaw.app").host.replace(/^www\./, "");
  } catch {
    return false;
  }
  return host === site || host === `www.${site}`;
}

/** True when `message` is an unexpired sign-in for `host`, signed by the admin wallet. */
export async function isAdmin(host: string | null, message: unknown, signature: unknown, now = Date.now(), admin = ADMIN): Promise<boolean> {
  if (!allowedHost(host) || !host || typeof message !== "string" || typeof signature !== "string" || !isHex(signature)) return false;
  const expires = Date.parse(/^expires: (.+)$/m.exec(message)?.[1] ?? "");
  if (!Number.isFinite(expires) || expires <= now || expires > now + MAX_WINDOW_MS) return false;
  if (message !== adminMessage(host, expires)) return false;
  return arcClient()
    .verifyMessage({ address: admin, message, signature })
    .catch(() => false);
}
