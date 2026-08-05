import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["adm-zip", "typescript", "elkjs", "web-tree-sitter", "tree-sitter-wasms"],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/tree-sitter-wasms/out/**/*.wasm",
      "./node_modules/tree-sitter-wasms/package.json",
      "./node_modules/web-tree-sitter/**/*.wasm"
    ],
  },
};

export default nextConfig;
