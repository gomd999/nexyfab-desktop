#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTrustedBlindReviewers,
  validateMechanicalBlindChallenge,
} from '../../../scripts/mechanical-commercial-evidence-v3.mjs';
import {
  parseTrustedManufacturingInspectors,
  validateMechanicalManufacturingReceipt,
} from '../../../scripts/build-mechanical-product-scope-assessment.mjs';

const TOOL_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = fs.realpathSync(path.resolve(path.dirname(TOOL_PATH), '../../..'));
const KINDS = Object.freeze(['blind', 'manufacturing']);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const render = value => `${JSON.stringify(value, null, 2)}\n`;

function option(args, name) {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function safeExternalRoot(rootValue) {
  if (typeof rootValue !== 'string' || !rootValue.trim()) throw new Error('MECHANICAL_EVIDENCE_ROOT_REQUIRED');
  const resolved = path.resolve(rootValue);
  if (!fs.existsSync(resolved)
    || !fs.statSync(resolved).isDirectory()
    || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('MECHANICAL_EVIDENCE_ROOT_NOT_SAFE_DIRECTORY');
  const real = fs.realpathSync(resolved);
  if (real === REPOSITORY_ROOT || real.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) {
    throw new Error('MECHANICAL_EVIDENCE_ROOT_MUST_BE_OUTSIDE_REPOSITORY');
  }
  return real;
}

function safeCandidate(evidenceRoot, candidateValue) {
  if (typeof candidateValue !== 'string' || !candidateValue.trim()) throw new Error('MECHANICAL_EVIDENCE_CANDIDATE_REQUIRED');
  const resolved = path.resolve(candidateValue);
  if (!fs.existsSync(resolved)
    || !fs.statSync(resolved).isFile()
    || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('MECHANICAL_EVIDENCE_CANDIDATE_NOT_SAFE_FILE');
  const real = fs.realpathSync(resolved);
  if (!real.startsWith(`${evidenceRoot}${path.sep}`)) throw new Error('MECHANICAL_EVIDENCE_CANDIDATE_OUTSIDE_ROOT');
  return real;
}

function safeNewOutput(outputValue) {
  if (outputValue === null || outputValue === undefined) return null;
  if (typeof outputValue !== 'string' || !outputValue.trim()) throw new Error('MECHANICAL_EVIDENCE_OUTPUT_INVALID');
  const resolved = path.resolve(outputValue);
  if (fs.existsSync(resolved)) throw new Error('MECHANICAL_EVIDENCE_OUTPUT_ALREADY_EXISTS');
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent)
    || !fs.statSync(parent).isDirectory()
    || fs.lstatSync(parent).isSymbolicLink()) throw new Error('MECHANICAL_EVIDENCE_OUTPUT_PARENT_NOT_SAFE_DIRECTORY');
  return path.join(fs.realpathSync(parent), path.basename(resolved));
}

function atomicNoReplace(output, bytes) {
  const temporary = `${output}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    fs.linkSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function promoteMechanicalCommercialReceipt({
  kind,
  candidatePath,
  evidenceRoot,
  outputPath = null,
  trustedBlindReviewers = parseTrustedBlindReviewers(),
  trustedManufacturingInspectors = parseTrustedManufacturingInspectors(),
  now = Date.now(),
}) {
  if (!KINDS.includes(kind)) throw new Error('MECHANICAL_EVIDENCE_KIND_INVALID');
  const realRoot = safeExternalRoot(evidenceRoot);
  const realCandidate = safeCandidate(realRoot, candidatePath);
  const output = safeNewOutput(outputPath);
  let receipt;
  const candidateBytes = fs.readFileSync(realCandidate);
  try {
    receipt = JSON.parse(candidateBytes.toString('utf8'));
  } catch {
    receipt = null;
  }
  const valid = kind === 'blind'
    ? validateMechanicalBlindChallenge(receipt, {
      evidenceRoot: realRoot,
      trustedReviewers: trustedBlindReviewers,
      now,
    })
    : validateMechanicalManufacturingReceipt(receipt, {
      evidenceRoot: realRoot,
      trustedInspectors: trustedManufacturingInspectors,
      now,
    });
  const result = {
    schema: 'nexyfab.mechanical-commercial-receipt-promotion.v1',
    kind,
    valid,
    promoted: false,
    candidate: {
      path: realCandidate,
      bytes: candidateBytes.byteLength,
      sha256: sha256(candidateBytes),
    },
    evidenceRoot: realRoot,
    output,
    outputSha256: null,
    blockers: valid ? [] : ['candidate_receipt_invalid'],
    claimBoundary: {
      createsEvidence: false,
      createsSignatures: false,
      grantsCommercialRelease: false,
    },
  };
  if (!valid || output === null) return result;
  const outputBytes = Buffer.from(render(receipt));
  atomicNoReplace(output, outputBytes);
  return {
    ...result,
    promoted: true,
    outputSha256: sha256(outputBytes),
  };
}

export function main(args = process.argv.slice(2)) {
  const kind = option(args, 'kind');
  const candidatePath = option(args, 'candidate');
  const evidenceRoot = option(args, 'evidence-root');
  const checkOnly = args.includes('--check');
  const outputPath = option(args, 'output');
  if (!checkOnly && !outputPath) {
    throw new Error('Usage: --kind=blind|manufacturing --candidate=<receipt.json> --evidence-root=<external-root> (--check | --output=<validated-receipt.json>)');
  }
  const result = promoteMechanicalCommercialReceipt({
    kind,
    candidatePath,
    evidenceRoot,
    outputPath: checkOnly ? null : outputPath,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.valid ? 0 : 4;
}

if (process.argv[1] && path.resolve(process.argv[1]) === TOOL_PATH) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[mechanical-evidence-promotion] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
