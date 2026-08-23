import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MECHANICAL_CORE_EXACT_RUNTIME_BUNDLE,
  MECHANICAL_CORE_FIFTH_RUNTIME_BUNDLE,
  MECHANICAL_CORE_FOURTH_RUNTIME_BUNDLE,
  MECHANICAL_CORE_RUNTIME_BUNDLE,
  MECHANICAL_CORE_SIXTH_RUNTIME_BUNDLE,
  MECHANICAL_CORE_THIRD_RUNTIME_BUNDLE,
  executeMechanicalCoreRuntimeBundle,
  type MechanicalCoreRuntimePaths,
} from './mechanical-core-feature-local-runtime';
import { tabFeature } from '../src/app/[lang]/shape-generator/features/tab';
import { cutFeature } from '../src/app/[lang]/shape-generator/features/cut';
import { threadFeature } from '../src/app/[lang]/shape-generator/features/thread';
import { bendFeature, flangeFeature, hemFeature, jogFeature } from '../src/app/[lang]/shape-generator/features/sheetMetal';
import { bendReliefFeature, cornerReliefFeature } from '../src/app/[lang]/shape-generator/features/reliefCuts';
import { variableShellFeature } from '../src/app/[lang]/shape-generator/features/variableShell';
import {
  ensureOcctReady,
  occtBaseSolid,
  occtRegisteredShapeEvidence,
  resetShapeRegistry,
  setOcctGlobalMode,
} from '../src/app/[lang]/shape-generator/features/occtEngine';
import { MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES, requiredMechanicalCoreLocalAssertionSuffixes } from '../src/lib/ai/mechanicalCoreFeatureContract';
import { verifyMechanicalCoreLocalBinding } from './mechanical-core-feature-local-closed-loop';

const root = process.cwd();
const scratch = `.mechanical-runtime-test-${process.pid}-${Date.now()}`;
const paths: MechanicalCoreRuntimePaths = {
  artifactRoot: `${scratch}/artifacts`,
  receiptOutput: `${scratch}/axis-evidence.json`,
};

afterAll(() => {
  fs.rmSync(path.resolve(root, scratch), { recursive: true, force: true });
});

