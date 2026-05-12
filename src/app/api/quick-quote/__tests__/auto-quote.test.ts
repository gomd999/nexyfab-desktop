/**
 * B4 — Auto-quote endpoint contract tests.
 *
 * Confirms the heuristic picker fires the right process for each shape
 * class so future refactors don't accidentally redirect quotes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/plan-guard', () => ({
  checkPlan: vi.fn(async () => ({ ok: true, userId: 'u1', plan: 'pro' })),
}));

let POST: typeof import('../auto-quote/route').POST;

beforeEach(async () => {
  vi.resetModules();
  ({ POST } = await import('../auto-quote/route'));
});

async function call(body: unknown) {
  const req = new Request('http://test/api/quick-quote/auto-quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as Parameters<typeof POST>[0]);
}

describe('auto-quote', () => {
  it('rejects missing geometry', async () => {
    const res = await call({});
    expect(res.status).toBe(400);
  });

  it('thin-wall part → sheet metal as primary', async () => {
    // 100×80×1.5 mm sheet ≈ V=12 cm³, A≈164 cm² → wall proxy ≈ 1.46mm
    const res = await call({
      geometry: { volume_cm3: 12, surface_area_cm2: 164, bbox: { w: 100, h: 80, d: 1.5 } },
      quantity: 10,
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.primary.process).toBe('sheet_metal');
    expect(body.classification.wallProxy).toBe('thin');
  });

  it('small complex part → SLA primary', async () => {
    // Volume / surface ratio gives medium wall (avoids the thin-wall
    // short-circuit), and surface area >> bbox triggers complexity ≥2.
    const res = await call({
      geometry: { volume_cm3: 30, surface_area_cm2: 200, bbox: { w: 30, h: 30, d: 30 } },
      quantity: 5,
    });
    const body = await res.json();
    expect(body.primary.process).toBe('3d_printing_sla');
  });

  it('high quantity production → injection mold primary', async () => {
    const res = await call({
      geometry: { volume_cm3: 50, surface_area_cm2: 100, bbox: { w: 80, h: 60, d: 30 } },
      quantity: 1000,
      useCase: 'production',
    });
    const body = await res.json();
    expect(body.primary.process).toBe('injection_molding');
  });

  it('default → CNC primary', async () => {
    const res = await call({
      geometry: { volume_cm3: 200, surface_area_cm2: 300, bbox: { w: 100, h: 80, d: 40 } },
      quantity: 5,
      useCase: 'custom',
    });
    const body = await res.json();
    expect(body.primary.process).toBe('cnc');
  });

  it('returns 2 alternatives in addition to primary', async () => {
    const res = await call({
      geometry: { volume_cm3: 50, surface_area_cm2: 100, bbox: { w: 80, h: 60, d: 30 } },
      quantity: 1,
    });
    const body = await res.json();
    expect(body.alternatives).toHaveLength(2);
  });

  it('estimate scales: tooling-heavy process amortizes per qty', async () => {
    // Both qty thresholds (100, 1000) trigger injection_molding selection
    // with useCase=production, so both responses include it for comparison.
    const r1 = await (await call({
      geometry: { volume_cm3: 50, surface_area_cm2: 100, bbox: { w: 80, h: 60, d: 30 } },
      quantity: 100, useCase: 'production',
    })).json();
    const r2 = await (await call({
      geometry: { volume_cm3: 50, surface_area_cm2: 100, bbox: { w: 80, h: 60, d: 30 } },
      quantity: 1000, useCase: 'production',
    })).json();
    const inj1 = [r1.primary, ...r1.alternatives].find((c: { process: string }) => c.process === 'injection_molding');
    const inj2 = [r2.primary, ...r2.alternatives].find((c: { process: string }) => c.process === 'injection_molding');
    expect(inj1).toBeTruthy();
    expect(inj2).toBeTruthy();
    expect(inj2!.estimatedUnitKrw).toBeLessThan(inj1!.estimatedUnitKrw);
  });

  it('rationale is non-empty for every candidate', async () => {
    const res = await call({
      geometry: { volume_cm3: 50, surface_area_cm2: 100, bbox: { w: 80, h: 60, d: 30 } },
      quantity: 5,
    });
    const body = await res.json();
    for (const c of [body.primary, ...body.alternatives]) {
      expect(c.rationale.length).toBeGreaterThan(3);
    }
  });
});
