#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MECHANICAL_CORE_30_FEATURES } from '../src/lib/ai/mechanicalCoreFeatureContract';

const designArtifactNames = Object.freeze({
  requirements: 'requirements.md',
  nfab: 'design.nfab',
  step: 'design.step',
  drawing: 'released-drawing.pdf',
  bom: 'released-bom.csv',
  manifest: 'manifest.json',
  intentEvaluation: 'intent-evaluation.json',
  verificationReceipt: 'verification-receipt.json',
});

function familyFor(index: number): 'machined' | 'sheet_metal' | 'rotational_sweep_loft' | 'pattern_multibody_boolean' {
  if (index < 12) return 'machined';
  if (index < 20) return 'sheet_metal';
  if (index < 25) return 'rotational_sweep_loft';
  return 'pattern_multibody_boolean';
}

function rootId(kind: string, generatedAt: string): string {
  return createHash('sha256').update(`nexyfab:${kind}\0${generatedAt}`).digest('hex');
}

export function buildMechanicalCommercialEvidenceWorkbooks(generatedAt = new Date().toISOString()) {
  return {
    design: {
      schema: 'nexyfab.mechanical-direct-design-workbook.v1',
      releaseChannel: 'mechanical-core',
      generatedAt,
      evidenceRootId: rootId('direct-design', generatedAt),
      policy: {
        sourceFilesRemainOutsideRepository: true,
        exactFileSha256Required: true,
        requiredNfabCycles: 3,
        requiredStepCycles: 3,
        requiredIntentVariantsPerCase: 5,
        overwriteExistingWorkbook: false,
      },
      cases: MECHANICAL_CORE_30_FEATURES.map((primaryFeature, index) => {
        const caseId = `design-${String(index + 1).padStart(2, '0')}-${primaryFeature}`;
        return {
          caseId,
          family: familyFor(index),
          primaryFeature,
          status: 'evidence_required',
          artifactPaths: Object.fromEntries(Object.entries(designArtifactNames).map(([role, file]) => [role, `${caseId}/${file}`])),
          releaseEligible: false,
        };
      }),
    },
    blind: {
      schema: 'nexyfab.mechanical-blind-product-challenge-workbook.v1',
      releaseChannel: 'mechanical-core',
      generatedAt,
      evidenceRootId: rootId('blind-product-challenge', generatedAt),
      policy: {
        requirementsLockedBeforeExecution: true,
        builderCannotReview: true,
        highRiskDualReviewRequired: true,
        trustedReviewerSignatureRequired: true,
        sourceFilesRemainOutsideRepository: true,
        overwriteExistingWorkbook: false,
      },
      cases: Array.from({ length: 20 }, (_, index) => {
        const challengeId = `challenge-${String(index + 1).padStart(2, '0')}`;
        return {
          challengeId,
          risk: index < 5 ? 'high' : 'standard',
          status: 'requirements_required',
          artifactPaths: {
            requirements: `${challengeId}/requirements.md`,
            releasePackage: `${challengeId}/release-package.zip`,
          },
          releaseEligible: false,
        };
      }),
    },
  } as const;
}

function option(args: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export function main(args = process.argv.slice(2)): number {
  const rootArg = option(args, 'root') ?? process.env.NEXYFAB_MECHANICAL_COMMERCIAL_EVIDENCE_ROOT;
  if (!rootArg?.trim()) throw new Error('MECHANICAL_COMMERCIAL_EVIDENCE_ROOT_REQUIRED');
  const root = path.resolve(rootArg);
  const repositoryRoot = path.resolve(process.cwd());
  if (root === repositoryRoot || root.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('MECHANICAL_COMMERCIAL_EVIDENCE_ROOT_MUST_BE_OUTSIDE_REPOSITORY');
  }
  const designRoot = path.join(root, 'direct-design');
  const blindRoot = path.join(root, 'blind-challenges');
  const designOutput = path.join(designRoot, 'mechanical-direct-design-workbook.json');
  const blindOutput = path.join(blindRoot, 'mechanical-blind-product-challenge-workbook.json');
  if (fs.existsSync(designOutput) || fs.existsSync(blindOutput)) throw new Error('MECHANICAL_COMMERCIAL_EVIDENCE_WORKBOOK_ALREADY_EXISTS');

  const workbooks = buildMechanicalCommercialEvidenceWorkbooks();
  fs.mkdirSync(designRoot, { recursive: true });
  fs.mkdirSync(blindRoot, { recursive: true });
  for (const item of workbooks.design.cases) fs.mkdirSync(path.join(designRoot, item.caseId), { recursive: true });
  for (const item of workbooks.blind.cases) fs.mkdirSync(path.join(blindRoot, item.challengeId), { recursive: true });
  fs.writeFileSync(designOutput, `${JSON.stringify(workbooks.design, null, 2)}\n`, { flag: 'wx' });
  fs.writeFileSync(blindOutput, `${JSON.stringify(workbooks.blind, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ok: true, designOutput, blindOutput, designCases: 30, blindCases: 20 })}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[mechanical-commercial-evidence] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
