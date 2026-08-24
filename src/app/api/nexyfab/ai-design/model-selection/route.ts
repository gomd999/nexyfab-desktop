import { randomUUID } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { checkOrigin } from '@/lib/csrf';
import { canUseCodegenModel, CODEGEN_MODELS } from '@/lib/ai/codegenModels';
import { selectCodegenModel } from '@/lib/ai/modelSelectionPolicy';

export const runtime = 'nodejs';
const MAX_BODY_BYTES = 32 * 1024;

const capability = z.enum(['vision', 'reasoning', 'precision-intent', 'structured-output']);
const requestSchema = z.object({
  mode: z.enum(['auto', 'quality', 'balanced', 'fast', 'manual']),
  modelId: z.string().trim().min(1).max(128).nullable().optional(),
  manualModelId: z.string().trim().min(1).max(128).nullable().optional(),
  task: z.union([
    z.string().trim().min(1).max(256),
    z.object({
      kind: z.string().trim().min(1).max(256).optional(),
      complexity: z.enum(['simple', 'moderate', 'complex']).optional(),
      requiredCapabilities: z.array(capability).max(16).optional(),
      requiresVision: z.boolean().optional(),
    }),
  ]).optional(),
  input: z.object({
    kind: z.enum(['text', 'structured', 'image', 'mixed']).optional(),
    hasImage: z.boolean().optional(),
    requiresVision: z.boolean().optional(),
  }).optional(),
  risk: z.union([
    z.enum(['low', 'medium', 'high', 'critical']),
    z.object({
      level: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      exactGeometry: z.boolean().optional(),
      releaseImpact: z.boolean().optional(),
    }),
  ]).optional(),
  capabilities: z.array(capability).max(16).optional(),
  constraints: z.object({
    allowedModelIds: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
    excludedModelIds: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
    allowedProviders: z.array(z.enum(['deepseek', 'qwen', 'openai', 'gemini', 'anthropic', 'openrouter', 'local'])).max(16).optional(),
    requiredTier: z.enum(['free', 'pro', 'enterprise']).optional(),
    requiredCapabilities: z.array(capability).max(16).optional(),
    maxLatencyClass: z.enum(['fast', 'standard']).optional(),
  }).optional(),
}).strict();

function publicCatalog(plan: string) {
  return CODEGEN_MODELS.map(model => ({
    id: model.id,
    label: model.label,
    tier: model.tier,
    note: model.note,
    vision: model.vision === true,
    recommended: model.recommended === true,
    availability: model.availability,
    allowed: canUseCodegenModel(model, plan),
  }));
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({
    schema: 'nexyfab.model-selection-catalog.v1',
    modes: ['auto', 'quality', 'balanced', 'fast', 'manual'],
    models: publicCatalog(authUser.plan),
  });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let raw: unknown;
  try {
    raw = await readBoundedJson(req, MAX_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    raw = null;
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({
      error: 'INVALID_MODEL_SELECTION_REQUEST',
      issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    }, { status: 400 });
  }

  // The authenticated entitlement always wins over any client state.
  const result = selectCodegenModel({ ...parsed.data, plan: authUser.plan });
  const receiptEnvelope = {
    receiptId: randomUUID(),
    issuedAt: new Date().toISOString(),
    ...result.receipt,
  };
  if (!result.ok) {
    return NextResponse.json({ error: 'MODEL_SELECTION_BLOCKED', receipt: receiptEnvelope }, { status: 409 });
  }
  return NextResponse.json({
    model: {
      id: result.model.id,
      label: result.model.label,
      provider: result.model.provider,
      tier: result.model.tier,
      vision: result.model.vision === true,
    },
    receipt: receiptEnvelope,
  });
}
