/**
 * WA-D1 — makeLlmPlanner (LLM-backed DesignPlanner) tests.
 *
 * The completion function is injected, so every test is deterministic — NO
 * live LLM call (비용·비결정 금지). Coverage:
 *   - valid JSON → DesignPlan that the real driver packages (all gates green)
 *   - markdown code-fence robustness
 *   - schema violation (missing required / wrong type) → PlannerError
 *   - revolve-body dimension → preflight refusal with explicit reason
 *   - invalid topology ref → preflight refusal
 *   - dangling dimension ref (unknown part/body) → preflight refusal
 *   - empty / non-JSON response → PlannerError
 *   - explicit {"error":"unsupported"} sentinel → PlannerError
 *   - unknown fields dropped
 *   - revision context injected into the user message
 */

import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@/lib/ai';
import { makeLlmPlanner, type LlmDesignBrief } from './llmPlanner';
import { PlannerError } from './planner';
import { runDesignDriver } from './designDriver';
import { lBracketPlan } from './fixturePlanner';
import type { DesignBrief, DesignPlan } from './types';

// ─── helpers ────────────────────────────────────────────────────────────

/** A planner whose model always returns `text`, and that records the messages. */
function plannerReturning(text: string) {
  const seen: { messages: ChatMessage[] } = { messages: [] };
  const planner = makeLlmPlanner({
    complete: async (messages) => {
      seen.messages = messages;
      return text;
    },
  });
  return { planner, seen };
}

const BRIEF: DesignBrief = { id: 'b1', text: 'design an L-bracket' };

/** A minimal, gate-eligible extrude plan JSON (for tampering in schema tests). */
function validPlanJson(): string {
  return JSON.stringify(lBracketPlan());
}

// ─── valid path ─────────────────────────────────────────────────────────

describe('makeLlmPlanner — valid plan', () => {
  it('parses valid JSON into a DesignPlan the driver packages (all gates green)', async () => {
    const { planner } = plannerReturning(validPlanJson());
    const result = await runDesignDriver(BRIEF, { planner });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.refusal.reason);
    expect(result.plan.planId).toBe('fixture-l-bracket');
    expect(result.gates.every((g) => g.pass)).toBe(true);
    expect(result.package.parts).toHaveLength(1);
    // Real-measured dimensions exist only because every gate passed.
    expect(result.package.parts[0]!.dimensions.length).toBeGreaterThan(0);
    expect(result.package.parts[0]!.dxf).toContain('SECTION');
  });

  it('tolerates a markdown-fenced JSON reply', async () => {
    const fenced = '```json\n' + validPlanJson() + '\n```';
    const { planner } = plannerReturning(fenced);
    const plan = await planner.plan(BRIEF);
    expect(plan.planId).toBe('fixture-l-bracket');
    expect(plan.parts).toHaveLength(1);
  });

  it('tolerates prose surrounding the JSON object', async () => {
    const noisy = `Sure — here is the plan you asked for:\n${validPlanJson()}\nLet me know if you want changes.`;
    const { planner } = plannerReturning(noisy);
    const plan = await planner.plan(BRIEF);
    expect(plan.planId).toBe('fixture-l-bracket');
  });

  it('drops unknown fields not in the schema', async () => {
    const raw = JSON.parse(validPlanJson()) as Record<string, unknown>;
    raw.hallucinatedTopLevel = { foo: 1 };
    (raw.parts as Array<Record<string, unknown>>)[0]!.hallucinatedPart = 'nope';
    const { planner } = plannerReturning(JSON.stringify(raw));
    const plan = (await planner.plan(BRIEF)) as DesignPlan & Record<string, unknown>;
    expect(plan.hallucinatedTopLevel).toBeUndefined();
    expect((plan.parts[0] as unknown as Record<string, unknown>).hallucinatedPart).toBeUndefined();
    // ...and the surviving plan is still gate-eligible.
    const result = await runDesignDriver(BRIEF, { planner });
    expect(result.ok).toBe(true);
  });
});

// ─── schema violations → PlannerError ──────────────────────────────────────

