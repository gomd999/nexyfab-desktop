#!/usr/bin/env tsx
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ensureOcctReady,
  exportOcctStep,
  occtImportStepText,
  occtProjectViews,
  occtRegisteredShapeEvidence,
  resetShapeRegistry,
  setOcctGlobalMode,
} from '../src/app/[lang]/shape-generator/features/occtEngine';

const SOURCE = path.join(
  process.cwd(),
  'docs/evidence/cad-independent/local/mechanical-step-c4-260814/source.step',
);
const EVIDENCE_ROOT = path.dirname(SOURCE);
const RETURNED = path.join(EVIDENCE_ROOT, 'nexyfab-kernel-returned.step');
const RECEIPT = path.join(EVIDENCE_ROOT, 'nexyfab-kernel-receipt.json');
const RECEIPT_SHA = path.join(EVIDENCE_ROOT, 'nexyfab-kernel-receipt.sha256');
const SOURCE_FILES = [
  'scripts/verify-mechanical-local-step-kernel.ts',
  'src/app/[lang]/shape-generator/features/occtEngine.ts',
  'src/app/[lang]/shape-generator/io/assemblyStepHierarchy.ts',
] as const;
const EXPECTED_BOUNDS = [0, 0, 0, 100, 60, 20] as const;
const EXPECTED_VOLUME_MM3 = 57_600;

/**
 * The local replicad-opencascadejs build can export a B-rep with
 * STEPControl_Writer and reopen it with STEPControl_Reader, but it does not
 * expose STEPCAFControl_Reader/XCAF document traversal.  Keep product
 * identity explicitly on HOLD; topology and HLR evidence must not be used as
 * a substitute for PRODUCT/NAUO/name preservation.
 */
const PRODUCT_STRUCTURE_CAPABILITY = {
  status: 'HOLD',
  code: 'XCAF_STEP_READER_UNAVAILABLE',
  reason: 'The local OCCT binding exposes STEPControl_Reader/Writer and STEPCAFControl_Writer, but not STEPCAFControl_Reader; product/occurrence identity cannot be independently reopened and verified.',
  required: 'STEPCAFControl_Reader plus XCAFDoc_ShapeTool traversal bound to the reopened document',
} as const;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileBinding(absolute: string, relative: string): { path: string; sha256: string; bytes: number } {
  const bytes = fs.readFileSync(absolute);
  return { path: relative.replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

function writeAtomic(target: string, value: string): void {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { flag: 'wx' });
  fs.renameSync(temporary, target);
}

function verifyBinding(root: string, binding: { path?: unknown; sha256?: unknown; bytes?: unknown }): void {
  if (typeof binding.path !== 'string' || typeof binding.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(binding.sha256)
    || !Number.isInteger(binding.bytes)) throw new Error('LOCAL_STEP_KERNEL_BINDING_INVALID');
  const target = path.resolve(root, ...binding.path.replaceAll('\\', '/').split('/'));
  const boundary = path.resolve(root);
  if (!target.startsWith(`${boundary}${path.sep}`) || !fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`LOCAL_STEP_KERNEL_BINDING_MISSING:${binding.path}`);
  }
  const actual = fileBinding(target, binding.path);
  if (actual.sha256 !== binding.sha256 || actual.bytes !== binding.bytes) {
    throw new Error(`LOCAL_STEP_KERNEL_BINDING_STALE:${binding.path}`);
  }
}

function boundsOf(geometry: Awaited<ReturnType<typeof occtImportStepText>>['geometry']): number[] {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error('LOCAL_STEP_KERNEL_BOUNDS_MISSING');
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
}

