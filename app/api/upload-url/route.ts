import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/blob";

export const runtime = "nodejs";

/**
 * Vercel Blob's client SDK posts here to exchange a short-lived upload token.
 * The browser then sends the zip directly to Blob, never through this function.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("uploads/")) throw new Error("Invalid upload destination.");
        if (!pathname.toLowerCase().endsWith(".zip")) throw new Error("Only .zip uploads are allowed.");
        return {
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          allowedContentTypes: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
        };
      },
      onUploadCompleted: async () => {
        // The client receives the Blob URL directly. Analysis is deliberately started only by the client.
      },
    });
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to authorize the upload." },
      { status: 400 },
    );
  }
}
