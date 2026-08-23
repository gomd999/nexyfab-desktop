#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/;
const AUTHORING_FAMILIES = new Set(['opencascade', 'occt', 'replicad']);
const REQUIRED_CHECKS = Object.freeze([
  'opened', 'schema_conformance', 'valid_brep', 'body_count', 'units', 'bounding_box',
  'volume', 'surface_area', 'product_structure', 'occurrence_transforms',
  'component_names', 'part_numbers', 'attributes', 'returned_reimport',
  'geometry_diff', 'revision_binding',
]);
const RELATIVE_TOLERANCE = 1e-6;
const BOUNDING_BOX_ABSOLUTE_TOLERANCE = 1e-5;

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

function resolveInside(root, relative) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) return null;
  const parts = relative.replaceAll('\\', '/').split('/');
  if (parts.includes('..')) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...parts);
  return resolved.startsWith(`${resolvedRoot}${path.sep}`) ? resolved : null;
}

function readBoundFile(root, binding, extensions) {
  if (!binding || !SHA256.test(String(binding.sha256 ?? ''))) throw new Error('STEP_C4_ARTIFACT_BINDING_INVALID');
  const absolute = resolveInside(root, binding.path);
  if (!absolute || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`STEP_C4_ARTIFACT_MISSING:${binding?.path ?? 'missing'}`);
  }
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(absolute);
  if (!real.startsWith(`${realRoot}${path.sep}`) || !extensions.includes(path.extname(real).toLowerCase())) {
    throw new Error(`STEP_C4_ARTIFACT_OUTSIDE_ROOT:${binding.path}`);
  }
  const bytes = fs.readFileSync(real);
  if (hash(bytes) !== binding.sha256) throw new Error(`STEP_C4_ARTIFACT_HASH_MISMATCH:${binding.path}`);
  return { absolute: real, bytes };
}

function assertWorkbook(workbook) {
  if (workbook?.schema !== 'nexyfab.mechanical-standalone-step-c4-workbook.v1'
    || workbook?.releaseChannel !== 'mechanical-core'
    || !SHA256.test(String(workbook?.designRevisionSha256 ?? ''))
    || !workbook?.source?.path
    || !SHA256.test(String(workbook?.source?.sha256 ?? ''))) {
    throw new Error('STEP_C4_WORKBOOK_INVALID');
  }
}

function assertIndependentEngine(engine) {
  const family = String(engine?.family ?? '').trim().toLowerCase();
  const identity = String(engine?.identity ?? '').trim();
  const version = String(engine?.version ?? '').trim();
  if (!family || !identity || !version) throw new Error('STEP_C4_ENGINE_IDENTITY_MISSING');
  if (AUTHORING_FAMILIES.has(family) || /open\s*cascade|occt|replicad/i.test(`${identity} ${family}`)) {
    throw new Error('STEP_C4_ENGINE_NOT_INDEPENDENT');
  }
  return { family, identity, version };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function relativeError(expected, actual) {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), Number.EPSILON);
}

function sameStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length > 0
    && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function assertMeasuredRoundtrip(measurements) {
  const source = measurements?.source;
  const returned = measurements?.returned;
  for (const value of [source, returned]) {
    if (!Number.isInteger(value?.bodyCount) || value.bodyCount < 1
      || !Number.isInteger(value?.occurrenceCount) || value.occurrenceCount < 1
      || typeof value?.units !== 'string' || !value.units.trim()
      || !Array.isArray(value?.boundingBox) || value.boundingBox.length !== 6 || !value.boundingBox.every(finiteNumber)
      || !finiteNumber(value?.volume) || value.volume <= 0
      || !finiteNumber(value?.surfaceArea) || value.surfaceArea <= 0) {
      throw new Error('STEP_C4_MEASUREMENTS_INVALID');
    }
  }
  if (source.bodyCount !== returned.bodyCount) throw new Error('STEP_C4_BODY_COUNT_MISMATCH');
  if (source.occurrenceCount !== returned.occurrenceCount) throw new Error('STEP_C4_OCCURRENCE_COUNT_MISMATCH');
  if (source.units !== returned.units) throw new Error('STEP_C4_UNITS_MISMATCH');
  if (source.boundingBox.some((value, index) => Math.abs(value - returned.boundingBox[index]) > BOUNDING_BOX_ABSOLUTE_TOLERANCE)) {
    throw new Error('STEP_C4_BOUNDING_BOX_MISMATCH');
  }
  if (relativeError(source.volume, returned.volume) > RELATIVE_TOLERANCE) throw new Error('STEP_C4_VOLUME_MISMATCH');
  if (relativeError(source.surfaceArea, returned.surfaceArea) > RELATIVE_TOLERANCE) throw new Error('STEP_C4_SURFACE_AREA_MISMATCH');
  if (!sameStrings(source.componentNames, returned.componentNames)) throw new Error('STEP_C4_COMPONENT_NAMES_MISMATCH');
  if (!sameStrings(source.partNumbers, returned.partNumbers)) throw new Error('STEP_C4_PART_NUMBERS_MISMATCH');
  const sourceAttributes = source.attributes && typeof source.attributes === 'object' ? source.attributes : null;
  const returnedAttributes = returned.attributes && typeof returned.attributes === 'object' ? returned.attributes : null;
  if (!sourceAttributes || !returnedAttributes || canonical(sourceAttributes) !== canonical(returnedAttributes)) {
    throw new Error('STEP_C4_ATTRIBUTES_MISMATCH');
  }
}

