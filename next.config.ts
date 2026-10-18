import type { NextConfig } from "next";

/**
 * Content Security Policy. Scripts are limited to our own bundle plus the few third parties the app loads (Vercel
 * analytics, Cloudflare Turnstile for Privy's bot check); inline scripts stay allowed because Next's own bootstrap and the
 * splash decider in the head are inline and the pages are static (no per-request nonce). That still stops a script from
 * another origin, and the rest is locked down: nobody can frame the site (clickjacking), no plugins, no base-tag or
 * form hijacking. Network and image sources stay open to https because wallets, RPCs, Convex and the stock logos live
 * on many hosts. Privy's login runs in an iframe on auth.privy.io.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self' https: wss:",
  "frame-src https://auth.privy.io https://*.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // A stray lockfile in the home directory would otherwise be taken as the workspace root.
  turbopack: { root: process.cwd() },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Cabinet backs (scripts/cabinet-bake.tsx) are on every page with a machine: cache them for a day, revalidate in
      // the background for a week. Not immutable: the file names carry no hash.
      { source: "/cabinet/:file", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
  // Share-card routes read their TTFs from disk; trace them into the serverless bundle.
  outputFileTracingIncludes: {
    "/opengraph-image": ["./lib/og/fonts/**", "./public/logos/**"],
    "/twitter-image": ["./lib/og/fonts/**", "./public/logos/**"],
    "/api/og/pull": ["./lib/og/fonts/**", "./public/logos/**"],
    "/api/og/gift": ["./lib/og/fonts/**", "./public/logos/**"],
  },
};

export default nextConfig;
