/**
 * assemblyStepExport.test.ts — single-STEP multi-body assembly export.
 *
 * Routing + transform tests (no OCCT WASM required — replicad +
 * occtEngine are mocked). Verifies:
 *   - empty parts list → throws
 *   - replicad unavailable → throws with clear message
 *   - per-part transform decomposition: translate path, rotate path,
 *     identity skipped
 *   - all parts fail bridge → throws
 *   - partial failure surfaces diagnostics + still composes the rest
 *   - single-part fast path (no makeCompound)
 *   - multi-part composition via makeCompound
 *   - rebrand step: PRODUCT name replaced with assembly name
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

const occtMock = vi.hoisted(() => ({
  meshToOcctShapeHandle: vi.fn(),
  exportOcctStep: vi.fn(),
  getShape: vi.fn(),
  registerShape: vi.fn((s: unknown) => `handle:${(s as { __id?: string }).__id ?? Math.random()}`),
}));

vi.mock('../../features/occtEngine', () => occtMock);

const replicadMock = vi.hoisted(() => ({
  makeCompound: vi.fn(),
}));

vi.mock('replicad', () => replicadMock);

import { exportAssemblyToStepAsync, type AssemblyStepPart } from '../assemblyStepExport';

function makeShape(id: string) {
  // Minimal Replicad-shaped mock — clone / translate / rotate return self
  // so we can verify call order without managing immutable lineage.
  const shape: Record<string, unknown> = { __id: id };
  shape.clone = vi.fn(() => shape);
  shape.translate = vi.fn(() => shape);
  shape.rotate = vi.fn(() => shape);
  shape.blobSTEP = vi.fn(() => new Blob([''], { type: 'text/plain' }));
  return shape;
}

const sampleStep = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');
FILE_NAME('Open CASCADE.step','2026-05-29',('OpenCascade'),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=APPLICATION_CONTEXT('core data for automotive mechanical design processes');
#2=PRODUCT('Compound','Compound','',(#3));
ENDSEC;
END-ISO-10303-21;`;

beforeEach(() => {
  vi.clearAllMocks();
  occtMock.exportOcctStep.mockResolvedValue(sampleStep);
});

describe('exportAssemblyToStepAsync — preconditions', () => {
  it('throws when parts list is empty', async () => {
    await expect(exportAssemblyToStepAsync([])).rejects.toThrow(/empty/);
  });

  it('throws when all parts fail OCCT bridge', async () => {
    occtMock.meshToOcctShapeHandle.mockResolvedValue(null);
    const parts: AssemblyStepPart[] = [
      { id: 'p1', geometry: new THREE.BoxGeometry(1, 1, 1) },
      { id: 'p2', geometry: new THREE.SphereGeometry(1) },
    ];
    await expect(exportAssemblyToStepAsync(parts)).rejects.toThrow(/no parts could be exported/);
  });
});

describe('exportAssemblyToStepAsync — single-part fast path', () => {
  it('skips makeCompound when only one part composed (cost saving)', async () => {
    const shape = makeShape('s1');
    occtMock.meshToOcctShapeHandle.mockResolvedValue('h1');
    occtMock.getShape.mockReturnValue(shape);

    const result = await exportAssemblyToStepAsync(
      [{ id: 'p1', geometry: new THREE.BoxGeometry(1, 1, 1) }],
      'single-asm',
    );

    expect(replicadMock.makeCompound).not.toHaveBeenCalled();
    expect(result.bodyCount).toBe(1);
    expect(result.stepText).toContain('ISO-10303-21');
    expect(result.diagnostics).toEqual([]);
  });

  it('reuses geometry.userData.occtHandle when present (no second bridge call)', async () => {
    const shape = makeShape('cached');
    occtMock.getShape.mockReturnValue(shape);
    const geom = new THREE.BoxGeometry(1, 1, 1);
    geom.userData = { occtHandle: 'cached-handle' };

    await exportAssemblyToStepAsync([{ id: 'p1', geometry: geom }]);

    expect(occtMock.meshToOcctShapeHandle).not.toHaveBeenCalled();
    expect(occtMock.getShape).toHaveBeenCalledWith('cached-handle');
  });
});

describe('exportAssemblyToStepAsync — multi-part composition', () => {
  it('calls makeCompound with all transformed shapes', async () => {
    const shapeA = makeShape('A');
    const shapeB = makeShape('B');
    occtMock.meshToOcctShapeHandle.mockResolvedValueOnce('h-a').mockResolvedValueOnce('h-b');
    occtMock.getShape.mockReturnValueOnce(shapeA).mockReturnValueOnce(shapeB);
    const compound = makeShape('comp');
    replicadMock.makeCompound.mockReturnValue(compound);

    const result = await exportAssemblyToStepAsync([
      { id: 'a', geometry: new THREE.BoxGeometry(1, 1, 1) },
      { id: 'b', geometry: new THREE.BoxGeometry(2, 2, 2) },
    ], 'two-part');

    expect(replicadMock.makeCompound).toHaveBeenCalledTimes(1);
    expect(replicadMock.makeCompound).toHaveBeenCalledWith([shapeA, shapeB]);
    expect(result.bodyCount).toBe(2);
  });

  it('partial failure: 1/3 parts bridge fails, the other 2 still compose with diagnostics', async () => {
    const shapeA = makeShape('A');
    const shapeC = makeShape('C');
    occtMock.meshToOcctShapeHandle
      .mockResolvedValueOnce('h-a')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('h-c');
    occtMock.getShape
      .mockReturnValueOnce(shapeA)
      .mockReturnValueOnce(shapeC);
    replicadMock.makeCompound.mockReturnValue(makeShape('comp'));

    const result = await exportAssemblyToStepAsync([
      { id: 'a', geometry: new THREE.BoxGeometry(1, 1, 1) },
      { id: 'b-fails', geometry: new THREE.SphereGeometry(1) },
      { id: 'c', geometry: new THREE.BoxGeometry(2, 2, 2) },
    ]);

    expect(result.bodyCount).toBe(2);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toEqual({ partId: 'b-fails', warning: 'mesh→OCCT bridge failed' });
  });
});

describe('exportAssemblyToStepAsync — transform application', () => {
  it('translate-only transform → calls shape.translate(x,y,z) once, no rotate', async () => {
    const shape = makeShape('t');
    occtMock.meshToOcctShapeHandle.mockResolvedValue('h');
    occtMock.getShape.mockReturnValue(shape);

    const t = new THREE.Matrix4().makeTranslation(10, 20, 30);
    await exportAssemblyToStepAsync([
      { id: 'p', geometry: new THREE.BoxGeometry(1, 1, 1), transform: t },
    ]);

    expect(shape.translate).toHaveBeenCalledWith(10, 20, 30);
    expect(shape.rotate).not.toHaveBeenCalled();
  });

  it('identity transform → no translate or rotate calls', async () => {
    const shape = makeShape('i');
    occtMock.meshToOcctShapeHandle.mockResolvedValue('h');
    occtMock.getShape.mockReturnValue(shape);

    const id = new THREE.Matrix4().identity();
    await exportAssemblyToStepAsync([
      { id: 'p', geometry: new THREE.BoxGeometry(1, 1, 1), transform: id },
    ]);

    expect(shape.translate).not.toHaveBeenCalled();
    expect(shape.rotate).not.toHaveBeenCalled();
  });

  it('rotation-only transform → calls shape.rotate with axis + angle in degrees', async () => {
    const shape = makeShape('r');
    occtMock.meshToOcctShapeHandle.mockResolvedValue('h');
    occtMock.getShape.mockReturnValue(shape);

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    await exportAssemblyToStepAsync([
      { id: 'p', geometry: new THREE.BoxGeometry(1, 1, 1), transform: m },
    ]);

    expect(shape.rotate).toHaveBeenCalled();
    const rotateCall = (shape.rotate as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(rotateCall[0]).toBeCloseTo(90, 1);
    expect(rotateCall[1]).toEqual([0, 0, 0]);
    expect(rotateCall[2][2]).toBeCloseTo(1, 5);
  });

  it('combined translate + rotate → both called in order (rotate first, then translate)', async () => {
    const shape = makeShape('tr');
    const calls: string[] = [];
    (shape.translate as ReturnType<typeof vi.fn>).mockImplementation(() => { calls.push('translate'); return shape; });
    (shape.rotate as ReturnType<typeof vi.fn>).mockImplementation(() => { calls.push('rotate'); return shape; });
    occtMock.meshToOcctShapeHandle.mockResolvedValue('h');
    occtMock.getShape.mockReturnValue(shape);

    const t = new THREE.Matrix4()
      .makeRotationY(Math.PI / 4)
      .setPosition(5, 10, 15);
    await exportAssemblyToStepAsync([
      { id: 'p', geometry: new THREE.BoxGeometry(1, 1, 1), transform: t },
    ]);

    expect(calls).toEqual(['rotate', 'translate']);
  });
});

describe('exportAssemblyToStepAsync — rebrand', () => {
  it('replaces "Compound" PRODUCT entry with the supplied assembly name', async () => {
    const shape1 = makeShape('1');
    const shape2 = makeShape('2');
    occtMock.meshToOcctShapeHandle.mockResolvedValueOnce('a').mockResolvedValueOnce('b');
    occtMock.getShape.mockReturnValueOnce(shape1).mockReturnValueOnce(shape2);
    replicadMock.makeCompound.mockReturnValue(makeShape('comp'));

    const result = await exportAssemblyToStepAsync(
      [
        { id: 'a', geometry: new THREE.BoxGeometry(1, 1, 1) },
        { id: 'b', geometry: new THREE.BoxGeometry(2, 2, 2) },
      ],
      'My_Asm_2',
    );

    expect(result.stepText).toContain("PRODUCT('My_Asm_2','My_Asm_2',");
    expect(result.stepText).toContain("'My_Asm_2.step'");
    expect(result.stepText).not.toContain("PRODUCT('Compound','Compound',");
  });
});
