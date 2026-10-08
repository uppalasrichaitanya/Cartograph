/**
 * Entry points: the files a runtime, a framework, a test runner or a person
 * starts from, rather than files another file imports.
 *
 * Reachability (reachability.ts) starts its search here. Every rule is a
 * recognised convention, and each result names the rule that matched in a
 * short human-readable `reason`, so a reader can see why a file was treated as
 * a starting point and disagree. Recognising too few entry points makes
 * reachable code look unreachable, so where a convention is cheap to match the
 * rules lean generous.
 *
 * Pure: it receives the discovered file paths, the manifest paths and a
 * `read` callback for contents, and touches no filesystem itself.
 */

export type EntryPoint = { path: string; reason: string };

export type EntryPointInput = {
  /** Discovered source files, relative to the project root, forward slashes. */
  files: readonly string[];
  /** Paths of package.json / pyproject.toml / go.mod files (project-relative). */
  manifestPaths: readonly string[];
  /** Contents of any project file, or undefined when it cannot be read. */
  read: (path: string) => string | undefined;
};

const SOURCE_EXT = "(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)";
const NEXT_SPECIAL =
  "(?:page|layout|route|loading|error|global-error|not-found|template|default|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)";
const NEXT_APP = new RegExp(`^(?:src/)?app/(?:.*/)?${NEXT_SPECIAL}\\.${SOURCE_EXT}$`);
const NEXT_PAGES = new RegExp(`^(?:src/)?pages/.+\\.${SOURCE_EXT}$`);
const NEXT_ROOT = new RegExp(`^(?:src/)?(middleware|proxy|instrumentation)\\.${SOURCE_EXT}$`);
const CONFIG_FILE = new RegExp(`^[^/]+\\.config\\.${SOURCE_EXT}$`);
const CONVENTIONAL_ROOT = /^(?:src\/)?(?:index|main|server|app|cli|worker|sw)\.[A-Za-z]+$/;
const PY_ENTRY_NAMES = new Set(["__main__.py", "manage.py", "setup.py", "wsgi.py", "asgi.py"]);
const PY_MAIN_GUARD = /^if\s+__name__\s*==\s*["']__main__["']\s*:/m;
const GO_PACKAGE_MAIN = /^package\s+main\b/m;

/** Extensions a built target may have been compiled from. */
const SOURCE_TWINS: Record<string, string[]> = {
  ".js": [".js", ".ts", ".tsx", ".jsx"],
  ".jsx": [".jsx", ".tsx"],
  ".mjs": [".mjs", ".mts"],
  ".cjs": [".cjs", ".cts"],
};

const isDeclarationFile = (path: string) => /\.d\.[cm]?ts$/.test(path);
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const join = (dir: string, rest: string) => (dir ? `${dir}/${rest}` : rest);
const escapeRegExp = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** `./a/../b` style targets normalised to a project-relative path. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export function findEntryPoints(input: EntryPointInput): EntryPoint[] {
  const fileSet = new Set(input.files.filter((file) => !isDeclarationFile(file)));
  const found = new Map<string, string>();
  const add = (path: string, reason: string) => {
    if (fileSet.has(path) && !found.has(path)) found.set(path, reason);
  };

  // Directories that are a package root: the project root plus every manifest's directory.
  const roots = new Set<string>([""]);
  for (const manifest of input.manifestPaths) roots.add(dirOf(manifest));

  // 1. Manifests.
  for (const manifest of input.manifestPaths) {
    const dir = dirOf(manifest);
    if (manifest.endsWith("package.json")) packageJsonEntries(manifest, dir, input, fileSet, add);
    else if (manifest.endsWith("pyproject.toml")) pyprojectEntries(manifest, dir, input, add);
  }

  const sortedFiles = [...fileSet].sort();
  for (const file of sortedFiles) {
    // 2. Framework routes and root-level conventions, relative to each package root that contains the file.
    for (const root of roots) {
      if (root && !file.startsWith(`${root}/`)) continue;
      const rel = root ? file.slice(root.length + 1) : file;
      if (NEXT_APP.test(rel) || NEXT_PAGES.test(rel)) add(file, `Next.js route (${file})`);
      else if (NEXT_ROOT.test(rel)) add(file, `Next.js ${rel.match(NEXT_ROOT)![1]} (${file})`);
      else if (CONFIG_FILE.test(rel)) add(file, "config file");
      else if (/^(?:test|tests)\//.test(rel)) add(file, "test file");
      else if (/^(?:scripts|bin)\//.test(rel)) add(file, `script (${rel.split("/")[0]}/)`);
      else if (CONVENTIONAL_ROOT.test(rel)) add(file, "conventional root file");
    }

    // 3. Tests and stories anywhere.
    if (/\.(?:test|spec)\.[^/]+$/.test(file) || /(?:^|\/)__tests__\//.test(file)) add(file, "test file");
    else if (/\.stories\.[^/]+$/.test(file)) add(file, "Storybook story");
    else if (/(?:^|\/)test_[^/]*\.py$/.test(file) || /_test\.py$/.test(file) || /(?:^|\/)conftest\.py$/.test(file)) add(file, "test file");
    else if (/_test\.go$/.test(file)) add(file, "test file");

    // 4. Language entry conventions that need the file's contents.
    const base = file.slice(file.lastIndexOf("/") + 1);
    if (file.endsWith(".py")) {
      if (PY_ENTRY_NAMES.has(base)) add(file, `Python entry module (${base})`);
      else if (PY_MAIN_GUARD.test(input.read(file) ?? "")) add(file, "Python __main__ guard");
    } else if (file.endsWith(".go") && !file.endsWith("_test.go")) {
      if (GO_PACKAGE_MAIN.test(input.read(file) ?? "")) add(file, "Go package main");
    }
  }

  return [...found].map(([path, reason]) => ({ path, reason })).sort((a, b) => a.path.localeCompare(b.path));
}

function packageJsonEntries(
  manifest: string,
  dir: string,
  input: EntryPointInput,
  fileSet: ReadonlySet<string>,
  add: (path: string, reason: string) => void,
): void {
  let json: unknown;
  try {
    json = JSON.parse(input.read(manifest) ?? "");
  } catch {
    return;
  }
  if (!json || typeof json !== "object") return;
  const pkg = json as Record<string, unknown>;
  const reasonFor = (field: string) => `${manifest} "${field}"`;

  const fromTargets = (field: string, targets: string[]) => {
    for (const target of targets) {
      for (const file of resolveTarget(dir, target, fileSet)) add(file, reasonFor(field));
    }
  };
  for (const field of ["main", "module", "types"] as const) {
    if (typeof pkg[field] === "string") fromTargets(field, [pkg[field] as string]);
  }
  if (typeof pkg.bin === "string") fromTargets("bin", [pkg.bin]);
  else if (pkg.bin && typeof pkg.bin === "object") fromTargets("bin", stringLeaves(pkg.bin));
  if (pkg.exports !== undefined) fromTargets("exports", stringLeaves(pkg.exports));
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
  return [];
}

/**
 * Source files a manifest target points at. A target that is not itself a
 * discovered source file is mapped to an obvious twin (dist/x.js -> src/x.ts,
 * lib/x.js -> lib/x.ts); otherwise it names nothing and is ignored.
 */
function resolveTarget(dir: string, target: string, fileSet: ReadonlySet<string>): string[] {
  if (isDeclarationFile(target) || target.startsWith("#")) return [];
  const rel = normalise(target);
  if (!rel) return [];
  const bases = [rel];
  const first = rel.split("/")[0];
  if ((first === "dist" || first === "build") && rel.includes("/")) {
    const rest = rel.slice(first.length + 1);
    bases.push(`src/${rest}`, rest);
  }
  const matches = new Set<string>();
  for (const base of bases) {
    const extIndex = base.lastIndexOf(".");
    const ext = extIndex > base.lastIndexOf("/") ? base.slice(extIndex) : "";
    const stem = ext ? base.slice(0, extIndex) : base;
    const variants = ext ? (SOURCE_TWINS[ext] ?? [ext]).map((e) => stem + e) : [base];
    for (const variant of variants) {
      const full = join(dir, variant);
      if (variant.includes("*")) {
        const pattern = new RegExp(`^${escapeRegExp(full).replace(/\*/g, ".*")}$`);
        for (const file of fileSet) if (pattern.test(file)) matches.add(file);
      } else if (fileSet.has(full)) {
        matches.add(full);
      }
    }
  }
  return [...matches];
}

function pyprojectEntries(
  manifest: string,
  dir: string,
  input: EntryPointInput,
  add: (path: string, reason: string) => void,
): void {
  const text = input.read(manifest);
  if (!text) return;
  let inScripts = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inScripts = /^\[(?:project\.scripts|tool\.poetry\.scripts)\]/.test(line);
      continue;
    }
    if (!inScripts) continue;
    const match = line.match(/^[\w.-]+\s*=\s*["']([\w.]+)(?::[\w.]+)?["']/);
    if (!match) continue;
    const modulePath = match[1].replace(/\./g, "/");
    for (const base of [dir, join(dir, "src")]) {
      add(join(base, `${modulePath}.py`), "pyproject.toml script");
      add(join(base, `${modulePath}/__init__.py`), "pyproject.toml script");
    }
  }
}
