import type { MetadataRoute } from "next";
import { SITE_URL } from "./site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { path: "", priority: 1 as const },
    { path: "/privacy", priority: 0.4 as const },
    { path: "/terms", priority: 0.4 as const },
  ].map(({ path, priority }) => ({
      url: `${SITE_URL}${path}`,
      lastModified: new Date("2026-08-23"),
      changeFrequency: "weekly",
      priority,
    }));
}
