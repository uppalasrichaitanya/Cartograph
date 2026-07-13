import { NextResponse } from "next/server";
import { analyzeRepository } from "@/lib/analysis/analyzeRepository";
import { StorageError } from "@/lib/storage/local";
import { DiscoveryError } from "@/lib/analysis/discoverFiles";
import { UnsafeZipError } from "@/lib/safety/safeUnzip";

export const runtime = "nodejs";
// Valid for Vercel's Fluid Compute default and leaves room for large, legitimate repositories.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { zipPath?: unknown };
    if (typeof body.zipPath !== "string") {
      return NextResponse.json({ error: "zipPath is required." }, { status: 400 });
    }
    const result = await analyzeRepository(body.zipPath);
    return NextResponse.json(result);
  } catch (error) {
    const expected = error instanceof StorageError || error instanceof DiscoveryError || error instanceof UnsafeZipError;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed." },
      { status: expected ? 400 : 500 },
    );
  }
}
