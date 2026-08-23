#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIndependentDomainReviewKit } from './validate-independent-domain-review-kit.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const option = (args, name) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) return null;
  const normalized = relative.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) return null;
  const absolute = path.resolve(root, ...normalized.split('/'));
  return absolute === root || absolute.startsWith(`${root}${path.sep}`) ? absolute : null;
}

function verifiedEvidenceFile(root, relative) {
  const lexical = inside(root, relative);
  if (!lexical || !fs.existsSync(lexical) || !fs.statSync(lexical).isFile() || fs.lstatSync(lexical).isSymbolicLink()) return null;
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(lexical);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) return null;
  return realFile;
}

export function verifyIndependentDomainReviewEvidence(kit, { evidenceRoot } = {}) {
  const issues = [];
  const root = evidenceRoot ? path.resolve(evidenceRoot) : null;
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) issues.push('evidence_root_missing');
  const base = validateIndependentDomainReviewKit(kit);
  if (!base.structurallyValid) issues.push(...base.issues.map(issue => `kit:${issue}`));
  let checkedReceipts = 0;
  for (const item of Array.isArray(kit?.cases) ? kit.cases : []) {
    const receipt = item?.blindedRun?.automaticValidationReceipt;
    const receiptPath = root && fs.existsSync(root) ? verifiedEvidenceFile(root, receipt?.path) : null;
    if (!receiptPath) { issues.push(`receipt_file_missing:${item?.caseId ?? 'missing'}`); continue; }
    const bytes = fs.readFileSync(receiptPath);
    if (sha256(bytes) !== receipt?.sha256) { issues.push(`receipt_hash_mismatch:${item.caseId}`); continue; }
    let parsed;
    try { parsed = JSON.parse(bytes.toString('utf8')); } catch { issues.push(`receipt_json_invalid:${item.caseId}`); continue; }
    if (parsed?.schema !== 'nexyfab.domain-automatic-validation.v1' || parsed?.caseId !== item.caseId || parsed?.inputSha256 !== item?.blindedRun?.inputSha256 || JSON.stringify(parsed?.outputArtifactHashes) !== JSON.stringify(item?.blindedRun?.outputArtifactHashes)) issues.push(`receipt_binding_invalid:${item.caseId}`);
    else checkedReceipts += 1;
  }
  const claimedRelease = Array.isArray(kit?.cases) && kit.cases.some(item => item?.releaseEligible === true);
  if (claimedRelease) issues.push('output_artifact_paths_not_bound_for_independent_byte_verification');
  return { structurallyValid: issues.length === 0, releaseEligible: false, checkedReceipts, issues, externalEvidenceRequired: ['independent_expert_signatures', 'native_cad_roundtrip', 'manufacturing_receipt', 'field_inspection_receipt'] };
}

export function main(args = process.argv.slice(2)) {
  const kitPath = path.resolve(option(args, 'kit') ?? 'docs/evidence/release/independent-domain-review-kit-260810.json');
  const evidenceRoot = path.resolve(option(args, 'evidence-root') ?? path.dirname(kitPath));
  const kit = JSON.parse(fs.readFileSync(kitPath, 'utf8'));
  const report = { schema: 'nexyfab.independent-domain-review-evidence-verification.v1', generatedAt: new Date().toISOString(), kitPath, evidenceRoot, ...verifyIndependentDomainReviewEvidence(kit, { evidenceRoot }) };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.structurallyValid ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
