/**
 * brief-expander/expandBrief.test — the clarify→structure PRE-PASS.
 *
 * The model only PROPOSES structure + a source label; deterministic code is the
 * arbiter. These tests pin the honesty invariant: a value the code cannot ground
 * in the user's own text is NEVER presented as a number — it becomes needs_input
 * (value null). `complete` is a deterministic mock (no live LLM, no cost).
 */
import { describe, it, expect } from 'vitest';
import {
  expandBrief,
  groundBrief,
  toPlannerBrief,
  textHasValue,
  BriefExpanderError,
} from '../expandBrief';
import type { BriefParam } from '../types';

const mock = (json: unknown) => async () => JSON.stringify(json);
const findParam = (
  brief: Awaited<ReturnType<typeof expandBrief>>,
  comp: string,
  key: string,
): BriefParam | undefined => brief.components.find((c) => c.name === comp)?.params.find((p) => p.key === key);

describe('brief-expander — source labelling (given | assumption | needs_input)', () => {
  it('labels a value stated in the text as given, keeps a noted default as assumption, and asks for the rest', async () => {
    const raw = '지름 500mm 원통형 물탱크, 재질은 알아서';
    const brief = await expandBrief(raw, {
      complete: mock({
        title: '물탱크',
        domain: 'mech',
        components: [
          { name: '탱크', params: [
            { key: 'diameter', value: 500, unit: 'mm', source: 'given', note: '' },
            { key: 'wallThickness', value: 3, unit: 'mm', source: 'assumption', note: '가정: 일반 스테인리스 탱크 표준 두께' },
            { key: 'height', value: null, unit: 'mm', source: 'needs_input', note: '탱크 높이는 얼마인가요?' },
          ] },
        ],
        questions: ['탱크 높이는 얼마인가요?'],
        assumptions: [],
      }),
    });

    expect(findParam(brief, '탱크', 'diameter')).toMatchObject({ value: 500, source: 'given' });
    expect(findParam(brief, '탱크', 'wallThickness')).toMatchObject({ value: 3, source: 'assumption' });
    const h = findParam(brief, '탱크', 'height');
    expect(h?.source).toBe('needs_input');
    expect(h?.value).toBeNull();
    // the needs_input note is surfaced as a question
    expect(brief.questions.some((q) => q.includes('높이'))).toBe(true);
    // the assumption is surfaced in the human-readable list
    expect(brief.assumptions.some((a) => a.includes('wallThickness'))).toBe(true);
  });

  it('the water-treatment RO example: no numbers stated => every param is needs_input, none fabricated', async () => {
    const raw = '수처리 기기 설계하려해 RO가 들어가고 필터도 다 있어야해';
    const brief = await expandBrief(raw, {
      complete: mock({
        title: '수처리 기기 (RO + 필터)',
        domain: 'mech',
        components: [
          { name: 'RO 유닛', params: [
            { key: 'permeateCapacity', value: null, unit: 'L/day', source: 'needs_input', note: '하루 처리 수량은?' },
          ] },
          { name: '전처리 필터', params: [
            { key: 'stageCount', value: 3, unit: null, source: 'assumption', note: '가정: 가정용 표준 3단' },
            { key: 'micronRating', value: null, unit: 'micron', source: 'needs_input', note: '여과 정밀도는?' },
          ] },
        ],
        questions: ['하루 처리 수량은?', '여과 정밀도는?'],
        assumptions: [],
      }),
    });

    expect(brief.domain).toBe('mech');
    expect(brief.components.map((c) => c.name)).toContain('RO 유닛');
    expect(brief.components.map((c) => c.name)).toContain('전처리 필터');
    // No stated number => capacity/micron are needs_input with null value.
    expect(findParam(brief, 'RO 유닛', 'permeateCapacity')?.value).toBeNull();
    expect(findParam(brief, '전처리 필터', 'micronRating')?.value).toBeNull();
    // The 3-stage default is a labeled assumption (not presented as a fact).
    expect(findParam(brief, '전처리 필터', 'stageCount')).toMatchObject({ value: 3, source: 'assumption' });
    expect(brief.questions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('brief-expander — no fabrication (the core invariant)', () => {
  it('a "given" value that is NOT in the user text is refused (becomes needs_input, never a number)', async () => {
    // The user never said 800; the model hallucinated it and mislabelled it given.
    const raw = 'RO 물탱크 하나 설계해줘';
    const brief = await expandBrief(raw, {
      complete: mock({
        title: '물탱크',
        domain: 'mech',
        components: [
          { name: '탱크', params: [
            { key: 'height', value: 800, unit: 'mm', source: 'given', note: '' },
          ] },
        ],
        questions: [],
        assumptions: [],
      }),
    });
    const h = findParam(brief, '탱크', 'height');
    expect(h?.source).toBe('needs_input');
    expect(h?.value).toBeNull(); // fabricated number dropped, never surfaced
  });

  it('an "assumption" with NO basis note is refused (becomes needs_input, never a number)', () => {
    const brief = groundBrief(
      {
        title: 't', domain: 'mech',
        components: [{ name: 'c', params: [
          { key: 'foo', value: 42, unit: 'mm', source: 'assumption' }, // no note
        ] }],
        questions: [], assumptions: [],
      },
      'make a c',
    );
    const foo = brief.components[0]!.params[0]!;
    expect(foo.source).toBe('needs_input');
    expect(foo.value).toBeNull();
  });

  it('a mislabelled "assumption" whose value IS in the text is promoted to given', () => {
    const brief = groundBrief(
      {
        title: 't', domain: 'mech',
        components: [{ name: 'c', params: [
          { key: 'diameter', value: 500, unit: 'mm', source: 'assumption', note: 'guessed' },
        ] }],
        questions: [], assumptions: [],
      },
      '지름 500mm 짜리',
    );
    expect(brief.components[0]!.params[0]).toMatchObject({ value: 500, source: 'given' });
  });

  it('drops hallucinated keyless params and coerces an unknown source to needs_input', () => {
    const brief = groundBrief(
      {
        title: 't', domain: 'generic',
        components: [{ name: 'c', params: [
          { value: 10, unit: 'mm', source: 'given' },            // no key -> dropped
          { key: 'x', value: 10, unit: 'mm', source: 'nonsense' }, // bad source -> needs_input
        ] }],
      },
      'anything',
    );
    expect(brief.components[0]!.params).toHaveLength(1);
    expect(brief.components[0]!.params[0]).toMatchObject({ key: 'x', source: 'needs_input', value: null });
  });
});

describe('brief-expander — grounding helper', () => {
  it('a number is matched only as a whole token (5 is not inside 500)', () => {
    expect(textHasValue('지름 500mm', 500)).toBe(true);
    expect(textHasValue('지름 500mm', 5)).toBe(false);
    expect(textHasValue('두께 3.5t', 3)).toBe(false);
    expect(textHasValue('6,000L 탱크', 6000)).toBe(true);
    expect(textHasValue('RO 필터', 'RO')).toBe(true);
  });
});

describe('brief-expander — planner adapter (feeds the existing pipeline)', () => {
  it('toPlannerBrief puts ONLY given values into params; assumptions/questions ride in text', async () => {
    const brief = await expandBrief('지름 500mm 물탱크', {
      complete: mock({
        title: '물탱크',
        domain: 'mech',
        components: [
          { name: '탱크', params: [
            { key: 'diameter', value: 500, unit: 'mm', source: 'given', note: '' },
            { key: 'wallThickness', value: 3, unit: 'mm', source: 'assumption', note: '표준 두께 가정' },
            { key: 'height', value: null, unit: 'mm', source: 'needs_input', note: '높이는?' },
          ] },
        ],
        questions: [], assumptions: [],
      }),
    });
    const pb = toPlannerBrief(brief, 'x');
    expect(pb.id).toBe('x');
    // authoritative params: only the grounded given value
    expect(pb.params).toEqual({ '탱크.diameter': 500 });
    // assumption + open question are visible in the text, not in params
    expect(pb.text).toContain('가정/assumption');
    expect(pb.text).toContain('미정/needs input');
    expect(pb.params['탱크.wallThickness']).toBeUndefined();
    expect(pb.params['탱크.height']).toBeUndefined();
  });

  it('domain override wins over the model classification', async () => {
    const brief = await expandBrief('옹벽 하나', {
      domain: 'civil',
      complete: mock({ title: 'wall', domain: 'mech', components: [], questions: [], assumptions: [] }),
    });
    expect(brief.domain).toBe('civil');
  });
});

describe('brief-expander — malformed model output', () => {
  it('empty output throws BriefExpanderError', async () => {
    await expect(expandBrief('x', { complete: async () => '' })).rejects.toThrow(BriefExpanderError);
  });
  it('non-JSON output throws BriefExpanderError', async () => {
    await expect(expandBrief('x', { complete: async () => 'sorry, I cannot help' })).rejects.toThrow(BriefExpanderError);
  });
  it('extracts JSON from a markdown-fenced reply', async () => {
    const brief = await expandBrief('지름 500mm 통', {
      complete: async () => '```json\n{"title":"통","domain":"mech","components":[{"name":"c","params":[{"key":"diameter","value":500,"unit":"mm","source":"given"}]}],"questions":[],"assumptions":[]}\n```',
    });
    expect(findParam(brief, 'c', 'diameter')).toMatchObject({ value: 500, source: 'given' });
  });
});