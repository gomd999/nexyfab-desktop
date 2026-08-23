import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { toIsoLang } from '@/lib/i18n/normalize';
import { architectureInteriorAiStatusCopy } from '@/lib/ai/architectureInteriorAiStatusCopy';
import { makeRemoteApprovalToken } from '@/lib/precision-cad-agent/remoteApprovalToken';
import { hashArchitectureInteriorEvidenceV2 } from '@/lib/ai/architectureInteriorWorkspace';
import {
  generateArchitectureInteriorAiDesign,
  type ArchitectureInteriorAiDesignRequest,
  type ArchitectureInteriorAiDesignRuntimeResult,
} from '@/lib/ai/architectureInteriorAiDesignRuntime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BRIEF_CHARS = 12_000;
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const SOURCE_LENGTHS = new Set(['mm', 'cm', 'm', 'in', 'ft']);
const CONSTRUCTION_KEYS = new Set(['wallThickness', 'slabThickness', 'ceilingThickness']);
const CONSTRAINT_KEYS = new Set(['storeyCount', 'storeyHeight', 'maximumFootprintWidth', 'maximumFootprintDepth']);
const BODY_KEYS = new Set(['designBrief', 'proposalId', 'sourceLength', 'construction', 'constraints', 'locale']);

type RouteParams = { params: Promise<{ id: string }> };
type DesignBody = {
  designBrief: string;
  proposalId: string;
  sourceLength: 'mm' | 'cm' | 'm' | 'in' | 'ft';
  construction: { wallThickness: number; slabThickness: number; ceilingThickness: number };
  constraints?: {
    storeyCount?: number;
    storeyHeight?: number;
    maximumFootprintWidth?: number;
    maximumFootprintDepth?: number;
  };
  locale?: string;
};

type RouteError =
  | 'AUTHENTICATION_REQUIRED'
  | 'PROJECT_NOT_FOUND'
  | 'EDITOR_REQUIRED'
  | 'ORIGIN_REJECTED'
  | 'BAD_REQUEST'
  | 'REQUEST_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

function errorResponse(code: RouteError, status: number, extra: Record<string, unknown> = {}, headers?: HeadersInit) {
  return NextResponse.json(
    { ok: false, code, statusKey: `architectureInterior.ai.${code.toLowerCase()}`, ...extra },
    { status, headers: { 'Cache-Control': 'private, no-store', ...headers } },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000_000;
}

function parseBody(value: unknown): { ok: true; body: DesignBody } | { ok: false } {
  if (!isRecord(value) || Object.keys(value).some(key => !BODY_KEYS.has(key))) return { ok: false };
  if (typeof value.designBrief !== 'string' || !value.designBrief.trim() || value.designBrief.length > MAX_BRIEF_CHARS) return { ok: false };
  if (typeof value.proposalId !== 'string' || !SAFE_ID.test(value.proposalId)) return { ok: false };
  if (typeof value.sourceLength !== 'string' || !SOURCE_LENGTHS.has(value.sourceLength)) return { ok: false };
  if (!isRecord(value.construction) || Object.keys(value.construction).some(key => !CONSTRUCTION_KEYS.has(key))) return { ok: false };
  const construction = value.construction;
  if (!finitePositive(construction.wallThickness) || !finitePositive(construction.slabThickness) || !finitePositive(construction.ceilingThickness)) return { ok: false };

  let constraints: DesignBody['constraints'];
  if (value.constraints !== undefined) {
    if (!isRecord(value.constraints) || Object.keys(value.constraints).some(key => !CONSTRAINT_KEYS.has(key))) return { ok: false };
    const candidate = value.constraints;
    const storeyCount = candidate.storeyCount;
    const storeyHeight = candidate.storeyHeight;
    const maximumFootprintWidth = candidate.maximumFootprintWidth;
    const maximumFootprintDepth = candidate.maximumFootprintDepth;
    if ((storeyCount !== undefined && !finitePositive(storeyCount))
      || (storeyHeight !== undefined && !finitePositive(storeyHeight))
      || (maximumFootprintWidth !== undefined && !finitePositive(maximumFootprintWidth))
      || (maximumFootprintDepth !== undefined && !finitePositive(maximumFootprintDepth))) return { ok: false };
    if (storeyCount !== undefined && (!Number.isSafeInteger(storeyCount) || storeyCount > 64)) return { ok: false };
    constraints = {
      ...(storeyCount === undefined ? {} : { storeyCount }),
      ...(storeyHeight === undefined ? {} : { storeyHeight }),
      ...(maximumFootprintWidth === undefined ? {} : { maximumFootprintWidth }),
      ...(maximumFootprintDepth === undefined ? {} : { maximumFootprintDepth }),
    };
  }
  if (value.locale !== undefined && (typeof value.locale !== 'string' || value.locale.length > 32)) return { ok: false };
  return {
    ok: true,
    body: {
      designBrief: value.designBrief,
      proposalId: value.proposalId,
      sourceLength: value.sourceLength as DesignBody['sourceLength'],
      construction: {
        wallThickness: construction.wallThickness,
        slabThickness: construction.slabThickness,
        ceilingThickness: construction.ceilingThickness,
      },
      ...(constraints ? { constraints } : {}),
      ...(value.locale === undefined ? {} : { locale: value.locale }),
    },
  };
}

function responseSize(value: unknown): boolean {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_RESPONSE_BYTES; } catch { return false; }
}

function receiptHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function approvalChallenge(runtime: Extract<ArchitectureInteriorAiDesignRuntimeResult, { ok: true }>, request: DesignBody, projectId: string, userId: string) {
  const candidateHash = hashArchitectureInteriorEvidenceV2(runtime.result);
  const proposalHash = runtime.result.hashes?.proposal;
  if (typeof proposalHash !== 'string' || !/^[a-f0-9]{64}$/.test(proposalHash)) return null;
  const token = makeRemoteApprovalToken({
    userId,
    projectId,
    revision: -1,
    tool: 'architecture-interior-ai-design.commit',
    arguments: { proposalId: request.proposalId, proposalHash, candidateHash },
  });
  return token
    ? { status: 'ready' as const, scope: 'architecture_interior_concept' as const, baseRevision: -1 as const, proposalId: request.proposalId, proposalHash, candidateHash, token }
    : { status: 'unavailable' as const, statusKey: 'architectureInterior.ai.approval_unavailable' as const };
}

function executionReceipt(runtime: Extract<ArchitectureInteriorAiDesignRuntimeResult, { ok: true }>, request: DesignBody, projectId: string) {
  return {
    runtimeVersion: runtime.execution.runtimeVersion,
    mode: 'server_provider_chain' as const,
    truncated: false as const,
    receiptHash: receiptHash({ projectId, proposalId: request.proposalId, candidate: runtime.result, runtimeVersion: runtime.execution.runtimeVersion }),
  };
}

function stableStatus(locale: string, status: Parameters<typeof architectureInteriorAiStatusCopy>[0]) {
  const language = toIsoLang(locale);
  return {
    statusKey: `architectureInterior.ai.${status}`,
    message: architectureInteriorAiStatusCopy(status, language),
    locale: language,
  };
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  if (!checkOrigin(req)) return errorResponse('ORIGIN_REJECTED', 403);
  const auth = await getAuthUser(req);
  if (!auth) return errorResponse('AUTHENTICATION_REQUIRED', 401);
  const { id: projectId } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return errorResponse('PROJECT_NOT_FOUND', 404);
  if (!access.canEdit) return errorResponse('EDITOR_REQUIRED', 403);

  const ip = getTrustedClientIp(req.headers);
  const limit = await rateLimitAsync(`architecture-interior-ai-design:${projectId}:${auth.userId}:${ip}`, 5, 60_000);
  if (!limit.allowed) return errorResponse('RATE_LIMITED', 429, {}, rateLimitHeaders(limit, 5));

  let parsed: unknown;
  try { parsed = await readBoundedJson<unknown>(req, MAX_REQUEST_BYTES); }
  catch (cause) {
    const bounded = boundedJsonError(cause);
    if (bounded) return errorResponse(bounded.code === 'PAYLOAD_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'BAD_REQUEST', bounded.status);
    return errorResponse('BAD_REQUEST', 400);
  }
  const input = parseBody(parsed);
  if (!input.ok) return errorResponse('BAD_REQUEST', 400);

  const locale = input.body.locale ?? req.headers.get('accept-language') ?? 'en';
  const runtimeInput: ArchitectureInteriorAiDesignRequest = {
    projectId,
    proposalId: input.body.proposalId,
    designBrief: input.body.designBrief,
    sourceLength: input.body.sourceLength,
    construction: input.body.construction,
    ...(input.body.constraints ? { constraints: input.body.constraints } : {}),
    userId: auth.userId,
  };
  let generated: ArchitectureInteriorAiDesignRuntimeResult;
  try { generated = await generateArchitectureInteriorAiDesign(runtimeInput); }
  catch { return errorResponse('INTERNAL_ERROR', 500); }
  if (!generated.ok) {
    const status = generated.code === 'MODEL_UNAVAILABLE' ? 503 : generated.code === 'INVALID_REQUEST' ? 400 : 422;
    const statusName = generated.code === 'INVALID_REQUEST' ? 'invalid_request' : generated.code === 'MODEL_TRUNCATED' ? 'model_truncated' : generated.code === 'MODEL_OUTPUT_INVALID' ? 'model_output_invalid' : generated.code === 'MODEL_UNAVAILABLE' ? 'model_unavailable' : 'proposal_rejected';
    const statusInfo = stableStatus(locale, statusName);
    const failure = { ok: false, code: generated.code, ...statusInfo, ...(generated.issues ? { issues: generated.issues.slice(0, 64) } : {}), persisted: false, exact: { status: 'not_run' }, compliance: { status: 'not_run' }, release: { status: 'not_run' } };
    if (!responseSize(failure)) return errorResponse('INTERNAL_ERROR', 500);
    return NextResponse.json(failure, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const statusInfo = stableStatus(locale, 'concept_compiled');
  const approval = approvalChallenge(generated, input.body, projectId, auth.userId);
  if (!approval) return errorResponse('INTERNAL_ERROR', 500);
  const response = {
    ok: true,
    code: 'CONCEPT_PROPOSAL_READY' as const,
    ...statusInfo,
    projectId,
    proposalId: input.body.proposalId,
    candidate: generated.result,
    execution: executionReceipt(generated, input.body, projectId),
    approval,
    persisted: false as const,
    exact: { status: 'not_run' as const, statusKey: 'architectureInterior.ai.exact_not_run' },
    compliance: { status: 'not_run' as const, statusKey: 'architectureInterior.ai.compliance_not_run' },
    release: { status: 'not_run' as const, statusKey: 'architectureInterior.ai.release_not_run' },
    nextStep: { statusKey: 'architectureInterior.ai.awaiting_authority', required: 'explicit_approval_and_persist_transaction' as const },
    quoteOrRfqSideEffects: false as const,
  };
  if (!responseSize(response)) return errorResponse('INTERNAL_ERROR', 500);
  return NextResponse.json(response, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
}
