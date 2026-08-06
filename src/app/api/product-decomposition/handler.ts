import { compileProductDecomposition, type ProductDecompositionPlan } from '@/lib/ai/productDecomposition';
import { buildProductDecompositionPrompt } from '@/lib/ai/productDecompositionPrompt';

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
  if (!isPlanEnvelope(candidate)) {
    return { status: 422, payload: { ok: false, code: 'INVALID_DECOMPOSITION', message: 'AI did not return a complete product decomposition' } };
  }
  const compiled = compileProductDecomposition(candidate as unknown as ProductDecompositionPlan);
  if (!compiled.ok) {
    return {
      status: 422,
      payload: {
        ok: false, code: 'DECOMPOSITION_NEEDS_REVIEW',
        message: 'Product decomposition failed CAD/assembly validation', issues: compiled.issues,
      },
    };
  }
  return { status: 200, payload: { ok: true, plan: candidate, program: compiled.program } };
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

function isPlanEnvelope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return plan.version === 1 && plan.units === 'mm' && typeof plan.productName === 'string' &&
    Array.isArray(plan.requirements) && Array.isArray(plan.definitions) && Array.isArray(plan.instances) &&
    Array.isArray(plan.mates) && Array.isArray(plan.subassemblies) && Array.isArray(plan.observations) &&
    Array.isArray(plan.assumptions) && Array.isArray(plan.unresolved);
}
