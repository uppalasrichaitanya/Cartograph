import { handleDelete } from "@/lib/api/deleteAnalysis";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleDelete(request, id, getStorage());
}
