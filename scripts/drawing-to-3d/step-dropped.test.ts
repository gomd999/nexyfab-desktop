/**
 * STEP 내보내기 누락(dropped)이 통과로 읽히던 것 (260729).
 *
 * `stepRoundTrip` 은 드롭된 부품을 predVol·predicted AABB 에서 **제외**하고 대조한다.
 * 즉 내보내지 못한 부품이 많을수록 남은 것끼리만 비교하게 되는데, verdict 는 그대로
 * PASS 였다. 제작 업체가 받는 STEP 에 그 부품이 없는데 모든 문서가 합격이라 말한다.
 *
 * 방법론 문서는 이미 "dropped>0 이면 호출측이 **반드시 고지**"로 정해 뒀지만
 * (docs/drawing-to-3d-methodology.md), 쉬운요약 어디에도 렌더가 없었다 — 문서로만
 * 있던 계약이다.
 *
 * ⚠ 정직하게: 드롭 자체는 **재현하지 못했다**(과대 필렛·mesh 부품·영치수 세 경로 모두
 * 드롭 없이 통과). 아래는 계약과 소비자 경로를 고정하는 테스트다.
 */
import { describe, it, expect } from 'vitest';
import { easySummary } from './easy-summary.mjs';

const summary = easySummary as unknown as (a: unknown, o?: Record<string, unknown>) => string;
const rig = {
  name: '가대', domain: 'mech',
  parts: [
    { id: 'base', type: 'box', role: 'slab', material: 'steel', params: { width: 2000, depth: 2000, height: 100 }, at: { tx: 0, ty: 0, tz: 50 } },
    { id: 'col', type: 'box', role: 'column', material: 'steel', params: { width: 150, depth: 150, height: 800 }, at: { tx: 0, ty: 0, tz: 500 } },
  ],
};
const text = (o?: Record<string, unknown>) =>
  summary(rig, { title: '가대', domain: 'mech', ...o }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('STEP 누락 고지', () => {
  it('누락이 있으면 소비자 문서가 개수와 부품명을 말한다', () => {
    const t = text({ stepDropped: [{ pid: 'col', op: 'part' }] });
    expect(t).toContain('3D 파일(STEP)에 1개 부품이 빠졌습니다');
    expect(t).toContain('col');
  });

  it('도면과 STEP 이 어긋난다는 사실을 명시한다 — 둘 다 업체로 간다', () => {
    const t = text({ stepDropped: [{ pid: 'col' }, { pid: 'base' }] });
    expect(t).toContain('두 문서가 어긋납니다');
    expect(t).toContain('그대로 보내면 그 부품은 전달되지 않습니다');
  });

  it('누락이 없으면 아무 말도 하지 않는다 — 과잉 경고 금지', () => {
    expect(text()).not.toContain('빠졌습니다');
    expect(text({ stepDropped: [] })).not.toContain('빠졌습니다');
  });

  it('부품명이 없는 항목도 무너지지 않는다(kind 폴백)', () => {
    const t = text({ stepDropped: [{ kind: 'revolve' }] });
    expect(t).toContain('revolve');
  });
});
