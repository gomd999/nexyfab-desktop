// @vitest-environment node
/**
 * evalIntentLive — the REAL NL→intent accuracy measurement (task C). Runs the
 * golden cases through the actual production prompt (`scad-intent-from-nl`
 * template) against the live DeepSeek provider and reports passRate via the same
 * scorer the offline curation tests use (evalSuite.evalCase).
 *
 * This is the only honest source of the "AI가 확실히 의도를 뽑는가" number — the
 * offline tests verify the cases/compiler, but the NL→intent step needs a live
 * model. GATED: runs only when RUN_LIVE_EVAL=1 and DEEPSEEK_API_KEY is set, so
 * it never costs money or flakes in normal CI/husky. Doubles as the regression
 * net the cron runs on every prompt/model change.
 *
 *   Run: RUN_LIVE_EVAL=1 DEEPSEEK_API_KEY=sk-... npx vitest run evalIntentLive
 */
import { describe, it, expect } from 'vitest';
import { getPromptVariant } from '@/lib/ai/prompts';
import { INTENT_ACCURACY_EVAL_CASES } from '../evalIntentAccuracy';
import { runEvalSuite } from '../evalSuite';
import type { IntentInput } from '@/lib/openscad-render/intentToScad';

const KEY = process.env.DEEPSEEK_API_KEY?.trim();
const RUN = process.env.RUN_LIVE_EVAL === '1' && !!KEY;

async function deepseek(system: string, user: string): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`deepseek ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

function parseIntent(raw: string): IntentInput | null {
  let s = raw.trim();
  // Strip ```json … ``` fences the model sometimes adds despite instructions.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as IntentInput) : null;
  } catch {
    return null;
  }
}

describe.skipIf(!RUN)('LIVE NL→intent accuracy (DeepSeek, production prompt)', () => {
  it('passRate over the golden cases', async () => {
    const def = getPromptVariant('scad-intent-from-nl');
    const generator = async (prompt: string): Promise<IntentInput | null> =>
      parseIntent(await deepseek(def.template, prompt));

    const r = await runEvalSuite(INTENT_ACCURACY_EVAL_CASES, generator);
    console.log(
      `\n[live-eval] passRate=${(r.passRate * 100).toFixed(1)}%  ` +
      `(exact=${r.exactCount} structural=${r.structuralCount} directional=${r.directionalCount} mismatch=${r.mismatchCount} / ${r.total})`,
    );
    for (const c of r.results) {
      const diag = c.matchLevel !== 'exact' && c.details.length ? '  ⟵ ' + c.details.join(' | ') : '';
      console.log(`  ${c.matchLevel.padEnd(12)} ${c.caseId}${diag}`);
    }
    // Regression guard. Prompt v1.3.0 measured 100% (15/15 exact) twice; 0.85
    // catches a real 2+-case regression without flaking on model variance.
    expect(r.passRate).toBeGreaterThanOrEqual(0.85);
  }, 180_000);
});

// Always-present guard so the file isn't an empty suite when skipped.
describe('evalIntentLive harness', () => {
  it('is gated on RUN_LIVE_EVAL + DEEPSEEK_API_KEY', () => {
    expect(typeof RUN).toBe('boolean');
  });
});
