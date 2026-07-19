/**
 * D1 판독 역투영 diff 회귀(260719) — GT intent=OK, 오염 intent=DEMOTE(강등+되묻기).
 * 코어는 무의존(그레이 버퍼) — 로더만 sharp(테스트/CLI 전용).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reprojectDiff, loadGrayPng } from './reproject-diff.mjs';

const TD = join(dirname(fileURLToPath(import.meta.url)), 'testdata');
const gt = (n: string) => JSON.parse(readFileSync(join(TD, n + '.gt.json'), 'utf8'));

describe('D1 역투영 diff', () => {
  it('GT intent = OK(지지율 ≥ 0.6·잔차 ≤ 8%) — flange·plate·bent_sheet', async () => {
    for (const name of ['flange-09', 'plate-with-holes-01', 'bent-sheet-05']) {
      const gray = await loadGrayPng(join(TD, name + '.png'));
      const r = reprojectDiff(gray, gt(name));
      expect(r.verdict, `${name}: ${JSON.stringify(r)}`).toBe('OK');
      expect(r.support).toBeGreaterThanOrEqual(0.6);
      expect(r.confidenceFactor).toBe(1);
    }
  }, 60_000);
  it('오염 intent = DEMOTE — 내부 피처 어긋남(지지율)·치수 스왑(스케일 잔차)', async () => {
    const flange = await loadGrayPng(join(TD, 'flange-09.png'));
    const bad1 = reprojectDiff(flange, { type: 'flange', outerDia: 110, boreDia: 40, thickness: 16, bcd: 70, boltHoleD: 8, boltCount: 4 });
    expect(bad1.verdict).toBe('DEMOTE');
    expect(bad1.confidenceFactor).toBe(0.5);
    expect(bad1.askBack).toContain('확인');
    const plate = await loadGrayPng(join(TD, 'plate-with-holes-01.png'));
    const bad2 = reprojectDiff(plate, { type: 'plate_with_holes', width: 100, depth: 200, thickness: 10, holes: [] });
    expect(bad2.verdict).toBe('DEMOTE');
    expect(bad2.reasons.join(' ')).toContain('스케일 괴리');
  }, 60_000);
  it('D2 멀티뷰 모순: 두께 오염(16→40) = 정면 뷰 공유 축척 대조로 DEMOTE + 관측값 제시', async () => {
    const gray = await loadGrayPng(join(TD, 'flange-09.png'));
    const r = reprojectDiff(gray, { type: 'flange', outerDia: 110, boreDia: 60, thickness: 40, bcd: 90, boltHoleD: 12, boltCount: 6 }) as {
      verdict: string; reasons: string[]; crossViews: { view: string; checked?: boolean; impliedMm?: number; devPct?: number }[];
    };
    expect(r.verdict).toBe('DEMOTE');
    expect(r.reasons.join(' ')).toContain('멀티뷰 모순');
    const front = r.crossViews.find((c) => c.view === 'front');
    expect(front?.impliedMm).toBeGreaterThan(14); // 실제 16mm 근방 관측 제시
    expect(front?.impliedMm).toBeLessThan(19);
    // GT 는 교차 뷰도 정합(오탐 없음)
    const ok = reprojectDiff(gray, gt('flange-09')) as { verdict: string; crossViews: { checked?: boolean; devPct?: number }[] };
    expect(ok.verdict).toBe('OK');
    expect(ok.crossViews.some((c) => c.checked && (c.devPct ?? 99) < 10)).toBe(true);
  }, 60_000);
  it('대상 외 어휘 = UNSUPPORTED(강등 없음 — 정직)', async () => {
    const gray = await loadGrayPng(join(TD, 'flange-09.png'));
    const r = reprojectDiff(gray, { type: 'spur_gear', module: 2, teeth: 20, thickness: 10 });
    expect(r.verdict).toBe('UNSUPPORTED');
    expect(r.confidenceFactor).toBe(1);
  }, 30_000);
});
