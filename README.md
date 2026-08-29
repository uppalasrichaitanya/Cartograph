# Cartograph

Turn a JavaScript, TypeScript, or Python project zip into a shareable, interactive dependency map.

Every edge on the map is read from an actual import statement. Nothing is inferred from folder names, nothing is guessed from naming conventions, and uploaded code is never executed. When a dependency cannot be resolved, Cartograph draws it as unresolved rather than quietly dropping it — because a missing edge and an edge to nowhere are different facts.

**Static analysis only.** No model creates, removes, or reroutes a node or an edge.

---

## What you get

Upload a zip, watch the analysis stream its progress, and land on a permanent shareable URL (`/repo/<id>`).

**A map at two altitudes.** A folder-level survey of the whole repository, and a file-level view inside any region. Cross-region dependencies stay visible from inside a region as boundary markers, so following a dependency out of a folder never dead-ends.

**Marks that show the limits of the analysis.** Every node and edge carries the evidence behind it, rendered so you can tell them apart at a glance:

| Mark | Meaning |
| --- | --- |
| `verified` | Directly observed in source. |
| `derived` | Deterministically computed from verified facts. As reliable as verified, but with lineage. |
| `heuristic` | Best-effort. May be wrong. |
| `unknown` | The dependency exists; its target could not be determined. |

Confidence never increases as data flows through the pipeline. A fifth state, `assisted`, is reserved for generated interpretation and is excluded at the type level from ever becoming graph geometry.

**Structural observations**, each traceable back to the graph that produced it — import cycles, dependency hubs ranked by in-degree, and orphaned files that nothing imports.

**Repository context** — detected primary language, framework (Next.js, Remix, Preact, and others, from config files or `package.json` dependencies), file and folder counts, dependency count, and archive size.

**A workspace to explore it** - search across files, named symbols, and packages; a per-file detail panel; a breadcrumb trail of where you have been; and zoom controls. Symbol selections are shareable and survive refresh.

Files that could not be fully parsed are reported alongside the map instead of being silently omitted.

---

## How it reads a repository

| Language | Extensions | Parser |
| --- | --- | --- |
| TypeScript / JavaScript | `.ts` `.tsx` `.js` `.jsx` | TypeScript compiler API |
| Python | `.py` | `tree-sitter-python` (WASM) |

Both parsers also index named declarations. TypeScript/JavaScript support functions, named
function or arrow expressions assigned to variables, classes, constructors, methods,
interfaces, type aliases, and enums. Python supports functions, async functions, nested
functions, classes, constructors, and methods.

**Path aliases are honoured.** `baseUrl` and `paths` from `tsconfig.json` or `jsconfig.json` are resolved, so `@/lib/thing` becomes a real edge instead of an unresolved stub. Re-exports are followed.

**Python import roots are detected, not assumed.** A declared layout in `pyproject.toml` or `setup.cfg` is used when present. Falling back to a structural guess is recorded as a guess and weakens the confidence of what depends on it, rather than passing itself off as declared.

Adding a language means implementing a parser against the registry interface — not modifying the pipeline.

The symbol index is not a call graph. Cartograph does not currently add call or reference
edges between declarations; dependency geometry remains file-level and import-based.

---

## What it deliberately does not do

Cartograph's scope is narrow on purpose: **understand software architecture.** It is not an IDE, a compiler, a build system, a vulnerability scanner, a CI policy engine, or a coding assistant. It does not execute, lint, type-check, or modify your code.

See [`docs/project-philosophy.md`](docs/project-philosophy.md) for the principles these constraints come from.

---

## Safety

Uploaded archives are treated as hostile input.

- **Never executed** — static parsing only.
- **Zip extraction is validated** — path traversal and symlink escapes are rejected per entry, and every rejection is recorded and surfaced in the result rather than swallowed.
- **Binary and unreadable files are detected** by content sniffing, not by extension.
- **Resource limits** — 25 MB compressed upload, 250 MB extracted, 800 source files. Parsing runs in a worker pool under time bounds.
- **The archive is deleted** after the analysis attempt, on success or failure. Only the result JSON persists.

---

## Run locally

```bash
npm install
cp .env.example .env.local   # PowerShell: Copy-Item .env.example .env.local
npm run dev
```

No external services are needed. With `BLOB_READ_WRITE_TOKEN` unset, uploads and results are kept on the local filesystem under `.data/`.

To exercise the Vercel Blob path locally, set `BLOB_READ_WRITE_TOKEN` to a token for a **public** Blob store. The browser then uploads the zip directly to Blob using a short-lived token from `/api/upload-url`, so the archive never passes through a Serverless Function and its 4.5 MB body limit.

## Deploy to Vercel

1. Create a **public** Vercel Blob store and configure `BLOB_READ_WRITE_TOKEN` for the deployment environment.
2. Deploy the Next.js app. The analysis routes request a 300-second duration, which requires Fluid Compute (300 s is the current Hobby maximum).
3. Upload a zip.

## Verification

```bash
npm test        # parsers, IR construction and validation, safety, workspace, conformance
npm run lint
npm run build
```

The suite includes conformance fixtures per language and determinism checks: the same repository must always produce the same graph.

---

## Project layout

```
app/                    Next.js App Router — pages and API routes
components/             Diagram, search, upload, and workspace UI
lib/analysis/           Discovery, parsing, graph construction, clustering, anomalies
lib/analysis/ir/        Versioned intermediate representation and its validation
lib/analysis/parsers/   Per-language parsers behind one registry interface
lib/safety/             Zip validation, content sniffing, resource guards, worker pool
lib/storage/            Local filesystem and Vercel Blob backends
docs/                   Philosophy, vision, roadmap, and specs
```

Built with Next.js 15, React 19, `@xyflow/react` for the diagram, and `elkjs` for layout.

## License

MIT — see [LICENSE](LICENSE).
