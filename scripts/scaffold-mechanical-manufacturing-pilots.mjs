#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_MECHANICAL_PILOT_PROCESSES } from './build-mechanical-product-scope-assessment.mjs';

const artifactNames = Object.freeze({
  nfab: 'design.nfab',
  step: 'design.step',
  drawing: 'released-drawing.pdf',
  bom: 'released-bom.csv',
  manufacturingReceipt: 'manufacturing-receipt.pdf',
  inspectionReport: 'inspection-report.json',
  photoEvidence: 'photo-evidence.jpg',
});

export function buildMechanicalManufacturingPilotWorkbook(generatedAt = new Date().toISOString()) {
  const evidenceRootId = crypto.createHash('sha256').update(`nexyfab-mechanical-pilots\0${generatedAt}`).digest('hex');
  return {
    schema: 'nexyfab.mechanical-manufacturing-pilot-workbook.v1',
    releaseChannel: 'mechanical-core',
    generatedAt,
    evidenceRootId,
    policy: {
      sourceFilesRemainOutsideRepository: true,
      exactFileSha256Required: true,
      noUnapprovedCadChangesRequired: true,
      minimumCriticalMeasurementsPerCase: 3,
      trustedInspectorSignatureRequired: true,
      overwriteExistingWorkbook: false,
    },
    cases: REQUIRED_MECHANICAL_PILOT_PROCESSES.map((process, index) => {
      const caseId = `pilot-${String(index + 1).padStart(2, '0')}-${process.replaceAll('_', '-')}`;
      return {
        caseId,
        process,
        status: 'evidence_required',
        designRevision: null,
        artifactPaths: Object.fromEntries(Object.entries(artifactNames).map(([role, file]) => [role, `${caseId}/${file}`])),
        manufacturer: { facilityId: null, independentFromNexyfab: null, completedAt: null },
        measurements: [],
        inspector: { reviewerId: null, independentFromBuild: null, inspectedAt: null, targetHash: null, signature: null },
        releaseEligible: false,
      };
    }),
  };
}

function option(args, name) {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export function main(args = process.argv.slice(2)) {
  const rootArg = option(args, 'root') ?? process.env.NEXYFAB_MECHANICAL_PILOT_ROOT;
  if (!rootArg?.trim()) throw new Error('MECHANICAL_PILOT_ROOT_REQUIRED');
  const root = path.resolve(rootArg);
  const repositoryRoot = path.resolve(process.cwd());
  if (root === repositoryRoot || root.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('MECHANICAL_PILOT_ROOT_MUST_BE_OUTSIDE_REPOSITORY');
  }
  const output = path.join(root, 'mechanical-manufacturing-pilot-workbook.json');
  if (fs.existsSync(output)) throw new Error('MECHANICAL_PILOT_WORKBOOK_ALREADY_EXISTS');
  const workbook = buildMechanicalManufacturingPilotWorkbook();
  fs.mkdirSync(root, { recursive: true });
  for (const item of workbook.cases) fs.mkdirSync(path.join(root, item.caseId), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(workbook, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ok: true, output, evidenceRootId: workbook.evidenceRootId, cases: workbook.cases.length })}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[mechanical-pilots] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
