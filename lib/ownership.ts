/**
 * Who may delete an analysis, and how long it lives.
 *
 * Share links are public by design, so deletion rights cannot come from the
 * link. The uploader's browser receives a random token once; the store keeps
 * only its hash. The Blob store is public, but a SHA-256 of 256 random bits
 * reveals nothing usable.
 *
 * @module lib/ownership
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type RetentionChoice = "7d" | "30d" | "manual";
export const DEFAULT_RETENTION: RetentionChoice = "30d";

const DAYS: Record<Exclude<RetentionChoice, "manual">, number> = { "7d": 7, "30d": 30 };

export function parseRetention(value: unknown): RetentionChoice {
  return value === "7d" || value === "30d" || value === "manual" ? value : DEFAULT_RETENTION;
}

export function expiresAt(createdAt: string, choice: RetentionChoice): string | null {
  if (choice === "manual") return null;
  return new Date(Date.parse(createdAt) + DAYS[choice] * 24 * 60 * 60 * 1000).toISOString();
}

export function createOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyOwnerToken(token: string, expectedHash: string): boolean {
  if (!token || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashOwnerToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isExpired(retention: { expiresAt: string | null } | undefined, now: Date): boolean {
  if (!retention?.expiresAt) return false;
  return Date.parse(retention.expiresAt) <= now.getTime();
}
