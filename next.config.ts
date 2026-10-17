import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // A stray lockfile in the home directory would otherwise be taken as the workspace root.
  turbopack: { root: process.cwd() },
  // Share-card routes read their TTFs from disk; trace them into the serverless bundle.
  outputFileTracingIncludes: {
    "/opengraph-image": ["./lib/og/fonts/**", "./public/logos/**"],
    "/twitter-image": ["./lib/og/fonts/**", "./public/logos/**"],
    "/api/og/pull": ["./lib/og/fonts/**", "./public/logos/**"],
    "/api/og/gift": ["./lib/og/fonts/**", "./public/logos/**"],
  },
};

export default nextConfig;
