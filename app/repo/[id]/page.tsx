import { notFound } from "next/navigation";
import { DiagramView } from "@/components/DiagramView";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function RepositoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await getStorage().loadAnalysis(id);
    if (!result) notFound();
    return <DiagramView result={result} />;
  } catch {
    notFound();
  }
}
