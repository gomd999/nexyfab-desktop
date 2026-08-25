import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  EVIDENCE_BINDING_ROOTS,
  buildMechanicalInternalVerificationReceipt,
} from './run-mechanical-core-internal-verification.mjs';
import { TEXT_BINDING_CANONICALIZATION } from './canonical-text-binding.mjs';

const boundFiles = [
  'package.json',
  'package-lock.json',
  'scripts/run-mechanical-core-internal-verification.mjs',
  'src/lib/ai/mechanicalDesignGraph.ts',
  'src/lib/ai/mechanicalDesignGraph.test.ts',
  'src/lib/ai/mechanicalCoreFeatureContract.ts',
  'src/lib/ai/mechanicalCoreFeatureContract.test.ts',
  'scripts/mechanical-core-feature-local-closed-loop.ts',
  'scripts/mechanical-core-feature-local-closed-loop.test.ts',
  'scripts/mechanical-core-feature-local-runtime.ts',
  'scripts/mechanical-core-feature-local-runtime.test.ts',
  'scripts/mechanical-ai-intent-local-qualification.ts',
  'scripts/mechanical-ai-intent-local-qualification.test.ts',
  'scripts/verify-mechanical-ai-intent-local-qualification.ts',
  'scripts/verify-mechanical-ai-intent-local-qualification.test.ts',
  'scripts/mechanical-ai-intent-runtime-harness.ts',
  'scripts/mechanical-ai-intent-runtime-harness.test.ts',
  'scripts/verify-mechanical-ai-intent-runtime-receipt.ts',
  'scripts/verify-mechanical-ai-intent-runtime-receipt.test.ts',
  'scripts/build-assembly-drawing-handoff-readiness.mjs',
  'scripts/build-assembly-drawing-handoff-readiness.test.mjs',
  'src/lib/cad/assemblyDrawingHandoffStore.ts',
  'src/lib/cad/assemblyDrawingHandoffStore.test.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/route.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/route.sqlite.integration.test.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/[handoffId]/route.ts',
  'src/app/api/cron/assembly-drawing-handoff-prune/route.ts',
  'src/app/[lang]/shape-generator/assembly/serverDrawingHandoff.ts',
  'src/app/[lang]/shape-generator/features/mechanicalCoreFeatureRuntimeCoverage.test.ts',
  'src/app/[lang]/shape-generator/features/featureApplyCoverage.test.ts',
  'src/app/api/featureTree-intent/handler.ts',
  'src/app/api/featureTree-intent/route.test.ts',
  'src/lib/ai/mechanicalStepInteroperability.ts',
  'src/lib/ai/mechanicalStepInteroperability.test.ts',
  'scripts/run-mechanical-standalone-step-c4.mjs',
  'scripts/run-mechanical-standalone-step-c4.test.mjs',
  'scripts/build-mechanical-commercial-contract-assessments.ts',
  'scripts/build-mechanical-commercial-contract-assessments.test.ts',
  'src/app/[lang]/shape-generator/ai/programFromNfab.ts',
  'src/app/[lang]/shape-generator/ai/programFromNfab.test.ts',
  'src/lib/ai/guidedDesignBrief.ts',
  'src/lib/ai/guidedDesignBrief.test.ts',
  'src/lib/ai/aiCanonicalCandidate.ts',
  'src/lib/ai/aiCanonicalCandidate.test.ts',
  'src/app/[lang]/shape-generator/assembly/drawingHandoff.ts',
  'src/app/[lang]/shape-generator/assembly/drawingHandoff.test.ts',
  'src/app/[lang]/shape-generator/io/manufacturingPackage.ts',
  'src/app/[lang]/shape-generator/io/manufacturingPackage.test.ts',
  'src/app/[lang]/shape-generator/io/stepRoundtripReport.ts',
  'src/app/[lang]/shape-generator/io/stepExporter.ts',
  'src/app/[lang]/shape-generator/io/stepImporter.ts',
  'src/app/[lang]/shape-generator/features/occtEngine.ts',
  'src/app/[lang]/shape-generator/__tests__/geometrySignature.ts',
  'src/app/[lang]/shape-generator/io/__tests__/stepRoundtripReport.test.ts',
  'src/app/[lang]/shape-generator/io/__tests__/stepRoundtripWasm.feasibility.test.ts',
  'src/app/[lang]/shape-generator/io/__tests__/nfabMechanicalDesignGraphRoundtrip.test.ts',
  'src/lib/ai/domainAccuracyReleaseGate.ts',
  'src/lib/ai/domainAccuracyReleaseGate.test.ts',
  'public/replicad_single.wasm',
  'public/occt-import-js.wasm',
];

