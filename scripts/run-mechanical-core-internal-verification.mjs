#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUTPUT_REL = 'docs/evidence/cad-independent/mechanical-core-internal-verification.json';
const SOURCE_BINDINGS = Object.freeze([
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
]);

const DIRECT_TESTS = [
  'src/lib/ai/mechanicalDesignGraph.test.ts',
  'src/lib/ai/mechanicalCoreFeatureContract.test.ts',
  'scripts/mechanical-core-feature-local-closed-loop.test.ts',
  'scripts/mechanical-core-feature-local-runtime.test.ts',
  'src/app/[lang]/shape-generator/features/mechanicalCoreFeatureRuntimeCoverage.test.ts',
  'src/app/[lang]/shape-generator/features/featureApplyCoverage.test.ts',
  'src/app/api/featureTree-intent/route.test.ts',
  'src/lib/ai/mechanicalStepInteroperability.test.ts',
  'scripts/build-mechanical-commercial-contract-assessments.test.ts',
  'src/app/[lang]/shape-generator/ai/programFromNfab.test.ts',
  'src/lib/ai/guidedDesignBrief.test.ts',
  'src/lib/ai/aiCanonicalCandidate.test.ts',
  'src/app/[lang]/shape-generator/assembly/drawingHandoff.test.ts',
  'src/app/[lang]/shape-generator/io/manufacturingPackage.test.ts',
  'src/app/[lang]/shape-generator/io/__tests__/stepRoundtripReport.test.ts',
  'src/app/[lang]/shape-generator/io/__tests__/stepRoundtripWasm.feasibility.test.ts',
  'src/app/[lang]/shape-generator/io/__tests__/nfabMechanicalDesignGraphRoundtrip.test.ts',
];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function commandSpec(name) {
  if (name === 'direct-cad') return ['exec', 'vitest', 'run', '--', ...DIRECT_TESTS];
  if (name === 'mechanical-accuracy') return ['run', 'test:accuracy:mechanical'];
  if (name === 'intent-qualification') return ['run', 'mechanical:intents:local:check'];
  if (name === 'intent-runtime') return ['run', 'mechanical:intents:runtime:check'];
  if (name === 'assembly-handoff-readiness') return ['run', 'assembly-handoff:readiness:check'];
  return ['run', 'typecheck'];
}

function defaultRunCommand(root, name) {
  const args = commandSpec(name);
  const commandText = ['npm', ...args].join(' ');
  const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const executableArgs = process.platform === 'win32' ? ['/d', '/s', '/c', commandText] : args;
  const environment = name === 'direct-cad' ? { RUN_OCCT_FEASIBILITY: '1' } : {};
  const started = Date.now();
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  return {
    name,
    command: commandText,
    environment,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
    ...(result.error ? { launchError: result.error.message } : {}),
  };
}

function gitValue(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 ? String(result.stdout ?? '').trim() : null;
}

export function buildMechanicalInternalVerificationReceipt({
  root,
  runCommand = defaultRunCommand,
  generatedAt = new Date().toISOString(),
}) {
  const commands = [
    'direct-cad',
    'mechanical-accuracy',
    'intent-qualification',
    'intent-runtime',
    'assembly-handoff-readiness',
    'typecheck',
  ].map(name => runCommand(root, name));
  const sourceBindings = SOURCE_BINDINGS.map(relative => {
    const absolute = path.resolve(root, ...relative.split('/'));
    if (!fs.existsSync(absolute)) throw new Error(`MECHANICAL_INTERNAL_SOURCE_MISSING:${relative}`);
    return { path: relative, sha256: sha256(fs.readFileSync(absolute)) };
  });
  const passed = name => commands.find(command => command.name === name)?.exitCode === 0;
  const checks = {
    losslessDesignGraph: passed('direct-cad'),
    coreThirtyImplementationCoverage: passed('direct-cad'),
    threeCycleNfab: passed('direct-cad'),
    threeCycleStep: passed('direct-cad'),
    mechanicalAccuracy: passed('mechanical-accuracy'),
    intentIntakeQualification: passed('intent-qualification'),
    intentExactRuntimeRepresentative: passed('intent-runtime'),
    assemblyDrawingHandoffLocalReadiness: passed('assembly-handoff-readiness'),
    typecheck: passed('typecheck'),
  };
  const ok = Object.values(checks).every(Boolean);
  const workingTree = gitValue(root, ['status', '--porcelain']);

  return {
    schema: 'nexyfab.mechanical-core-internal-verification.v1',
    generatedAt,
    releaseChannel: 'mechanical-core',
    ok,
    git: {
      head: gitValue(root, ['rev-parse', 'HEAD']),
      branch: gitValue(root, ['branch', '--show-current']),
      workingTreeClean: workingTree === '',
    },
    checks,
    commands,
    sourceBindings,
    claimBoundary: {
      internalOnly: true,
      independentHoldout: false,
      expertApproval: false,
      manufacturingValidation: false,
    },
  };
}

export function runAndWriteMechanicalInternalVerification({ root = process.cwd(), runCommand } = {}) {
  const receipt = buildMechanicalInternalVerificationReceipt({ root, ...(runCommand ? { runCommand } : {}) });
  const output = path.resolve(root, ...OUTPUT_REL.split('/'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  return { ok: receipt.ok, output: OUTPUT_REL, checks: receipt.checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runAndWriteMechanicalInternalVerification();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`[mechanical-internal-verification] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
