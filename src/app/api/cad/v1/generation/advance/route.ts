import { NextRequest, NextResponse } from "next/server";
import { POST as verifyAssemblyPost } from "@/app/api/cad/v1/assembly/verify/route";
import { advanceGenerationRun } from "@/lib/ai/advanceGenerationRun";
import { prepareGenerationTopologyLineage, refreshGenerationTopologyLineage, resolveGenerationTopologyRebind, validateGenerationTopologyRebindConfirmation, type AssemblyVerificationResult, type GenerationAdvanceResult } from "@/lib/ai/advanceGenerationRun";
import { parseGenerationTopologyLineageEvidence } from "@/lib/ai/generationTopologyLineage";
import { buildGenerationCanonicalResponse } from "@/lib/ai/generationCanonicalResponse";
import { bindAdaptiveComplexProductExecutionPlan, buildAdaptiveComplexProductExecutionPlan } from "@/lib/ai/adaptiveComplexProductExecution";
import type { AiAssemblyProgram } from "@/lib/ai/aiAssemblyProgram";
import { bindGenerationProgram, findGenerationAdvanceReplay, recordGenerationAdvanceReplay, type GenerationRunState } from "@/lib/ai/generationRunState";
import { serverEvidenceSha256 } from "@/lib/ai/serverEvidence";
import { getTrustedClientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { loadServerGenerationState, saveServerGenerationState } from "@/lib/ai/generationStateStore";
import { generationRequestOwner } from "@/lib/ai/generationRequestOwner";
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { loadCommercialGenerationRouteRun, saveCommercialGenerationRouteRun, type LoadedCommercialGenerationRun } from '@/lib/ai/commercialGenerationRouteState';
import { commercialPostgresMigrationAtLeast } from '@/lib/commercial-readiness';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  projectId?: string;
  idempotencyKey?: string;
  state?: GenerationRunState;
  program?: AiAssemblyProgram;
  allowedDoF?: number;
  /** Browser may send acknowledgements only; readiness/blockers are derived. */
  topologyRebind?: unknown;
  commercialReceipt?: unknown;
  registry?: unknown;
  clock?: unknown;
  mode?: unknown;
  rawReceiptBytes?: unknown;
};

const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function idempotencyKeyFor(req: NextRequest, body: Body): string {
  const rawHeader = req.headers.get('idempotency-key');
  if (rawHeader !== null && !rawHeader.trim()) throw new Error('GENERATION_IDEMPOTENCY_KEY_INVALID');
  const header = rawHeader?.trim() || undefined;
  if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim())) throw new Error('GENERATION_IDEMPOTENCY_KEY_INVALID');
  const bodyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
  if (header && bodyKey && header !== bodyKey) throw new Error('GENERATION_IDEMPOTENCY_KEY_CONFLICT');
  const supplied = bodyKey ?? header;
  // Existing clients predate the header.  A deterministic server-owned key
  // keeps those retries idempotent while still separating each source
  // revision; callers that need a stable cross-process key may provide one.
  const key = supplied ?? `generation:${serverEvidenceSha256({ runId: body.state?.runId ?? '', revision: body.state?.revision ?? -1 }).slice(0, 48)}`;
  if (!SAFE_IDEMPOTENCY_KEY.test(key)) throw new Error('GENERATION_IDEMPOTENCY_KEY_INVALID');
  return key;
}

function requestSha256(body: Body, confirmedIds: readonly string[]): string {
  return serverEvidenceSha256({
    schema: 'nexyfab.generation-advance-request.v1',
    runId: body.state!.runId,
    baseRevision: body.state!.revision,
    program: body.program,
    allowedDoF: body.allowedDoF ?? 0,
    // Derived readiness/blocker fields are intentionally not part of the
    // caller-controlled request identity.
    topologyConfirmation: [...confirmedIds],
  });
}

function responseFor(result: GenerationAdvanceResult, replayed = false): NextResponse {
  return NextResponse.json({
    ok: true,
    ...(replayed ? { replayed: true } : {}),
    ...result,
    canonical: buildGenerationCanonicalResponse(result),
    executionPlan: bindAdaptiveComplexProductExecutionPlan(buildAdaptiveComplexProductExecutionPlan(result.state), result.state, result.state.projectId),
    quoteOrRfqSideEffects: false,
  });
}

function replayResult(state: GenerationRunState, replay: NonNullable<ReturnType<typeof findGenerationAdvanceReplay>>): GenerationAdvanceResult {
  const stoppedAt: GenerationAdvanceResult['stoppedAt'] = ['kernel', 'topology', 'assembly_solve', 'motion'].includes(replay.stoppedAt)
    ? replay.stoppedAt as GenerationAdvanceResult['stoppedAt']
    : 'motion';
  const assemblyVerification = (replay.assemblyVerification ?? state.checkpointOutputs?.assembly_solve) as AssemblyVerificationResult | undefined;
  const commercialReceiptVerification = replay.commercialReceiptVerification as GenerationAdvanceResult['commercialReceiptVerification'];
  return {
    state,
    stoppedAt,
    commercialReleaseReady: replay.commercialReleaseReady,
    ...(replay.topologyEvidenceSource ? { topologyEvidenceSource: replay.topologyEvidenceSource } : {}),
    ...(assemblyVerification ? { assemblyVerification } : {}),
    ...(commercialReceiptVerification ? { commercialReceiptVerification } : {}),
  };
}

