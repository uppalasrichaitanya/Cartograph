import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cartograph — Codebase architecture, verified",
  description: "Generate an interactive architecture diagram from a JavaScript, TypeScript, or Python repository.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
