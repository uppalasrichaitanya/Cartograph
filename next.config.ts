import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["adm-zip", "typescript", "elkjs", "web-tree-sitter", "tree-sitter-wasms"],
};

export default nextConfig;
