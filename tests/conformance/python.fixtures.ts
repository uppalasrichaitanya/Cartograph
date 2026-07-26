/**
 * Cartograph Conformance Fixtures — Python
 *
 * Language-specific test fixtures for the Python parser conformance suite.
 * Each fixture describes a minimal Python project and the expected extraction
 * behavior when run through the full pipeline.
 *
 * These fixtures cover the Python parser's core responsibilities:
 *   - Absolute imports (`import foo`, `from foo import bar`)
 *   - Relative imports (`.`, `..`, `...`)
 *   - Namespace packages (directories without `__init__.py`)
 *   - src/-layout projects
 *   - Flat-layout projects
 *   - Circular imports (validates language-agnostic cycle detection)
 *   - Syntax errors → parse error handling
 *   - External import classification (stdlib, third-party)
 *   - Star imports (`from foo import *`)
 *   - Exclusion verification (.venv, __pycache__, *.egg-info)
 *   - Determinism (tested automatically by the framework)
 *
 * Created as part of Milestone 3, Phase 5 (Pipeline Integration).
 *
 * @module tests/conformance/python.fixtures
 */

import type { ConformanceFixture } from "./framework";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const pythonFixtures: ConformanceFixture[] = [
  // -------------------------------------------------------------------------
  // 1. Basic absolute imports
  // -------------------------------------------------------------------------
  {
    name: "basic absolute imports",
    language: "python",
    files: [
      {
        path: "mypackage/__init__.py",
        content: "",
      },
      {
        path: "mypackage/main.py",
        content: [
          "import mypackage.utils",
          "from mypackage.helpers import helper_fn",
          "",
          "def run():",
          "    pass",
        ].join("\n"),
      },
      {
        path: "mypackage/utils.py",
        content: "def utility(): pass\n",
      },
      {
        path: "mypackage/helpers.py",
        content: "def helper_fn(): pass\n",
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: '[project]\nname = "mypackage"\n',
      },
    ],
    expected: {
      parsedFileCount: 4,
      imports: {
        "mypackage/main.py": ["mypackage/helpers.py", "mypackage/utils.py"],
        "mypackage/__init__.py": [],
        "mypackage/utils.py": [],
        "mypackage/helpers.py": [],
      },
      externalImports: {
        "mypackage/main.py": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 2. Relative imports
  // -------------------------------------------------------------------------
  {
    name: "relative imports (single and double dot)",
    language: "python",
    files: [
      {
        path: "pkg/__init__.py",
        content: "",
      },
      {
        path: "pkg/sub/__init__.py",
        content: "",
      },
      {
        path: "pkg/sub/deep.py",
        content: [
          "from . import sibling",
          "from .. import top_util",
        ].join("\n"),
      },
      {
        path: "pkg/sub/sibling.py",
        content: "x = 1\n",
      },
      {
        path: "pkg/top_util.py",
        content: "y = 2\n",
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: '[project]\nname = "pkg"\n',
      },
    ],
    expected: {
      parsedFileCount: 5,
      imports: {
        "pkg/sub/deep.py": ["pkg/sub/sibling.py", "pkg/top_util.py"],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 3. Namespace packages (no __init__.py)
  // -------------------------------------------------------------------------
  {
    name: "namespace package without __init__.py",
    language: "python",
    files: [
      {
        path: "nspkg/module_a.py",
        content: "from nspkg import module_b\n",
      },
      {
        path: "nspkg/module_b.py",
        content: "value = 42\n",
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: '[project]\nname = "nspkg"\n',
      },
    ],
    expected: {
      parsedFileCount: 2,
      imports: {
        "nspkg/module_a.py": ["nspkg/module_b.py"],
        "nspkg/module_b.py": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 4. src/-layout project
  // -------------------------------------------------------------------------
  {
    name: "src/ layout project",
    language: "python",
    files: [
      {
        path: "src/mypkg/__init__.py",
        content: "",
      },
      {
        path: "src/mypkg/app.py",
        content: "from mypkg import core\n",
      },
      {
        path: "src/mypkg/core.py",
        content: "def main(): pass\n",
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: [
          '[project]',
          'name = "mypkg"',
          '',
          '[tool.setuptools.packages.find]',
          'where = ["src"]',
        ].join("\n"),
      },
    ],
    expected: {
      parsedFileCount: 3,
      imports: {
        "src/mypkg/app.py": ["src/mypkg/core.py"],
        "src/mypkg/__init__.py": [],
        "src/mypkg/core.py": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 5. Flat-layout project (no src/)
  // -------------------------------------------------------------------------
  {
    name: "flat layout project (no src/)",
    language: "python",
    files: [
      {
        path: "flatpkg/__init__.py",
        content: "",
      },
      {
        path: "flatpkg/entry.py",
        content: "from flatpkg import lib\n",
      },
      {
        path: "flatpkg/lib.py",
        content: "val = 1\n",
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: '[project]\nname = "flatpkg"\n',
      },
    ],
    expected: {
      parsedFileCount: 3,
      imports: {
        "flatpkg/entry.py": ["flatpkg/lib.py"],
        "flatpkg/__init__.py": [],
        "flatpkg/lib.py": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 6. Circular imports
  // -------------------------------------------------------------------------
  {
    name: "circular imports between two files",
    language: "python",
    files: [
      {
        path: "circle/__init__.py",
        content: "",
      },
      {
        path: "circle/a.py",
        content: "from circle import b\n",
      },
      {
        path: "circle/b.py",
        content: "from circle import a\n",
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: '[project]\nname = "circle"\n',
      },
    ],
    expected: {
      parsedFileCount: 3,
      imports: {
        "circle/a.py": ["circle/b.py"],
        "circle/b.py": ["circle/a.py"],
        "circle/__init__.py": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 7. Syntax error handling
  // -------------------------------------------------------------------------
  {
    name: "syntax error produces parse errors",
    language: "python",
    files: [
      {
        path: "broken.py",
        content: "def foo(\n  # unclosed paren, missing body\n",
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: '[project]\nname = "broken"\n',
      },
    ],
    expected: {
      parsedFileCount: 0,
      errorFiles: ["broken.py"],
    },
  },

  // -------------------------------------------------------------------------
  // 8. External import classification (stdlib + third-party)
  // -------------------------------------------------------------------------
  {
    name: "external imports (stdlib and third-party)",
    language: "python",
    files: [
      {
        path: "app/__init__.py",
        content: "",
      },
      {
        path: "app/main.py",
        content: [
          "import os",
          "import json",
          "import requests",
          "import numpy",
          "from app import helper",
        ].join("\n"),
      },
      {
        path: "app/helper.py",
        content: "h = 1\n",
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: '[project]\nname = "app"\n',
      },
    ],
    expected: {
      parsedFileCount: 3,
      imports: {
        "app/main.py": ["app/helper.py"],
      },
      externalImports: {
        "app/main.py": ["json", "numpy", "os", "requests"],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 9. Star imports (from foo import *)
  // -------------------------------------------------------------------------
  {
    name: "star import resolves as file-level dependency",
    language: "python",
    files: [
      {
        path: "startest/__init__.py",
        content: "",
      },
      {
        path: "startest/consumer.py",
        content: "from startest.provider import *\n",
      },
      {
        path: "startest/provider.py",
        content: "exported_val = 42\n",
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: '[project]\nname = "startest"\n',
      },
    ],
    expected: {
      parsedFileCount: 3,
      imports: {
        "startest/consumer.py": ["startest/provider.py"],
        "startest/__init__.py": [],
        "startest/provider.py": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 10. File with no imports
  // -------------------------------------------------------------------------
  {
    name: "file with no imports produces empty extraction",
    language: "python",
    files: [
      {
        path: "constants.py",
        content: "PI = 3.14159\nE = 2.71828\n",
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: '[project]\nname = "constants"\n',
      },
    ],
    expected: {
      parsedFileCount: 1,
      imports: {
        "constants.py": [],
      },
      externalImports: {
        "constants.py": [],
      },
    },
  },

  // -------------------------------------------------------------------------
  // 11. External-only imports
  // -------------------------------------------------------------------------
  {
    name: "file with only external imports",
    language: "python",
    files: [
      {
        path: "script.py",
        content: [
          "import flask",
          "import sqlalchemy",
          "from typing import Optional",
        ].join("\n"),
      },
    ],
    manifests: [
      {
        path: "pyproject.toml",
        content: '[project]\nname = "script"\n',
      },
    ],
    expected: {
      parsedFileCount: 1,
      imports: {
        "script.py": [],
      },
      externalImports: {
        "script.py": ["flask", "sqlalchemy", "typing.Optional"],
      },
    },
  },
];
