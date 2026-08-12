import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { UNIQUE_UPLOAD_TOKEN_OPTIONS } from "@/lib/storage/uploadPathname";

export const runtime = "nodejs";

/**
 * Vercel Blob client-upload token exchange.
 *
 * The browser sends the file directly to Vercel Blob storage using
 * a short-lived token obtained from this endpoint. This avoids
 * passing the full zip through a Serverless Function (which has a
 * 4.5 MB body limit on Vercel).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Validate that only zip files are uploaded.
        if (!pathname.toLowerCase().endsWith(".zip")) {
          throw new Error("Only .zip uploads are allowed.");
        }
        return {
          allowedContentTypes: [
            "application/zip",
            "application/x-zip-compressed",
            "application/octet-stream",
          ],
          maximumSizeInBytes: 25 * 1024 * 1024, // 25 MB
          // Every upload must land on its own pathname. The pathname comes
          // from the browser, so the token — not the client — is what
          // guarantees it: without a random suffix, re-uploading the same
          // project reuses one Blob URL, and the cleanup that follows an
          // analysis then deletes another request's archive.
          ...UNIQUE_UPLOAD_TOKEN_OPTIONS,
        };
      },
      onUploadCompleted: async () => {
        // No post-upload processing needed; the analysis stream
        // endpoint handles everything.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
