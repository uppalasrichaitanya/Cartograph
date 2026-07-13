# Cartograph — Architecture Diagram Feature: Implementation Spec (v2)

This supersedes the v1 spec. Same scope — one feature: upload a JS/TS codebase → get a static, verifiably-accurate, clickable architecture diagram. The changes below fix real bugs in v1 (things that would fail on real repos or on Vercel itself), not scope creep.

## What changed from v1, and why

| # | v1 | v2 | Why |
|---|---|---|---|
| 1 | Zip posted directly to `/api/analyze` | Client uploads zip to Vercel Blob first, route takes a blob URL | Vercel Functions hard-cap request bodies at 4.5MB — a 25MB zip 413s before your code runs |
| 2 | One blocking POST does everything | Same request, but status is streamed (SSE) instead of silent | 800-file TS parses can run long; a silent spinner reads as broken |
| 3 | Import resolution: relative paths only | Also reads `tsconfig.json` `baseUrl`/`paths` and resolves aliases (`@/...`) | Most real TS/Next.js projects use aliases constantly — without this, a huge share of internal imports get misclassified as external and the graph is wrong on exactly the repos people will test with |
| 4 | No zip safety checks | Validate every entry path stays inside the temp dir; cap total uncompressed size | Zip-slip (path traversal) and zip bombs are real risks on a public upload endpoint |
| 5 | Mermaid.js renders the diagram | React Flow + `elkjs` for layout | You said you want this to feel like a real product, not a generated diagram. Mermaid's layout gets messy past ~30 nodes and has no pan/zoom/drag/hover-highlight. React Flow gives you all of that natively |
| 6 | No persistence, no shareable link | Result JSON written to Blob/KV under a UUID, returns `/repo/{id}` | Zero-persistence means nobody can share or revisit a diagram — bad for something meant to be shown off |
| 7 | God-module cutoff: flat `>15` in-degree | Default to top-5%-of-distribution, flat cutoff as fallback for tiny repos | A flat number doesn't scale between a 40-file repo and a 700-file repo |

Everything else from v1 (no LLM touching graph structure, TS Compiler API for parsing, DFS cycle detection, folder-based clustering, in-memory/stateless-per-analysis processing) stays as-is. Those were the right calls.

---

## 1. Goal, in one sentence

A user uploads a zip of a JS/TS project. The app extracts real imports (no LLM guessing), builds a dependency graph, clusters it into folders/layers, renders it as an interactive clickable diagram, verifies the layout is legible, and gives the user a shareable link to it.

## 2. Non-negotiable design rule

**Graph structure (nodes, edges, clusters) comes ONLY from static analysis of the code.** No LLM call may add, remove, or reroute a node or edge. If an LLM is used at all in this feature, it is only for: (a) writing a plain-English label/summary for a cluster after clustering is done, clearly marked as "AI-generated description," or (b) explaining an anomaly already detected by code. This constraint is the point of the project — do not violate it for convenience.

## 3. Tech stack (final)

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 14+, App Router, TypeScript | Single deployable app, server + client in one codebase |
| File upload | Client-side upload to **Vercel Blob** (`@vercel/blob` client uploads), server never touches the raw multipart body | Routes around the 4.5MB serverless body cap entirely; scales to whatever size cap you choose |
| Unzip | `adm-zip`, run server-side against the file pulled from Blob | Standard; wrap with the safety checks in Step 1 |
| Import extraction | TypeScript Compiler API (`typescript` package) with `allowJs: true`, plus `tsconfig.json` parsing for path aliases | Real AST beats regex; alias resolution is required for correctness on real repos |
| Graph data structure | Plain JSON adjacency list, no graph DB | A single repo's graph is small; don't over-engineer storage |
| Cycle/anomaly detection | Hand-rolled DFS (cycles) + degree counting with percentile-based god-module threshold | Small, explainable algorithms |
| Diagram rendering | **React Flow** for interactive canvas + **elkjs** for layout computation | Pan/zoom/drag/hover out of the box; elkjs handles layered/hierarchical layout far better than mermaid's dagre at higher node counts |
| Layout verification | Same idea as v1 — read rendered node bounding boxes, pairwise intersection check — but now redundant-as-safety-net rather than load-bearing, since elkjs is a proper layout engine | Cheap, deterministic, catches the rare bad case |
| Persistence | Vercel Blob (or KV) stores the analysis result JSON keyed by UUID, for shareable links only — no user accounts, no auth | Minimal addition, big UX payoff: a link you can send someone |
| Progress feedback | Server-Sent Events (SSE) from `/api/analyze/stream` reporting phase (unzipping / parsing / clustering / detecting anomalies / done) | Long-running analysis shouldn't look identical to a hang |
| Deploy | Vercel, with `maxDuration` raised on the analyze route (check current plan limits before committing to a number) | Stays a single deployable app; only add a separate worker service if you outgrow function duration limits on real usage |