const evidenceFiles = EVIDENCE_BINDING_ROOTS.map((root, index) => `${root}/fixture-${index + 1}.json`);

function writeBoundFixture(root) {
  for (const relative of [...boundFiles, ...evidenceFiles]) {
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, relative.endsWith('.wasm') ? Buffer.from([0, 13, 10, 255]) : `${relative}\n`);
  }
}

test('receipt only passes when every required verification command passes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-mechanical-internal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeBoundFixture(root);
  const pass = buildMechanicalInternalVerificationReceipt({
    root,
    generatedAt: '2026-08-11T00:00:00.000Z',
    runCommand: (_root, name) => ({ name, command: name, exitCode: 0, durationMs: 1, environment: name === 'direct-cad' ? { RUN_OCCT_FEASIBILITY: '1' } : {} }),
  });
  assert.equal(pass.ok, true);
  assert.equal(pass.sourceBindings.length, boundFiles.length + evidenceFiles.length);
  assert.deepEqual(pass.bindingPolicy, {
    text: TEXT_BINDING_CANONICALIZATION,
    binary: 'raw',
    evidenceRoots: [...EVIDENCE_BINDING_ROOTS],
  });
  assert.equal(pass.sourceBindings.filter(item => item.canonicalization === 'raw').length, 2);
  assert.equal(pass.sourceBindings.filter(item => item.canonicalization === TEXT_BINDING_CANONICALIZATION).length, boundFiles.length + evidenceFiles.length - 2);
  assert.ok(EVIDENCE_BINDING_ROOTS.every(rootPath => pass.sourceBindings.some(item => item.path.startsWith(`${rootPath}/`))));
  assert.equal(pass.checks.coreThirtyImplementationCoverage, true);
  assert.equal(pass.checks.intentIntakeQualification, true);
  assert.equal(pass.checks.intentExactRuntimeRepresentative, true);
  assert.equal(pass.checks.assemblyDrawingHandoffLocalReadiness, true);
  assert.equal('coreThirtyRuntimeCoverage' in pass.checks, false);
  assert.equal(pass.claimBoundary.independentHoldout, false);

  const fail = buildMechanicalInternalVerificationReceipt({
    root,
    runCommand: (_root, name) => ({ name, command: name, exitCode: name === 'mechanical-accuracy' ? 1 : 0, durationMs: 1, environment: name === 'direct-cad' ? { RUN_OCCT_FEASIBILITY: '1' } : {} }),
  });
  assert.equal(fail.ok, false);
  assert.equal(fail.checks.mechanicalAccuracy, false);
  assert.equal(fail.checks.threeCycleStep, true);
});

test('text source bindings remain identical across LF and CRLF while WASM stays raw', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-mechanical-internal-eol-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeBoundFixture(root);
  for (const relative of [...boundFiles, ...evidenceFiles].filter(item => !item.endsWith('.wasm'))) {
    const absolute = path.join(root, ...relative.split('/'));
    fs.appendFileSync(absolute, 'second\n');
  }
  const runCommand = (_root, name) => ({ name, command: name, exitCode: 0, durationMs: 1, environment: name === 'direct-cad' ? { RUN_OCCT_FEASIBILITY: '1' } : {} });
  const lf = buildMechanicalInternalVerificationReceipt({ root, runCommand });
  for (const relative of [...boundFiles, ...evidenceFiles].filter(item => !item.endsWith('.wasm'))) {
    const absolute = path.join(root, ...relative.split('/'));
    fs.writeFileSync(absolute, fs.readFileSync(absolute, 'utf8').replaceAll('\n', '\r\n'));
  }
  const crlf = buildMechanicalInternalVerificationReceipt({ root, runCommand });
  assert.deepEqual(crlf.sourceBindings, lf.sourceBindings);
});

test('fails closed when a required checked-evidence directory is absent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-mechanical-internal-missing-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeBoundFixture(root);
  fs.rmSync(path.join(root, ...EVIDENCE_BINDING_ROOTS[0].split('/')), { recursive: true, force: true });
  assert.throws(
    () => buildMechanicalInternalVerificationReceipt({
      root,
      runCommand: (_root, name) => ({ name, command: name, exitCode: 0, durationMs: 1, environment: name === 'direct-cad' ? { RUN_OCCT_FEASIBILITY: '1' } : {} }),
    }),
    /MECHANICAL_INTERNAL_EVIDENCE_ROOT_MISSING/,
  );
});
