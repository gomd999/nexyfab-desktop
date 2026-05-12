/**
 * AI eval runner (S4) — orchestrates the 33-case evalset against an
 * intent-extraction function. Pluggable so it works with:
 *   - Real API:  `runEval(extractIntent)` where extractIntent calls /api/nexyfab/scad-intent-from-nl
 *   - Mock:      `runEval(mockIntentFn)` — used in tests to verify the
 *                harness end-to-end without burning AI budget.
 *
 * Output is structured so it can be diffed across runs / model versions.
 */
import {
  SCAD_INTENT_EVALSET,
  scoreIntent,
  summarizeEval,
  type EvalCase,
  type ScoreResult,
  type EvalSummary,
} from './scad-intent-evalset';
import type { IntentInput } from '../../openscad-render/intentToScad';

export type IntentExtractor = (prompt: string) => Promise<Partial<IntentInput>>;

export interface RunOptions {
  /** Filter to specific case ids (smoke testing). */
  ids?: string[];
  /** Filter by language. */
  lang?: 'ko' | 'en';
  /** Concurrency for the extractor calls. Default 1 (sequential). */
  concurrency?: number;
  /** Hook fired after each case scores — e.g. for live progress logging. */
  onProgress?: (result: ScoreResult, index: number, total: number) => void;
}

export async function runEval(
  extractor: IntentExtractor,
  opts: RunOptions = {},
): Promise<EvalSummary> {
  const cases = filterCases(SCAD_INTENT_EVALSET, opts);
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const results: ScoreResult[] = new Array(cases.length);

  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= cases.length) return;
      const c = cases[idx];
      let intent: Partial<IntentInput> = {};
      try {
        intent = await extractor(c.prompt);
      } catch (e) {
        results[idx] = {
          caseId: c.id,
          passed: false,
          partialScore: 0,
          failures: [`extractor threw: ${(e as Error).message}`],
        };
        opts.onProgress?.(results[idx], idx, cases.length);
        continue;
      }
      results[idx] = scoreIntent(c, intent);
      opts.onProgress?.(results[idx], idx, cases.length);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return summarizeEval(results, cases);
}

function filterCases(all: EvalCase[], opts: RunOptions): EvalCase[] {
  let out = all;
  if (opts.ids) {
    const idSet = new Set(opts.ids);
    out = out.filter(c => idSet.has(c.id));
  }
  if (opts.lang) {
    out = out.filter(c => c.lang === opts.lang);
  }
  return out;
}

// ─── Mock extractor for test harness ───────────────────────────────────────

/**
 * Returns the expected intent baked into each case's `must`. Used by the
 * harness self-test to confirm the orchestrator + scorer wiring works
 * end-to-end without an actual AI call. A real extractor would never be
 * this clean — that's the point: this gives us a "100% baseline" we can
 * compare a real run against.
 */
export function makeOracleExtractor(): IntentExtractor {
  const byPrompt = new Map<string, Partial<IntentInput>>();
  for (const c of SCAD_INTENT_EVALSET) {
    const intent: Partial<IntentInput> = {
      shapeId: c.must.shapeId ?? 'box',
      params: {},
    };
    for (const [k, spec] of Object.entries(c.must.paramsApprox ?? {})) {
      intent.params![k] = spec.value;
    }
    if (c.must.featureTypes && c.must.featureTypes.length > 0) {
      intent.features = c.must.featureTypes.map(t => ({ type: t, params: {} }));
    }
    byPrompt.set(c.prompt, intent);
  }
  return async (prompt: string) => byPrompt.get(prompt) ?? {};
}

/**
 * A bad extractor — returns plausibly-shaped but wrong intents. Used to
 * verify the scorer correctly fails them.
 */
export function makeNoiseExtractor(): IntentExtractor {
  return async () => ({
    shapeId: 'wrongShape',
    params: { width: 9999 },
  });
}
