import type { LanguageParser, ParseFileInput, ParserInitContext, RawExtraction, ResolvedSpecifier } from "../interface";
import { detectGoModule } from "./metadata";
import { buildGoPackageIndex, type GoPackageIndex } from "./packageIndex";
import { ensureGoRuntime, parseGoSourceSync } from "./treeSitter";
import { extractImports } from "./importExtractor";
import { extractGoDeclarations } from "./declarations";
import { resolveGoImportFromFile } from "./importResolver";

export class GoParser implements LanguageParser {
  readonly id = "go";
  readonly name = "Go";
  readonly language = "go" as const;
  readonly extensions = ["go"] as const;
  readonly capabilities = ["imports", "declarations"] as const;
  private packageIndex: GoPackageIndex | null = null;

  get modulePath(): string | null { return this.packageIndex?.modulePath ?? null; }
  get rootConfidence(): "declared" | "structural-heuristic" | null { return this.packageIndex?.rootConfidence ?? null; }
  canHandle(extension: string): boolean { return extension.toLowerCase() === "go"; }

  async initialize(context: ParserInitContext): Promise<void> {
    this.dispose();
    const moduleResult = await detectGoModule(context.projectRoot);
    this.packageIndex = buildGoPackageIndex(moduleResult, context.discoveredFiles);
    await ensureGoRuntime();
  }

  parseFile(file: ParseFileInput, content: string): RawExtraction {
    const lineCount = content.split(/\r?\n/).length;
    try {
      const tree = parseGoSourceSync(content);
      try {
        const imports = extractImports(tree);
        return {
          path: file.relativePath, lineCount, internalImports: imports.specifiers, externalImports: [],
          parseErrors: imports.parseErrors, capabilitiesUsed: ["imports", "declarations"],
          declarations: extractGoDeclarations(tree),
        };
      } finally { tree.delete(); }
    } catch (error) {
      return {
        path: file.relativePath, lineCount, internalImports: [], externalImports: [],
        parseErrors: [{ message: error instanceof Error ? error.message : "Unable to parse file", severity: "fatal", reason: "unknown" }],
        capabilitiesUsed: ["imports", "declarations"],
      };
    }
  }

  resolveImport(specifier: string, fromFile: ParseFileInput, knownFiles: ReadonlyArray<ParseFileInput>): ResolvedSpecifier {
    void knownFiles;
    return this.packageIndex ? resolveGoImportFromFile(specifier, fromFile, this.packageIndex) : { resolved: null, raw: specifier };
  }

  dispose(): void { this.packageIndex = null; }
}
