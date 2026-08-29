import { notFound } from "next/navigation";
import { DiagramView } from "@/components/DiagramView";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

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
    result = await getStorage().loadAnalysis(id);
  } catch {
    notFound();
  }
  if (!result) notFound();
  return <DiagramView result={result} initialSearch={initialSearch.toString()} />;
}
