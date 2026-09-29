/**
 * Owner-token deletion of a stored analysis. Lives outside the route file
 * because Next.js route modules may only export HTTP handlers and config.
 *
 * @module lib/api/deleteAnalysis
 */
import { verifyOwnerToken } from "@/lib/ownership";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/safety/rateLimit";
import type { StorageBackend } from "@/lib/storage";
import { isValidAnalysisId } from "@/lib/storage/interface";

export async function handleDelete(request: Request, id: string, storage: StorageBackend): Promise<Response> {
  if (!isValidAnalysisId(id)) return Response.json({ error: "Analysis not found." }, { status: 404 });
  const limited = enforceRateLimit(request, RATE_LIMITS.delete);
  if (limited) return limited;
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]?.trim();
  if (!token) return Response.json({ error: "A delete token is required." }, { status: 401 });
  const owner = await storage.loadOwner(id);
  if (!owner) return Response.json({ error: "This analysis cannot be deleted from here." }, { status: 404 });
  if (!verifyOwnerToken(token, owner.tokenHash)) return Response.json({ error: "This browser cannot delete that analysis." }, { status: 403 });
  await storage.deleteAnalysis(id);
  return new Response(null, { status: 204 });
}
