/**
 * expandBriefSelfConsistent.test — lever B applied to the brief expander.
 *
 * `complete` is a scripted mock returning controlled per-run variations (no live
 * LLM, no cost). Pins the honesty contract: params the runs AGREE on keep their
 * given/assumption label; a param the runs DISAGREE on is downgraded to
 * needs_input ("runs disagreed") and surfaced as a question — never averaged
 * into a fabricated consensus. runs=1 is a strict no-op.
 */
import { describe, it, expect, vi } from 'vitest';
import { expandBriefSelfConsistent } from '../expandBrief';
import type { BriefParam } from '../types';

/** A scripted `complete`: returns the queued JSON strings in order. */
function scriptedComplete(...payloads: unknown[]): () => Promise<string> {
  let i = 0;
  return async () => {
    const p = payloads[Math.min(i, payloads.length - 1)];
    i++;
    return JSON.stringify(p);
  };
}

const findParam = (
  result: Awaited<ReturnType<typeof expandBriefSelfConsistent>>,
  comp: string,
  key: string,
): BriefParam | undefined =>
  result.brief.components.find((c) => c.name === comp)?.params.find((p) => p.key === key);

const givenDiameter = (v: number) => ({
  title: '물탱크',
  domain: 'mech',
  components: [{ name: '탱크', params: [{ key: 'diameter', value: v, unit: 'mm', source: 'given' }] }],
  questions: [],
  assumptions: [],
});

describe('expandBriefSelfConsistent — runs=1 no-op', () => {
  it('calls the model once, confidence 1, no downgrades — identical params to expandBrief', async () => {
    const complete = vi.fn(scriptedComplete(givenDiameter(500)));
    const res = await expandBriefSelfConsistent('지름 500mm 물탱크', { complete }); // runs defaults to 1

    expect(complete).toHaveBeenCalledTimes(1); // zero extra cost
    expect(res.runsUsed).toBe(1);
    expect(res.lowConfidenceParams).toEqual([]);
    expect(findParam(res, '탱크', 'diameter')).toMatchObject({ value: 500, source: 'given' });
    // every projected field reported at confidence 1
    expect(Object.values(res.confidence).every((c) => c === 1)).toBe(true);
  });
});

describe('expandBriefSelfConsistent — runs agree', () => {
  it('3 agreeing runs keep the given label and an agreeing assumption stays an assumption', async () => {
    const payload = {
      title: '물탱크',
      domain: 'mech',
      components: [
        { name: '탱크', params: [
          { key: 'diameter', value: 500, unit: 'mm', source: 'given' },
          { key: 'wallThickness', value: 3, unit: 'mm', source: 'assumption', note: '표준 두께 가정' },
        ] },
      ],
      questions: [],
      assumptions: [],
    };
    const complete = vi.fn(scriptedComplete(payload, payload, payload));
    const res = await expandBriefSelfConsistent('지름 500mm 물탱크', { complete, runs: 3 });

    expect(complete).toHaveBeenCalledTimes(3);
    expect(res.runsUsed).toBe(3);
    expect(res.lowConfidenceParams).toEqual([]);
    expect(findParam(res, '탱크', 'diameter')).toMatchObject({ value: 500, source: 'given' });
    expect(findParam(res, '탱크', 'wallThickness')).toMatchObject({ value: 3, source: 'assumption' });
  });
});

describe('expandBriefSelfConsistent — runs disagree (the core lever B behaviour)', () => {
  it('a grounded value that DISAGREES across runs is downgraded to needs_input with a "runs disagreed" note and surfaced as a question', async () => {
    // Both 300 and 500 appear in the text, so BOTH are grounded as `given` on
    // their own run — the ONLY reason to distrust the value is that the runs
    // disagreed. Majority (300, 300) vs (500) => 2/3 < 0.8 => downgrade.
    const raw = '팬 지름은 300 또는 500 중 하나로 해줘';
    const mk = (v: number) => ({
      title: '팬',
      domain: 'mech',
      components: [{ name: '팬', params: [{ key: 'diameter', value: v, unit: 'mm', source: 'given' }] }],
      questions: [],
      assumptions: [],
    });
    const complete = scriptedComplete(mk(300), mk(500), mk(300));
    const res = await expandBriefSelfConsistent(raw, { complete, runs: 3, agreement: 0.8 });

    const d = findParam(res, '팬', 'diameter');
    expect(d?.source).toBe('needs_input');
    expect(d?.value).toBeNull(); // the disagreed value is NOT presented as a fact
    expect(d?.note).toContain('runs disagreed');
    expect(res.lowConfidenceParams).toContain('팬.diameter');
    // the downgrade surfaces as a question back to the user
    expect(res.brief.questions.some((q) => q.includes('runs disagreed'))).toBe(true);
  });

  it('a param the runs AGREE is unknown (all needs_input) stays needs_input, not flagged as a disagreement', async () => {
    const raw = 'RO 물탱크 설계해줘';
    const unknown = {
      title: '물탱크',
      domain: 'mech',
      components: [{ name: '탱크', params: [{ key: 'height', value: null, unit: 'mm', source: 'needs_input', note: '높이는?' }] }],
      questions: ['높이는?'],
      assumptions: [],
    };
    const complete = scriptedComplete(unknown, unknown, unknown);
    const res = await expandBriefSelfConsistent(raw, { complete, runs: 3 });

    const h = findParam(res, '탱크', 'height');
    expect(h?.source).toBe('needs_input');
    // all runs agreed it is unknown => high agreement, NOT a lever-B downgrade
    expect(res.lowConfidenceParams).toEqual([]);
  });
});
