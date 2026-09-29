import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["adm-zip", "typescript", "elkjs", "web-tree-sitter", "tree-sitter-wasms"],
  outputFileTracingIncludes: {
    "/api/analyze/**": [
      "./node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm",
      "./node_modules/tree-sitter-wasms/out/tree-sitter-go.wasm",
      "./node_modules/tree-sitter-wasms/package.json",
    ],
    "/api/diagram/**": [
      "./node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
      "./node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2",
      "./node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
      "./node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-italic.woff2",
    ],
  },
};

export default nextConfig;
