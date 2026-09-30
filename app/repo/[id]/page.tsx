import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { DiagramView } from "@/components/DiagramView";
import { hasAiProvider } from "@/lib/ai/provider";
import { repoMetadata } from "@/lib/og/metadata";
import { getStorage } from "@/lib/storage";
import { loadLiveAnalysis } from "@/lib/storage/live";

export const dynamic = "force-dynamic";

/** One storage read per request, shared by the page and its metadata. */
const loadAnalysis = cache(async (id: string) => loadLiveAnalysis(getStorage(), id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    const result = await loadAnalysis(id);
    return result ? repoMetadata(result, id) : {};
  } catch {
    // The page itself answers a missing or unreadable analysis; metadata must not throw.
    return {};
  }
}

export default async function RepositoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawSearchParams = await searchParams;
  const initialSearch = new URLSearchParams();
  for (const [key, value] of Object.entries(rawSearchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) initialSearch.append(key, entry);
    } else if (value !== undefined) {
      initialSearch.set(key, value);
    }
  }
  let result;
  try {
    result = await loadAnalysis(id);
  } catch {
    notFound();
  }
  if (!result) notFound();
  return <DiagramView result={result} initialSearch={initialSearch.toString()} aiConfigured={hasAiProvider()} />;
}
