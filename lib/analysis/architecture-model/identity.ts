import { createHash } from "node:crypto";
import type { BoundaryId, BoundaryKind } from "./types";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function encodeBase62(buffer: Buffer): string {
  let value = BigInt(`0x${buffer.toString("hex")}`);
  if (value === 0n) return "0";
  const output: string[] = [];
  while (value > 0n) {
    output.push(BASE62[Number(value % 62n)]);
    value /= 62n;
  }
  return output.reverse().join("");
}

export function createBoundaryId(kind: BoundaryKind, path: string): BoundaryId {
  const digest = createHash("sha256")
    .update(`architecture-boundary:${kind}:${path}`, "utf8")
    .digest()
    .subarray(0, 16);
  return encodeBase62(digest) as BoundaryId;
}
