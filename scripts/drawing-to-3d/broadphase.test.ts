/**
 * N5 — 브로드페이즈: 브루트포스와의 후보 포함 관계(누락 0), 대규모 성능 게이트
 * (타워 8,880부품 buildAssembly < 10s, 간섭 0), 예산 상향 후 정직 거부 유지.
 */
import { describe, expect, it } from 'vitest';
import { aabbCandidatePairs } from './broadphase.mjs';
import { buildTower } from './tower-template.mjs';
import { buildAssembly } from './assembly.mjs';

function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (1664525 * s + 1013904223) >>> 0), s / 2 ** 32); }

describe('broadphase (N5)', () => {
  it('never misses a pair the brute force finds (500 random boxes, pad-covered)', () => {
    const r = lcg(7);
    const boxes = Array.from({ length: 500 }, () => {
      const x = r() * 5000, y = r() * 5000, z = r() * 3000;
      const w = 20 + r() * 800, d = 20 + r() * 800, h = 20 + r() * 800;
      return { min: [x, y, z], max: [x + w, y + d, z + h] };
    });
    const pad = 4;
    const brute = new Set<number>();
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      const sep = [0, 1, 2].some(k => A.min[k] - pad > B.max[k] || B.min[k] - pad > A.max[k]);
      if (!sep) brute.add(i * boxes.length + j);
    }
    const got = new Set(aabbCandidatePairs(boxes, { pad }).map(([i, j]) => i * boxes.length + j));
    // 계약은 ⊇ (누락 0). 그리드 후보는 브루트 초과분이 없어야 정확히 일치한다
    for (const key of brute) expect(got.has(key)).toBe(true);
    expect(got.size).toBe(brute.size);
  });

  it('8,880-part tower passes buildAssembly under 10s with zero interference', () => {
    const t0 = Date.now();
    const tower = buildTower({ floors: 40, nx: 6, ny: 5 });
    expect(tower.ok).toBe(true);
    expect(tower.expanded!.parts!.length).toBeGreaterThan(8000);
    const built = buildAssembly({ name: 'big_tower', domain: 'building', parts: tower.expanded!.parts });
    const elapsed = Date.now() - t0;
    expect(built.ok).toBe(true);
    expect((built.interferences ?? []).length).toBe(0);
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);

  it('honest refusal still exists above the raised budget', () => {
    const parts = Array.from({ length: 20001 }, (_, i) =>
      ({ id: `p${i}`, type: 'box', params: { width: 10, depth: 10, height: 10 }, at: { tx: i * 20 } }));
    const built = buildAssembly({ name: 'over', domain: 'mech', parts });
    expect(built.ok).toBe(false);
    expect(built.gateErrors.join(' ')).toContain('예산');
  });
});
