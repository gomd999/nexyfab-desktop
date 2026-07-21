/**
 * brepExportActions — W5-H SAT/IGES/IFC 익스포트 액션 계층 테스트.
 *
 * 핸들러 순서(게이트 → 시작 → exporters 디스패치 → 성공/거부 사유 전달)와
 * planLimits 편입(free 제외·pro/team/enterprise 포함 = STEP 동급)을 검증한다.
 * exporters 는 vi.mock 스파이 — 다운로드는 실행하지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as THREE from 'three';
import { runBrepExport, BREP_EXPORT_FORMATS } from './brepExportActions';
import { PLAN_LIMITS } from '../freemium/planLimits';

vi.mock('./exporters', () => ({
  exportSAT: vi.fn(async () => {}),
  exportIGES: vi.fn(async () => {}),
  exportIFC: vi.fn(async () => {}),
}));
import { exportSAT, exportIGES, exportIFC } from './exporters';

const geo = { fake: true } as unknown as THREE.BufferGeometry;

function cbs() {
  return {
    onGated: vi.fn(),
    onStart: vi.fn(),
    onSuccess: vi.fn(),
    onRefused: vi.fn(),
    onFinally: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(exportSAT).mockClear().mockResolvedValue(undefined);
  vi.mocked(exportIGES).mockClear().mockResolvedValue(undefined);
  vi.mocked(exportIFC).mockClear().mockResolvedValue(undefined);
});

describe('runBrepExport (W5-H)', () => {
  it('no geometry → no-geometry, nothing runs', async () => {
    const c = cbs();
    expect(await runBrepExport('sat', null, ['sat'], c)).toBe('no-geometry');
    expect(c.onStart).not.toHaveBeenCalled();
    expect(exportSAT).not.toHaveBeenCalled();
  });

  it('plan gate: format not in exportFormats → gated, exporter never called', async () => {
    const c = cbs();
    expect(await runBrepExport('sat', geo, PLAN_LIMITS.free.exportFormats, c)).toBe('gated');
    expect(c.onGated).toHaveBeenCalledTimes(1);
    expect(c.onStart).not.toHaveBeenCalled();
    expect(exportSAT).not.toHaveBeenCalled();
  });

  it.each([
    ['sat', () => exportSAT],
    ['iges', () => exportIGES],
    ['ifc', () => exportIFC],
  ] as const)('%s → dispatches to the matching exporter with the geometry', async (format, pick) => {
    const c = cbs();
    expect(await runBrepExport(format, geo, PLAN_LIMITS.pro.exportFormats, c)).toBe('exported');
    expect(pick()).toHaveBeenCalledTimes(1);
    expect(pick()).toHaveBeenCalledWith(geo, 'shape-design');
    expect(c.onStart).toHaveBeenCalledTimes(1);
    expect(c.onSuccess).toHaveBeenCalledTimes(1);
    expect(c.onFinally).toHaveBeenCalledTimes(1);
    expect(c.onGated).not.toHaveBeenCalled();
    expect(c.onRefused).not.toHaveBeenCalled();
  });

  it('writer refusal → refused with the original reason, finally still fires', async () => {
    vi.mocked(exportIFC).mockRejectedValueOnce(
      new Error('IFC export refused: shell is not closed (2 open edges)'));
    const c = cbs();
    expect(await runBrepExport('ifc', geo, PLAN_LIMITS.pro.exportFormats, c)).toBe('refused');
    expect(c.onRefused).toHaveBeenCalledWith('IFC export refused: shell is not closed (2 open edges)');
    expect(c.onSuccess).not.toHaveBeenCalled();
    expect(c.onFinally).toHaveBeenCalledTimes(1);
  });
});

describe('planLimits 편입 (기존 STEP/DXF 와 동급 — pro 이상)', () => {
  it.each(BREP_EXPORT_FORMATS)('free excludes %s', (f) => {
    expect(PLAN_LIMITS.free.exportFormats).not.toContain(f);
  });
  it.each(BREP_EXPORT_FORMATS)('pro/team/enterprise include %s (same tier as step)', (f) => {
    for (const plan of ['pro', 'team', 'enterprise'] as const) {
      expect(PLAN_LIMITS[plan].exportFormats).toContain('step'); // 기준 동급성
      expect(PLAN_LIMITS[plan].exportFormats).toContain(f);
    }
  });
});
