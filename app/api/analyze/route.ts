import { NextResponse } from "next/server";
import { analyzeRepository } from "@/lib/analysis/analyzeRepository";
import { BlobValidationError } from "@/lib/storage/blob";
import { DiscoveryError } from "@/lib/analysis/discoverFiles";
import { UnsafeZipError } from "@/lib/safety/safeUnzip";

export const runtime = "nodejs";
// Valid for Vercel's Fluid Compute default and leaves room for large, legitimate repositories.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { blobUrl?: unknown };
    if (typeof body.blobUrl !== "string") {
      return NextResponse.json({ error: "blobUrl is required." }, { status: 400 });
    }
    const result = await analyzeRepository(body.blobUrl);
    return NextResponse.json(result);
  } catch (error) {
    const expected = error instanceof BlobValidationError || error instanceof DiscoveryError || error instanceof UnsafeZipError;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed." },
      { status: expected ? 400 : 500 },
    );
  }
}
