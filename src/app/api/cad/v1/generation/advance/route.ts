import { NextRequest, NextResponse } from "next/server";
import { POST as verifyAssemblyPost } from "@/app/api/cad/v1/assembly/verify/route";
import { advanceGenerationRun } from "@/lib/ai/advanceGenerationRun";
import type { GenerationTopologyRebindGate } from "@/lib/ai/advanceGenerationRun";
import { buildGenerationCanonicalResponse } from "@/lib/ai/generationCanonicalResponse";
import { buildAdaptiveComplexProductExecutionPlan } from "@/lib/ai/adaptiveComplexProductExecution";
import type { AiAssemblyProgram } from "@/lib/ai/aiAssemblyProgram";
import type { GenerationRunState } from "@/lib/ai/generationRunState";
import { getTrustedClientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { loadServerGenerationState, saveServerGenerationState } from "@/lib/ai/generationStateStore";
import { generationRequestOwner } from "@/lib/ai/generationRequestOwner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  state?: GenerationRunState;
  program?: AiAssemblyProgram;
  allowedDoF?: number;
  topologyRebind?: GenerationTopologyRebindGate;
};

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-generation-advance:${ip}`, 30, 60_000).allowed) {
    return NextResponse.json(
      {
        ok: false,
        code: "RATE_LIMIT",
        message: "Too many generation advancement requests",
      },
      { status: 429 },
    );
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  if (
    !body?.state ||
    body.state.schema !== "nexyfab.generation-run.v1" ||
    !body.program
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "state and program are required",
      },
      { status: 400 },
    );
  }
  if (
    body.allowedDoF !== undefined &&
    (!Number.isInteger(body.allowedDoF) || body.allowedDoF < 0)
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_ALLOWED_DOF",
        message: "allowedDoF must be a non-negative integer",
      },
      { status: 400 },
    );
  }
  try {
    const owner = await generationRequestOwner(req, ip);
    const stored = await loadServerGenerationState(owner, body.state.runId);
    if (stored.revision !== body.state.revision) throw new Error("GENERATION_REVISION_CONFLICT");
    const result = await advanceGenerationRun(
      stored,
      body.program,
      async (input) => {
        const verificationRequest = new NextRequest(
          new URL("/api/cad/v1/assembly/verify", req.url),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": ip,
            },
            body: JSON.stringify(input),
          },
        );
        const response = await verifyAssemblyPost(verificationRequest);
        return await response.json();
      },
      body.allowedDoF ?? 0,
      body.topologyRebind,
    );
    if (result.state.revision !== stored.revision) await saveServerGenerationState(owner, result.state, stored.revision);
    return NextResponse.json({
      ok: true,
      ...result,
      canonical: buildGenerationCanonicalResponse(result),
      executionPlan: buildAdaptiveComplexProductExecutionPlan(result.state),
      quoteOrRfqSideEffects: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation advancement failed";
    const status = message === "GENERATION_RUN_NOT_FOUND" ? 404 : message === "GENERATION_STATE_REDIS_REQUIRED" ? 503 : 409;
    return NextResponse.json(
      {
        ok: false,
        code: message.startsWith("GENERATION_") ? message : "ADVANCE_FAILED",
        message,
      },
      { status },
    );
  }
}
