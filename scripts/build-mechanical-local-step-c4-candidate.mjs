#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import * as stepWriteModule from '../src/lib/brep-bridge/stepWrite.ts';
import * as assemblyHierarchyModule from '../src/app/[lang]/shape-generator/io/assemblyStepHierarchy.ts';
import { inspectStandaloneStep } from './standalone-step-ts-adapter.mjs';
import { executeIndependentStepParser } from './standalone-step-ts-adapter.mjs';
import { runMechanicalStandaloneStepC4 } from './run-mechanical-standalone-step-c4.mjs';

const ROOT = process.cwd();
const { writeExtrudeAsStep } = stepWriteModule.default ?? stepWriteModule;
const { stitchAssemblyHierarchy } = assemblyHierarchyModule.default ?? assemblyHierarchyModule;
const EVIDENCE_RELATIVE = 'docs/evidence/cad-independent/local/mechanical-step-c4-260814';
const EVIDENCE_ROOT = path.join(ROOT, EVIDENCE_RELATIVE);
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_FILES = [
  'scripts/build-mechanical-local-step-c4-candidate.mjs',
  'scripts/standalone-step-ts-adapter.mjs',
  'scripts/run-mechanical-standalone-step-c4.mjs',
  'src/app/[lang]/shape-generator/io/assemblyStepHierarchy.ts',
  'src/lib/brep-bridge/stepWrite.ts',
];
const ARTIFACT_FILES = [
  'source.step',
  'workbook.json',
  'independent-opened.json',
  'independent-returned.step',
  'independent-report.json',
  'candidate.json',
];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
const render = value => `${JSON.stringify(value, null, 2)}\n`;

function binding(absolute, relative) {
  const bytes = fs.readFileSync(absolute);
  return { path: relative.replaceAll('\\', '/'), sha256: sha256(bytes), bytes: bytes.length };
}

function writeAtomic(target, bytes) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  fs.renameSync(temporary, target);
}

