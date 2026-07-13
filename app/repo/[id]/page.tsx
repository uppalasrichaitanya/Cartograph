import { notFound } from "next/navigation";
import { DiagramView } from "@/components/DiagramView";
import { loadAnalysis } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";

export default async function RepositoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await loadAnalysis(id);
    if (!result) notFound();
    return <DiagramView result={result} />;
  } catch {
    notFound();
  }
}
