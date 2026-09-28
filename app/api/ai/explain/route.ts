import { NextResponse } from "next/server";
import { assertGrounded } from "@/lib/ai";
import { buildExplainPrompt } from "@/lib/ai/explain";
import { generateAiResponse } from "@/lib/ai/provider";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 45;

type ExplainRequest = Readonly<{
  analysisId?: unknown;
  nodeId?: unknown;
}>;

export async function POST(request: Request) {
  let body: ExplainRequest;
  try {
    body = (await request.json()) as ExplainRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }
  if (typeof body.analysisId !== "string" || !body.analysisId.trim()) {
    return NextResponse.json({ error: "analysisId is required." }, { status: 400 });
  }
  if (body.nodeId !== undefined && typeof body.nodeId !== "string") {
    return NextResponse.json({ error: "nodeId must be a string when provided." }, { status: 400 });
  }

  const result = await getStorage().loadAnalysis(body.analysisId);
  if (!result) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });

  let explainPrompt;
  try {
    explainPrompt = buildExplainPrompt(result, body.nodeId as string | undefined);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid subject." }, { status: 404 });
  }

  try {
    // Grounding runs inside the provider chain so an ungrounded answer falls
    // through to the next provider instead of failing the request outright.
    const generated = await generateAiResponse(explainPrompt.prompt, {
      budgetMs: 40_000,
      validate: (response) => assertGrounded(response, explainPrompt.allowed),
    });
    return NextResponse.json({ ...generated.response, provider: generated.provider, model: generated.model });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI explanation failed." },
      { status: 502 },
    );
  }
}
