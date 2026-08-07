import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DOMAIN_ACCURACY_DOMAINS,
  type DomainAccuracyDomain,
} from '../src/lib/ai/domainAccuracyProgram';
import {
  buildDomainAccuracyEvidence,
  type DomainAccuracyCase,
  type DomainAccuracyRun,
} from '../src/lib/ai/domainAccuracyEvidence';

export interface DomainReportArgs {
  domain: DomainAccuracyDomain;
  casesFile: string;
  runsFile: string;
}

export function parseDomainReportArgs(args: readonly string[]): DomainReportArgs {
  const value = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const domain = value('domain');
  const casesFile = value('cases');
  const runsFile = value('runs');
  if (!domain || !DOMAIN_ACCURACY_DOMAINS.includes(domain as DomainAccuracyDomain)) {
    throw new TypeError(`--domain must be one of: ${DOMAIN_ACCURACY_DOMAINS.join(', ')}`);
  }
  if (!casesFile) throw new TypeError('--cases <approved-holdout-cases.json> is required');
  if (!runsFile) throw new TypeError('--runs <ai-generation-runs.json> is required');
  return { domain: domain as DomainAccuracyDomain, casesFile, runsFile };
}

async function readArray<T>(file: string, label: string): Promise<T[]> {
  const parsed: unknown = JSON.parse(await readFile(resolve(file), 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError(`${label} must be a JSON array`);
  return parsed as T[];
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const input = parseDomainReportArgs(args);
    const cases = await readArray<DomainAccuracyCase>(input.casesFile, 'cases');
    const runs = await readArray<DomainAccuracyRun>(input.runsFile, 'runs');
    const report = buildDomainAccuracyEvidence(input.domain, cases, runs);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.assessment.eligible ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = await main();

