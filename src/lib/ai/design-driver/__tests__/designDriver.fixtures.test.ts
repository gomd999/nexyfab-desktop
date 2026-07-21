/**
 * WA-A acceptance — fixture plans ①②③ must produce FULL-GATE-PASS packages
 * with real-measured numbers (계획 문서 §2 WA-A 수용 기준):
 *   - run() → ok:true
 *   - 치수 실측 |measured − expected| ≤ 1e-6
 *   - 부피 이론치 게이트 (relError ≤ 1e-9, 근사는 basis에 명시)
 *   - DXF 텍스트에 실측값 존재 (플레이스홀더/미측정 마커 없음)
 *   - 리포트에 게이트 전부 pass + 수치
 */

import { describe, expect, it } from 'vitest';
import {
  fixturePlanner,
  runDesignDriver,
  tessellatedCylinderVolume,
  DIMENSION_MATCH_TOL,
  type DesignPackage,
  type DriverResult,
} from '../index';

// ─── DXF TEXT extraction (group-code pair walk) ──────────────────────────

interface DxfTextEntity {
  layer: string;
  text: string;
}

function dxfTextEntities(dxf: string): DxfTextEntity[] {
  const lines = dxf.split('\n');
  const out: DxfTextEntity[] = [];
  let current: Partial<DxfTextEntity> | null = null;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    const value = lines[i + 1];
    if (code === 0) {
      if (current && current.text !== undefined) out.push({ layer: current.layer ?? '0', text: current.text });
      current = value === 'TEXT' ? {} : null;
      continue;
    }
    if (!current) continue;
    if (code === 8) current.layer = value;
    if (code === 1) current.text = value;
  }
  if (current && current.text !== undefined) out.push({ layer: current.layer ?? '0', text: current.text });
  return out;
}

function dimLabel(pkg: DesignPackage, partIdx: number, dimId: string): string | undefined {
  return dxfTextEntities(pkg.parts[partIdx].dxf).find((t) => t.layer === `DIM_${dimId}`)?.text;
}

async function runFixture(key: string): Promise<DriverResult> {
  return runDesignDriver({ id: key, text: `fixture ${key}` }, { planner: fixturePlanner });
}

function expectOk(res: DriverResult): asserts res is Extract<DriverResult, { ok: true }> {
  if (!res.ok) {
    throw new Error(`expected ok:true — refusal: ${res.refusal.reason}`);
  }
}

// ─── ① L-bracket ─────────────────────────────────────────────────────────

describe('WA-A fixture ① L-bracket', () => {
  it('passes all gates and packages measured dims + volume + DXF', async () => {
    const res = await runFixture('l-bracket');
    expectOk(res);

    // every gate passed, with numbers attached
    expect(res.gates.length).toBeGreaterThanOrEqual(3);
    for (const g of res.gates) {
      expect(g.pass).toBe(true);
      expect(Object.keys(g.metrics).length).toBeGreaterThan(0);
    }

    // geometry: exact prism volume 736 × 20 = 14720 mm³
    const geom = res.gates.find((g) => g.id === 'geometry:bracket')!;
    expect(geom.metrics.totalVolumeMm3).toBeCloseTo(14720, 6);
    expect(geom.metrics.volumeRelError).toBeLessThanOrEqual(1e-9);

    // drawing: 5 dims, all measured within 1e-6 of the brief nominals
    const part = res.package.parts[0];
    expect(part.dimensions).toHaveLength(5);
    const byId = new Map(part.dimensions.map((d) => [d.id, d]));
    const expected: Record<string, number> = {
      d_width: 60,
      d_height: 40,
      d_thickness: 8,
      d_depth: 20,
      d_corner: 90,
    };
    for (const [id, nominal] of Object.entries(expected)) {
      const d = byId.get(id)!;
      expect(d, id).toBeDefined();
      expect(Math.abs(d.value - nominal), `${id} deviation`).toBeLessThanOrEqual(DIMENSION_MATCH_TOL);
      expect(d.deviation!).toBeLessThanOrEqual(DIMENSION_MATCH_TOL);
    }
    expect(byId.get('d_corner')!.unit).toBe('deg');

    // DXF: real measured labels on the DIM layers, no unmeasured markers
    expect(part.dxf).not.toContain('NEXYFAB_DIM_UNMEASURED');
    expect(dimLabel(res.package, 0, 'd_width')).toBe('60');
    expect(dimLabel(res.package, 0, 'd_thickness')).toBe('8');
    expect(dimLabel(res.package, 0, 'd_depth')).toBe('20');
    expect(dimLabel(res.package, 0, 'd_corner')).toBe('90%%d'); // 90° in R12 encoding

    // report: all gates pass, honesty disclosures present
    expect(res.package.report.allPassed).toBe(true);
    expect(res.package.report.gates).toHaveLength(res.gates.length);
    expect(res.package.report.limitations.some((l) => l.includes('PDF'))).toBe(true);
    expect(res.package.report.limitations.some((l) => l.includes('FEA'))).toBe(true);
  });

  it('is deterministic: same brief ⇒ identical DXF + report', async () => {
    const a = await runFixture('l-bracket');
    const b = await runFixture('l-bracket');
    expectOk(a);
    expectOk(b);
    expect(a.package.parts[0].dxf).toBe(b.package.parts[0].dxf);
    expect(JSON.stringify(a.package.report)).toBe(JSON.stringify(b.package.report));
  });
});

