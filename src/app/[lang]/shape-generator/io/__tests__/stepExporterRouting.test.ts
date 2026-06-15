/**
 * stepExporterRouting.test.ts — Phase D non-box B-rep export routing.
 *
 * 상위: docs/strategy/M1_STEP_CUSTOMER_LIMITS.md (정량 한계 + 비-박스
 *      B-rep export 경로 명시)
 *      docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase C/D
 *      후속 ("비-박스 solid B-rep export")
 *
 * Asserts the routing contract of `exportToStepAsync` WITHOUT loading
 * the OCCT WASM kernel (so the test stays in the default CI suite).
 *
 *   Path 1 — geometry.userData.occtHandle present
 *            → exportOcctStep called directly (no mesh bridge needed)
 *   Path 2 — no handle, OCCT mesh bridge available
 *            → meshToOcctShapeHandle → exportOcctStep
 *   Path 3 — both paths fail → legacy `exportToStep` fallback
 *
 * Predicates:
 *   - canExportStepCleanly: true for BoxGeometry + handle-bearing geom
 *   - canExportStepViaBridge: true unconditionally (Route A always
 *     available when WASM is loadable; the bridge handles non-box B-rep)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

vi.mock('../../features/occtEngine', () => ({
  exportOcctStep: vi.fn(),
  meshToOcctShapeHandle: vi.fn(),
}));

import {
  exportToStepAsync,
  exportToStep,
  canExportStepCleanly,
  canExportStepViaBridge,
} from '../stepExporter';
import { exportOcctStep, meshToOcctShapeHandle } from '../../features/occtEngine';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('canExportStepCleanly — instant-export predicate', () => {
  it('returns true for BoxGeometry (AP214 NX-cube fast path)', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    expect(canExportStepCleanly(box)).toBe(true);
  });

  it('returns true when geometry carries an OCCT handle (from extrude/revolve/etc.)', () => {
    const cyl = new THREE.CylinderGeometry(5, 5, 10, 16);
    cyl.userData = { occtHandle: 'shape-42' };
    expect(canExportStepCleanly(cyl)).toBe(true);
  });

  it('returns false for a vanilla non-box mesh without OCCT handle (bridge path used)', () => {
    const cyl = new THREE.CylinderGeometry(5, 5, 10, 16);
    expect(canExportStepCleanly(cyl)).toBe(false);
  });
});

describe('canExportStepViaBridge — always-on predicate', () => {
  it('returns true for any geometry (Route A handles non-box meshes)', () => {
    const cyl = new THREE.CylinderGeometry(5, 5, 10, 16);
    const sph = new THREE.SphereGeometry(5, 16, 16);
    const torus = new THREE.TorusGeometry(5, 1, 8, 16);
    expect(canExportStepViaBridge(cyl)).toBe(true);
    expect(canExportStepViaBridge(sph)).toBe(true);
    expect(canExportStepViaBridge(torus)).toBe(true);
  });
});

describe('exportToStepAsync — routing contract', () => {
  it('Path 1 — uses existing OCCT handle directly (no mesh bridge)', async () => {
    const geom = new THREE.CylinderGeometry(5, 5, 10, 16);
    geom.userData = { occtHandle: 'shape-existing' };
    vi.mocked(exportOcctStep).mockResolvedValue('ISO-10303-21;\n... real STEP ...');

    const result = await exportToStepAsync(geom, 'cyl1');

    expect(exportOcctStep).toHaveBeenCalledWith('shape-existing');
    expect(meshToOcctShapeHandle).not.toHaveBeenCalled();
    expect(result).toContain('ISO-10303-21');
  });

  it('Path 2 — no handle, bridges through meshToOcctShapeHandle and exports B-rep', async () => {
    const geom = new THREE.CylinderGeometry(5, 5, 10, 16);
    vi.mocked(meshToOcctShapeHandle).mockResolvedValue('shape-bridged');
    vi.mocked(exportOcctStep).mockResolvedValue('ISO-10303-21;\n... bridged STEP ...');

    const result = await exportToStepAsync(geom, 'cyl2');

    expect(meshToOcctShapeHandle).toHaveBeenCalledWith(geom);
    expect(exportOcctStep).toHaveBeenCalledWith('shape-bridged');
    expect(result).toContain('ISO-10303-21');
    // Bridge cached the handle for re-export
    expect(geom.userData?.occtHandle).toBe('shape-bridged');
  });

  it('Path 2 — second export of same geometry reuses cached bridged handle', async () => {
    const geom = new THREE.CylinderGeometry(5, 5, 10, 16);
    vi.mocked(meshToOcctShapeHandle).mockResolvedValue('shape-bridged');
    vi.mocked(exportOcctStep).mockResolvedValue('ISO-10303-21;\n... bridged STEP ...');

    await exportToStepAsync(geom, 'cyl-A');
    // Reset bridge mock; cached handle should bypass it.
    vi.mocked(meshToOcctShapeHandle).mockReset();
    vi.mocked(exportOcctStep).mockResolvedValue('ISO-10303-21;\n... reused STEP ...');

    await exportToStepAsync(geom, 'cyl-B');
    expect(meshToOcctShapeHandle).not.toHaveBeenCalled();
    expect(exportOcctStep).toHaveBeenLastCalledWith('shape-bridged');
  });

  it('Path 3 — both bridges fail → legacy tessellated emitter (Box still round-trips)', async () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    vi.mocked(meshToOcctShapeHandle).mockResolvedValue(null);
    vi.mocked(exportOcctStep).mockResolvedValue(null);

    const result = await exportToStepAsync(box, 'fallback-box');

    // Fallback yields valid AP214 cube STEP via legacy emitter.
    expect(result).toContain('ISO-10303-21');
    expect(result).toContain('fallback-box');
  });

  it('Path 3 — handle path returns null → falls through to mesh bridge', async () => {
    const geom = new THREE.BoxGeometry(5, 5, 5);
    geom.userData = { occtHandle: 'stale-handle' };
    vi.mocked(exportOcctStep)
      .mockResolvedValueOnce(null) // Path 1 returns null
      .mockResolvedValueOnce('ISO-10303-21;\n... bridged ...'); // Path 2 succeeds
    vi.mocked(meshToOcctShapeHandle).mockResolvedValue('fresh-handle');

    const result = await exportToStepAsync(geom, 'recovery-box');

    expect(exportOcctStep).toHaveBeenCalledTimes(2);
    expect(meshToOcctShapeHandle).toHaveBeenCalled();
    expect(result).toContain('ISO-10303-21');
  });
});

describe('exportToStep (sync legacy emitter) — Box vs non-box', () => {
  it('returns AP214 NX-cube STEP for BoxGeometry (round-trips through OCCT)', () => {
    const box = new THREE.BoxGeometry(20, 10, 5);
    const stp = exportToStep(box, 'my-box');
    expect(stp).toContain('ISO-10303-21');
    expect(stp).toContain('my-box');
    // AP214 box path uses CARTESIAN_POINT primitives, not TRIANGULATED_FACE.
    expect(stp).toContain('CARTESIAN_POINT');
  });

  it('returns AP242 tessellated STEP for non-box (legacy path; importer-rejection risk noted)', () => {
    const cyl = new THREE.CylinderGeometry(5, 5, 10, 16);
    cyl.computeVertexNormals();
    const stp = exportToStep(cyl, 'my-cyl');
    expect(stp).toContain('ISO-10303-21');
    expect(stp).toContain('my-cyl');
    // Tessellated AP242 emits TRIANGULATED_FACE.
    expect(stp).toContain('TRIANGULATED_FACE');
  });
});