function feature(width, height, depth) {
  return {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

function buildSource() {
  const fixedTimestamp = '2026-08-14T00:00:00.000Z';
  const partSpecs = [
    { id: 'base-plate', label: 'Base Plate', dimensionsMm: [100, 60, 8], translationMm: [0, 0, 0] },
    { id: 'mount-block', label: 'Mount Block', dimensionsMm: [40, 20, 12], translationMm: [20, 15, 8] },
  ];
  const perPart = partSpecs.map(part => writeExtrudeAsStep(
    feature(...part.dimensionsMm),
    { productName: part.id, timestamp: fixedTimestamp, filename: `${part.id}.step`, description: 'NexyFab C4 bounded exact box source' },
  ));
  const parts = partSpecs.map(part => ({
    id: part.id,
    label: part.label,
    geometry: new THREE.BoxGeometry(...part.dimensionsMm),
    transform: new THREE.Matrix4().makeTranslation(...part.translationMm),
  }));
  let source = stitchAssemblyHierarchy(parts, perPart, 'NexyFab_C4_Box_Assembly').stepText;
  source = source
    .replace(/FILE_NAME\('NexyFab_C4_Box_Assembly\.step','[^']*'/, "FILE_NAME('NexyFab_C4_Box_Assembly.step','2026-08-14T00:00:00'")
    .replace(/FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN \{ 1 0 10303 214 1 1 1 1 \}'\)\);/, "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));" )
    .replace("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2003", "APPLICATION_PROTOCOL_DEFINITION('international standard','ap242_managed_model_based_3d_engineering',2014")
    .replaceAll('\r\n', '\n');
  const design = {
    schema: 'nexyfab.local-step-c4-design.v1',
    units: 'mm',
    assembly: 'NexyFab_C4_Box_Assembly',
    parts: partSpecs,
  };
  const designRevisionSha256 = sha256(Buffer.from(canonical(design)));
  return { source: `${source.trim()}\n`, design, designRevisionSha256 };
}

function verifyBinding(root, value) {
  if (!value || typeof value.path !== 'string' || !SHA256.test(value.sha256) || !Number.isInteger(value.bytes)) {
    throw new Error(`LOCAL_STEP_C4_BINDING_INVALID:${value?.path ?? 'missing'}`);
  }
  const target = path.resolve(root, ...value.path.replaceAll('\\', '/').split('/'));
  const resolvedRoot = path.resolve(root);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`) || !fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`LOCAL_STEP_C4_BINDING_MISSING:${value.path}`);
  }
  const actual = binding(target, value.path);
  if (actual.sha256 !== value.sha256 || actual.bytes !== value.bytes) throw new Error(`LOCAL_STEP_C4_BINDING_STALE:${value.path}`);
}

async function generate() {
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const built = buildSource();
  const sourcePath = path.join(EVIDENCE_ROOT, 'source.step');
  writeAtomic(sourcePath, built.source);
  const workbook = {
    schema: 'nexyfab.mechanical-standalone-step-c4-workbook.v1',
    releaseChannel: 'mechanical-core',
    designRevisionSha256: built.designRevisionSha256,
    source: { path: 'source.step', sha256: sha256(Buffer.from(built.source)) },
    design: built.design,
  };
  writeAtomic(path.join(EVIDENCE_ROOT, 'workbook.json'), render(workbook));
  const candidate = await runMechanicalStandaloneStepC4({
    workbook,
    evidenceRoot: EVIDENCE_ROOT,
    executeIndependentParser: executeIndependentStepParser,
  });
  writeAtomic(path.join(EVIDENCE_ROOT, 'candidate.json'), render(candidate));
  const receipt = {
    schema: 'nexyfab.mechanical-local-step-c4-readiness.v1',
    generatedAt: new Date().toISOString(),
    status: 'PASS_LOCAL',
    scope: 'AP242 explicit-transform axis-aligned box assembly',
    designRevisionSha256: built.designRevisionSha256,
    sourceArtifactSha256: workbook.source.sha256,
    target: 'independent-step-parser',
    requestedLevel: 'C4',
    checksPassed: candidate.checks.length,
    checksFailed: 0,
    eligibleForSignedReceipt: candidate.eligibleForSignedReceipt,
    commerciallyVerified: false,
    commercialStatus: 'NOT_RUN',
    blockers: [
      'external_operator_signature_not_run',
      'nexyfab_kernel_occurrence_geometry_and_transform_pass_local_but_semantic_identifiers_fail_local',
      'external_product_structure_reopen_not_run',
      'general_curved_brep_and_non_box_assembly_not_run',
    ],
    sourceBindings: SOURCE_FILES.map(relative => binding(path.join(ROOT, relative), relative)),
    artifactBindings: ARTIFACT_FILES.map(relative => binding(path.join(EVIDENCE_ROOT, relative), relative)),
  };
  writeAtomic(path.join(EVIDENCE_ROOT, 'receipt.json'), render(receipt));
  const receiptBytes = fs.readFileSync(path.join(EVIDENCE_ROOT, 'receipt.json'));
  writeAtomic(path.join(EVIDENCE_ROOT, 'receipt.sha256'), `${sha256(receiptBytes)}\n`);
  return { receipt, receiptSha256: sha256(receiptBytes) };
}

function check() {
  const receiptPath = path.join(EVIDENCE_ROOT, 'receipt.json');
  const receiptBytes = fs.readFileSync(receiptPath);
  const receipt = JSON.parse(receiptBytes);
  const declared = fs.readFileSync(path.join(EVIDENCE_ROOT, 'receipt.sha256'), 'utf8').trim();
  if (sha256(receiptBytes) !== declared) throw new Error('LOCAL_STEP_C4_RECEIPT_HASH_MISMATCH');
  if (receipt.schema !== 'nexyfab.mechanical-local-step-c4-readiness.v1'
    || receipt.status !== 'PASS_LOCAL' || receipt.commerciallyVerified !== false
    || receipt.commercialStatus !== 'NOT_RUN' || receipt.checksPassed !== 16 || receipt.checksFailed !== 0) {
    throw new Error('LOCAL_STEP_C4_RECEIPT_STATUS_INVALID');
  }
  for (const value of receipt.sourceBindings ?? []) verifyBinding(ROOT, value);
  for (const value of receipt.artifactBindings ?? []) verifyBinding(EVIDENCE_ROOT, value);
  if (receipt.sourceBindings?.length !== SOURCE_FILES.length || receipt.artifactBindings?.length !== ARTIFACT_FILES.length) {
    throw new Error('LOCAL_STEP_C4_BINDING_COUNT_INVALID');
  }
  const workbook = JSON.parse(fs.readFileSync(path.join(EVIDENCE_ROOT, 'workbook.json'), 'utf8'));
  const source = fs.readFileSync(path.join(EVIDENCE_ROOT, 'source.step'), 'utf8');
  const returned = fs.readFileSync(path.join(EVIDENCE_ROOT, 'independent-returned.step'), 'utf8');
  const report = JSON.parse(fs.readFileSync(path.join(EVIDENCE_ROOT, 'independent-report.json'), 'utf8'));
  const candidate = JSON.parse(fs.readFileSync(path.join(EVIDENCE_ROOT, 'candidate.json'), 'utf8'));
  if (workbook.source.sha256 !== sha256(Buffer.from(source))
    || workbook.designRevisionSha256 !== receipt.designRevisionSha256
    || candidate.designRevisionSha256 !== receipt.designRevisionSha256
    || candidate.sourceArtifactSha256 !== receipt.sourceArtifactSha256
    || candidate.commerciallyVerified !== false || candidate.eligibleForSignedReceipt !== true) {
    throw new Error('LOCAL_STEP_C4_REVISION_OR_SOURCE_STALE');
  }
  const sourceMeasurement = inspectStandaloneStep(source);
  const returnedMeasurement = inspectStandaloneStep(returned);
  const expectedParts = workbook.design.parts.map(part => ({
    occurrenceLabel: part.label,
    name: part.id,
    partNumber: part.id,
    dimensionsMm: part.dimensionsMm,
    translationMm: part.translationMm,
  }));
  const measuredParts = sourceMeasurement.parts.map(part => ({
    occurrenceLabel: part.occurrenceLabel,
    name: part.name,
    partNumber: part.partNumber,
    dimensionsMm: part.dimensionsMm,
    translationMm: part.translationMm,
  }));
  if (canonical(sourceMeasurement) !== canonical(returnedMeasurement)
    || canonical(report.measurements?.source) !== canonical(sourceMeasurement)
    || canonical(report.measurements?.returned) !== canonical(returnedMeasurement)
    || canonical(measuredParts) !== canonical(expectedParts)) {
    throw new Error('LOCAL_STEP_C4_MEASUREMENT_MISMATCH');
  }
  const checks = Array.isArray(candidate.checks) ? candidate.checks : [];
  if (checks.length !== 16 || checks.some(value => value?.status !== 'pass') || new Set(checks.map(value => value.id)).size !== 16) {
    throw new Error('LOCAL_STEP_C4_CHECKS_INVALID');
  }
  return { ok: true, status: receipt.status, checks: checks.length, commerciallyVerified: false, commercialStatus: 'NOT_RUN', receiptSha256: declared };
}

const write = process.argv.includes('--write');
const checkOnly = process.argv.includes('--check');
if (write === checkOnly) {
  process.stderr.write('Usage: --write | --check\n');
  process.exitCode = 2;
} else {
  try {
    const result = write ? await generate() : check();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`[mechanical-local-step-c4] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