**On "should I leave Vercel entirely":** no, not for this. The two real problems (body size, duration) both have first-party Vercel fixes (Blob client uploads, SSE + raised `maxDuration`). Splitting the analysis pipeline into a separate always-on worker (Railway/Fly.io/Render) is a legitimate v3 move if you find people uploading consistently large monorepos and hitting timeouts even with SSE keeping the connection warm — but don't add that infra until you've actually hit the wall.

## 4. Pipeline (implement in this exact order)

### Step 0 — Client-side upload
- Client requests a signed upload URL/token from a small server route
- Browser uploads the zip directly to Vercel Blob (never passes through your function as a body)
- Client gets back a blob URL, POSTs *that URL* (a few hundred bytes) to `/api/analyze`
- Enforce the size cap (~25MB to start) client-side before upload and server-side by checking the Blob object's reported size before downloading it for processing

### Step 1 — Fetch & extract
- Server downloads the zip from the Blob URL into `/tmp/cartograph-{uuid}`
- **Zip-slip protection:** before writing any entry, resolve its path and reject/skip if it resolves outside the temp directory
- **Zip-bomb protection:** track cumulative uncompressed size while extracting; abort with a clear error if it exceeds a hard ceiling (e.g. 250MB uncompressed) well before disk fills
- Delete the temp directory after the response is sent (success or failure)

### Step 2 — File discovery
- Walk the extracted directory recursively
- Include only: `.ts`, `.tsx`, `.js`, `.jsx`
- Exclude: `node_modules`, `.git`, `dist`, `build`, `.next`, any dotfolder
- Hard cap: if more than ~800 matching files, reject with a clear error ("repo too large for v1 — try a smaller project or a subfolder")
- If a nested top-level folder is detected (common when zipping a repo), step into it automatically

### Step 3 — Import extraction (the core static analysis)
- Look for `tsconfig.json` (or `jsconfig.json`) at the project root; if present, parse `compilerOptions.baseUrl` and `compilerOptions.paths` into an alias-resolution table
- For each file:
  - Parse with `ts.createSourceFile(filename, contents, ts.ScriptTarget.Latest, true)`
  - Walk the AST, collect `ImportDeclaration` and `ExportDeclaration` (re-exports) nodes
  - For each import specifier:
    - If it starts with `.` or `/` → resolve relative to the file, trying `.ts`, `.tsx`, `.js`, `.jsx`, `/index.ts`, etc.
    - Else if it matches a configured path alias → resolve through the alias table the same way
    - Else if it doesn't resolve to a project file → external package; record it separately (count only, not a graph node)
- If a file fails to parse (syntax error), skip it and collect it in a `parseErrors` list — don't crash the whole analysis
- Output per file: `{ filePath, imports: string[] (resolved project paths), externalImports: string[] }`

