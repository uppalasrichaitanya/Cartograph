/**
 * The daily expiry sweep, authorised by CRON_SECRET. Kept out of the route
 * file so tests can call it directly.
 *
 * @module lib/api/sweep
 */
import { timingSafeEqual } from "node:crypto";
import type { StorageBackend } from "@/lib/storage";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleSweep(request: Request, storage: StorageBackend, now: Date, secret: string | undefined): Promise<Response> {
  if (!secret) return Response.json({ error: "The sweep is not configured (CRON_SECRET is unset)." }, { status: 503 });
  const given = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  if (!sameSecret(given, secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const ids = await storage.listExpiredIds(now);
  for (const id of ids) await storage.deleteAnalysis(id);
  return Response.json({ deleted: ids.length });
}
