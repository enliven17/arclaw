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

const DEFAULT_BLOCKED = [
  // Sanctioned or embargoed.
  "CU", "IR", "KP", "SY", "RU", "BY", "MM",
  // Regions that license or forbid paid games of chance with prizes of value.
  "US", "GB", "FR", "AU", "NL", "BE", "SG",
];

const blocked = new Set(
  (process.env.BLOCKED_COUNTRIES?.trim() ? process.env.BLOCKED_COUNTRIES.split(",") : DEFAULT_BLOCKED).map((c) => c.trim().toUpperCase()).filter(Boolean),
);

export function proxy(request: NextRequest) {
  const country = request.headers.get("x-vercel-ip-country")?.toUpperCase();
  if (country && blocked.has(country)) {
    const url = request.nextUrl.clone();
    url.pathname = "/restricted";
    url.search = "";
    return NextResponse.rewrite(url, { status: 451 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/claim/:path*"],
};
