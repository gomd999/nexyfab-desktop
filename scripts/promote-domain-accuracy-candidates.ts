import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  promoteDomainAccuracyCandidate,
  type DomainAccuracyApproval,
  type DomainAccuracyCandidate,
} from '../src/lib/ai/domainAccuracyCandidate';

export interface PromotionArgs { candidatesFile: string; approvalsFile: string }

export function parsePromotionArgs(args: readonly string[]): PromotionArgs {
  const value = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
  const candidatesFile = value('candidates');
  const approvalsFile = value('approvals');
  if (!candidatesFile) throw new TypeError('--candidates <candidate-manifest.json> is required');
  if (!approvalsFile) throw new TypeError('--approvals <approval-records.json> is required');
  return { candidatesFile, approvalsFile };
}

async function array<T>(file: string, label: string): Promise<T[]> {
  const parsed: unknown = JSON.parse(await readFile(resolve(file), 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError(`${label} must be a JSON array`);
  return parsed as T[];
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const input = parsePromotionArgs(args);
    const candidates = await array<DomainAccuracyCandidate>(input.candidatesFile, 'candidates');
    const approvals = await array<DomainAccuracyApproval>(input.approvalsFile, 'approvals');
    const promotions = candidates.map(candidate => promoteDomainAccuracyCandidate(candidate, approvals));
    const approvedCases = promotions.flatMap(item => item.benchmarkCase ? [item.benchmarkCase] : []);
    const summary = {
      candidates: candidates.length,
      approved: promotions.filter(item => item.status === 'approved').length,
      scoreEligible: promotions.filter(item => item.scoreEligible).length,
      pending: promotions.filter(item => item.status === 'pending').length,
      rejected: promotions.filter(item => item.status === 'rejected').length,
      invalid: promotions.filter(item => item.status === 'invalid').length,
    };
    process.stdout.write(`${JSON.stringify({ summary, approvedCases, promotions }, null, 2)}\n`);
    return summary.scoreEligible === candidates.length && candidates.length >= 20 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
// No top-level await: tsx resolves .ts CLI entries as CJS here (no "type":
// "module") where it is a transform error — found 260808 via the review-
// packets CLI; the vitest ESM import path had hidden it.
if (isMain) void main().then(code => { process.exitCode = code; });