describe('mechanical core cumulative exact runtime bundle', () => {
  it('executes all 30 exact features through all seven closed-loop axes', async () => {
    const result = await executeMechanicalCoreRuntimeBundle(
      root,
      paths,
      new Date('2026-08-13T03:00:00.000Z'),
    );

    expect(result.bundleComplete).toBe(true);
    expect(result.bundleAxisTotals).toEqual({ PASS: 210, FAIL: 0, NOT_RUN: 0 });
    const bundleRuns = result.receipt.runs.filter(run =>
      (MECHANICAL_CORE_RUNTIME_BUNDLE as readonly string[]).includes(run.feature));
    expect(bundleRuns).toHaveLength(210);
    expect(new Set(bundleRuns.map(run => `${run.feature}:${run.axis}`)).size).toBe(210);
    expect(new Set(bundleRuns.map(run => run.axis))).toEqual(new Set(MECHANICAL_CORE_LOCAL_CLOSED_LOOP_AXES));
    for (const run of bundleRuns) {
      const exact = (MECHANICAL_CORE_EXACT_RUNTIME_BUNDLE as readonly string[]).includes(run.feature);
      expect(exact).toBe(true);
      expect(run.status).toBe('PASS');
      expect(run.executedAt).toBe('2026-08-13T03:00:00.000Z');
      expect(run.designRevisionSha256).toBe(result.receipt.designRevisionSha256);
      expect(run.selectionIdentity).toMatchObject({ featureFamily: run.feature, featureId: 'runtime-feature', preserved: true, topologySilentRemapCount: 0 });
      expect(run.evidence.length).toBeGreaterThan(0);
      for (const suffix of requiredMechanicalCoreLocalAssertionSuffixes(run.axis)) {
        expect(run.evidence.some(binding => binding.assertionId.endsWith(suffix))).toBe(true);
      }
      for (const binding of run.evidence) {
        expect(binding.bytes).toBeGreaterThan(0);
        expect(verifyMechanicalCoreLocalBinding(root, binding)).toBe(true);
      }
    }
  }, 180_000);

  it('records native STEP and exact HLR for every exact feature', () => {
    for (const feature of MECHANICAL_CORE_EXACT_RUNTIME_BUNDLE) {
      const step = fs.readFileSync(path.resolve(root, paths.artifactRoot, feature, `${feature}-edited.step`));
      const svg = fs.readFileSync(path.resolve(root, paths.artifactRoot, feature, `${feature}-exact-hlr.svg`));
      expect(step.toString('utf8')).toContain('ISO-10303-21');
      expect(svg.toString('utf8')).toContain('<svg');
      expect(svg.toString('utf8')).toContain('<path');
      expect(crypto.createHash('sha256').update(step).digest('hex')).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('binds exact feature-meaning assertions for the third requested bundle', () => {
    expect(MECHANICAL_CORE_THIRD_RUNTIME_BUNDLE).toEqual([
      'variableFillet', 'offsetFace', 'thread', 'helix', 'bend',
    ]);
    for (const feature of MECHANICAL_CORE_THIRD_RUNTIME_BUNDLE) {
      const create = JSON.parse(fs.readFileSync(
        path.resolve(root, paths.artifactRoot, feature, 'create.json'),
        'utf8',
      )) as { featureMeaning?: { assertion?: string } };
      expect(create.featureMeaning?.assertion).toBeTruthy();
    }
  });

  it('uses product OCCT applyAsync paths and binds meaning for exact fourth-bundle features', () => {
    expect(MECHANICAL_CORE_FOURTH_RUNTIME_BUNDLE).toEqual(['flange', 'hem', 'jog', 'tab', 'cut']);
    expect(flangeFeature.applyAsync).toBeTypeOf('function');
    expect(hemFeature.applyAsync).toBeTypeOf('function');
    expect(jogFeature.applyAsync).toBeTypeOf('function');
    expect(tabFeature.applyAsync).toBeTypeOf('function');
    expect(cutFeature.applyAsync).toBeTypeOf('function');
    for (const feature of ['flange', 'hem', 'jog', 'tab', 'cut'] as const) {
      const create = JSON.parse(fs.readFileSync(
        path.resolve(root, paths.artifactRoot, feature, 'create.json'),
        'utf8',
      )) as { featureMeaning?: { assertion?: string } };
      expect(create.featureMeaning?.assertion).toMatch(/exact/);
    }
  });

  it('exposes exact product applyAsync paths for thread, bend, and flange', () => {
    expect(threadFeature.applyAsync).toBeTypeOf('function');
    expect(bendFeature.applyAsync).toBeTypeOf('function');
    expect(flangeFeature.applyAsync).toBeTypeOf('function');
    for (const feature of ['thread', 'bend', 'flange'] as const) {
      const create = JSON.parse(fs.readFileSync(
        path.resolve(root, paths.artifactRoot, feature, 'create.json'),
        'utf8',
      )) as { featureMeaning?: { assertion?: string }; exact?: { singleSolid?: boolean } };
      expect(create.featureMeaning?.assertion).toMatch(/actual product/);
      expect(create.exact?.singleSolid).toBe(true);
    }
  });

  it('routes the actual tab/cut feature definitions through registered OCCT solids', async () => {
    await ensureOcctReady();
    setOcctGlobalMode(true);
    try {
      for (const [definition, params] of [
        [tabFeature, { width: 20, length: 10, position: 50, edgeIndex: 0 }],
        [cutFeature, { width: 20, length: 10, posX: 0, posZ: 0, endCondition: 1, depth: 2 }],
      ] as const) {
        resetShapeRegistry();
        const base = occtBaseSolid('box', { width: 60, height: 4, depth: 30 });
        expect(base.handle).toBeTruthy();
        base.geometry.userData.occtHandle = base.handle!;
        const output = await definition.applyAsync!(base.geometry, params, { featureId: `runtime-${definition.type}` });
        const handle = output.userData.occtHandle as string | undefined;
        expect(handle).toBeTruthy();
        const exact = occtRegisteredShapeEvidence(handle);
        expect(exact?.singleSolid).toBe(true);
        expect(exact?.volumeMm3).toBeGreaterThan(0);
      }
    } finally {
      setOcctGlobalMode(false);
      resetShapeRegistry();
    }
  }, 60_000);

  it('runs every exact product path from the fifth bundle with bounded variable-shell scope', () => {
    expect(MECHANICAL_CORE_FIFTH_RUNTIME_BUNDLE).toEqual([
      'bendRelief', 'cornerRelief', 'variableShell', 'sketchExtrude', 'revolve',
    ]);
    expect(bendReliefFeature.applyAsync).toBeTypeOf('function');
    expect(cornerReliefFeature.applyAsync).toBeTypeOf('function');
    expect(variableShellFeature.applyAsync).toBeTypeOf('function');
    for (const feature of MECHANICAL_CORE_FIFTH_RUNTIME_BUNDLE) {
      const create = JSON.parse(fs.readFileSync(
        path.resolve(root, paths.artifactRoot, feature, 'create.json'),
        'utf8',
      )) as { featureMeaning?: { assertion?: string; exactScope?: string }; exactScope?: string; exact?: { singleSolid?: boolean } };
      expect(create.featureMeaning?.assertion).toContain('actual product');
      expect(create.exact?.singleSolid).toBe(true);
      if (feature === 'variableShell') {
        expect(create.exactScope).toContain('bbox-faithful box only');
        expect(create.featureMeaning?.exactScope).toContain('general per-face B-Rep thickening remains unsupported');
      }
    }
  });

  it('binds exact product meaning for the sixth requested bundle', () => {
    expect(MECHANICAL_CORE_SIXTH_RUNTIME_BUNDLE).toEqual([
      'revolve', 'sweep', 'loft', 'mirror', 'boolean', 'splitBody', 'helix',
    ]);
    for (const feature of MECHANICAL_CORE_SIXTH_RUNTIME_BUNDLE) {
      const create = JSON.parse(fs.readFileSync(
        path.resolve(root, paths.artifactRoot, feature, 'create.json'),
        'utf8',
      )) as { featureMeaning?: { assertion?: string }; exact?: { singleSolid?: boolean } };
      expect(create.featureMeaning?.assertion).toBeTruthy();
      expect(create.exact?.singleSolid).toBe(true);
    }
  });
});
