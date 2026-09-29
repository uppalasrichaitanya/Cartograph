/**
 * Where this browser keeps the right to delete an analysis.
 *
 * Per-viewer by design: the token is the uploader's, not the link's. Every
 * access is guarded, because private windows and blocked site data make
 * storage throw, and nothing else on the page may break because of that.
 *
 * @module lib/workspace/ownerToken
 */
const key = (id: string) => `cartograph:owner:${id}`;
// Real tokens are 43 base64url characters; the bounds only reject junk.
const TOKEN = /^[A-Za-z0-9_-]{10,100}$/;

function store(storage?: Storage): Storage | null {
  if (storage) return storage;
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function saveOwnerToken(id: string, token: string, storage?: Storage): void {
  try { store(storage)?.setItem(key(id), token); } catch { /* unavailable */ }
}

export function loadOwnerToken(id: string, storage?: Storage): string | null {
  try { return store(storage)?.getItem(key(id)) ?? null; } catch { return null; }
}

export function forgetOwnerToken(id: string, storage?: Storage): void {
  try { store(storage)?.removeItem(key(id)); } catch { /* unavailable */ }
}

export function takeOwnerFragment(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("owner");
  return token && TOKEN.test(token) ? token : null;
}

export function ownerLink(origin: string, id: string, token: string): string {
  return `${origin}/repo/${id}#owner=${token}`;
}
