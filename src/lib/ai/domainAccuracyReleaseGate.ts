import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildDomainAccuracyEvidence, type DomainAccuracyCase, type DomainAccuracyRun } from './domainAccuracyEvidence';
import { DOMAIN_ACCURACY_DOMAINS } from './domainAccuracyProgram';

export interface DomainAccuracyReleaseIssue { code: string; message: string }

async function array<T>(file: string): Promise<T[]> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError('expected JSON array');
  return parsed as T[];
}

/** Commercial releases require all five independently reviewed 95% campaign reports. */
export async function domainAccuracyReleaseIssues(evidenceDir: string | undefined): Promise<DomainAccuracyReleaseIssue[]> {
  if (!evidenceDir?.trim()) return [{ code: 'domain_accuracy.evidence_dir_missing', message: 'DOMAIN_ACCURACY_EVIDENCE_DIR must point to approved five-domain campaign evidence' }];
  const issues: DomainAccuracyReleaseIssue[] = [];
  for (const domain of DOMAIN_ACCURACY_DOMAINS) {
    try {
      const cases = await array<DomainAccuracyCase>(join(evidenceDir, `${domain}.cases.json`));
      const runs = await array<DomainAccuracyRun>(join(evidenceDir, `${domain}.runs.json`));
      const result = buildDomainAccuracyEvidence(domain, cases, runs);
      if (!result.assessment.eligible) {
        issues.push({
          code: `domain_accuracy.${domain}.not_eligible`,
          message: [...result.issues, ...result.assessment.blockers].join(', ') || '95% campaign is not eligible',
        });
      }
    } catch (error) {
      issues.push({
        code: `domain_accuracy.${domain}.evidence_unreadable`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return issues;
}
