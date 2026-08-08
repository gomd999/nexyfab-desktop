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

describe('P-1a: cylinder body (shaft / pipe)', () => {
  it('converts a bare shaft to a circle base', () => {
    const p = composeIntentToFeatureProgram({
      features: [{ kind: 'cylinder', diameter: 50, height: 400 }],
    })!;
    expect(p.features).toHaveLength(1);
    expect(p.features[0]).toMatchObject({ type: 'sketchExtrude', shape: 'circle', width: 50, height: 400 });
  });

  it('converts a pipe (concentric bore at (0,0) or unplaced) — the box (0,0) refusal must NOT apply', () => {
    for (const at of [{ translate: [0, 0, 0] }, undefined]) {
      const p = composeIntentToFeatureProgram({
        features: [
          { kind: 'cylinder', diameter: 100, height: 500 },
          { kind: 'cylinder', op: 'subtract', diameter: 80, at },
        ],
      })!;
      expect(p.features[0]).toMatchObject({ shape: 'circle', width: 100, height: 500 });
      expect(p.features[1]).toMatchObject({ type: 'hole', diameter: 80, posX: 0, posY: 0 });
    }
  });

  it('refuses eccentric holes (unmeasured origin convention) and bore ≥ OD', () => {
    expect(composeIntentToFeatureProgram({
      features: [
        { kind: 'cylinder', diameter: 100, height: 500 },
        { kind: 'cylinder', op: 'subtract', diameter: 20, at: { translate: [30, 0, 0] } },
      ],
    })).toBeNull();
    expect(composeIntentToFeatureProgram({
      features: [
        { kind: 'cylinder', diameter: 100, height: 500 },
        { kind: 'cylinder', op: 'subtract', diameter: 100, at: { translate: [0, 0, 0] } },
      ],
    })).toBeNull();
    // 복수 몸체(box+cylinder add)
    expect(composeIntentToFeatureProgram({
      features: [{ kind: 'box', size: [100, 60, 8] }, { kind: 'cylinder', diameter: 50, height: 100 }],
    })).toBeNull();
  });
});

describe('P-1b: polyline (extrude) body', () => {
  const L_PROFILE = [[0, 0], [80, 0], [80, 8], [8, 8], [8, 60], [0, 60]] as const;

  it('converts an L-profile extrude to a profile-based sketchExtrude', () => {
    const p = composeIntentToFeatureProgram({
      features: [{ kind: 'extrude', profile: L_PROFILE.map(pt => [...pt]), height: 40 }],
    })!;
    expect(p.features).toHaveLength(1);
    expect(p.features[0]).toMatchObject({ type: 'sketchExtrude', height: 40 });
    expect(p.features[0]!.profile).toHaveLength(6);
    expect(p.features[0]!.profile![1]).toEqual([80, 0]);
  });

  it('refuses polyline+holes (hole coords in polygon space unmeasured) and degenerate profiles', () => {
    expect(composeIntentToFeatureProgram({
      features: [
        { kind: 'extrude', profile: L_PROFILE.map(pt => [...pt]), height: 40 },
        { kind: 'cylinder', op: 'subtract', diameter: 8, at: { translate: [20, 4, 0] } },
      ],
    })).toBeNull();
    expect(composeIntentToFeatureProgram({
      features: [{ kind: 'extrude', profile: [[0, 0], [10, 0]], height: 40 }],
    })).toBeNull();
    expect(composeIntentToFeatureProgram({
      features: [{ kind: 'extrude', profile: L_PROFILE.map(pt => [...pt]) }], // height 없음
    })).toBeNull();
  });
});
