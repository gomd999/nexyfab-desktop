/**
 * E1 핸드오프 변환기 — 정직 범위 계약: 단일 사각판+위치 있는 관통구멍만 변환,
 * 그 밖은 null(버튼 숨김 — 부분 약속 금지). 좌표는 모서리 원점→중심 원점.
 */
import { describe, expect, it } from 'vitest';
import { composeIntentToFeatureProgram } from './chatCadHandoff';

const plate = (holes: Array<{ x: number; y: number; d: number }> = []) => ({
  features: [
    { kind: 'box', size: [100, 60, 8] },
    ...holes.map(h => ({ kind: 'cylinder', op: 'subtract', diameter: h.d, at: { translate: [h.x, h.y, 0] } })),
  ],
});

describe('composeIntentToFeatureProgram (E1)', () => {
  it('converts plate + positioned holes with corner→center coordinates', () => {
    const p = composeIntentToFeatureProgram(plate([{ x: 25, y: 30, d: 8 }, { x: 75, y: 30, d: 8 }]))!;
    expect(p.features[0]).toMatchObject({ type: 'sketchExtrude', shape: 'rect', width: 100, depth: 60, height: 8 });
    expect(p.features[1]).toMatchObject({ type: 'hole', diameter: 8, posX: -25, posY: 0 });
    expect(p.features[2]).toMatchObject({ type: 'hole', diameter: 8, posX: 25, posY: 0 });
  });

  it('refuses out-of-scope vocabulary instead of partially converting', () => {
    // 보스(add cylinder)
    expect(composeIntentToFeatureProgram({
      features: [{ kind: 'box', size: [100, 60, 8] }, { kind: 'cylinder', op: 'add', diameter: 20 }],
    })).toBeNull();
    // 복수 몸체
    expect(composeIntentToFeatureProgram({
      features: [{ kind: 'box', size: [100, 60, 8] }, { kind: 'box', size: [50, 50, 5] }],
    })).toBeNull();
    // 위치 미부여 구멍(원점 관례) — (0,0)에 찍으면 조용한 오답
    expect(composeIntentToFeatureProgram(plate([{ x: 0, y: 0, d: 8 }]))).toBeNull();
    // 판 밖 구멍 — 형상 모순
    expect(composeIntentToFeatureProgram(plate([{ x: 120, y: 30, d: 8 }]))).toBeNull();
    // 몸체 없음
    expect(composeIntentToFeatureProgram({ features: [] })).toBeNull();
    expect(composeIntentToFeatureProgram(undefined)).toBeNull();
  });
});
