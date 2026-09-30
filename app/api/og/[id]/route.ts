import { handleOgImage } from "@/lib/api/ogImage";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleOgImage(request, id, { storage: getStorage() });
}
