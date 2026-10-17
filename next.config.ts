import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Share-card routes read their TTFs from disk; trace them into the serverless bundle.
  outputFileTracingIncludes: {
    "/opengraph-image": ["./lib/og/fonts/**"],
    "/twitter-image": ["./lib/og/fonts/**"],
    "/api/og/pull": ["./lib/og/fonts/**"],
    "/api/og/gift": ["./lib/og/fonts/**"],
  },
};

export default nextConfig;
