/** std-snap 폐형 테스트 — 규격 스냅·규격 외 정직 경고. */
import { describe, it, expect } from 'vitest';
import { snapPipe, snapFlange10k, snapSquareTube, snapBolt, auditAssemblyStd } from './std-snap.mjs';

describe('시판 규격 스냅(G1)', () => {
  it('Ø60 → 50A OD60.5 SCH40 으로 스냅한다', () => {
    const s = snapPipe(60);
    expect(s.ok).toBe(true);
    expect(s.dn).toBe(50);
    expect(s.od).toBe(60.5);
    expect(s.label).toContain('50A SCH40');
  });
  it('규격에서 먼 지름은 정직 경고(스냅 강제 없음)', () => {
    const s = snapPipe(6);
    expect(s.ok).toBe(false);
    expect(s.warning).toContain('규격 외');
  });
  it('플랜지 50A 10K 표준치(OD155·PCD120·4-⌀19)', () => {
    const f = snapFlange10k(50);
    expect(f.ok).toBe(true);
    expect(f.od).toBe(155);
    expect(f.pcd).toBe(120);
    expect(f.nBolt).toBe(4);
  });
  it('각관 60각·볼트 M12 스냅', () => {
    expect(snapSquareTube(60).side).toBe(60);
    expect(snapBolt(12.5).m).toBe(12);
  });
  it('어셈블리 감사: 배관 d 편차 권고 + 규격 외 경고 목록', () => {
    const r = (auditAssemblyStd as unknown as (a: unknown) => { items: unknown[]; warnings: string[] })({
      parts: [
        { id: 'post1', type: 'box', role: 'column', params: { width: 60, depth: 60, height: 100 } },
        { id: 'pipe_x', type: 'cylinder', role: 'pipe', params: { diameter: 57, length: 500 } },
      ],
      pipes: [{ id: 'P1', d: 60 }],
    });
    expect(r.items.length).toBe(3);
    expect(r.warnings.join(' ')).toContain('스냅 권고'); // 57→60.5 편차
  });
});
