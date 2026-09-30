/**
 * Download a public GitHub repository archive to disk (Node only).
 *
 * The URL is built here from an already-validated GithubSource; the host is a
 * constant and never comes from the user. Redirects are followed by hand so
 * each hop can be checked against an allowlist (https, GitHub's own hosts, no
 * credentials, no port), which rules out SSRF through a crafted redirect. The
 * byte cap is enforced while streaming, because a chunked response such as
 * codeload's carries no content-length to trust.
 */
import { writeFile } from "node:fs/promises";
import type { GithubSource } from "./source";

export class GithubImportError extends Error {}

export const MAX_GITHUB_ARCHIVE_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;
const ALLOWED_REDIRECT_HOSTS = new Set(["codeload.github.com", "github.com"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type DownloadOptions = {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function archiveUrl(source: GithubSource): string {
  const ref = source.ref ? source.ref.split("/").map(encodeURIComponent).join("/") : "HEAD";
  return `https://codeload.github.com/${source.owner}/${source.repo}/zip/${ref}`;
}

function tooLarge(maxBytes: number): GithubImportError {
  const limit = maxBytes >= 1024 * 1024 ? `${Math.round(maxBytes / (1024 * 1024))} MB` : `${maxBytes} bytes`;
  return new GithubImportError(
    `This repository's archive is larger than ${limit}. Zip only its source folders and upload that instead.`,
  );
}

/** Resolve a Location header and accept it only if it stays on GitHub over https. */
function checkedRedirectTarget(location: string | null, current: string): string {
  const rejected = new GithubImportError("GitHub redirected the download to an unexpected address, so it was not followed.");
  if (!location) throw rejected;
  let target: URL;
  try {
    target = new URL(location, current);
  } catch {
    throw rejected;
  }
  if (
    target.protocol !== "https:" ||
    !ALLOWED_REDIRECT_HOSTS.has(target.hostname) ||
    target.port !== "" ||
    target.username !== "" ||
    target.password !== ""
  ) {
    throw rejected;
  }
  return target.toString();
}

export async function downloadGithubArchive(
  source: GithubSource,
  destinationPath: string,
  options: DownloadOptions = {},
): Promise<{ bytes: number }> {
  const {
    fetchImpl = fetch,
    maxBytes = MAX_GITHUB_ARCHIVE_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = options;
  const name = `${source.owner}/${source.repo}`;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });

  // Rejects on abort so a stalled body read cannot outlive the timeout.
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  aborted.catch(() => {});

  try {
    let url = archiveUrl(source);
    let response: Response | null = null;
    for (let hop = 0; ; hop += 1) {
      const current: Response = await Promise.race([
        fetchImpl(url, { redirect: "manual", signal: controller.signal }),
        aborted,
      ]);
      if (REDIRECT_STATUSES.has(current.status)) {
        await current.body?.cancel().catch(() => {});
        if (hop >= MAX_REDIRECTS) throw new GithubImportError("GitHub followed too many redirects, so the download was stopped. Try again, or upload a zip.");
        url = checkedRedirectTarget(current.headers.get("location"), url);
        continue;
      }
      response = current;
      break;
    }

    if (response.status === 404) {
      await response.body?.cancel().catch(() => {});
      throw new GithubImportError(
        `Couldn't find a public GitHub repository at ${name}${source.ref ? ` (branch or tag "${source.ref}")` : ""}. ` +
          "Private repositories aren't supported. Upload a zip instead.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new GithubImportError(
        `GitHub didn't return the archive (status ${response.status}). Try again in a minute, or upload a zip.`,
      );
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw tooLarge(maxBytes);
    }
    if (!response.body) throw new GithubImportError("GitHub sent an empty response. Try again, or upload a zip.");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw tooLarge(maxBytes);
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }

    try {
      await writeFile(destinationPath, Buffer.concat(chunks));
    } catch {
      throw new GithubImportError("Couldn't save the downloaded archive.");
    }
    return { bytes };
  } catch (error) {
    if (error instanceof GithubImportError) throw error;
    if (timedOut) throw new GithubImportError("GitHub took too long to send the archive.");
    if (signal?.aborted) throw error;
    throw new GithubImportError("Couldn't reach GitHub. Try again in a minute, or upload a zip.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
