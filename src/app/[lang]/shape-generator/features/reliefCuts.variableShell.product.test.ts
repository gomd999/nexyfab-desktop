import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureOcctReady,
  exportOcctStep,
  occtRegisteredShapeEvidence,
  resetShapeRegistry,
  setOcctGlobalMode,
} from './occtEngine';
import {
  applyBendReliefExact,
  applyCornerReliefExact,
  bendReliefFeature,
  cornerReliefFeature,
} from './reliefCuts';
import { applyVariableShellExactBox, variableShellFeature } from './variableShell';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

function handleOf(geometry: THREE.BufferGeometry): string {
  const handle = geometry.userData?.occtHandle;
  expect(typeof handle).toBe('string');
  expect(handle.length).toBeGreaterThan(0);
  return handle as string;
}

function exactVolume(geometry: THREE.BufferGeometry): number {
  const evidence = occtRegisteredShapeEvidence(handleOf(geometry));
  expect(evidence?.singleSolid).toBe(true);
  expect(evidence?.solidCount).toBe(1);
  expect(evidence?.volumeMm3).not.toBeNull();
  return evidence!.volumeMm3!;
}

function plateWithBend(): THREE.BufferGeometry {
  const plate = new THREE.BoxGeometry(100, 2, 50);
  plate.userData.__bendHistory = [{
    angle: 90,
    radius: 2,
    position: 0.5,
    direction: 'up',
    lineAxis: 'x',
    linePos: 0,
  }];
  return plate;
}

describeMaybe('relief and variable-shell exact product paths', () => {
  beforeAll(async () => {
    await ensureOcctReady();
    setOcctGlobalMode(true);
  }, 120_000);

  beforeEach(() => {
    resetShapeRegistry();
    setOcctGlobalMode(true);
  });

  afterAll(() => {
    setOcctGlobalMode(false);
    resetShapeRegistry();
  });

  it('cuts both rectangular bend-relief notches as one registered exact solid', async () => {
    const out = applyBendReliefExact(plateWithBend(), {
      width: 4,
      depth: 6,
      position: 0.5,
      shape: 'rectangular',
    });
    expect(exactVolume(out)).toBeCloseTo(10_000 - 2 * 4 * 6 * 2, 3);
    const step = await exportOcctStep(handleOf(out));
    expect(step).toContain('ISO-10303-21');
  }, 30_000);

  it('cuts a square corner relief without replacing the plate by its bbox', () => {
    const out = applyCornerReliefExact(new THREE.BoxGeometry(100, 2, 50), {
      corner: 0,
      shape: 'square',
      size: 8,
      inset: 0,
    });
    expect(exactVolume(out)).toBeCloseTo(10_000 - 4 * 4 * 2, 3);
  });

  it('keeps obround bend and circular corner variants on exact kernel solids', () => {
    const bend = applyBendReliefExact(plateWithBend(), {
      width: 4,
      depth: 6,
      position: 0.5,
      shape: 'obround',
    });
    const perNotchArea = 4 * (6 - 4 / 2) + Math.PI * (4 / 2) ** 2 / 2;
    expect(exactVolume(bend)).toBeCloseTo(10_000 - 2 * perNotchArea * 2, 2);

    const corner = applyCornerReliefExact(new THREE.BoxGeometry(100, 2, 50), {
      corner: 0,
      shape: 'circular',
      size: 8,
      inset: 0,
    });
    expect(exactVolume(corner)).toBeCloseTo(10_000 - Math.PI * 4 ** 2 / 4 * 2, 2);
  });

  it('creates a closed per-direction exact shell for a faithful box', async () => {
    const out = applyVariableShellExactBox(new THREE.BoxGeometry(50, 50, 50), {
      topThickness: 2,
      sideThickness: 1.5,
      bottomThickness: 3,
      openFace: 0,
    });
    expect(exactVolume(out)).toBeCloseTo(125_000 - 47 * 45 * 47, 3);
    const step = await exportOcctStep(handleOf(out));
    expect(step).toContain('ISO-10303-21');
  }, 30_000);

  it('routes all three feature definitions to registered B-Reps in exact mode', async () => {
    const bend = await bendReliefFeature.applyAsync!(plateWithBend(), {
      width: 4, depth: 6, position: 50, shape: 0,
    }, { featureId: 'bend-relief-product' });
    const corner = await cornerReliefFeature.applyAsync!(new THREE.BoxGeometry(100, 2, 50), {
      corner: 0, shape: 1, size: 8, inset: 0,
    }, { featureId: 'corner-relief-product' });
    const shell = await variableShellFeature.applyAsync!(new THREE.BoxGeometry(50, 50, 50), {
      topThickness: 2, sideThickness: 1.5, bottomThickness: 3, openFace: 1,
    }, { featureId: 'variable-shell-product' });

    expect(exactVolume(bend)).toBeGreaterThan(0);
    expect(exactVolume(corner)).toBeGreaterThan(0);
    // Top opening pierces the host; only the in-body 47 mm cavity height
    // contributes to the removed volume (the 1 mm boolean pad is outside).
    expect(exactVolume(shell)).toBeCloseTo(125_000 - 47 * 47 * 47, 3);
    expect(bend.userData.__meshDowngrades).toBeUndefined();
    expect(corner.userData.__meshDowngrades).toBeUndefined();
    expect(shell.userData.__meshDowngrades).toBeUndefined();
  }, 30_000);

  it('fails closed on non-box variable shell, stale relief hosts, and invalid dimensions', () => {
    expect(() => applyVariableShellExactBox(new THREE.TorusGeometry(10, 2), {
      topThickness: 2,
      sideThickness: 1.5,
      bottomThickness: 3,
      openFace: 0,
    })).toThrow('VARIABLE_SHELL_EXACT_BOX_REQUIRED');

    const nonBox = new THREE.TorusGeometry(10, 2);
    nonBox.userData.__bendHistory = [{
      angle: 90,
      radius: 2,
      position: 0.5,
      direction: 'up',
      lineAxis: 'x',
      linePos: 0,
    }];
    expect(() => applyBendReliefExact(nonBox, {
      width: 4,
      depth: 6,
      position: 0.5,
      shape: 'rectangular',
    })).toThrow(/no B-rep handle|plain box/);

    expect(() => applyVariableShellExactBox(new THREE.BoxGeometry(10, 10, 10), {
      topThickness: 2,
      sideThickness: 5,
      bottomThickness: 2,
      openFace: 0,
    })).toThrow('VARIABLE_SHELL_THICKNESS_TOO_LARGE');
  });
});
