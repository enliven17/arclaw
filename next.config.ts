import type { NextConfig } from "next";
import { STATIC_SCRIPT_SRC, policy } from "./lib/csp";

// Static pages get the inline-friendly policy; /app and /claim get a strict per-request one from proxy.ts (lib/csp.ts).
const csp = policy(STATIC_SCRIPT_SRC);

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
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
      // /app and /claim get their (strict) policy from proxy.ts; everything else gets the static one here
      { source: "/:path((?!app(?:/|$)|claim(?:/|$)).*)", headers: securityHeaders },
      { source: "/app/:path*", headers: securityHeaders.filter((h) => h.key !== "Content-Security-Policy") },
      { source: "/app", headers: securityHeaders.filter((h) => h.key !== "Content-Security-Policy") },
      { source: "/claim/:path*", headers: securityHeaders.filter((h) => h.key !== "Content-Security-Policy") },
      { source: "/claim", headers: securityHeaders.filter((h) => h.key !== "Content-Security-Policy") },
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
