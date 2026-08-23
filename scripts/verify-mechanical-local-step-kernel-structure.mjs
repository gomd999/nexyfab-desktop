#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectStandaloneStep } from './standalone-step-ts-adapter.mjs';

const ROOT = process.cwd();
const EVIDENCE_ROOT = path.join(ROOT, 'docs/evidence/cad-independent/local/mechanical-step-c4-260814');
const SOURCE = path.join(EVIDENCE_ROOT, 'source.step');
const RETURNED = path.join(EVIDENCE_ROOT, 'nexyfab-kernel-returned.step');
const KERNEL_RECEIPT = path.join(EVIDENCE_ROOT, 'nexyfab-kernel-receipt.json');
const RECEIPT = path.join(EVIDENCE_ROOT, 'nexyfab-kernel-structure-receipt.json');
const RECEIPT_SHA = path.join(EVIDENCE_ROOT, 'nexyfab-kernel-structure-receipt.sha256');
const SOURCE_FILES = [
  'scripts/standalone-step-ts-adapter.mjs',
  'scripts/verify-mechanical-local-step-kernel-structure.mjs',
];

/**
 * Product/occurrence identity needs an XCAF document round-trip.  The local
 * replicad-opencascadejs build currently exposes STEPControl reader/writer
 * and STEPCAFControl_Writer, but not STEPCAFControl_Reader.  Keep this
 * capability explicit so topology/geometry evidence can never be promoted to
 * a product-identity claim by accident.
 */
export const PRODUCT_STRUCTURE_CAPABILITY = Object.freeze({
  status: 'HOLD',
  code: 'XCAF_STEP_READER_UNAVAILABLE',
  reason: 'The local OCCT binding exposes STEPControl_Reader/Writer and STEPCAFControl_Writer, but not STEPCAFControl_Reader; imported shapes therefore cannot be traversed as an XCAF product/occurrence document after reopen.',
  required: 'STEPCAFControl_Reader plus XCAFDoc_ShapeTool traversal bound to the reopened document',
});

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function binding(absolute, relativeRoot = ROOT) {
  const bytes = fs.readFileSync(absolute);
  return {
    path: path.relative(relativeRoot, absolute).replaceAll('\\', '/'),
    sha256: sha256(bytes),
    bytes: bytes.length,
  };
}

function verifyBinding(item, relativeRoot = ROOT) {
  if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)
    || !Number.isInteger(item.bytes) || item.bytes < 1) throw new Error('LOCAL_STEP_STRUCTURE_BINDING_INVALID');
  const boundary = path.resolve(relativeRoot);
  const target = path.resolve(boundary, ...item.path.replaceAll('\\', '/').split('/'));
  if (!target.startsWith(`${boundary}${path.sep}`) || !fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`LOCAL_STEP_STRUCTURE_BINDING_MISSING:${item.path}`);
  }
  const actual = binding(target, relativeRoot);
  if (actual.sha256 !== item.sha256 || actual.bytes !== item.bytes) {
    throw new Error(`LOCAL_STEP_STRUCTURE_BINDING_STALE:${item.path}`);
  }
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function geometryPartSignature(part) {
  return JSON.stringify({
    dimensionsMm: part.dimensionsMm,
    translationMm: part.translationMm,
    volumeMm3: part.volumeMm3,
    surfaceAreaMm2: part.surfaceAreaMm2,
  });
}

function semanticSignature(measurement) {
  return JSON.stringify({
    componentNames: [...measurement.componentNames].sort(),
    partNumbers: [...measurement.partNumbers].sort(),
    occurrenceLabels: measurement.parts.map(part => part.occurrenceLabel).sort(),
  });
}

export function assessKernelStructure(sourceMeasurement, returnedMeasurement) {
  const sourceGeometry = sourceMeasurement.parts.map(geometryPartSignature).sort();
  const returnedGeometry = returnedMeasurement.parts.map(geometryPartSignature).sort();
  const geometryStructurePreserved = sourceMeasurement.units === 'mm'
    && returnedMeasurement.units === 'mm'
    && sourceMeasurement.bodyCount === returnedMeasurement.bodyCount
    && sourceMeasurement.occurrenceCount === returnedMeasurement.occurrenceCount
    && JSON.stringify(sourceMeasurement.boundingBox) === JSON.stringify(returnedMeasurement.boundingBox)
    && sourceMeasurement.volume === returnedMeasurement.volume
    && sourceMeasurement.surfaceArea === returnedMeasurement.surfaceArea
    && JSON.stringify(sourceGeometry) === JSON.stringify(returnedGeometry);
  const semanticIdentityPreserved = semanticSignature(sourceMeasurement) === semanticSignature(returnedMeasurement);
  return {
    localStatus: geometryStructurePreserved && semanticIdentityPreserved ? 'PASS_LOCAL' : 'FAIL_LOCAL',
    geometryStructurePreserved: geometryStructurePreserved ? 'PASS_LOCAL' : 'FAIL_LOCAL',
    semanticIdentityPreserved: semanticIdentityPreserved ? 'PASS_LOCAL' : 'FAIL_LOCAL',
    productStructureCapability: PRODUCT_STRUCTURE_CAPABILITY,
    checks: [
      { id: 'ap242_reopen', status: 'PASS_LOCAL', actual: `source=${sourceMeasurement.attributes.protocolYear},returned=${returnedMeasurement.attributes.protocolYear}` },
      { id: 'occurrence_count', status: geometryStructurePreserved ? 'PASS_LOCAL' : 'FAIL_LOCAL', actual: `${sourceMeasurement.occurrenceCount}->${returnedMeasurement.occurrenceCount}` },
      { id: 'per_occurrence_geometry_and_transform', status: geometryStructurePreserved ? 'PASS_LOCAL' : 'FAIL_LOCAL', actual: `${sourceGeometry.length} source/${returnedGeometry.length} returned` },
      { id: 'aggregate_geometry', status: geometryStructurePreserved ? 'PASS_LOCAL' : 'FAIL_LOCAL', actual: `bbox=${returnedMeasurement.boundingBox.join(',')};volume=${returnedMeasurement.volume};surface=${returnedMeasurement.surfaceArea}` },
      { id: 'component_names', status: JSON.stringify([...sourceMeasurement.componentNames].sort()) === JSON.stringify([...returnedMeasurement.componentNames].sort()) ? 'PASS_LOCAL' : 'FAIL_LOCAL', actual: `${sourceMeasurement.componentNames.join('|')} -> ${returnedMeasurement.componentNames.join('|')}` },
      { id: 'part_numbers', status: JSON.stringify([...sourceMeasurement.partNumbers].sort()) === JSON.stringify([...returnedMeasurement.partNumbers].sort()) ? 'PASS_LOCAL' : 'FAIL_LOCAL', actual: `${sourceMeasurement.partNumbers.join('|')} -> ${returnedMeasurement.partNumbers.join('|')}` },
      { id: 'occurrence_labels', status: JSON.stringify(sourceMeasurement.parts.map(part => part.occurrenceLabel).sort()) === JSON.stringify(returnedMeasurement.parts.map(part => part.occurrenceLabel).sort()) ? 'PASS_LOCAL' : 'FAIL_LOCAL', actual: `${sourceMeasurement.parts.map(part => part.occurrenceLabel).join('|')} -> ${returnedMeasurement.parts.map(part => part.occurrenceLabel).join('|')}` },
    ],
  };
}

