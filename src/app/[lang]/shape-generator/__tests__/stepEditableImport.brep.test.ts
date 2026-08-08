/**
 * T-1(#3) 슬라이스 1 — STEP 편집가능 임포트(실 WASM): 임포트가 메시 폐기가
 * 아니라 **살아있는 B-rep 핸들**을 남겨 다이렉트 편집·정확 재수출 경로에
 * 올라감을 실증한다.
 *   1. 자체 방출 STEP 왕복: extrude→export→import→핸들 실재+에지 서명 12
 *   2. 재수출 충실도: 왕복 후 체적 보존(해석 400×... 아님, 메시 적분 대조)
 *   3. K7 정직 범위: 임포트 형상은 이름표 없음(생성 이력 부재 — B안 소관)
 * Skipped when RUN_OCCT_FEASIBILITY=0 (sibling 관례).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import {
  ensureOcctReady,
  resetShapeRegistry,
  occtExtrudeProfile,
  occtImportStepText,
  occtEdgeSignatures,
  occtTopoNames,
  exportOcctStep,
  occtFilletBox,
  occtChamferBox,
} from '../features/occtEngine';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position; const idx = geo.index!;
  let vol = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(vol);
}

describeMaybe('T-1 — STEP 편집가능 임포트(실 WASM)', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 120_000);

  it('round-trips an emitted STEP into a LIVE B-rep handle with real edges', async () => {
    resetShapeRegistry();
    const src = occtExtrudeProfile([
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 },
    ], 10);
    const step = (await exportOcctStep(src.handle))!;
    expect(step).toContain('ISO-10303-21');

    const imported = await occtImportStepText(step);
    expect(imported.handle).toBeTruthy();
    // 살아있는 B-rep: 에지 열거 가능(박스 12에지) — 다이렉트 편집 경로의 전제
    const sigs = occtEdgeSignatures(imported.handle);
    expect(sigs.length).toBe(12);
    // 체적 보존(메시 적분): 40×20×10 = 8000mm³
    expect(Math.abs(meshVolume(imported.geometry) - 8000)).toBeLessThan(1);
    // 재수출 가능(핸들 → STEP)
    const reExported = await exportOcctStep(imported.handle);
    expect(reExported).toContain('ISO-10303-21');
  });

  it('imported shapes carry NO K7 name table (no generative history — honest B-path scope)', async () => {
    resetShapeRegistry();
    const src = occtExtrudeProfile([
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 },
    ], 10);
    const step = (await exportOcctStep(src.handle))!;
    const imported = await occtImportStepText(step);
    expect(occtTopoNames(imported.handle)).toBeNull();
  });

  it('non-STEP text → null handle, empty geometry (fallback contract)', async () => {
    resetShapeRegistry();
    const r = await occtImportStepText('not a step file');
    expect(r.handle).toBeNull();
    expect(r.geometry.attributes.position).toBeUndefined();
  });
});

describeMaybe('T-1 슬라이스2 — 임포트 B-rep 다이렉트 편집(N-1 게이트)', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 120_000);

  async function importBox() {
    resetShapeRegistry();
    const src = occtExtrudeProfile([
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 },
    ], 10);
    const step = (await exportOcctStep(src.handle))!;
    return occtImportStepText(step);
  }

  it('imported handle chains into occtFilletBox — real B-rep fillet + re-export', async () => {
    const imported = await importBox();
    const dummyHost = { w: 0, h: 0, d: 0, cx: 0, cy: 0, cz: 0 };
    const filleted = occtFilletBox(dummyHost, 2, {}, imported.handle);
    expect(filleted.handle).toBeTruthy();
    const vol = meshVolume(filleted.geometry);
    // r=2 전에지 필렛: 8000보다 작고, 과도 손실은 아니어야 한다(해석 근사 7800±)
    expect(vol).toBeLessThan(8000);
    expect(vol).toBeGreaterThan(7000);
    // 곡면(필렛)이 생겨 에지 수가 원 12를 초과 — B-rep 연산 실증
    expect(occtEdgeSignatures(filleted.handle).length).toBeGreaterThan(12);
    const reExported = await exportOcctStep(filleted.handle);
    expect(reExported).toContain('ISO-10303-21');
  });

  it('imported handle chains into occtChamferBox as well', async () => {
    const imported = await importBox();
    const dummyHost = { w: 0, h: 0, d: 0, cx: 0, cy: 0, cz: 0 };
    const chamfered = occtChamferBox(dummyHost, 1.5, {}, imported.handle);
    expect(chamfered.handle).toBeTruthy();
    expect(meshVolume(chamfered.geometry)).toBeLessThan(8000);
  });
});