function assertReplayMatches(
  replay: NonNullable<ReturnType<typeof findGenerationAdvanceReplay>>,
  requestHash: string,
  baseRevision: number,
): void {
  if (replay.requestSha256 !== requestHash || replay.baseRevision !== baseRevision) throw new Error('GENERATION_ADVANCE_IDEMPOTENCY_CONFLICT');
}

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
  let body: Body | null;
  try { body = await readBoundedJson<Body>(req, 16 * 1024 * 1024); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded) return NextResponse.json({ ok: false, code: bounded.code }, { status: bounded.status }); throw error; }
  if (body && (body.commercialReceipt !== undefined || body.registry !== undefined || body.clock !== undefined || body.mode !== undefined || body.rawReceiptBytes !== undefined)) return NextResponse.json({ ok: false, code: 'COMMERCIAL_RECEIPT_SERVER_ONLY', status: 'HOLD', releaseReady: false }, { status: 400 });
  if (process.env.NEXYFAB_COMMERCIAL_MODE === '1' && !commercialPostgresMigrationAtLeast(process.env, 2026082208)) return NextResponse.json({ ok: false, code: 'COMMERCIAL_GENERATION_MIGRATION_REQUIRED', status: 'HOLD', releaseReady: false }, { status: 503 });
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
  const topologyValue = body.topologyRebind;
  const topologyIssues = validateGenerationTopologyRebindConfirmation(topologyValue);
  if (topologyIssues.length) {
    return NextResponse.json(
      {
        ok: false,
        code: topologyIssues.includes('TOPOLOGY_REBIND_GATE_REQUIRED')
          ? 'TOPOLOGY_REBIND_GATE_REQUIRED'
          : topologyIssues[0] === 'TOPOLOGY_CLIENT_DERIVED_FIELDS_FORBIDDEN'
            ? 'TOPOLOGY_CLIENT_DERIVED_FIELDS_FORBIDDEN'
            : 'TOPOLOGY_REBIND_GATE_INVALID',
        issues: topologyIssues,
      },
      { status: 400 },
    );
  }
  const confirmedIds = Array.isArray((topologyValue as Record<string, unknown>).confirmedIds)
    ? [...(topologyValue as { confirmedIds: string[] }).confirmedIds].sort()
    : [];
  let idempotencyKey: string;
  try { idempotencyKey = idempotencyKeyFor(req, body); }
  catch (error) {
    const code = error instanceof Error ? error.message : 'GENERATION_IDEMPOTENCY_KEY_INVALID';
    return NextResponse.json({ ok: false, code, message: code }, { status: 400 });
  }
  let advanceRequestSha256: string;
  try { advanceRequestSha256 = requestSha256(body, confirmedIds); }
  catch { return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'Advance request contains unsupported evidence.' }, { status: 400 }); }
  try {
    const commercial = process.env.NEXYFAB_COMMERCIAL_MODE === '1';
    const owner = commercial ? '' : await generationRequestOwner(req, ip);
    let commercialCurrent: LoadedCommercialGenerationRun | undefined = commercial ? await loadCommercialGenerationRouteRun(req, body.projectId ?? '', body.state.runId) : undefined;
    let stored = commercialCurrent?.state ?? await loadServerGenerationState(owner, body.state.runId);
    const priorReplay = findGenerationAdvanceReplay(stored, idempotencyKey);
    if (priorReplay) {
      assertReplayMatches(priorReplay, advanceRequestSha256, body.state.revision);
      return responseFor(replayResult(stored, priorReplay), true);
    }
    if (stored.revision !== body.state.revision) throw new Error("GENERATION_REVISION_CONFLICT");
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1' && !stored.evidenceBindings?.intentSnapshotSha256) throw new Error('GENERATION_INTENT_BINDING_MISSING');
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1' && !stored.evidenceBindings?.programSha256) throw new Error('GENERATION_PROGRAM_BINDING_MISSING');
    if (commercial && stored.evidenceBindings?.programSha256 !== serverEvidenceSha256(body.program)) throw new Error('GENERATION_PROGRAM_BINDING_MISMATCH');
    const existingLineage = parseGenerationTopologyLineageEvidence(stored, body.program, serverEvidenceSha256(body.program), stored.checkpointOutputs?.topology);
    if (commercial && !existingLineage) {
      const prepared = await prepareGenerationTopologyLineage(stored, body.program);
      if (prepared.state.revision !== stored.revision) {
        if (commercialCurrent) commercialCurrent = await saveCommercialGenerationRouteRun(commercialCurrent, prepared.state);
        else await saveServerGenerationState(owner, prepared.state, stored.revision);
        stored = prepared.state;
      }
      if (prepared.status === 'baseline-recorded') {
        return NextResponse.json({ ok: false, code: 'GENERATION_TOPOLOGY_HISTORY_REQUIRED', message: 'Server topology history baseline recorded; retry advancement with the returned state.', status: 'HOLD', releaseReady: false, state: stored }, { status: 503 });
      }
      if (prepared.status === 'unavailable' || !prepared.lineage) {
        return NextResponse.json({ ok: false, code: 'GENERATION_TOPOLOGY_SERVER_EVIDENCE_REQUIRED', message: 'Exact server topology evidence is unavailable.', status: 'HOLD', releaseReady: false, state: stored }, { status: 503 });
      }
    }
    const topology = resolveGenerationTopologyRebind(stored, body.program, { confirmedIds }, {
      commercial,
      serverEvidenceSha256,
    });
    // A bound checkpoint is server evidence.  Without one, noncommercial
    // execution remains preview-local and never acquires a commercial bind.
    const bound = topology.source === 'server-checkpoint'
      ? bindGenerationProgram(stored, topology.programSha256)
      : stored;
    const result = await advanceGenerationRun(
      bound,
      topology.program,
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
      topology.gate,
    );
    result.topologyEvidenceSource = topology.source;
    // Record the replay first: this is the final CAS revision.  The topology
    // sidecar must be rebound to that exact revision, otherwise a successful
    // response persists evidence one revision behind and cannot be parsed on
    // the next request/replay.
    let committedCandidate = recordGenerationAdvanceReplay(result.state, {
      idempotencyKey,
      requestSha256: advanceRequestSha256,
      baseRevision: body.state.revision,
      resultRevision: result.state.revision + 1,
      stoppedAt: result.stoppedAt,
      commercialReleaseReady: result.commercialReleaseReady,
      topologyEvidenceSource: result.topologyEvidenceSource,
      ...(result.assemblyVerification ? { assemblyVerification: result.assemblyVerification } : {}),
      ...(result.commercialReceiptVerification ? { commercialReceiptVerification: result.commercialReceiptVerification } : {}),
    });
    if (topology.lineage && committedCandidate.stages.kernel.status === 'passed' && committedCandidate.stages.topology.status === 'passed') {
      committedCandidate = refreshGenerationTopologyLineage(committedCandidate, topology.program, topology.lineage);
    }
    let committedState: GenerationRunState;
    try {
      if (commercialCurrent) committedState = (await saveCommercialGenerationRouteRun(commercialCurrent, committedCandidate)).state;
      else committedState = await saveServerGenerationState(owner, committedCandidate, stored.revision);
    } catch (error) {
      // A concurrent identical request may win the CAS while this request is
      // still running exact geometry.  Read the winner and replay it rather
      // than turning a successful operation into a misleading stale error.
      if (error instanceof Error && error.message === 'GENERATION_REVISION_CONFLICT') {
        const latest = commercial
          ? (await loadCommercialGenerationRouteRun(req, body.projectId ?? '', body.state.runId)).state
          : await loadServerGenerationState(owner, body.state.runId);
        const racedReplay = findGenerationAdvanceReplay(latest, idempotencyKey);
        if (racedReplay) {
          assertReplayMatches(racedReplay, advanceRequestSha256, body.state.revision);
          return responseFor(replayResult(latest, racedReplay), true);
        }
      }
      throw error;
    }
    return responseFor({ ...result, state: committedState });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation advancement failed";
    const hold = message === 'GENERATION_TOPOLOGY_SERVER_EVIDENCE_REQUIRED' ||
      message === 'GENERATION_TOPOLOGY_HISTORY_REQUIRED' ||
      message === 'GENERATION_TOPOLOGY_HISTORY_STALE' ||
      message === 'GENERATION_TOPOLOGY_HISTORY_INVALID' ||
      message === 'GENERATION_TOPOLOGY_EVIDENCE_INVALID' ||
      message === 'GENERATION_PROGRAM_EVIDENCE_INVALID' ||
      message === 'GENERATION_PROGRAM_BINDING_MISSING' ||
      message === 'GENERATION_INTENT_BINDING_MISSING';
    const status = message === "GENERATION_RUN_NOT_FOUND" ? 404 : message === "GENERATION_STATE_REDIS_REQUIRED" || message === 'GENERATION_STATE_POSTGRES_AUTHORITATIVE_REQUIRED' || hold ? 503 : 409;
    return NextResponse.json(
      {
        ok: false,
        code: message.startsWith("GENERATION_") || message.startsWith("TOPOLOGY_") ? message : "ADVANCE_FAILED",
        message,
        ...(hold ? { status: 'HOLD', releaseReady: false } : {}),
      },
      { status },
    );
  }
}
