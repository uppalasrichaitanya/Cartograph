/**
 * Blob pathname generation for uploaded archives.
 *
 * Uploaded zips are temporary: `analyzeRepository` downloads the archive and
 * then deletes it in its `finally` block. That cleanup targets a pathname, so
 * two uploads that resolve to the *same* pathname are the same object — one
 * request's cleanup then deletes another request's archive, and the analysis
 * fails with "Failed to download the uploaded archive."
 *
 * Uploading the same project twice used to hit exactly that: the browser sent
 * `file.name` as the pathname and the client token set no random suffix
 * (@vercel/blob v1 defaults `addRandomSuffix` to false), so every upload of
 * `my-project.zip` shared one pathname and one URL.
 *
 * Every upload therefore gets its own pathname, from two independent
 * directions:
 *
 *   - `buildUploadPathname` puts a fresh UUID segment in the pathname the
 *     browser requests.
 *   - `UNIQUE_UPLOAD_TOKEN_OPTIONS` makes Vercel Blob add its own random
 *     suffix when issuing the token, so uniqueness holds even though the
 *     pathname originates on the untrusted client.
 *
 * This module is imported by a client component, so it must stay free of
 * Node built-ins. `crypto.randomUUID` is available on both the browser
 * (secure contexts, which includes localhost) and Node 22.
 */

/** Folder that temporary uploads live under, kept apart from `analyses/`. */
export const UPLOAD_PREFIX = "uploads";

/**
 * Client-token constraints that keep the final pathname unique.
 *
 * `addRandomSuffix` is the server-side guarantee: the pathname comes from the
 * browser, so it cannot be trusted to be unique on its own. `allowOverwrite`
 * stays off so a collision fails loudly instead of clobbering a live upload.
 */
export const UNIQUE_UPLOAD_TOKEN_OPTIONS = {
  addRandomSuffix: true,
  allowOverwrite: false,
} as const;

/**
 * Build a unique Blob pathname for an uploaded archive.
 *
 * Returns a distinct pathname on every call, including for repeated uploads
 * of the same file. The original file name is preserved (sanitised) as the
 * last segment so uploads stay recognisable in the Blob dashboard and so the
 * `.zip` extension check in /api/upload-url still applies to it.
 */
export function buildUploadPathname(fileName: string): string {
  // Collapse anything outside a conservative set — this also removes `/` and
  // `\`, so a caller-supplied name cannot escape the prefix or forge another
  // namespace.
  const safeName =
    fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-") || "archive";

  return `${UPLOAD_PREFIX}/${crypto.randomUUID()}/${safeName}`;
}
