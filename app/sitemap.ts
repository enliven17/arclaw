import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

const PUBLIC_PATHS = [
  { path: "/", changeFrequency: "weekly" as const, priority: 1 },
  { path: "/app/play", changeFrequency: "weekly" as const, priority: 0.9 },
  { path: "/app/play/single", changeFrequency: "weekly" as const, priority: 0.8 },
  { path: "/app/play/stack", changeFrequency: "weekly" as const, priority: 0.8 },
  { path: "/app/play/vault", changeFrequency: "weekly" as const, priority: 0.8 },
  { path: "/app/leaderboard", changeFrequency: "hourly" as const, priority: 0.5 },
  { path: "/whitepaper", changeFrequency: "monthly" as const, priority: 0.6 },
  { path: "/disclaimer", changeFrequency: "yearly" as const, priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly" as const, priority: 0.3 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map(({ path, changeFrequency, priority }) => ({
    url: new URL(path, SITE_URL).toString(),
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));
}