describe('makeLlmPlanner — schema enforcement', () => {
  it('rejects a missing required field (planId)', async () => {
    const raw = JSON.parse(validPlanJson()) as Record<string, unknown>;
    delete raw.planId;
    const { planner } = plannerReturning(JSON.stringify(raw));
    await expect(planner.plan(BRIEF)).rejects.toBeInstanceOf(PlannerError);
    await expect(planner.plan(BRIEF)).rejects.toThrow(/planId/);
  });

  it('rejects a type mismatch (expectedVolume.valueMm3 as string)', async () => {
    const raw = JSON.parse(validPlanJson()) as Record<string, unknown>;
    (raw.parts as Array<Record<string, unknown>>)[0]!.expectedVolume = {
      valueMm3: 'fourteen thousand',
      basis: 'made up',
    };
    const { planner } = plannerReturning(JSON.stringify(raw));
    await expect(planner.plan(BRIEF)).rejects.toThrow(/valueMm3/);
  });

  it('rejects expectedVolume without a basis (honesty invariant)', async () => {
    const raw = JSON.parse(validPlanJson()) as Record<string, unknown>;
    (raw.parts as Array<Record<string, unknown>>)[0]!.expectedVolume = { valueMm3: 14720 };
    const { planner } = plannerReturning(JSON.stringify(raw));
    await expect(planner.plan(BRIEF)).rejects.toThrow(/basis/);
  });

  it('rejects an unmeshable feature kind', async () => {
    const raw = JSON.parse(validPlanJson()) as Record<string, unknown>;
    const body = (raw.parts as Array<{ bodies: Array<{ feature: { kind: string } }> }>)[0]!.bodies[0]!;
    body.feature.kind = 'boolean_magic';
    const { planner } = plannerReturning(JSON.stringify(raw));
    await expect(planner.plan(BRIEF)).rejects.toThrow(/meshable/);
  });

  it('rejects an empty parts array', async () => {
    const raw = JSON.parse(validPlanJson()) as Record<string, unknown>;
    raw.parts = [];
    const { planner } = plannerReturning(JSON.stringify(raw));
    await expect(planner.plan(BRIEF)).rejects.toThrow(/at least one part/);
  });
});

// ─── preflight refusals (게이트 전 명시 거부) ────────────────────────────────

describe('makeLlmPlanner — plan preflight', () => {
  it('refuses a revolve dimension with a non-f.lat ref (WB-1: revolve now measurable, but namespace enforced)', async () => {
    const plan: DesignPlan = {
      planId: 'p_rev',
      name: 'Revolved knob',
      parts: [
        {
          partId: 'knob',
          name: 'Knob',
          bodies: [
            {
              bodyId: 'main',
              feature: {
                kind: 'revolve',
                loop: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                  { x: 10, y: 20 },
                  { x: 0, y: 20 },
                ],
                angleDegrees: 360,
                mode: 'add',
              } as unknown as DesignPlan['parts'][number]['bodies'][number]['feature'],
            },
          ],
        },
      ],
      drawing: {
        dimensions: [
          { id: 'd_dia', partId: 'knob', bodyId: 'main', view: 'top', kind: 'diametric', refs: ['f.cap.top'], expected: 20 },
        ],
      },
    };
    const { planner } = plannerReturning(JSON.stringify(plan));
    // WB-1: revolve bodies are now measurable (buildRevolveMeasureTopo), but the
    // ref must be the revolve namespace f.lat.{i}; an extrude name is refused.
    await expect(planner.plan(BRIEF)).rejects.toThrow(
      /is not a valid revolve topology name \(namespace: f\.lat/,
    );
  });

  it('refuses a dimension whose refs are outside the topology namespace', async () => {
    const raw = JSON.parse(validPlanJson()) as {
      drawing: { dimensions: Array<{ refs: string[] }> };
    };
    raw.drawing.dimensions[0]!.refs = ['totally.made.up'];
    const { planner } = plannerReturning(JSON.stringify(raw));
    await expect(planner.plan(BRIEF)).rejects.toThrow(/not a valid extrude topology name/);
  });

  it('refuses a dimension that references a non-existent body', async () => {
    const raw = JSON.parse(validPlanJson()) as {
      drawing: { dimensions: Array<{ bodyId: string }> };
    };
    raw.drawing.dimensions[0]!.bodyId = 'ghost';
    const { planner } = plannerReturning(JSON.stringify(raw));
    await expect(planner.plan(BRIEF)).rejects.toThrow(/unknown body/);
  });

  it('surfaces the preflight refusal through the driver as a stage:plan refusal', async () => {
    const raw = JSON.parse(validPlanJson()) as {
      drawing: { dimensions: Array<{ refs: string[] }> };
    };
    raw.drawing.dimensions[0]!.refs = ['bogus'];
    const { planner } = plannerReturning(JSON.stringify(raw));
    const result = await runDesignDriver(BRIEF, { planner });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.refusal.stage).toBe('plan');
    expect(result.refusal.reason).toMatch(/preflight rejected/);
    expect(result.gates).toHaveLength(0);
  });
});