### Step 4 — Build the graph
- Nodes: one per project file that was parsed
- Edges: `A → B` if A imports B
- Store as: `{ nodes: [{id, path, folder}], edges: [{from, to}] }`
- Validate every resolved import path against the discovered file list only (guards against accidentally matching something that should've been excluded)

### Step 5 — Cluster into layers
- Cluster by top-level folder (e.g. everything under `src/services/` is one cluster, `src/components/` another)
- Folders with fewer than 3 files merge into a sibling or an "other" cluster
- Still not doing automatic community detection in v1 — folder structure is defensible and explainable. Real v2 candidate, not this pass.

### Step 6 — Anomaly detection (pure algorithms, no AI)
- **Circular dependencies:** DFS-based cycle detection; report each cycle as an ordered list of file paths
- **God modules:** default threshold is the top 5% of the in-degree distribution for the repo; fall back to a flat cutoff (e.g. >15) only when the repo is too small for percentiles to be meaningful (e.g. under ~20 files)
- **Orphans:** nodes with in-degree 0 AND out-degree 0

### Step 7 — Prepare render data
- Build a nodes/edges structure for React Flow: folder-level by default, file-level per folder available for drill-down
- Run **elkjs** (layered algorithm, e.g. `elk.layered`) server-side or client-side to compute `x`/`y` positions for nodes and routing hints for edges — this replaces mermaid string generation
- Tag god-module nodes and cycle-participant nodes with a `variant: "warning"` field so the React Flow node renderer can style them distinctly without a legend read
- For repos with more than ~60 files, folder-level view is the default; file-level view per folder is fetched/computed on click into that folder

### Step 8 — Render + verify layout
- React Flow renders the elkjs-computed layout, with pan/zoom, draggable nodes, and hover-highlighting of connected edges built in
- After render, run a lightweight bounding-box overlap check as a safety net (not the primary layout mechanism, since elkjs already does real layout):
  - Get bounding boxes for rendered nodes, check pairwise intersection
  - If violations are found: fall back to folder-level view (or a "layout too dense" notice) rather than trying to patch elkjs's output
- Entirely client-side, no network call, no LLM

### Step 9 — Persist & share
- Write the full analysis result (graph, clusters, anomalies, render data) to Blob/KV keyed by a UUID
- Return `shareUrl: "/repo/{uuid}"` in the response
- Visiting that URL re-hydrates the same diagram without re-running analysis — this is the only persistence in v1, no accounts attached to it

### Step 10 — Click-through panel
- Clicking a file node opens a side panel showing: file path, its resolved imports, files that import it, line count
- No RAG/chat integration in this pass — reuse this same graph data for that later

---

## 5. API contract

```
POST /api/upload-url
  body: { filename, size }
  response 200: { uploadUrl, blobUrl, token }   // for direct client → Blob upload

POST /api/analyze
  body: { blobUrl: string }
  response 200 (or streamed via /api/analyze/stream using the same blobUrl):
    {
      shareUrl: string,
      graph: { nodes: [...], edges: [...] },
      clusters: [{ name, fileIds: [...] }],
      anomalies: {
        cycles: [[filePath, filePath, ...], ...],
        godModules: [{ filePath, inDegree }],
        orphans: [filePath, ...]
      },
      parseErrors: [{ filePath, message }],
      renderData: {
        folderView: { nodes: [...], edges: [...] },      // positions pre-computed via elkjs
        fileViewByFolder: { [folderName]: { nodes, edges } }
      }
    }
  response 4xx: { error: string } for: file too large, too many files, invalid zip, no matching files found, unsafe zip contents

GET /repo/{id}
  → re-hydrates a previously computed result from Blob/KV, same shape as above minus re-analysis
```

## 6. Suggested repo structure

```
/app
  /api
    /upload-url/route.ts
    /analyze/route.ts
    /analyze/stream/route.ts   # SSE progress
  /repo/[id]/page.tsx           # shareable diagram view
/lib
  /analysis
    resolveAliases.ts           # tsconfig baseUrl/paths → resolver, Step 3
    extractImports.ts           # Step 3
    buildGraph.ts                # Step 4
    clusterByFolder.ts           # Step 5
    detectAnomalies.ts           # Step 6
    prepareRenderData.ts         # Step 7, elkjs layout
  /safety
    safeUnzip.ts                 # zip-slip + zip-bomb checks, Step 1
  /storage
    blob.ts                      # upload URLs + result persistence
/components
  UploadForm.tsx
  DiagramView.tsx                 # React Flow canvas, view toggle
  FileDetailPanel.tsx
  ProgressStream.tsx               # consumes SSE
/types
  graph.ts                        # shared TS types for the API contract above
```

## 7. Edge cases to explicitly handle

- Zip contains a nested top-level folder — detect and step into it automatically
- Zip entry paths attempt to escape the extraction directory — reject those entries, don't extract them
- Zip decompresses to an unreasonable size relative to its compressed size — abort extraction
- Repo has zero matching files — clear error, not a blank diagram
- A file fails to parse (syntax error) — skip, collect in `parseErrors`, don't crash the run
- Project has a `tsconfig.json` with `paths` but no `baseUrl` (or vice versa) — handle gracefully, default `baseUrl` to project root
- Monorepo with multiple `package.json`/`tsconfig.json` files — v1 still treats it as one big graph; note as a known limitation
- Import path resolves to a file outside the discovered file list (e.g. incorrectly matched inside `node_modules`) — validate resolution against the discovered file list only

## 8. Definition of done for this feature

- [ ] Upload a real personal JS/TS repo as a zip (via direct-to-Blob client upload) and get back a diagram within a few seconds, with progress shown while it runs
- [ ] A repo using `tsconfig.json` path aliases resolves those imports correctly, not as external packages
- [ ] Diagram shows folder-level clusters by default, drills into file-level on click, with working pan/zoom/drag
- [ ] At least one god-module and one orphan are correctly flagged on a real repo (verify manually)
- [ ] Circular dependency detection correctly finds a cycle you introduce on purpose as a test
- [ ] A zip with a path-traversal entry and an oversized decompressed payload are both safely rejected
- [ ] Layout overlap check runs after render and falls back to folder view when file view is too dense
- [ ] Clicking a node opens the file detail panel with correct import/importer lists
- [ ] The result has a working shareable `/repo/{id}` link that reloads the same diagram
- [ ] Deployed on Vercel with a working live URL

## 9. What NOT to build yet

- No auth, no user accounts (the shareable link is not access-controlled — treat it like a public gist)
- No relational database — Blob/KV for result persistence only, nothing else
- No RAG chat integration (reuse this graph data for that later)
- No GitHub URL cloning — zip upload only
- No Python/other-language support
- No AI-generated cluster labels yet — ship the deterministic version first
- No automatic community-detection clustering — folder-based only
- No dedicated worker service — only add one if real usage proves Vercel's function duration is the bottleneck