function buildReceipt() {
  const sourceMeasurement = inspectStandaloneStep(fs.readFileSync(SOURCE, 'utf8'));
  const returnedMeasurement = inspectStandaloneStep(fs.readFileSync(RETURNED, 'utf8'));
  const assessment = assessKernelStructure(sourceMeasurement, returnedMeasurement);
  return {
    schema: 'nexyfab.mechanical-local-step-kernel-structure-readiness.v1',
    executedAt: new Date().toISOString(),
    status: 'HOLD',
    scope: 'Bounded two-box AP242 product occurrence geometry, transform, and semantic identity after NexyFab OCCT reopen/export',
    ...assessment,
    commerciallyVerified: false,
    commercialStatus: 'NOT_RUN',
    releaseEligible: false,
    sourceBinding: binding(SOURCE),
    returnedBinding: binding(RETURNED),
    kernelReceiptBinding: binding(KERNEL_RECEIPT),
    sourceBindings: SOURCE_FILES.map(relative => binding(path.join(ROOT, relative))),
    measurements: { source: sourceMeasurement, returned: returnedMeasurement },
    blockers: [
      ...(assessment.semanticIdentityPreserved === 'FAIL_LOCAL' ? ['component_name_part_number_and_occurrence_label_not_preserved'] : []),
      'product_identity_xcaf_reopen_hold',
      'external_native_cad_reopen_not_run',
      'signed_external_operator_receipt_not_run',
      'bounded_axis_aligned_two_box_scope_only',
    ],
  };
}

function writeAtomic(target, value) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { flag: 'wx' });
  fs.renameSync(temporary, target);
}

export function runKernelStructureReceipt({ write, check }) {
  if (write === check) throw new Error('Usage: --write | --check');
  if (![SOURCE, RETURNED, KERNEL_RECEIPT].every(fs.existsSync)) throw new Error('LOCAL_STEP_STRUCTURE_INPUT_MISSING');
  const current = buildReceipt();
  if (check) {
    const receiptBytes = fs.readFileSync(RECEIPT);
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    const declared = fs.readFileSync(RECEIPT_SHA, 'utf8').trim();
    if (sha256(receiptBytes) !== declared) throw new Error('LOCAL_STEP_STRUCTURE_RECEIPT_HASH_MISMATCH');
    for (const item of [receipt.sourceBinding, receipt.returnedBinding, receipt.kernelReceiptBinding]) verifyBinding(item);
    if (!Array.isArray(receipt.sourceBindings) || receipt.sourceBindings.length !== SOURCE_FILES.length) {
      throw new Error('LOCAL_STEP_STRUCTURE_SOURCE_BINDING_COUNT_INVALID');
    }
    for (const item of receipt.sourceBindings) verifyBinding(item);
    if (receipt.schema !== current.schema || receipt.status !== 'HOLD' || receipt.releaseEligible !== false
      || receipt.commercialStatus !== 'NOT_RUN' || receipt.commerciallyVerified !== false
      || receipt.localStatus !== current.localStatus
      || receipt.geometryStructurePreserved !== current.geometryStructurePreserved
      || receipt.semanticIdentityPreserved !== current.semanticIdentityPreserved
      || stable(receipt.productStructureCapability) !== stable(current.productStructureCapability)
      || stable(receipt.checks) !== stable(current.checks)
      || stable(receipt.measurements) !== stable(current.measurements)) {
      throw new Error('LOCAL_STEP_STRUCTURE_RECEIPT_RESULT_STALE_OR_TAMPERED');
    }
    return { ...current, receiptSha256: declared, receiptRecalculated: true };
  }
  const bytes = Buffer.from(`${JSON.stringify(current, null, 2)}\n`);
  writeAtomic(RECEIPT, bytes);
  const digest = sha256(bytes);
  writeAtomic(RECEIPT_SHA, `${digest}\n`);
  return { ...current, receiptSha256: digest, receiptRecalculated: true };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const result = runKernelStructureReceipt({ write: process.argv.includes('--write'), check: process.argv.includes('--check') });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`[mechanical-local-step-kernel-structure] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
