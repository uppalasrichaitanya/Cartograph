/**
 * Page metadata for shared links. Pure, so it is unit-tested without Next.
 *
 * @module lib/og/metadata
 */
import type { Metadata } from "next";
import type { AnalysisResult } from "@/types/graph";
import { OG_HEIGHT, OG_WIDTH } from "./card";

const LOCAL_ORIGIN = "http://localhost:3000";
const HOST = /^[A-Za-z0-9.-]+(?::\d+)?$/;

/**
 * Absolute base for relative og:image URLs: the production domain in
 * production, the deployment URL on previews, localhost otherwise. Never throws.
 */
export function metadataBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): URL {
  const candidates = [
    env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : undefined,
    env.VERCEL_URL,
  ];
  for (const host of candidates) {
    if (host && HOST.test(host)) return new URL(`https://${host}`);
  }
  return new URL(LOCAL_ORIGIN);
}

export function repoMetadata(result: AnalysisResult, id: string): Metadata {
  const { repoName, fileCount, folderCount, dependencyCount } = result.repoMeta;
  const title = `${repoName} · architecture map · Cartograph`;
  const description = `${fileCount} files in ${folderCount} regions, ${dependencyCount} import edges, each read from an import statement.`;
  const images = [{ url: `/api/og/${id}`, width: OG_WIDTH, height: OG_HEIGHT, alt: `Architecture map of ${repoName}` }];
  return {
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Cartograph", images },
    twitter: { card: "summary_large_image", title, description, images: images.map((image) => image.url) },
    // Maps are shared by link; search engines should not index them.
    robots: { index: false, follow: false },
  };
}
