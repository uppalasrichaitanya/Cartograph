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

/** Stop starting deletes this long after the sweep begins (the route allows 60 s). */
export const SWEEP_BUDGET_MS = 50_000;

export type SweepOptions = { budgetMs?: number; clock?: () => number };

export async function handleSweep(
  request: Request,
  storage: StorageBackend,
  now: Date,
  secret: string | undefined,
  { budgetMs = SWEEP_BUDGET_MS, clock = Date.now }: SweepOptions = {},
): Promise<Response> {
  if (!secret) return Response.json({ error: "The sweep is not configured (CRON_SECRET is unset)." }, { status: 503 });
  const given = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  if (!sameSecret(given, secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const deadline = clock() + budgetMs;
  const ids = await storage.listExpiredIds(now);
  let deleted = 0;
  let failed = 0;
  let attempted = 0;
  for (const id of ids) {
    if (clock() >= deadline) break;
    attempted += 1;
    // One failing id must not block the rest of the run, or every later run.
    try {
      await storage.deleteAnalysis(id);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return Response.json({ deleted, failed, remaining: ids.length - attempted });
}
