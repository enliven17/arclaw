import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // A stray lockfile in the home directory would otherwise be taken as the workspace root.
  turbopack: { root: process.cwd() },
  // Cabinet backs (scripts/cabinet-bake.tsx) are on every page with a machine: cache them for a day, revalidate in
  // the background for a week. Not immutable: the file names carry no hash.
  async headers() {
    return [{ source: "/cabinet/:file", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] }];
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
