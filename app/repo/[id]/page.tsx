import { notFound } from "next/navigation";
import { DiagramView } from "@/components/DiagramView";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function RepositoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let result;
  try {
    result = await getStorage().loadAnalysis(id);
  } catch {
    notFound();
  }
  if (!result) notFound();
  return <DiagramView result={result} />;
}
