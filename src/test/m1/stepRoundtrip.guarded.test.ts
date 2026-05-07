/**
 * STEP: OCCT WASM 로드 + 샘플 파일 import + (가능 시) export→import 라운드트립.
 * 기본 CI에서는 스킵 — `RUN_STEP_IMPORT=1`: `npm run test:step-roundtrip`
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exportToStep } from '@/app/[lang]/shape-generator/io/stepExporter';
import { importPayload } from '@/app/[lang]/shape-generator/io/importers';

const runStepImport = process.env.RUN_STEP_IMPORT === '1' || process.env.RUN_STEP_IMPORT === 'true';

describe.skipIf(!runStepImport)('M1 STEP guarded (OCCT WASM)', () => {
  it(
    'importPayload parses bundled example .stp (OCCT smoke)',
    async () => {
      const path = join(process.cwd(), 'public', 'examples', 'acu_part-1_main_body.stp');
      const buf = (await readFile(path)).buffer;
      const { geometry, format } = await importPayload('acu_part-1_main_body.stp', buf);
      expect(format).toMatch(/STEP|STP/i);
      const pos = geometry.getAttribute('position');
      expect(pos).toBeTruthy();
      expect(pos!.count).toBeGreaterThan(100);
    },
    60_000,
  );

  it('importPayload parses STEP text exported from a box (AP214 B-rep round-trip)', async () => {
    const g = new THREE.BoxGeometry(10, 20, 30);
    const stepText = exportToStep(g, 'RoundTripBox');
    const buf = new TextEncoder().encode(stepText).buffer;
    const { geometry, format } = await importPayload('roundtrip.step', buf);
    expect(format).toMatch(/STEP|STP/i);
    const pos = geometry.getAttribute('position');
    expect(pos).toBeTruthy();
    expect(pos!.count).toBeGreaterThan(12);
  });
});
