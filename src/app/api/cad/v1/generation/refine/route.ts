import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/ai';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { loadServerGenerationState, saveServerGenerationState } from '@/lib/ai/generationStateStore';
import { generationRequestOwner } from '@/lib/ai/generationRequestOwner';
import type { GenerationRunState } from '@/lib/ai/generationRunState';
import { handleGenerationRefine, type RefineBody } from './handler';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { z } from 'zod';
import { localizedApiMessage, resolveServerLocale } from '@/lib/i18n/serverLocale';
import { loadCommercialGenerationRouteRun, saveCommercialGenerationRouteRun, type LoadedCommercialGenerationRun } from '@/lib/ai/commercialGenerationRouteState';
import { commercialPostgresMigrationAtLeast } from '@/lib/commercial-readiness';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const refineRequestSchema = z.object({
  projectId: z.string().trim().min(1).max(128).optional(),
  state: z.object({ runId: z.string().trim().min(1).max(256), revision: z.number().int().nonnegative() }).passthrough(),
  context: z.object({
    request: z.string().trim().min(1).max(8_000),
    stage: z.enum(['intent', 'decomposition', 'interfaces', 'part_programs']),
    attempt: z.number().int().positive(),
    priorOutputs: z.record(z.string(), z.unknown()),
    priorCheckpointHashes: z.record(z.string(), z.string()),
    feedback: z.array(z.string()),
    immutableEvidenceRefs: z.array(z.string()),
  }).strict(),
}).strict();

export async function POST(req: NextRequest) {
  const locale = resolveServerLocale(req, req.nextUrl.searchParams.get('lang'));
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-generation-refine:${ip}`, 30, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT', error: localizedApiMessage(locale, 'rateLimited'), outputLanguage: locale.route }, { status: 429 });
  let body: RefineBody | null;
  try { body = await readBoundedJson<RefineBody>(req, 5 * 1024 * 1024); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded) return NextResponse.json({ ok: false, code: bounded.code, error: localizedApiMessage(locale, 'badRequest'), outputLanguage: locale.route }, { status: bounded.status }); throw error; }
  const checked = refineRequestSchema.safeParse(body);
  if (!checked.success) return NextResponse.json({ ok: false, code: 'INVALID_REFINEMENT_REQUEST', error: localizedApiMessage(locale, 'badRequest'), issues: checked.error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })), outputLanguage: locale.route }, { status: 422 });
  const requestBody = checked.data;
  try {
    const commercial = process.env.NEXYFAB_COMMERCIAL_MODE === '1';
    if (commercial && !commercialPostgresMigrationAtLeast(process.env, 2026082208)) throw new Error('COMMERCIAL_GENERATION_MIGRATION_REQUIRED');
    const owner = commercial ? '' : await generationRequestOwner(req, ip);
    const commercialCurrent: LoadedCommercialGenerationRun | undefined = commercial ? await loadCommercialGenerationRouteRun(req, requestBody.projectId ?? '', requestBody.state.runId, requestBody.state.revision) : undefined;
    const stored = commercialCurrent?.state ?? await loadServerGenerationState(owner, requestBody.state.runId);
    if (stored.revision !== requestBody.state.revision) throw new Error('GENERATION_REVISION_CONFLICT');
    const result = await handleGenerationRefine({ state: stored, context: requestBody.context }, async (prompt, signal) => (await chatCompletion({ messages: [{ role: 'system', content: `[OUTPUT LANGUAGE CONTRACT] Write natural-language fields in ${locale.languageName}; preserve machine-readable keys, identifiers, and CAD code.` }, { role: 'user', content: prompt }], maxTokens: 12_000, temperature: 0, timeoutMs: 45_000, signal, task: 'cad-multistage-refinement' })).text);
    const next = result.payload.state as GenerationRunState | undefined;
    if (result.status === 200 && next) {
      if (commercialCurrent) await saveCommercialGenerationRouteRun(commercialCurrent, next);
      else await saveServerGenerationState(owner, next, stored.revision);
    }
    return NextResponse.json({ ...(result.payload as Record<string, unknown>), outputLanguage: locale.route }, { status: result.status });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'GENERATION_STATE_FAILED';
    const status = code === 'GENERATION_RUN_NOT_FOUND' ? 404 : code === 'GENERATION_STATE_REDIS_REQUIRED' || code.includes('MIGRATION_REQUIRED') || code.includes('POSTGRES_REQUIRED') ? 503 : 409;
    return NextResponse.json({ ok: false, code, message: localizedApiMessage(locale, 'providerFailed'), outputLanguage: locale.route }, { status });
  }
}
