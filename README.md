<table align="center">
  <tr>
    <td align="center" bgcolor="#F4F0E6" width="112" height="112">
      <img src="./app/icon.svg" width="72" height="72" alt="Cartograph logo" />
    </td>
  </tr>
</table>

<h1 align="center">Cartograph</h1>

<p align="center">
  <strong>Verified dependency maps for real codebases.</strong><br />
  Upload a repository. Read its architecture. Follow every measured edge.
</p>

<p align="center">
  <a href="#run-locally">Run locally</a> |
  <a href="#how-it-works">How it works</a> |
  <a href="#safety">Safety</a> |
  <a href="docs/project-philosophy.md">Project philosophy</a>
</p>

Cartograph turns a JavaScript, TypeScript, Python, or Go repository into a
shareable, interactive dependency map. Every graph edge comes from an import
statement in source. Nothing is inferred from folder names, and uploaded code
is never executed.

When a dependency cannot be resolved, Cartograph draws it as unresolved rather
than silently dropping it. A missing edge and an edge to nowhere are different
facts.

## What you get

### A map with two useful altitudes

Start with a folder-level survey of the whole repository, then drill into a
region for its file-level dependencies. Cross-region dependencies remain
visible as boundary markers, so following an edge never dead-ends at a view
boundary.

### Evidence that stays visible

Every node and edge carries the confidence of the fact behind it:

| Mark | Meaning |
| --- | --- |
| `verified` | Directly observed in source. |
| `derived` | Deterministically computed from verified facts, with lineage. |
| `heuristic` | Best-effort and may be wrong. |
| `unknown` | The dependency exists, but its target could not be determined. |
| `assisted` | Generated interpretation, kept off graph geometry. |

Confidence never increases as data moves through the pipeline. Generated
interpretation is always displayed on a separate assisted surface and can
never create, remove, or reroute a graph edge.

### Structural observations

Inspect import cycles, dependency hubs ranked by in-degree, and files that are
not imported anywhere. Each observation is traceable to the graph that
produced it; the interface does not collapse unlike measurements into one
severity score.

### Grounded AI explanations

The **AI explain** action can interpret the selected file or the repository
overview using the graph as its evidence set. Responses are requested from the
configured provider chain and rejected unless every claim has a valid citation
to a measured node, edge, or analyzer result.

Supported providers, attempted in order:

1. Gemini
2. Groq
3. OpenRouter

Provider keys are server-side only. The model is an interpreter, not an author
of graph data.

### A workspace for investigation

Search files, named symbols, and packages. Open a file detail panel, follow
imports and importers, inspect confidence evidence, use the breadcrumb and
investigation trail, and share a URL that preserves the current position.

## How it works

1. Upload a repository zip.
2. Cartograph validates the archive and discovers source files.
3. Language parsers extract imports, declarations, and parse errors.
4. The analysis pipeline builds a validated intermediate representation and a
   deterministic dependency graph.
5. Architecture boundaries, observations, and layout are computed from that
   graph.
6. The result is persisted at `/repo/<id>` and can be shared directly.

The pipeline is deterministic: the same repository produces the same graph,
ordering, and derived architecture records.

## Supported languages

| Language | Extensions | Parser |
| --- | --- | --- |
| TypeScript / JavaScript | `.ts` `.tsx` `.js` `.jsx` | TypeScript compiler API |
| Python | `.py` | tree-sitter Python (WASM) |
| Go | `.go` | tree-sitter Go (WASM) |

All parsers index named declarations. The symbol index is not a call graph:
dependency geometry remains file-level and import-based.

Path aliases from `tsconfig.json` or `jsconfig.json` are resolved, and
re-exports are followed. Python import roots are detected from declared
layouts when available; structural guesses are recorded as lower-confidence
evidence. Go package imports resolve to a deterministic representative file
and are marked heuristic when the package contains multiple source files.

## Safety

Uploaded archives are treated as hostile input.

- **Never executed:** parsing only; no build, lint, type-check, or runtime
  evaluation.
- **Archive paths are validated:** traversal and symlink escapes are rejected
  per entry and recorded in the result.
- **Content is sniffed:** binary and unreadable files are detected by content,
  not trusted extensions.
- **Resource limits are explicit:** 25 MB compressed, 250 MB extracted, and
  800 source files. Parsing runs in a bounded worker pool.
- **Uploads are temporary:** the archive is deleted after the analysis attempt;
  only the result JSON persists.

## Run locally

Requirements: Node.js `>=22.3.0`.

```bash
npm install
cp .env.example .env.local
npm run dev
```

PowerShell users can copy the environment template with:

```powershell
Copy-Item .env.example .env.local
npm.cmd run dev
```

Without `BLOB_READ_WRITE_TOKEN`, uploads and results use the local filesystem
under `.data/`. To enable the AI explanation action locally, add provider keys
to `.env.local`:

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b
OPEN_ROUTER_API_KEY=
OPEN_ROUTER_MODEL=openrouter/free
```

Keep these variables server-side. Do not rename them to `NEXT_PUBLIC_*`.

## Deploy to Vercel

1. Create a public Vercel Blob store and set `BLOB_READ_WRITE_TOKEN` in the
   deployment environment.
2. Add the AI provider variables if you want AI explanations in production.
3. Deploy the Next.js application.

The analysis routes request a 300-second duration, which requires Fluid
Compute on Vercel. The Go and Python tree-sitter WASM grammars are included in
the production trace.

## Verify changes

```bash
npm test
npm run lint
npm run build
```

The test suite covers parser conformance, IR validation, deterministic layout,
analysis safety, indexed queries, grounding validation, workspace navigation,
and visual foundations.

## Project layout

```text
app/                         Next.js App Router pages and API routes
components/                  Diagram, search, upload, AI, and workspace UI
lib/analysis/                Discovery, parsing, orchestration, and rendering
lib/analysis/analyzers/      Capability-aware analyzer plugins
lib/analysis/architecture-model/
                             Deterministic boundaries and inference records
lib/analysis/ir/              Versioned intermediate representation
lib/analysis/parsers/        Language parsers behind one registry
lib/ai/                      Read-only tools, providers, and grounding checks
lib/safety/                  Archive validation and resource guards
lib/storage/                 Local filesystem and Vercel Blob backends
docs/                        Philosophy, vision, roadmap, and specifications
```

Built with Next.js 16, React 19, `@xyflow/react`, and `elkjs`.

## Scope

Cartograph is a static architecture survey. It is not an IDE, compiler, build
system, vulnerability scanner, CI policy engine, or coding assistant. See
[`docs/project-philosophy.md`](docs/project-philosophy.md) for the reasoning
behind these boundaries.

## License

MIT - see [`LICENSE`](LICENSE).
