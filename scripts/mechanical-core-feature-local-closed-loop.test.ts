import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MECHANICAL_CORE_30_FEATURES,
  MECHANICAL_CORE_LOCAL_AXIS_EVIDENCE_SCHEMA,
  mechanicalCoreSelectionIdentityPayload,
  requiredMechanicalCoreLocalAssertionSuffixes,
  type MechanicalCoreLocalAxisEvidenceV1,
} from '../src/lib/ai/mechanicalCoreFeatureContract';
import {
  MECHANICAL_CORE_IMPLEMENTATION_SOURCES,
  buildMechanicalCoreFeatureLocalReadiness,
  checkMechanicalCoreFeatureLocalReadiness,
  writeMechanicalCoreFeatureLocalReadiness,
} from './mechanical-core-feature-local-closed-loop';

const paths = {
  evidenceInput: 'evidence/local-axis.json',
  assessmentOutput: 'out/readiness.json',
};
const sha256 = (bytes: Uint8Array): string => crypto.createHash('sha256').update(bytes).digest('hex');

function write(root: string, relative: string, value: string | Uint8Array) {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, value);
}

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-mechanical-local-'));
  const featureSymbols = MECHANICAL_CORE_30_FEATURES
    .filter(feature => feature !== 'sketchExtrude')
    .map(feature => `${feature}Feature`)
    .join('\n');
  write(
    root,
    'src/app/[lang]/shape-generator/features/index.ts',
    `${featureSymbols}\nexport function getFeatureDefinition(type: string) { if (type === 'sketchExtrude') return undefined; }\n`,
  );
  write(root, 'scripts/mechanical-core-feature-local-runtime.ts', `MECHANICAL_CORE_RUNTIME_BUNDLE\n${MECHANICAL_CORE_30_FEATURES.join('\n')}`);
  for (const sources of Object.values(MECHANICAL_CORE_IMPLEMENTATION_SOURCES)) {
    for (const source of sources) write(root, source, `// ${source}\n`);
  }
  return root;
}

function oneAxisReceipt(artifact: { path: string; sha256: string }): MechanicalCoreLocalAxisEvidenceV1 {
  const selectionIdentity = {
    featureFamily: 'hole' as const,
    featureId: 'runtime-feature',
    selectionId: 'hole:runtime-feature-selection',
    identitySha256: '',
    preserved: true,
    topologySilentRemapCount: 0,
  };
  selectionIdentity.identitySha256 = sha256(Buffer.from(mechanicalCoreSelectionIdentityPayload(selectionIdentity), 'utf8'));
  return {
    schema: MECHANICAL_CORE_LOCAL_AXIS_EVIDENCE_SCHEMA,
    generatedAt: '2026-08-13T00:00:00.000Z',
    designRevisionSha256: 'a'.repeat(64),
    runs: [{
      feature: 'hole',
      axis: 'create',
      status: 'PASS',
      executedAt: '2026-08-13T00:00:00.000Z',
      evidence: [{ ...artifact, bytes: 12, assertionId: `hole${requiredMechanicalCoreLocalAssertionSuffixes('create')[0]}` }],
      selectionIdentity,
      designRevisionSha256: 'a'.repeat(64),
    }],
  };
}

describe('mechanical core feature local closed-loop runner', () => {
  it('inventories all 30 runtime bindings but leaves 210 axes NOT_RUN without receipts', () => {
    const root = fixtureRoot();
    const result = buildMechanicalCoreFeatureLocalReadiness(root, paths);
    expect(result).toMatchObject({
      status: 'HOLD',
      eligible: false,
      inputErrors: ['local_axis_evidence_missing'],
      implementation: { required: 30, wired: 30, missing: [] },
      closedLoop: {
        passedFeatures: 0,
        axisTotals: { PASS: 0, FAIL: 0, NOT_RUN: 210 },
      },
    });
  });

  it('accepts one locally hashed axis while every unexecuted axis stays NOT_RUN', () => {
    const root = fixtureRoot();
    const bytes = Buffer.from('{"ok":true}\n');
    const artifact = { path: 'artifacts/hole-create.json', sha256: sha256(bytes) };
    write(root, artifact.path, bytes);
    write(root, paths.evidenceInput, `${JSON.stringify(oneAxisReceipt(artifact))}\n`);
    const result = buildMechanicalCoreFeatureLocalReadiness(root, paths);
    expect(result.closedLoop.axisTotals).toEqual({ PASS: 1, FAIL: 0, NOT_RUN: 209 });
    expect(result.closedLoop.cases.find(item => item.feature === 'hole')).toMatchObject({
      status: 'NOT_RUN',
      passedAxes: 1,
    });
    expect(result.eligible).toBe(false);
  });

  it('downgrades a claimed PASS after its bound artifact is changed', () => {
    const root = fixtureRoot();
    const bytes = Buffer.from('{"ok":true}\n');
    const artifact = { path: 'artifacts/hole-create.json', sha256: sha256(bytes) };
    write(root, artifact.path, bytes);
    write(root, paths.evidenceInput, `${JSON.stringify(oneAxisReceipt(artifact))}\n`);
    expect(buildMechanicalCoreFeatureLocalReadiness(root, paths).closedLoop.axisTotals.PASS).toBe(1);
    write(root, artifact.path, '{"ok":false}\n');
    const tampered = buildMechanicalCoreFeatureLocalReadiness(root, paths);
    expect(tampered.closedLoop.axisTotals).toEqual({ PASS: 0, FAIL: 1, NOT_RUN: 209 });
    expect(tampered.closedLoop.blockers).toContain('feature:hole:axis:create:binding_unverified');
  });

  it('writes a deterministic HOLD assessment and separately reports currency from eligibility', () => {
    const root = fixtureRoot();
    const written = writeMechanicalCoreFeatureLocalReadiness(root, paths);
    expect(written.eligible).toBe(false);
    expect(checkMechanicalCoreFeatureLocalReadiness(root, paths)).toMatchObject({
      current: true,
      eligible: false,
    });
  });
});
