/**
 * C1 프록시 인벤토리 회귀(260719) — 어휘 전수 3열(analytic·SCAD·STEP) 부피 대조.
 * 폐형 어휘가 프록시로 강등되거나(수식 드리프트) 새 프록시가 생기면 실패.
 */
import { describe, it, expect } from 'vitest';
import { buildProxyInventory, CANONICAL } from './proxy-inventory.mjs';

// 문서화된 프록시(실형상화 우선순위 — accuracy-roadmap C2): 이 외의 프록시 출현=회귀
const KNOWN_PROXY = new Set(['coil_spring', 'pillow_block', 'mesh']);

describe('C1 어휘 전수 프록시 인벤토리', () => {
  it('전 어휘 3열 대조 — 폐형=EXACT, 프록시=문서화 3종뿐', async () => {
    const inv = await buildProxyInventory({});
    const byType = new Map(inv.rows.map((r: { type: string }) => [r.type, r]));
    // 전수 커버리지(누락=silent cap 금지)
    for (const t of Object.keys(CANONICAL)) expect(byType.has(t), `${t} 미실행`).toBe(true);
    for (const r of inv.rows as Array<{ type: string; verdict: string; note?: string }>) {
      if (KNOWN_PROXY.has(r.type)) {
        expect(r.verdict, `${r.type}: 문서화 프록시가 EXACT 로 변함 — 실형상화 완료면 KNOWN_PROXY 에서 제거`).not.toBe('EXACT');
      } else {
        expect(r.verdict, `${r.type}: ${JSON.stringify(r)}`).toBe('EXACT');
      }
    }
  }, 600_000);
});
