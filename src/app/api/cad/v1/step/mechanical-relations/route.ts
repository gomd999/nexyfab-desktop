import { NextRequest, NextResponse } from "next/server";
import { getTrustedClientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { analyzeStepMechanicalRelations } from "@/lib/reference/stepMechanicalRelationEvidence";
import { boundedJsonError, readBoundedJson } from "@/lib/boundedJsonBody";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX = 20 * 1024 * 1024;
const MAX_BODY_BYTES = 24 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-step-mechanical:${ip}`, 20, 60_000).allowed)
    return NextResponse.json(
      { ok: false, code: "RATE_LIMIT" },
      { status: 429 },
    );
  let body: Record<string, unknown> | null;
  try {
    body = await readBoundedJson<Record<string, unknown>>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === "PAYLOAD_TOO_LARGE") {
      return NextResponse.json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    }
    body = null;
  }
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) =>
        !["step", "angularToleranceRad", "linearTolerance"].includes(key),
    ) ||
    typeof body.step !== "string" ||
    !body.step.trim()
  )
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST" },
      { status: 400 },
    );
  if (Buffer.byteLength(body.step, "utf8") > MAX)
    return NextResponse.json(
      { ok: false, code: "PAYLOAD_TOO_LARGE" },
      { status: 413 },
    );
  try {
    const evidence = analyzeStepMechanicalRelations(body.step, {
      ...(body.angularToleranceRad === undefined
        ? {}
        : { angularToleranceRad: Number(body.angularToleranceRad) }),
      ...(body.linearTolerance === undefined
        ? {}
        : { linearTolerance: Number(body.linearTolerance) }),
    });
    const analysisPassed =
        evidence.coaxialPairs.length > 0 ||
        evidence.pattern.status === "pass" ||
        evidence.weldment.status === "pass" ||
        evidence.sheetMetal.status === "pass";
    return NextResponse.json({
      ok: true,
      analysisPassed,
      releaseReady: false,
      releaseBlocker: "SIGNED_INDEPENDENT_RELEASE_EVIDENCE_REQUIRED",
      evidence,
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "STEP_MECHANICAL_RELATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
        quoteOrRfqSideEffects: false,
      },
      { status: 422 },
    );
  }
}
