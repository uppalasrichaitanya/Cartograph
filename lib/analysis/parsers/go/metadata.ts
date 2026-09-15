import { readFile } from "node:fs/promises";
import path from "node:path";

export interface GoModuleResult {
  readonly modulePath: string;
  readonly moduleRoot: string;
  readonly rootConfidence: "declared" | "structural-heuristic";
}

export async function detectGoModule(projectRoot: string): Promise<GoModuleResult> {
  const moduleRoot = projectRoot;
  try {
    const source = await readFile(path.join(projectRoot, "go.mod"), "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*module\s+([^\s#]+)\s*(?:#.*)?$/);
      if (match) {
        return { modulePath: match[1], moduleRoot, rootConfidence: "declared" };
      }
    }
  } catch {
    // Fall through to the structural root.
  }
  return { modulePath: "", moduleRoot, rootConfidence: "structural-heuristic" };
}
