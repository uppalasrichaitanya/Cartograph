import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/local";

export const runtime = "nodejs";

/**
 * Accepts a multipart/form-data upload containing a single .zip file.
 * Saves it to os.tmpdir() and returns the temporary file path so the
 * analysis stream endpoint can pick it up.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "A file is required." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "Only .zip uploads are allowed." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "The zip is larger than the 25 MB limit." }, { status: 400 });
    }

    const uploadDir = path.join(tmpdir(), "cartograph-uploads");
    await mkdir(uploadDir, { recursive: true });

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
    const tempPath = path.join(uploadDir, `${randomUUID()}-${safeName}`);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempPath, buffer);

    return NextResponse.json({ tempPath });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 500 },
    );
  }
}
