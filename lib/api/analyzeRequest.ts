/**
 * Validation of the POST /api/analyze/stream body. Lives outside the route
 * file because Next.js route modules may only export HTTP handlers and config.
 *
 * The body names exactly one source: an uploaded archive (`zipPath`) or a
 * public GitHub repository (`github`). Nothing about a GitHub import is taken
 * on the client's word beyond the validated owner/repo/ref: the display name
 * and size are derived server-side.
 *
 * @module lib/api/analyzeRequest
 */
import type { AnalysisOptions } from "@/lib/analysis/analyzeRepository";
import { parseRetention } from "@/lib/ownership";
import { GithubSourceError, parseGithubSource } from "@/lib/github/source";

export class AnalyzeRequestError extends Error {}

export function parseAnalyzeRequest(body: unknown): AnalysisOptions {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AnalyzeRequestError("The request body must be a JSON object.");
  }
  const input = body as Record<string, unknown>;
  const hasZip = input.zipPath !== undefined && input.zipPath !== null;
  const hasGithub = input.github !== undefined && input.github !== null;
  if (hasZip === hasGithub) {
    throw new AnalyzeRequestError("Send exactly one of zipPath or github.");
  }
  const retention = parseRetention(input.retention);

  if (hasGithub) {
    if (typeof input.github !== "string") {
      throw new AnalyzeRequestError("github must be a GitHub repository link.");
    }
    try {
      return { github: parseGithubSource(input.github), retention };
    } catch (error) {
      if (error instanceof GithubSourceError) throw new AnalyzeRequestError(error.message);
      throw error;
    }
  }

  if (typeof input.zipPath !== "string") throw new AnalyzeRequestError("zipPath is required.");
  const options: AnalysisOptions = { zipPath: input.zipPath, retention };
  // Both are client-supplied display metadata: bound them before they are persisted.
  if (typeof input.repoName === "string" && input.repoName.trim()) options.repoName = input.repoName.trim().slice(0, 120);
  if (typeof input.repoSizeBytes === "number" && Number.isFinite(input.repoSizeBytes) && input.repoSizeBytes >= 0) {
    options.repoSizeBytes = input.repoSizeBytes;
  }
  return options;
}
