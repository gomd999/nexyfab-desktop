// @vitest-environment node
/**
 * F-3 — 메이트 과구속 진단: 검증된 야코비안 랭크(kinematics)로 실판정.
 *   · 건강한 힌지 1개 = 자유도 1·과구속 0
 *   · 같은 두 부품에 중복 구속을 쌓으면 redundant > 0 (과구속 검출)
 *   · 사상 불가 메이트는 제외 목록+partial (조용한 생략 금지)
 */
import { describe, expect, it } from 'vitest';
import { diagnoseMateMobility } from './mateMobilityDiagnosis';

const PARTS = [
  { id: 'base', grounded: true, atMm: [0, 0, 0] as [number, number, number] },
  { id: 'arm', atMm: [100, 0, 0] as [number, number, number] },
];

describe('diagnoseMateMobility (F-3)', () => {
  it('single hinge → mobility 1, no over-constraint', async () => {
    const d = await diagnoseMateMobility(
      [{ id: 'm1', type: 'hinge', partA: 'base', partB: 'arm', axis: [0, 0, 1], atMm: [50, 0, 0] }],
      PARTS,
    );
    expect(d.status).toBe('ok');
    expect(d.mobility).toBe(1);
    expect(d.overconstrained).toBe(false);
  });

  it('stacked redundant constraints on the same pair → over-constraint DETECTED', async () => {
    const d = await diagnoseMateMobility(
      [
        { id: 'm1', type: 'hinge', partA: 'base', partB: 'arm', axis: [0, 0, 1], atMm: [50, 0, 0] },
        { id: 'm2', type: 'hinge', partA: 'base', partB: 'arm', axis: [0, 0, 1], atMm: [50, 0, 0] },
        { id: 'm3', type: 'coincident', partA: 'base', partB: 'arm', axis: [0, 0, 1], atMm: [50, 0, 0] },
      ],
      PARTS,
    );
    expect(d.redundant).toBeGreaterThan(0);
    expect(d.overconstrained).toBe(true);
  });

  it('unmappable mates are excluded loudly (partial diagnosis, never silent)', async () => {
    const d = await diagnoseMateMobility(
      [
        { id: 'm1', type: 'hinge', partA: 'base', partB: 'arm', axis: [0, 0, 1] },
        { id: 'm2', type: 'gear', partA: 'base', partB: 'arm', axis: [0, 0, 1] },
        { id: 'm3', type: 'coincident', partA: 'base', partB: 'arm' }, // 축 없음
      ],
      PARTS,
    );
    expect(d.status).toBe('partial');
    expect(d.excluded.map(e => e.reason).sort()).toEqual(['axis_unavailable', 'no_standard_pair_equivalent']);
    expect(d.note).toContain('부분 진단');
  });

  it('no mappable mates → not_run (never fabricates a zero)', async () => {
    const d = await diagnoseMateMobility(
      [{ id: 'm1', type: 'tangent', partA: 'base', partB: 'arm', axis: [0, 0, 1] }],
      PARTS,
    );
    expect(d.status).toBe('not_run');
    expect(d.mobility).toBeNull();
  });
});