function assertReport(report, workbook) {
  if (report?.schema !== 'nexyfab.independent-step-c4-report.v1'
    || report?.protocol !== 'AP242'
    || report?.modelKind !== 'assembly'
    || report?.designRevisionSha256 !== workbook.designRevisionSha256
    || report?.sourceArtifactSha256 !== workbook.source.sha256
    || !Array.isArray(report?.checks)) throw new Error('STEP_C4_REPORT_INVALID');
  const byId = new Map();
  for (const check of report.checks) {
    const values = byId.get(check?.id) ?? [];
    values.push(check);
    byId.set(check?.id, values);
  }
  for (const id of REQUIRED_CHECKS) {
    const values = byId.get(id) ?? [];
    if (values.length !== 1 || values[0]?.status !== 'pass') throw new Error(`STEP_C4_CHECK_NOT_PASS:${id}`);
  }
  assertMeasuredRoundtrip(report.measurements);
}

/**
 * Executes a separately supplied parser/writer adapter. This runner deliberately
 * rejects the OpenCascade/replicad authoring family, so an OCCT self-roundtrip
 * can never be mislabeled as independent interoperability evidence.
 */
export async function runMechanicalStandaloneStepC4({ workbook, evidenceRoot, executeIndependentParser, executedAt = new Date().toISOString() }) {
  assertWorkbook(workbook);
  if (typeof executeIndependentParser !== 'function') throw new Error('STEP_C4_ADAPTER_EXPORT_MISSING');
  const source = readBoundFile(evidenceRoot, workbook.source, ['.step', '.stp']);
  const execution = await executeIndependentParser({
    sourcePath: source.absolute,
    sourceSha256: workbook.source.sha256,
    designRevisionSha256: workbook.designRevisionSha256,
    evidenceRoot: path.resolve(evidenceRoot),
  });
  const engine = assertIndependentEngine(execution?.engine);
  assertReport(execution?.report, workbook);
  const opened = readBoundFile(evidenceRoot, execution.opened, ['.step', '.stp', '.json']);
  const returned = readBoundFile(evidenceRoot, execution.returned, ['.step', '.stp']);
  const reportArtifact = readBoundFile(evidenceRoot, execution.reportArtifact, ['.json']);
  const parsedReport = JSON.parse(reportArtifact.bytes.toString('utf8'));
  if (JSON.stringify(parsedReport) !== JSON.stringify(execution.report)) throw new Error('STEP_C4_REPORT_ARTIFACT_MISMATCH');

  return {
    schema: 'nexyfab.mechanical-standalone-step-c4-candidate.v1',
    releaseChannel: 'mechanical-core',
    target: 'independent-step-parser',
    executionMode: 'independent_parser',
    requestedLevel: 'C4',
    protocol: 'AP242',
    modelKind: 'assembly',
    designRevisionSha256: workbook.designRevisionSha256,
    sourceArtifactSha256: workbook.source.sha256,
    openedArtifactSha256: hash(opened.bytes),
    returnedArtifactSha256: hash(returned.bytes),
    evidenceBundleSha256: hash(reportArtifact.bytes),
    engine,
    executedAt,
    checks: execution.report.checks,
    evidence: {
      source: workbook.source.path.replaceAll('\\', '/'),
      opened: execution.opened.path.replaceAll('\\', '/'),
      returned: execution.returned.path.replaceAll('\\', '/'),
      report: execution.reportArtifact.path.replaceAll('\\', '/'),
    },
    eligibleForSignedReceipt: true,
    commerciallyVerified: false,
    nextAction: 'sign_and_bind_with_nexyfab_receipt',
  };
}

function atomicJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, target);
}

async function main(args = process.argv.slice(2)) {
  const option = name => args.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  const workbookPath = option('workbook');
  const adapterPath = option('adapter');
  const outputPath = option('output');
  if (!workbookPath || !adapterPath || !outputPath) {
    throw new Error('Usage: --workbook=<workbook.json> --adapter=<independent-adapter.mjs> --output=<candidate.json>');
  }
  const resolvedWorkbook = path.resolve(workbookPath);
  const evidenceRoot = path.dirname(resolvedWorkbook);
  const workbook = JSON.parse(fs.readFileSync(resolvedWorkbook, 'utf8'));
  const adapter = await import(pathToFileURL(path.resolve(adapterPath)).href);
  const candidate = await runMechanicalStandaloneStepC4({
    workbook,
    evidenceRoot,
    executeIndependentParser: adapter.executeIndependentStepParser,
  });
  const output = path.resolve(outputPath);
  atomicJson(output, candidate);
  process.stdout.write(`${JSON.stringify({ output, eligibleForSignedReceipt: true, commerciallyVerified: false })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[mechanical-step-c4] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
