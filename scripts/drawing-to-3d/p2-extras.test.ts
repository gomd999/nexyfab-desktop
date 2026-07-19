/** P2 잔여 회귀(260719b) — 체결 자동(플랜지 짝→볼트 세트) + HLR 스파이크 스모크. */
import { describe, it, expect } from 'vitest';
import { autoFasteners } from './fastener-auto.mjs';
import { hlrProject } from './hlr-spike.mjs';

const FL = (id: string, tz: number) => ({ id, type: 'flange', params: { outerDia: 155, boreDia: 60, thickness: 16, bcd: 120, boltHoleD: 19, boltCount: 4 }, at: { tx: 0, ty: 0, tz } });

describe('체결 자동 (플랜지 짝)', () => {
  it('면 맞댐 짝 = M17→M16 스냅·그립 32 → L55 세트, 비정합 짝=제외', () => {
    const r = autoFasteners({ parts: [FL('fa', 0), FL('fb', 16), { id: 'far', type: 'flange', params: { outerDia: 155, boreDia: 60, thickness: 16, bcd: 120, boltHoleD: 19, boltCount: 8 }, at: { tx: 0, ty: 0, tz: 400 } }] }) as unknown as {
      sets: { a: string; b: string; count: number; m: number; lengthMm: number; gripMm: number; label: string }[]; note: string;
    };
    expect(r.sets).toHaveLength(1); // fa↔fb 만(볼트 수 다른 far 제외·원거리 제외)
    const s = r.sets[0];
    expect(s.m).toBe(16); // 볼트홀 19 − 2 → M16(관례 명시)
    expect(s.gripMm).toBe(32);
    expect(s.lengthMm).toBe(55); // 32 + 16×1.35 = 53.6 → 표준 55 올림
    expect(s.label).toContain('4×M16×55');
    expect(r.note).toContain('입력 영역');
  });
});

describe('HLR 스파이크 (판정: 가능 — E1 정식 후속 근거)', () => {
  it('은선 제거 투영: top 뷰에 외형+구멍 원, front 에 은선 파선 — 수 초 내', async () => {
    const r = (await hlrProject({
      parts: [
        { id: 'bed', type: 'plate_with_holes', params: { width: 300, depth: 200, thickness: 20, holes: [{ x: 40, y: 40, d: 10 }] }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'boss', type: 'cylinder', params: { diameter: 60, length: 80 }, at: { tx: 150, ty: 100, tz: 20 } },
      ],
    }, { views: ['front', 'top'] })) as { ok: boolean; views: Record<string, string> };
    expect(r.ok).toBe(true);
    expect(r.views.top).toContain('<path');
    expect(r.views.top).toContain('A 5 5'); // 구멍 ⌀10 원호(반지름 5) 실투영
    expect(r.views.front).toContain('stroke-dasharray'); // 은선 존재
  }, 120_000);
});
