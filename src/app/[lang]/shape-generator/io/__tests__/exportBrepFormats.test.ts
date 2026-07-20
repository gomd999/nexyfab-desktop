/**
 * exportBrepFormats.test.ts — W5-H io 등록부 통합 검증 (260721).
 *
 * three.js BoxGeometry → 등록부 빌더(buildSATText/buildIGESText/buildIFCText) →
 * 기존 brep-bridge 임포터 재임포트로 전 배선 라운드트립을 실측한다.
 * DWG/X_T 정직 제외 선언(UNSUPPORTED_EXPORT_FORMATS)도 계약으로 고정.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// downloadBlob 스텁 — DOM 없이 다운로드 경로(export*)까지 검증
const downloads: Array<{ name: string; bytes: number }> = [];
vi.mock('@/lib/platform', () => ({
  downloadBlob: async (filename: string, blob: Blob) => {
    downloads.push({ name: filename, bytes: blob.size });
  },
  PREF_KEYS: {},
  prefGetString: () => '',
  prefSetString: () => {},
  prefRemove: () => {},
}));

import {
  buildSATText, buildIGESText, buildIFCText,
  exportSAT, exportIGES, exportIFC,
  UNSUPPORTED_EXPORT_FORMATS,
} from '../exporters';
import { parseSatBodies } from '@/lib/brep-bridge/satImport';
import { igesToNexyfabAssembly } from '@/lib/brep-bridge/meshIgesImport';
import { ifcToNexyfabAssembly } from '@/lib/brep-bridge/ifcImport';
import { selfCheckIfc } from '@/lib/brep-bridge/ifcExport';

// BoxGeometry(20,30,40) = 원점 중심 — AABB (-10,-15,-20)~(10,15,20), 부피 24000
const makeBox = () => new THREE.BoxGeometry(20, 30, 40);

describe('io 등록부 → SAT (실 B-rep 라운드트립)', () => {
  it('BoxGeometry → SAT → satImport 재구성: 정점 8·부피 24000·CG(0,0,0) 1e-6', async () => {
    const text = await buildSATText(makeBox());
    const r = parseSatBodies(text);
    expect(r.ok).toBe(true);
    const poly = r.bodies![0].poly!;
    expect(poly, `재구성 실패: ${r.bodies?.[0]?.fallbackReason}`).toBeTruthy();
    expect(poly.verts).toHaveLength(8);
    expect(Math.abs(poly.volume - 24000)).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[0])).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[1])).toBeLessThan(1e-6);
    expect(Math.abs(poly.cg[2])).toBeLessThan(1e-6);
  });

  it('개방 지오메트리(PlaneGeometry)는 사유와 함께 거부(throw)', async () => {
    await expect(buildSATText(new THREE.PlaneGeometry(10, 10))).rejects.toThrow(/개방 엣지|폐다면체/);
  });

  it('곡면 지오메트리(SphereGeometry)는 테셀레이션 평면 페이스로는 방출 — 극점 퇴화 슬리버 융합 후에도 폐셸이면 통과, 아니면 거부(둘 다 정직)', async () => {
    // 구는 삼각화되면 전 페이스가 평면(삼각형) — 폐셸 성립 시 SAT 방출은 정당
    // (평면 페이스 다면체로서의 근사 — 곡면 서피스 주장 아님). 실패 시 사유 필수.
    try {
      const text = await buildSATText(new THREE.SphereGeometry(10, 8, 6));
      const r = parseSatBodies(text);
      expect(r.ok).toBe(true);
      expect(r.bodies![0].poly, r.bodies?.[0]?.fallbackReason).toBeTruthy();
    } catch (e) {
      expect(String(e)).toMatch(/SAT export refused/);
    }
  });
});

describe('io 등록부 → IGES (폴리라인 와이어프레임)', () => {
  it('BoxGeometry → IGES → meshIgesImport: AABB 20×30×40 at(-10,-15,-20)', async () => {
    const text = await buildIGESText(makeBox(), 'box');
    expect(text).toContain('POLYLINE WIREFRAME'); // 정직 선언 유지
    const r = igesToNexyfabAssembly(text, { name: 'rt' });
    expect(r.ok, r.error).toBe(true);
    const p = r.assembly!.parts[0];
    expect(p.params.width).toBeCloseTo(20, 6);
    expect(p.params.depth).toBeCloseTo(30, 6);
    expect(p.params.height).toBeCloseTo(40, 6);
    expect(p.at.tx).toBeCloseTo(-10, 6);
    expect(p.at.ty).toBeCloseTo(-15, 6);
    expect(p.at.tz).toBeCloseTo(-20, 6);
    expect(r.assembly!.fidelity).toBe('aabb-approximation');
  });
});

describe('io 등록부 → IFC (IfcFacetedBrep)', () => {
  it('BoxGeometry → IFC → 자기검사 + ifcImport: AABB 20×30×40', async () => {
    const text = await buildIFCText(makeBox(), 'box');
    const c = selfCheckIfc(text, { brepPoints: 8 });
    expect(c.errors).toEqual([]);
    const r = ifcToNexyfabAssembly(text, { name: 'rt' });
    expect(r.ok, r.error).toBe(true);
    const p = r.assembly!.parts[0];
    expect(p.params.width).toBeCloseTo(20, 6);
    expect(p.params.depth).toBeCloseTo(30, 6);
    expect(p.params.height).toBeCloseTo(40, 6);
  });

  it('개방 지오메트리는 폐셸 요건 사유로 거부(throw)', async () => {
    await expect(buildIFCText(new THREE.PlaneGeometry(10, 10))).rejects.toThrow(/폐셸/);
  });
});

describe('다운로드 배선(export*) + 정직 제외 선언', () => {
  beforeEach(() => { downloads.length = 0; });

  it('exportSAT/exportIGES/exportIFC — 확장자별 파일 다운로드 도달', async () => {
    await exportSAT(makeBox(), 'part');
    await exportIGES(makeBox(), 'part');
    await exportIFC(makeBox(), 'part');
    expect(downloads.map((d) => d.name)).toEqual(['part.sat', 'part.igs', 'part.ifc']);
    for (const d of downloads) expect(d.bytes).toBeGreaterThan(500);
  });

  it('DWG·X_T 는 사유 문자열과 함께 명시 제외(겉핥기 생성 금지 계약)', () => {
    expect(Object.keys(UNSUPPORTED_EXPORT_FORMATS).sort()).toEqual(['dwg', 'x_t']);
    expect(UNSUPPORTED_EXPORT_FORMATS.dwg).toContain('DXF');
    expect(UNSUPPORTED_EXPORT_FORMATS.x_t).toContain('STEP');
  });
});
