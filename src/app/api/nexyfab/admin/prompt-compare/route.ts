/**
 * POST /api/nexyfab/admin/prompt-compare
 *
 * Runs the same prompt+input across every configured provider in parallel
 * and returns the responses + latencies for ad-hoc quality comparison.
 *
 * Body:
 *   {
 *     promptId:  string,           // registry id (e.g. "shape-chat")
 *     userInput: string,           // the user message to send
 *     providers?: string[],        // override which providers to call
 *                                  // (default: all configured)
 *     maxTokens?: number,          // override prompt default
 *     temperature?: number,        // override prompt default
 *   }
 *
 * Response: { results: [{ provider, ok, text?, error?, latencyMs, ... }] }
 *
 * Auth: super_admin / org_admin only. This endpoint can burn meaningful
 * tokens — every call multiplies token cost by the number of providers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getPrompt } from '@/lib/ai/prompts';
import { AiNotConfiguredError, AiProviderError, type ChatMessage, type ChatCompletionResponse } from '@/lib/ai';
import { deepseekProvider } from '@/lib/ai/providers/deepseek';
import { openaiProvider } from '@/lib/ai/providers/openai';
import { anthropicProvider } from '@/lib/ai/providers/anthropic';
import { localProvider } from '@/lib/ai/providers/local';
import { saveCompareRun } from '@/lib/ai/compareStore';
import { pairwiseSimilarity } from '@/lib/ai/similarity';
import { estimateCostCents } from '@/lib/ai/cost';

export const dynamic = 'force-dynamic';

const PROVIDERS = {
  deepseek: deepseekProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
  local: localProvider,
} as const;
type ProviderKey = keyof typeof PROVIDERS;

interface CompareResult {
  provider: ProviderKey;
  configured: boolean;
  ok: boolean;
  text?: string;
  model?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
  errorClass?: string;
}

async function callOne(
  key: ProviderKey,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
): Promise<CompareResult> {
  const adapter = PROVIDERS[key];
  if (!adapter.isConfigured()) {
    return { provider: key, configured: false, ok: false, error: 'not configured', errorClass: 'NotConfigured' };
  }
  try {
    const r: ChatCompletionResponse = await adapter.complete({
      messages,
      maxTokens,
      temperature,
      timeoutMs,
      provider: key,
    });
    return {
      provider: key,
      configured: true,
      ok: true,
      text: r.text,
      model: r.model,
      latencyMs: r.latencyMs,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
    };
  } catch (e) {
    if (e instanceof AiProviderError) {
      return {
        provider: key,
        configured: true,
        ok: false,
        error: e.message.slice(0, 500),
        errorClass: 'AiProviderError',
        model: 'unknown',
      };
    }
    if (e instanceof AiNotConfiguredError) {
      return { provider: key, configured: false, ok: false, error: 'not configured', errorClass: 'NotConfigured' };
    }
    return {
      provider: key,
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 500) : String(e),
      errorClass: 'unknown',
    };
  }
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = authUser.globalRole === 'super_admin'
    || (authUser.roles?.some(r => r.role === 'org_admin' as string) ?? false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const promptId = typeof body.promptId === 'string' ? body.promptId : '';
  const userInput = typeof body.userInput === 'string' ? body.userInput : '';
  const overrideMaxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : undefined;
  const overrideTemp = typeof body.temperature === 'number' ? body.temperature : undefined;
  const providersArg: string[] | undefined = Array.isArray(body.providers) ? body.providers : undefined;

  if (!promptId) {
    return NextResponse.json({ error: 'promptId is required' }, { status: 400 });
  }
  if (!userInput.trim()) {
    return NextResponse.json({ error: 'userInput is required' }, { status: 400 });
  }
  if (userInput.length > 8000) {
    return NextResponse.json({ error: 'userInput too long (max 8000 chars)' }, { status: 413 });
  }

  let prompt;
  try { prompt = getPrompt(promptId); }
  catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }

  // Resolve which providers to call. Filter to configured + valid keys.
  const requestedKeys = (providersArg ?? Object.keys(PROVIDERS))
    .map(k => String(k).toLowerCase())
    .filter((k): k is ProviderKey => k in PROVIDERS);
  if (requestedKeys.length === 0) {
    return NextResponse.json({ error: 'no valid providers requested' }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.template },
    { role: 'user', content: userInput },
  ];
  const maxTokens = overrideMaxTokens ?? prompt.defaults.maxTokens ?? 2000;
  const temperature = overrideTemp ?? prompt.defaults.temperature ?? 0.2;
  const timeoutMs = prompt.defaults.timeoutMs ?? 30_000;

  const results = await Promise.all(
    requestedKeys.map(k => callOne(k, messages, maxTokens, temperature, timeoutMs)),
  );

  // Compute pairwise similarity over successful responses. Failed providers
  // contribute empty strings → row/col of zeros, which is the correct signal.
  const similarity = pairwiseSimilarity(
    results.map(r => (r.ok && typeof r.text === 'string') ? r.text : ''),
  );
  const similarityProviders = results.map(r => r.provider);

  // Consolidation hint — when two providers gave nearly-identical responses
  // (≥0.95 cosine) AND one is meaningfully cheaper (>1.5x), recommend dropping
  // the expensive one. Catches "Anthropic Opus answered the same as DeepSeek
  // for 50x the cost" cases.
  const SIMILARITY_HINT_THRESHOLD = 0.95;
  const COST_RATIO_HINT = 1.5;
  type Hint = {
    type: 'consolidate_cheaper';
    keep: { provider: string; model: string; costCents: number };
    drop: { provider: string; model: string; costCents: number };
    similarity: number;
    savingsRatio: number;
  };
  const hints: Hint[] = [];
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = results[i];
      const b = results[j];
      if (!a.ok || !b.ok) continue;
      const sim = similarity[i][j];
      if (sim < SIMILARITY_HINT_THRESHOLD) continue;
      const aCost = a.model
        ? estimateCostCents(a.provider, a.model, a.promptTokens ?? 0, a.completionTokens ?? 0)
        : 0;
      const bCost = b.model
        ? estimateCostCents(b.provider, b.model, b.promptTokens ?? 0, b.completionTokens ?? 0)
        : 0;
      if (aCost === 0 && bCost === 0) continue;
      const cheaperCost = Math.min(aCost, bCost);
      const expensiveCost = Math.max(aCost, bCost);
      if (expensiveCost === 0 || expensiveCost <= cheaperCost * COST_RATIO_HINT) continue;
      const cheaper = aCost <= bCost ? a : b;
      const expensive = aCost > bCost ? a : b;
      hints.push({
        type: 'consolidate_cheaper',
        keep: { provider: cheaper.provider, model: cheaper.model ?? 'unknown', costCents: cheaperCost },
        drop: { provider: expensive.provider, model: expensive.model ?? 'unknown', costCents: expensiveCost },
        similarity: sim,
        savingsRatio: 1 - cheaperCost / expensiveCost,
      });
    }
  }

  // Persist the run so admins can browse history without paying for re-calls.
  // Fire-and-forget: a DB write failure must not fail the response itself.
  let runId: string | null = null;
  try {
    runId = await saveCompareRun({
      createdBy: authUser.userId,
      promptId: prompt.id,
      promptVersion: prompt.version,
      maxTokens,
      temperature,
      userInput,
      results,
    });
  } catch (e) {
    console.warn('[prompt-compare] saveCompareRun failed:', e);
  }

  return NextResponse.json({
    promptId: prompt.id,
    promptVersion: prompt.version,
    maxTokens,
    temperature,
    results,
    similarity,
    similarityProviders,
    consolidationHints: hints,
    ...(runId ? { runId } : {}),
  });
}