// ─── malformed / refusal responses ─────────────────────────────────────────

describe('makeLlmPlanner — malformed & refusal responses', () => {
  it('rejects an empty response', async () => {
    const { planner } = plannerReturning('');
    await expect(planner.plan(BRIEF)).rejects.toThrow(/empty response/);
  });

  it('rejects a non-JSON response', async () => {
    const { planner } = plannerReturning('I think you want a bracket but I am not sure.');
    await expect(planner.plan(BRIEF)).rejects.toThrow(/no JSON object/);
  });

  it('rejects malformed JSON', async () => {
    const { planner } = plannerReturning('{ "planId": "x", "parts": [ }');
    await expect(planner.plan(BRIEF)).rejects.toThrow(/not valid JSON/);
  });

  it('surfaces the explicit unsupported sentinel as a PlannerError', async () => {
    const { planner } = plannerReturning('{"error":"unsupported","reason":"free-form organic surface"}');
    await expect(planner.plan(BRIEF)).rejects.toThrow(/unsupported: free-form organic surface/);
  });
});

// ─── revision context injection ─────────────────────────────────────────────

describe('makeLlmPlanner — revision context', () => {
  it('injects reviewer comments and failed gates into the user message', async () => {
    const { planner, seen } = plannerReturning(validPlanJson());
    const brief: LlmDesignBrief = {
      id: 'b1',
      text: 'design an L-bracket',
      revision: {
        briefSummary: 'L-bracket v1',
        comments: ['make it 10mm taller', { note: 'add a mounting hole', featureId: 'body-main' }],
        failedGates: ['drawing'],
      },
    };
    await planner.plan(brief);

    const user = seen.messages.find((m) => m.role === 'user')!;
    expect(user.content).toContain('REVISION');
    expect(user.content).toContain('make it 10mm taller');
    expect(user.content).toContain('[body-main] add a mounting hole');
    expect(user.content).toContain('drawing');
    expect(user.content).toContain('L-bracket v1');
  });

  it('injects structured params when present', async () => {
    const { planner, seen } = plannerReturning(validPlanJson());
    await planner.plan({ id: 'b1', text: 'a bracket', params: { width: 60, material: 'AL6061' } });
    const user = seen.messages.find((m) => m.role === 'user')!;
    expect(user.content).toContain('"width":60');
    expect(user.content).toContain('AL6061');
  });

  it('always sends a system prompt with the schema and topology rules', async () => {
    const { planner, seen } = plannerReturning(validPlanJson());
    await planner.plan(BRIEF);
    const sys = seen.messages.find((m) => m.role === 'system')!;
    expect(sys.content).toContain('DesignPlan');
    expect(sys.content).toContain('f.cap.top');
    expect(sys.content).toMatch(/unsupported/);
  });
});