function assertNear(actual: number, expected: number, tolerance: number, code: string): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${code}:${actual}:${expected}`);
  }
}

function validateImported(
  result: Awaited<ReturnType<typeof occtImportStepText>>,
  label: string,
): { bounds: number[]; solidCount: number; volumeMm3: number; views: string[] } {
  if (!result.handle || result.geometry.getAttribute('position')?.count < 3) {
    throw new Error(`${label}_OPEN_FAILED`);
  }
  const exact = occtRegisteredShapeEvidence(result.handle);
  if (!exact || exact.solidCount !== 2 || exact.volumeMm3 === null) {
    throw new Error(`${label}_TOPOLOGY_INVALID:${JSON.stringify(exact)}`);
  }
  assertNear(exact.volumeMm3, EXPECTED_VOLUME_MM3, 1e-5, `${label}_VOLUME_MISMATCH`);
  const bounds = boundsOf(result.geometry);
  EXPECTED_BOUNDS.forEach((expected, index) => {
    assertNear(bounds[index]!, expected, 1e-5, `${label}_BOUNDS_MISMATCH_${index}`);
  });
  const projected = occtProjectViews(result.handle, ['front', 'top', 'right']);
  const views = Object.entries(projected ?? {})
    .filter(([, view]) => view.visible.length + view.hidden.length > 0)
    .map(([view]) => view);
  if (views.length !== 3) throw new Error(`${label}_HLR_INCOMPLETE:${views.join(',')}`);
  return { bounds, solidCount: exact.solidCount, volumeMm3: exact.volumeMm3, views };
}

async function runKernel(source: string): Promise<{
  returned: string;
  result: {
    ok: true;
    sourceSha256: string;
    returnedSha256: string;
    first: ReturnType<typeof validateImported>;
    second: ReturnType<typeof validateImported>;
    productStructurePreserved: 'NOT_RUN';
    productStructureCapability: typeof PRODUCT_STRUCTURE_CAPABILITY;
    externalCommercialReceipt: 'NOT_RUN';
  };
}> {
  const opened = await occtImportStepText(source);
  const first = validateImported(opened, 'LOCAL_STEP_KERNEL_FIRST');
  const returned = await exportOcctStep(opened.handle);
  if (!returned || !returned.includes('ISO-10303-21')) {
    throw new Error('LOCAL_STEP_KERNEL_REEXPORT_FAILED');
  }
  const reopened = await occtImportStepText(returned);
  const second = validateImported(reopened, 'LOCAL_STEP_KERNEL_SECOND');
  return {
    returned,
    result: {
      ok: true,
      sourceSha256: sha256(source),
      returnedSha256: sha256(returned),
      first,
      second,
      productStructurePreserved: 'NOT_RUN',
      productStructureCapability: PRODUCT_STRUCTURE_CAPABILITY,
      externalCommercialReceipt: 'NOT_RUN',
    },
  };
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check');
  if (write === check) throw new Error('Usage: --write | --check');
  if (!fs.existsSync(SOURCE)) throw new Error('LOCAL_STEP_KERNEL_SOURCE_MISSING');
  const source = fs.readFileSync(SOURCE, 'utf8');
  await ensureOcctReady();
  setOcctGlobalMode(true);
  try {
    if (check) {
      const receiptBytes = fs.readFileSync(RECEIPT);
      const receipt = JSON.parse(receiptBytes.toString('utf8')) as {
        schema?: unknown;
        status?: unknown;
        commerciallyVerified?: unknown;
        commercialStatus?: unknown;
        releaseEligible?: unknown;
        productStructurePreserved?: unknown;
        productStructureCapability?: unknown;
        sourceBinding?: { path?: unknown; sha256?: unknown; bytes?: unknown };
        returnedBinding?: { path?: unknown; sha256?: unknown; bytes?: unknown };
        sourceBindings?: Array<{ path?: unknown; sha256?: unknown; bytes?: unknown }>;
        measurements?: unknown;
      };
      const declared = fs.readFileSync(RECEIPT_SHA, 'utf8').trim();
      if (crypto.createHash('sha256').update(receiptBytes).digest('hex') !== declared) {
        throw new Error('LOCAL_STEP_KERNEL_RECEIPT_HASH_MISMATCH');
      }
      if (receipt.schema !== 'nexyfab.mechanical-local-step-kernel-readiness.v1'
        || receipt.status !== 'PASS_LOCAL' || receipt.commerciallyVerified !== false
        || receipt.commercialStatus !== 'NOT_RUN' || receipt.releaseEligible !== false
        || receipt.productStructurePreserved !== 'NOT_RUN'
        || JSON.stringify(receipt.productStructureCapability) !== JSON.stringify(PRODUCT_STRUCTURE_CAPABILITY)) {
        throw new Error('LOCAL_STEP_KERNEL_RECEIPT_STATUS_INVALID');
      }
      verifyBinding(EVIDENCE_ROOT, receipt.sourceBinding ?? {});
      verifyBinding(EVIDENCE_ROOT, receipt.returnedBinding ?? {});
      if (receipt.sourceBindings?.length !== SOURCE_FILES.length) {
        throw new Error('LOCAL_STEP_KERNEL_SOURCE_BINDING_COUNT_INVALID');
      }
      for (const binding of receipt.sourceBindings) verifyBinding(process.cwd(), binding);
      const executed = await runKernel(source);
      const storedReturned = fs.readFileSync(RETURNED, 'utf8');
      const storedReopened = validateImported(
        await occtImportStepText(storedReturned),
        'LOCAL_STEP_KERNEL_STORED_RETURNED',
      );
      if (receipt.sourceBinding?.sha256 !== executed.result.sourceSha256
        || JSON.stringify(receipt.measurements) !== JSON.stringify({ first: executed.result.first, second: executed.result.second })
        || JSON.stringify(storedReopened) !== JSON.stringify(executed.result.second)) {
        throw new Error('LOCAL_STEP_KERNEL_RECEIPT_MEASUREMENT_MISMATCH');
      }
      process.stdout.write(`${JSON.stringify({ ...executed.result, storedReopened, receiptSha256: declared })}\n`);
      return;
    }

    const executed = await runKernel(source);
    writeAtomic(RETURNED, executed.returned);
    const receipt = {
      schema: 'nexyfab.mechanical-local-step-kernel-readiness.v1',
      executedAt: new Date().toISOString(),
      status: 'PASS_LOCAL',
      scope: 'NexyFab OCCT open-export-reopen and three-view HLR for the bounded two-box AP242 assembly',
      commerciallyVerified: false,
      commercialStatus: 'NOT_RUN',
      productStructurePreserved: 'NOT_RUN',
      productStructureCapability: PRODUCT_STRUCTURE_CAPABILITY,
      releaseEligible: false,
      sourceBinding: fileBinding(SOURCE, path.basename(SOURCE)),
      returnedBinding: fileBinding(RETURNED, path.basename(RETURNED)),
      sourceBindings: SOURCE_FILES.map(relative => fileBinding(path.join(process.cwd(), relative), relative)),
      measurements: { first: executed.result.first, second: executed.result.second },
      blockers: ['external_operator_signature_not_run', 'product_structure_xcaf_reopen_hold'],
    };
    writeAtomic(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
    const receiptBytes = fs.readFileSync(RECEIPT);
    const receiptSha256 = crypto.createHash('sha256').update(receiptBytes).digest('hex');
    writeAtomic(RECEIPT_SHA, `${receiptSha256}\n`);
    process.stdout.write(`${JSON.stringify({ ...executed.result, receiptSha256 })}\n`);
  } finally {
    resetShapeRegistry();
    setOcctGlobalMode(false);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[mechanical-local-step-kernel] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
