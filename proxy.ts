/**
 * Region gate. The marketing pages, the whitepaper and the legal pages stay open everywhere; the app (/app) and the
 * claim page are the places money moves, and they answer 451 from regions where a paid game of chance with a prize of
 * value is not allowed to be offered to the public, and from sanctioned countries. The country comes from the
 * `x-vercel-ip-country` header Vercel sets; with no header (local development) nothing is blocked.
 *
 * The list is a conservative starting point, not legal advice: set BLOCKED_COUNTRIES (comma separated ISO codes) to
 * replace it once counsel has said which regions apply. A VPN beats any IP check; the terms say players are
 * responsible for their own jurisdiction.
 */
import { NextResponse, type NextRequest } from "next/server";
import { STATIC_SCRIPT_SRC, policy, strictPolicy } from "@/lib/csp";

const DEFAULT_BLOCKED = [
  // Sanctioned or embargoed.
  "CU", "IR", "KP", "SY", "RU", "BY", "MM",
  // Regions that license or forbid paid games of chance with prizes of value.
  "US", "GB", "FR", "AU", "NL", "BE", "SG",
];

const blocked = new Set(
  (process.env.BLOCKED_COUNTRIES?.trim() ? process.env.BLOCKED_COUNTRIES.split(",") : DEFAULT_BLOCKED).map((c) => c.trim().toUpperCase()).filter(Boolean),
);

export async function proxy(request: NextRequest) {
  const country = request.headers.get("x-vercel-ip-country")?.toUpperCase();
  if (country && blocked.has(country)) {
    const url = request.nextUrl.clone();
    url.pathname = "/restricted";
    url.search = "";
    const res = NextResponse.rewrite(url, { status: 451 });
    res.headers.set("Content-Security-Policy", policy(STATIC_SCRIPT_SRC));
    return res;
  }
  // Strict CSP for the pages where wallets sign (lib/csp.ts). Next reads the nonce from the request's policy and puts
  // it on its own scripts, which makes these pages render per request.
  const nonce = btoa(crypto.randomUUID());
  const csp = await strictPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: ["/app/:path*", "/claim/:path*"],
};
