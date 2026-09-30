/**
 * Parsing and validation of a GitHub repository reference.
 *
 * Pure and browser-safe (no node imports): the upload form validates with the
 * same function the API route uses, so a bad link is rejected before any
 * request is made and can never reach the server in a different shape.
 *
 * This is the only place a user-supplied string becomes part of an outbound
 * URL, so it is deliberately strict. The fetched host is never taken from the
 * input; only owner, repo and ref survive, each matched against a narrow
 * character set.
 */

export type GithubSource = { owner: string; repo: string; ref: string | null };

export class GithubSourceError extends Error {}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const REF_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;

const FORMAT_HELP = "Paste a link like github.com/owner/repo, or just owner/repo.";
const ALLOWED_HOSTS = new Set(["github.com", "www.github.com"]);

function validOwner(owner: string): boolean {
  return OWNER_PATTERN.test(owner);
}

function validRepo(repo: string): boolean {
  return repo !== "." && repo !== ".." && REPO_PATTERN.test(repo);
}

function validRef(ref: string): boolean {
  return (
    REF_PATTERN.test(ref) &&
    !ref.includes("..") &&
    !ref.includes("//") &&
    !ref.startsWith("/") &&
    !ref.endsWith("/") &&
    // A lone "." segment is normalised away by URL parsing, which would
    // fetch a different ref than the one shown.
    !ref.split("/").some((segment) => segment === "." || segment === "")
  );
}

/** The part of the input after the host, with any query or hash removed. */
function extractPath(input: string): string {
  const ssh = /^git@github\.com:(.*)$/i.exec(input);
  if (ssh) return ssh[1];

  const withScheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/.exec(input);
  if (withScheme) {
    const [, scheme, host, rest] = withScheme;
    const lowerHost = host.toLowerCase();
    if (lowerHost === "gist.github.com") {
      throw new GithubSourceError(
        "Gists aren't supported. Paste a repository link like github.com/owner/repo.",
      );
    }
    if (!/^https?$/i.test(scheme) || !ALLOWED_HOSTS.has(lowerHost)) {
      throw new GithubSourceError(
        `Only github.com repositories are supported. ${FORMAT_HELP}`,
      );
    }
    return rest;
  }

  const bare = /^([^/?#]+)(\/.*)?$/.exec(input);
  if (bare && bare[2] !== undefined) {
    const first = bare[1].toLowerCase();
    if (first === "gist.github.com") {
      throw new GithubSourceError(
        "Gists aren't supported. Paste a repository link like github.com/owner/repo.",
      );
    }
    if (ALLOWED_HOSTS.has(first)) return bare[2];
    // A dotted first segment is a host, never a valid owner name.
    if (first.includes(".") || first.includes(":")) {
      throw new GithubSourceError(
        `Only github.com repositories are supported. ${FORMAT_HELP}`,
      );
    }
  }
  return input;
}

export function parseGithubSource(input: string): GithubSource {
  const trimmed = input.trim();
  if (!trimmed) throw new GithubSourceError(`Paste a GitHub repository link. ${FORMAT_HELP}`);

  const pathOnly = extractPath(trimmed).split(/[?#]/, 1)[0];
  const segments = pathOnly.split("/");
  if (segments[0] === "") segments.shift();
  // One trailing slash is harmless; anything else empty is left for validation.
  if (segments.length > 0 && segments[segments.length - 1] === "") segments.pop();

  if (segments.length < 2) {
    throw new GithubSourceError(`That doesn't look like a repository link. ${FORMAT_HELP}`);
  }

  const [owner, rawRepo, kind, ...refParts] = segments;
  const repo = rawRepo.replace(/\.git$/i, "");

  if (kind === "blob" || kind === "raw" || kind === "blame") {
    throw new GithubSourceError(
      "That's a file link. Paste the repository link instead, like github.com/owner/repo.",
    );
  }
  if (kind !== undefined && kind !== "tree") {
    throw new GithubSourceError(`That doesn't look like a repository link. ${FORMAT_HELP}`);
  }
  if (!validOwner(owner)) {
    throw new GithubSourceError("That isn't a valid GitHub owner name. Owners use letters, digits and hyphens.");
  }
  if (!validRepo(repo)) {
    throw new GithubSourceError("That isn't a valid GitHub repository name. Names use letters, digits, dots, hyphens and underscores.");
  }

  let ref: string | null = null;
  if (kind === "tree") {
    ref = refParts.join("/");
    if (!validRef(ref)) {
      throw new GithubSourceError(
        "That branch or tag name isn't valid. Use a link like github.com/owner/repo/tree/main.",
      );
    }
  }
  return { owner, repo, ref };
}

/** `owner/repo`, or `owner/repo@ref` when a branch or tag is pinned. */
export function githubDisplayName(source: GithubSource): string {
  return `${source.owner}/${source.repo}${source.ref ? `@${source.ref}` : ""}`;
}

/** The repository's public page, on the branch or tag when one is pinned. */
export function githubRepoUrl(source: GithubSource): string {
  const base = `https://github.com/${source.owner}/${source.repo}`;
  return source.ref ? `${base}/tree/${source.ref}` : base;
}
