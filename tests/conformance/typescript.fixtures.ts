/**
 * Cartograph Conformance Fixtures — TypeScript/JavaScript
 *
 * Language-specific test fixtures for the TypeScript parser conformance
 * suite. Each fixture describes a minimal project and the expected
 * extraction behavior.
 *
 * These fixtures cover the TS parser's core responsibilities:
 *   - Static import/export extraction
 *   - Path alias resolution (tsconfig paths)
 *   - Re-exports and barrel files
 *   - Index file resolution (directory imports)
 *   - Syntax errors → parse error with line/column
 *   - Mixed TS/JS projects
 *   - JSX support (.tsx)
 *   - Empty files (no imports)
 *   - Circular imports
 *   - Deduplication of specifiers
 *
 * Adding a fixture: add a new ConformanceFixture object to the
 * typescriptFixtures array. The conformance framework will automatically
 * run it through the full pipeline and assert the expectations.
 *
 * @module tests/conformance/typescript.fixtures
 */

import type { ConformanceFixture } from "./framework";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const typescriptFixtures: ConformanceFixture[] = [
  // -------------------------------------------------------------------------
  // 1. Simple import/export
  // -------------------------------------------------------------------------
  {
    name: "simple import and export",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: [
          'import { helper } from "./lib/helper";',
          "",
          "export const main = () => helper();",
        ].join("\n"),
      },
      {
        path: "src/lib/helper.ts",
        content: "export const helper = () => 42;\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "src/entry.ts": ["src/lib/helper.ts"],
        "src/lib/helper.ts": [],
      },
      externalImports: {
        "src/entry.ts": [],
        "src/lib/helper.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 2. Path alias resolution (@/ aliases via tsconfig)
  // -------------------------------------------------------------------------
  {
    name: "path alias resolution (@/ via tsconfig)",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: 'import { helper } from "@/lib/helper";\n',
      },
      {
        path: "src/lib/helper.ts",
        content: "export const helper = 1;\n",
      },
    ],
    manifests: [
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
        }),
      },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "src/entry.ts": ["src/lib/helper.ts"],
        "src/lib/helper.ts": [],
      },
      externalImports: {
        "src/entry.ts": [],
        "src/lib/helper.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 3. Re-exports
  // -------------------------------------------------------------------------
  {
    name: "re-exports are captured as imports",
    language: "typescript",
    files: [
      {
        path: "src/barrel.ts",
        content: [
          'export { helper } from "./lib/helper";',
          'export * from "./lib/utils";',
        ].join("\n"),
      },
      {
        path: "src/lib/helper.ts",
        content: "export const helper = 1;\n",
      },
      {
        path: "src/lib/utils.ts",
        content: "export const utils = 2;\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 3,
      imports: {
        "src/barrel.ts": ["src/lib/helper.ts", "src/lib/utils.ts"],
        "src/lib/helper.ts": [],
        "src/lib/utils.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 4. Barrel files (index.ts) — directory imports
  // -------------------------------------------------------------------------
  {
    name: "barrel file / index.ts resolution",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: 'import { helper } from "./lib";\n',
      },
      {
        path: "src/lib/index.ts",
        content: 'export { helper } from "./helper";\n',
      },
      {
        path: "src/lib/helper.ts",
        content: "export const helper = 1;\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 3,
      imports: {
        "src/entry.ts": ["src/lib/index.ts"],
        "src/lib/index.ts": ["src/lib/helper.ts"],
        "src/lib/helper.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 5. Syntax errors → parse error with structured diagnostics
  // -------------------------------------------------------------------------
  {
    name: "syntax error produces parse errors",
    language: "typescript",
    files: [
      {
        path: "broken.ts",
        content: "export const fn = (: string) => {};\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 0,
      errorFiles: ["broken.ts"],
    },
  },

  // -------------------------------------------------------------------------
  // 6. Mixed TS/JS project
  // -------------------------------------------------------------------------
  {
    name: "mixed TypeScript and JavaScript files",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: 'import { util } from "./util";\n',
      },
      {
        path: "src/util.js",
        content: 'import path from "path";\nexport const util = () => path.resolve(".");\n',
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "src/entry.ts": ["src/util.js"],
        "src/util.js": [],
      },
      externalImports: {
        "src/entry.ts": [],
        "src/util.js": ["path"],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 7. .tsx file with JSX
  // -------------------------------------------------------------------------
  {
    name: ".tsx file with JSX syntax",
    language: "typescript",
    files: [
      {
        path: "components/App.tsx",
        content: [
          'import React from "react";',
          'import { Header } from "./Header";',
          "",
          "export const App = () => <Header />;",
        ].join("\n"),
      },
      {
        path: "components/Header.tsx",
        content: [
          'import React from "react";',
          "",
          "export const Header = () => <h1>Hello</h1>;",
        ].join("\n"),
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "components/App.tsx": ["components/Header.tsx"],
        "components/Header.tsx": [],
      },
      externalImports: {
        "components/App.tsx": ["react"],
        "components/Header.tsx": ["react"],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 8. File with no imports (valid empty extraction)
  // -------------------------------------------------------------------------
  {
    name: "file with no imports produces empty extraction",
    language: "typescript",
    files: [
      {
        path: "src/constants.ts",
        content: "export const PI = 3.14159;\nexport const E = 2.71828;\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 1,
      imports: {
        "src/constants.ts": [],
      },
      externalImports: {
        "src/constants.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 9. Circular imports
  // -------------------------------------------------------------------------
  {
    name: "circular imports between two files",
    language: "typescript",
    files: [
      {
        path: "src/a.ts",
        content: 'import { b } from "./b";\nexport const a = () => b();\n',
      },
      {
        path: "src/b.ts",
        content: 'import { a } from "./a";\nexport const b = () => a();\n',
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "src/a.ts": ["src/b.ts"],
        "src/b.ts": ["src/a.ts"],
      },
      externalImports: {
        "src/a.ts": [],
        "src/b.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 10. Specifier deduplication
  // -------------------------------------------------------------------------
  {
    name: "duplicate specifiers are deduplicated",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: [
          'import { a } from "./lib/helper";',
          'import { b } from "./lib/helper";',
          'export { c } from "./lib/helper";',
        ].join("\n"),
      },
      {
        path: "src/lib/helper.ts",
        content: "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        // Deduplication: "./lib/helper" appears only once in the resolved list
        "src/entry.ts": ["src/lib/helper.ts"],
        "src/lib/helper.ts": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 11. External-only imports
  // -------------------------------------------------------------------------
  {
    name: "file with only external imports",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: [
          'import React from "react";',
          'import express from "express";',
          'import { z } from "zod";',
          "",
          "export const app = express();",
        ].join("\n"),
      },
    ],
    manifests: [
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 1,
      imports: {
        "src/entry.ts": [],
      },
      externalImports: {
        "src/entry.ts": ["express", "react", "zod"],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 12. CommonJS require() — every static form, dynamic forms ignored
  // -------------------------------------------------------------------------
  {
    name: "CommonJS require() calls become edges; dynamic ones do not",
    language: "typescript",
    files: [
      {
        path: "lib/app.js",
        content: [
          "const a = require('./a');",
          "const { b } = require('./b');",
          "const [c] = require('./c.js');",
          "module.exports = require('./d');",
          "require('./side-effect');",
          "const fs = require('node:fs');",
          "const lodash = require(`lodash`);",
          "const name = './zzz';",
          "const dyn = require(name);",
          "const tpl = require(`./tpl-${name}`);",
          "const joined = require('./x' + name);",
          "const resolved = require.resolve('./not-an-edge');",
          "const missing = require('./missing');",
        ].join("\n"),
      },
      { path: "lib/a.js", content: "module.exports = 1;\n" },
      { path: "lib/b.js", content: "exports.b = 1;\n" },
      { path: "lib/c.js", content: "module.exports = [1];\n" },
      { path: "lib/d/index.js", content: "module.exports = 4;\n" },
      { path: "lib/side-effect.js", content: "global.x = 1;\n" },
      { path: "lib/not-an-edge.js", content: "module.exports = 0;\n" },
    ],
    manifests: [{ path: "package.json", content: '{ "name": "test" }' }],
    expected: {
      parsedFileCount: 7,
      imports: {
        "lib/app.js": [
          "lib/a.js",
          "lib/b.js",
          "lib/c.js",
          "lib/d/index.js",
          "lib/side-effect.js",
        ],
      },
      externalImports: { "lib/app.js": ["lodash", "node:fs"] },
      unresolvedInternalImports: { "lib/app.js": ["./missing"] },
    },
  },

  // -------------------------------------------------------------------------
  // 13. import = require, export-from forms, and .cjs/.mjs/.mts files
  // -------------------------------------------------------------------------
  {
    name: "import = require, export * from, export {x} from, and CJS/ESM extensions",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: [
          "import a = require('./a');",
          "export * from './b';",
          "export { c } from './c';",
          "export * as d from './d';",
          "import './e.mjs';",
          "const f = require('./f.cjs');",
          "import g from './g';",
          "export { a, f, g };",
        ].join("\n"),
      },
      { path: "src/a.ts", content: "export = 1;\n" },
      { path: "src/b.ts", content: "export const b = 1;\n" },
      { path: "src/c.ts", content: "export const c = 1;\n" },
      { path: "src/d.ts", content: "export const d = 1;\n" },
      { path: "src/e.mjs", content: "export const e = 1;\n" },
      { path: "src/f.cjs", content: "module.exports = 1;\n" },
      { path: "src/g.mts", content: "export default 1;\n" },
    ],
    manifests: [{ path: "package.json", content: '{ "name": "test" }' }],
    expected: {
      parsedFileCount: 8,
      imports: {
        "src/entry.ts": [
          "src/a.ts",
          "src/b.ts",
          "src/c.ts",
          "src/d.ts",
          "src/e.mjs",
          "src/f.cjs",
          "src/g.mts",
        ],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 14. TypeScript ESM: './x.js' specifiers name x.ts (NodeNext / Bundler)
  // -------------------------------------------------------------------------
  {
    name: "'.js' specifiers resolve to .ts/.tsx/.mts/.cts sources only when the literal file is missing",
    language: "typescript",
    files: [
      {
        path: "src/entry.ts",
        content: [
          "import './a.js';",
          "import './b.js';",
          "import './c.jsx';",
          "import './d.mjs';",
          "import './e.cjs';",
          "import './both.js';",
          "import './nothing.js';",
        ].join("\n"),
      },
      { path: "src/a.ts", content: "export const a = 1;\n" },
      { path: "src/b.tsx", content: "export const b = 1;\n" },
      { path: "src/c.tsx", content: "export const c = 1;\n" },
      { path: "src/d.mts", content: "export const d = 1;\n" },
      { path: "src/e.cts", content: "export const e = 1;\n" },
      { path: "src/both.js", content: "export const both = 1;\n" },
      { path: "src/both.ts", content: "export const both = 2;\n" },
    ],
    manifests: [{ path: "package.json", content: '{ "name": "test" }' }],
    expected: {
      parsedFileCount: 8,
      imports: {
        "src/entry.ts": [
          "src/a.ts",
          "src/b.tsx",
          "src/c.tsx",
          "src/d.mts",
          "src/e.cts",
          "src/both.js",
        ],
      },
      unresolvedInternalImports: { "src/entry.ts": ["./nothing.js"] },
    },
  },

  // -------------------------------------------------------------------------
  // 15. tsconfig paths combined with the '.js' -> '.ts' substitution
  // -------------------------------------------------------------------------
  {
    name: "tsconfig paths alias with a .js specifier resolves to the .ts source",
    language: "typescript",
    files: [
      { path: "src/entry.ts", content: "import '@/lib/helper.js';\n" },
      { path: "src/lib/helper.ts", content: "export const helper = 1;\n" },
    ],
    manifests: [
      {
        path: "tsconfig.json",
        content: JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
      },
      { path: "package.json", content: '{ "name": "test" }' },
    ],
    expected: {
      parsedFileCount: 2,
      imports: { "src/entry.ts": ["src/lib/helper.ts"] },
    },
  },
];
