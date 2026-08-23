import { compileProductDecomposition } from '@/lib/ai/productDecomposition';
import { buildProductDecompositionPrompt } from '@/lib/ai/productDecompositionPrompt';
import { parseProductDecompositionPlan } from '@/lib/ai/productDecompositionSchema';
import { assessProductDecompositionAccuracy, productPlanAccuracyReasons } from '@/lib/ai/productDecompositionAccuracy';

const MAX_TEXT_LENGTH = 8_000;

export type ProductDecompositionBody = { text?: string };
export type ProductDecompositionGenerator = (prompt: string, signal: AbortSignal) => Promise<unknown>;

export async function handleProductDecomposition(
  body: ProductDecompositionBody,
  generator: ProductDecompositionGenerator,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return { status: 400, payload: { ok: false, code: 'BAD_REQUEST', message: 'text is required' } };
  if (text.length > MAX_TEXT_LENGTH) return { status: 413, payload: { ok: false, code: 'PAYLOAD_TOO_LARGE', message: `text exceeds ${MAX_TEXT_LENGTH} characters` } };

  let raw: unknown;
  try {
    raw = await generator(buildProductDecompositionPrompt(text), AbortSignal.timeout(45_000));
  } catch (error) {
    return { status: 502, payload: { ok: false, code: 'AI_FAILED', message: error instanceof Error ? error.message : 'generation failed' } };
  }
  const candidate = extractObject(raw);
  const parsed = parseProductDecompositionPlan(candidate);
  if (!parsed.ok) {
    return { status: 422, payload: { ok: false, code: 'INVALID_DECOMPOSITION', message: 'AI did not return a complete product decomposition', issues: parsed.issues } };
  }
  const accuracy = assessProductDecompositionAccuracy(parsed.plan, new Set(['user:prompt']), { request: text });
  if (!accuracy.readyForGeometry) return { status: 422, payload: { ok: false, code: accuracy.requiresAuthoritativeInput ? 'AUTHORITATIVE_INPUT_REQUIRED' : 'DECOMPOSITION_NEEDS_REVIEW', message: 'Product decomposition did not pass independent accuracy gates', issues: productPlanAccuracyReasons(accuracy), accuracyAssessment: accuracy } };
  const compiled = compileProductDecomposition(parsed.plan);
  if (!compiled.ok) {
    return {
      status: 422,
      payload: {
        ok: false, code: 'DECOMPOSITION_NEEDS_REVIEW',
        message: 'Product decomposition failed CAD/assembly validation', issues: compiled.issues,
      },
    };
  }
  return { status: 200, payload: { ok: true, plan: parsed.plan, program: compiled.program, accuracyAssessment: accuracy } };
}

function extractObject(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(stripped.slice(start, end + 1)); } catch { return null; }
}
