import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["adm-zip", "typescript", "elkjs", "web-tree-sitter", "tree-sitter-wasms"],
  outputFileTracingIncludes: {
    "/api/analyze/**": [
      "./node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm",
      "./node_modules/tree-sitter-wasms/package.json",
    ],
  },
};

export default nextConfig;