// ─── (c) 뷰에서 잴 수 없는 선형 치수 — 260727 A-4 후속 ───────────────────────
// 실측 근거: 계획이 통과한 브리프의 완주를 막던 최대 병목이 도면 치수였고, 실패한
// 계획의 refs를 덤프하니 좌표계 오해가 체계적이었다(loop의 Y를 front에서 재려 하고,
// 두께를 두 수직 엣지 사이로 재려 함 — 둘 다 그 뷰에서 분리량이 구조적으로 0).
describe('makeLlmPlanner — 뷰에서 잴 수 없는 선형 치수는 빌드 전에 거부한다', () => {
  const block50x30x25 = (dims: DesignPlan['drawing']['dimensions']): DesignPlan => ({
    planId: 'p_block',
    name: 'Spacer block 50×30×25',
    parts: [
      {
        partId: 'spacer',
        name: 'Spacer',
        bodies: [
          {
            bodyId: 'b0',
            feature: {
              kind: 'extrude',
              loop: [
                { x: 0, y: 0 },
                { x: 50, y: 0 },
                { x: 50, y: 30 },
                { x: 0, y: 30 },
              ],
              depth: 25,
              direction: 'one_sided',
              mode: 'add',
            } as unknown as DesignPlan['parts'][number]['bodies'][number]['feature'],
          },
        ],
      },
    ],
    drawing: { dimensions: dims },
  });

  it("front 뷰는 Y를 투영으로 날린다 — Y로만 떨어진 두 엣지는 거부되고 'top'을 알려준다", async () => {
    const plan = block50x30x25([
      { id: 'd_height', partId: 'spacer', bodyId: 'b0', view: 'front', kind: 'linear', refs: ['e.vert.0', 'e.vert.3'], expected: 30 },
    ]);
    const { planner } = plannerReturning(JSON.stringify(plan));
    await expect(planner.plan(BRIEF)).rejects.toThrow(/cannot be measured there/);
    await expect(planner.plan(BRIEF)).rejects.toThrow(/only along world Y/);
    await expect(planner.plan(BRIEF)).rejects.toThrow(/'top'/);
  });

  it('두께를 두 수직 엣지 사이로 재려 하면 거부되고 f.cap 쌍을 알려준다', async () => {
    // 모든 수직 엣지는 같은 Z 범위를 가지므로 Z 분리량이 0이다. front 뷰에서 X로도
    // 겹치는 쌍(같은 x)을 고르면 어느 축으로도 못 잰다.
    const plan = block50x30x25([
      { id: 'd_thickness', partId: 'spacer', bodyId: 'b0', view: 'front', kind: 'linear', refs: ['e.vert.0', 'e.vert.3'], expected: 25 },
    ]);
    const { planner } = plannerReturning(JSON.stringify(plan));
    await expect(planner.plan(BRIEF)).rejects.toThrow(/cannot be measured there/);
  });

  it('올바른 조합(top=W/H · front=f.cap 두께)은 통과한다 — 과탐 없음', async () => {
    const plan = block50x30x25([
      { id: 'd_width', partId: 'spacer', bodyId: 'b0', view: 'top', kind: 'linear', refs: ['e.vert.0', 'e.vert.1'], expected: 50 },
      { id: 'd_height', partId: 'spacer', bodyId: 'b0', view: 'top', kind: 'linear', refs: ['e.vert.1', 'e.vert.2'], expected: 30 },
      { id: 'd_thick', partId: 'spacer', bodyId: 'b0', view: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'], expected: 25 },
    ]);
    const { planner } = plannerReturning(JSON.stringify(plan));
    await expect(planner.plan(BRIEF)).resolves.toBeTruthy();
  });

  it('값이 틀린 것(잴 수는 있음)은 프리플라이트가 통과시킨다 — 측정은 게이트 몫', async () => {
    // e.vert.0↔e.vert.1은 front에서 X로 50 떨어져 있다: 기대값 25가 틀렸을 뿐
    // "잴 수 없는" 것이 아니다. 여기서 막으면 게이트의 실측 판정을 가로채게 된다.
    const plan = block50x30x25([
      { id: 'd_depth', partId: 'spacer', bodyId: 'b0', view: 'front', kind: 'linear', refs: ['e.vert.0', 'e.vert.1'], expected: 25 },
    ]);
    const { planner } = plannerReturning(JSON.stringify(plan));
    await expect(planner.plan(BRIEF)).resolves.toBeTruthy();
  });

  // ─── 대각 치수 — 260727 최종 실측에서 남은 3건 중 1건(a4-08 거셋 빗변) ─────
  it("대각 span은 kind:'aligned'로 진짜 길이를, axis로 성분을 잴 수 있다", async () => {
    // 직각삼각형 거셋: 다리 80×80, 빗변은 e.vert.1↔e.vert.2(대각).
    const gusset = (dims: DesignPlan['drawing']['dimensions']): DesignPlan => ({
      planId: 'p_gusset',
      name: 'Gusset 80×80×6',
      parts: [{
        partId: 'gusset',
        name: 'Gusset',
        bodies: [{
          bodyId: 'b0',
          feature: {
            kind: 'extrude',
            loop: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 0, y: 80 }],
            depth: 6,
            direction: 'one_sided',
            mode: 'add',
          } as unknown as DesignPlan['parts'][number]['bodies'][number]['feature'],
        }],
      }],
      drawing: { dimensions: dims },
    });

    // ① aligned = 빗변의 실제 길이(80√2)
    const alignedPlan = gusset([
      { id: 'd_hyp', partId: 'gusset', bodyId: 'b0', view: 'top', kind: 'aligned', refs: ['e.vert.1', 'e.vert.2'], expected: Math.hypot(80, 80) },
    ]);
    const { planner: p1 } = plannerReturning(JSON.stringify(alignedPlan));
    await expect(p1.plan(BRIEF)).resolves.toBeTruthy();

    // ② linear + axis = 그 대각의 X 성분(다리 80)
    const axisPlan = gusset([
      { id: 'd_leg_x', partId: 'gusset', bodyId: 'b0', view: 'top', kind: 'linear', axis: 'x', refs: ['e.vert.1', 'e.vert.2'], expected: 80 },
    ]);
    const { planner: p2 } = plannerReturning(JSON.stringify(axisPlan));
    const coerced = await p2.plan(BRIEF);
    expect(coerced.drawing.dimensions[0]!.axis).toBe('x'); // 계획 단계에서 살아남아 게이트로 전달된다
  });

  it('axis:x가 게이트까지 전달돼 대각의 X 성분을 실측한다(배선 전 구간)', async () => {
    const plan: DesignPlan = {
      planId: 'p_gusset_axis',
      name: 'Gusset 80x80x6',
      parts: [{
        partId: 'gusset',
        name: 'Gusset',
        bodies: [{
          bodyId: 'b0',
          feature: {
            kind: 'extrude',
            loop: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 0, y: 80 }],
            depth: 6,
            direction: 'one_sided',
            mode: 'add',
          } as unknown as DesignPlan['parts'][number]['bodies'][number]['feature'],
        }],
      }],
      drawing: {
        dimensions: [
          // 대각 쌍이지만 axis:'x'로 X 성분(80)을 재라고 지시 — auto였다면 not-axis-aligned.
          { id: 'd_leg_x', partId: 'gusset', bodyId: 'b0', view: 'top', kind: 'linear', axis: 'x', refs: ['e.vert.1', 'e.vert.2'], expected: 80 },
        ],
      },
    };
    const { planner } = plannerReturning(JSON.stringify(plan));
    const res = await runDesignDriver({ id: 'g-axis', text: 'gusset' }, { planner });
    const dg = res.gates.find((g) => g.kind === 'drawing');
    expect(dg, 'drawing 게이트가 있어야 한다').toBeTruthy();
    expect(dg!.pass, dg!.reason ?? '').toBe(true);

    // 같은 쌍을 axis 없이 linear로 재면 종전대로 정직 실패(과탐 아님을 대조로 고정)
    const autoPlan: DesignPlan = {
      ...plan,
      drawing: { dimensions: [{ ...plan.drawing.dimensions[0]!, id: 'd_auto', axis: undefined }] },
    };
    const { planner: p2 } = plannerReturning(JSON.stringify(autoPlan));
    const res2 = await runDesignDriver({ id: 'g-auto', text: 'gusset' }, { planner: p2 });
    const dg2 = res2.gates.find((g) => g.kind === 'drawing');
    expect(dg2!.pass).toBe(false);
    expect(dg2!.reason).toMatch(/not-axis-aligned/);
  });

  it('axis는 linear 전용 — 다른 kind에 주면 계획 단계에서 거부', async () => {
    const plan = JSON.parse(validPlanJson()) as DesignPlan;
    plan.drawing.dimensions[0]!.kind = 'aligned';
    (plan.drawing.dimensions[0] as { axis?: string }).axis = 'x';
    const { planner } = plannerReturning(JSON.stringify(plan));
    await expect(planner.plan(BRIEF)).rejects.toThrow(/axis is linear-only/);
  });

  it("시스템 프롬프트가 대각 span의 세 가지 정답을 알려준다", async () => {
    const { planner, seen } = plannerReturning(validPlanJson());
    await planner.plan(BRIEF);
    const sys = seen.messages.find((m) => m.role === 'system')!;
    expect(sys.content).toContain('not-axis-aligned');
    expect(sys.content).toMatch(/kind:\"aligned\"\s+→ the slant's TRUE length/);
    expect(sys.content).toContain('gusset');
  });

  it('시스템 프롬프트가 구멍을 도면 치수로 넣지 말라고 명시한다(구멍엔 토폴로지 이름이 없음)', async () => {
    // 260727 재측정: 구멍을 열자 모델이 곧바로 구멍 지름을 diametric으로 넣으려 했고
    // 4/12가 그것으로 죽었다 — 구멍은 커널 절삭으로 검증되지만 시트 콜아웃은 미지원.
    const { planner, seen } = plannerReturning(validPlanJson());
    await planner.plan(BRIEF);
    const sys = seen.messages.find((m) => m.role === 'system')!;
    expect(sys.content).toContain('DO NOT dimension the holes');
    expect(sys.content).toMatch(/EXACTLY ONE ref/);
  });

  it('시스템 프롬프트가 뷰별 가시 축을 명시한다(모델이 애초에 안 틀리도록)', async () => {
    const { planner, seen } = plannerReturning(validPlanJson());
    await planner.plan(BRIEF);
    const sys = seen.messages.find((m) => m.role === 'system')!;
    expect(sys.content).toContain('VIEW FRAMES');
    expect(sys.content).toMatch(/front.*Y is projected out/);
    expect(sys.content).toContain('NEVER two e.vert');
  });
});
