/**
 * 치수 불일치의 **원인 국소화** (260728 §7-1) — §6-D 가 부피에 한 것을 치수에 한 것.
 *
 * 벤치 v1 실측: L-브래킷이 3 rep 전부 `measured 8 deviates from expected 40` 으로 죽었다.
 * 값이 아니라 **ref 선택**이 원인인데, 종전 메시지는 숫자만 말해서 그걸 알 수 없었다.
 *
 * ⚠ 이 보고는 "어떤 ref 를 골랐어야 하는가"를 제안하지 않는다 — 숫자를 맞추려고 의미가
 * 다른 엣지를 고르게 만들면 게이트는 통과하고 도면은 틀린다(§6-1 과 같은 자기충족).
 */
import { describe, it, expect } from 'vitest';
import { buildExtrudeTopo } from '@/lib/cad/topoNaming';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { describeRefSpan, refSpanLine } from '../refGeometry';
import { buildDrawingArtifact, drawingGate } from '../drawingGate';
import type { DesignPlan } from '../types';

/** L-프로파일: 다리 60·40, 벽두께 8, 깊이 20 (벤치 b-03 과 같은 형상). */
const L_FEATURE: ExtrudeFeature = {
  kind: 'extrude',
  loop: [
    { x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 8 },
    { x: 8, y: 8 }, { x: 8, y: 40 }, { x: 0, y: 40 },
  ],
  depth: 20, direction: 'one_sided', mode: 'add',
};

describe('describeRefSpan — 두 ref 가 실제로 어떻게 떨어져 있나', () => {
  const topo = buildExtrudeTopo(L_FEATURE);

  it('짧은 다리(40)를 재려고 벽두께(8)를 가르는 쌍을 고르면 그 간격을 그대로 보고한다', () => {
    // e.vert.5 = (0,40), e.vert.4 = (8,40) — 같은 Y, X 로 8 만큼 갈린다(축정렬이라 측정은 된다)
    const rep = describeRefSpan(topo, 'top', 'e.vert.5', 'e.vert.4');
    expect(rep).not.toBeNull();
    expect(rep!.alongWorld.find((w) => w.name === 'X')!.gap).toBeCloseTo(8, 9);
    expect(rep!.alongWorld.find((w) => w.name === 'Y')!.gap).toBeCloseTo(0, 9);
    // top 뷰는 X×Y 를 보여주므로 가로 간격이 8 로 잡힌다
    expect(rep!.alongViewRight).toBeCloseTo(8, 9);
  });

  it('의도한 쌍(다리 40)은 Y 로 40 만큼 갈린다 — 같은 함수로 확인된다', () => {
    const rep = describeRefSpan(topo, 'top', 'e.vert.0', 'e.vert.4');
    const y = rep!.alongWorld.find((w) => w.name === 'Y')!;
    expect(y.gap).toBeCloseTo(40, 9); // 수직 엣지 두 개는 (0,0)·(8,40) — Y 간격 40
    expect(rep!.alongViewUp).toBeGreaterThan(0);
  });

  it('한 줄 요약이 "쌍을 잘못 골랐다"를 명시하고 제안은 하지 않는다', () => {
    const line = refSpanLine('e.vert.5', 'e.vert.4', 'top', describeRefSpan(topo, 'top', 'e.vert.5', 'e.vert.4')!);
    expect(line).toContain("refs 'e.vert.5'↔'e.vert.4'");
    expect(line).toContain('you picked the wrong pair');
    // 대체 ref 를 지목하지 않는다
    expect(line).not.toMatch(/use '?e\.vert\.\d+'? instead/i);
  });

  it('알 수 없는 ref 나 비표준 뷰는 null — 없는 것을 지어내지 않는다', () => {
    expect(describeRefSpan(topo, 'top', 'e.vert.0', 'no.such.ref')).toBeNull();
    expect(describeRefSpan(topo, 'iso', 'e.vert.0', 'e.vert.4')).toBeNull();
  });
});

describe('drawingGate — 불일치 사유에 ref 간격이 실린다', () => {
  const plan: DesignPlan = {
    planId: 'p', name: 'L',
    parts: [{ partId: 'bracket', name: 'L', bodies: [{ bodyId: 'b0', feature: L_FEATURE }] }],
    drawing: {
      paperSize: 'A3', scale: 1,
      dimensions: [
        // 40 을 재려 했는데 벽두께 8 을 가르는 쌍을 골랐다 (b-03 이 3회 낸 바로 그 실수).
        // 축정렬이라 측정은 되고 값만 틀린다 — 종전엔 "measured 8" 만 나와 원인을 알 수 없었다.
        { id: 'd_leg_short', partId: 'bracket', bodyId: 'b0', view: 'top', kind: 'linear', refs: ['e.vert.5', 'e.vert.4'], expected: 40 },
      ],
    },
  };

  it('숫자만이 아니라 두 ref 의 실제 간격까지 말한다', () => {
    const res = drawingGate(plan, buildDrawingArtifact(plan));
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('deviates from expected 40');
    expect(res.reason).toContain("refs 'e.vert.5'↔'e.vert.4'");
    expect(res.reason).toContain('X=8');
  });

  it('맞게 고른 치수는 통과하고 아무 말도 덧붙이지 않는다 (과탐 0)', () => {
    const ok: DesignPlan = {
      ...plan,
      drawing: {
        ...plan.drawing,
        dimensions: [
          { id: 'd_leg_long', partId: 'bracket', bodyId: 'b0', view: 'top', kind: 'linear', refs: ['e.vert.0', 'e.vert.1'], expected: 60 },
        ],
      },
    };
    const res = drawingGate(ok, buildDrawingArtifact(ok));
    expect(res.pass).toBe(true);
    expect(res.reason).toBeUndefined();
  });
});