// ─── ② stepped shaft ─────────────────────────────────────────────────────

describe('WA-A fixture ② stepped shaft', () => {
  it('passes all gates — tessellated volume theory + exact diameters', async () => {
    const res = await runFixture('stepped-shaft');
    expectOk(res);

    const vTheory = tessellatedCylinderVolume(12, 24, 30) + tessellatedCylinderVolume(8, 24, 25);
    const geom = res.gates.find((g) => g.id === 'geometry:shaft')!;
    expect(geom.pass).toBe(true);
    expect(geom.metrics.totalVolumeMm3).toBeCloseTo(vTheory, 6);
    expect(geom.metrics.volumeRelError).toBeLessThanOrEqual(1e-9);
    // 근사 명시: tessellation deviation vs analytic cylinder is declared
    expect(geom.notes.join(' ')).toContain('tessellation deviation');

    const part = res.package.parts[0];
    const byId = new Map(part.dimensions.map((d) => [d.id, d]));
    for (const [id, nominal] of Object.entries({ d_dia1: 24, d_dia2: 16, d_len1: 30, d_len2: 25 })) {
      expect(Math.abs(byId.get(id)!.value - nominal), id).toBeLessThanOrEqual(DIMENSION_MATCH_TOL);
    }

    // DXF carries the measured diameters with the ⌀ (%%c) prefix
    expect(part.dxf).not.toContain('NEXYFAB_DIM_UNMEASURED');
    expect(dimLabel(res.package, 0, 'd_dia1')).toBe('%%c24');
    expect(dimLabel(res.package, 0, 'd_dia2')).toBe('%%c16');
    expect(dimLabel(res.package, 0, 'd_len1')).toBe('30');
    expect(dimLabel(res.package, 0, 'd_len2')).toBe('25');
  });
});

// ─── ③ pin-block assembly ────────────────────────────────────────────────

describe('WA-A fixture ③ pin-block assembly', () => {
  it('passes all gates — mate convergence + BOM + solved placements', async () => {
    const res = await runFixture('pin-block-assembly');
    expectOk(res);

    // assembly gate: converged with measured residual
    const asm = res.gates.find((g) => g.id === 'assembly')!;
    expect(asm.pass).toBe(true);
    expect(asm.metrics.finalMaxResidual).toBeLessThanOrEqual(1e-6);
    expect(asm.metrics.mateCount).toBe(2);

    // solved placement: pin seated concentric on the block boss
    expect(res.package.assembly).toBeDefined();
    const pin = res.package.assembly!.placements.find((p) => p.partId === 'pin')!;
    expect(Math.abs(pin.position.x - 20)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(pin.position.y - 20)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(pin.position.z - 20)).toBeLessThanOrEqual(1e-6);

    // BOM: deterministic rows sorted by name asc
    expect(res.package.bom).toEqual([
      { itemNo: 1, name: 'Block', qty: 1, material: 'AL6061' },
      { itemNo: 2, name: 'Pin', qty: 1, material: 'SUS304' },
    ]);

    // both parts dimensioned + measured
    const dims = res.package.parts.flatMap((p) => p.dimensions);
    expect(dims).toHaveLength(4);
    for (const d of dims) expect(d.deviation!).toBeLessThanOrEqual(DIMENSION_MATCH_TOL);
    const pinPkg = res.package.parts.find((p) => p.partId === 'pin')!;
    expect(dxfTextEntities(pinPkg.dxf).some((t) => t.layer === 'DIM_d_pin_dia' && t.text === '%%c10')).toBe(true);
  });
});
