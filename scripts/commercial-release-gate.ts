import { commercialReadinessIssues } from '../src/lib/commercial-readiness';
import { commercialReleaseEvidenceIssues } from '../src/lib/commercial-release-evidence';
import { domainAccuracyReleaseIssues, parseTrustedDomainReleaseReviewers } from '../src/lib/ai/domainAccuracyReleaseGate';
import { releaseDomainsForChannel } from '../src/lib/ai/releaseChannel';
import { cadIndependentReleaseAuditV2Issues } from '../src/lib/cad-independent-release-audit-v2';
import { readFile } from 'node:fs/promises';

async function readCadIndependentAudit(path: string | undefined): Promise<unknown> {
  if (!path?.trim()) return null;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function main() {
  const issues = [
    ...commercialReadinessIssues(process.env),
    ...commercialReleaseEvidenceIssues(process.env),
    ...await domainAccuracyReleaseIssues(
      process.env.DOMAIN_ACCURACY_EVIDENCE_DIR,
      parseTrustedDomainReleaseReviewers(process.env.NEXYFAB_DOMAIN_REVIEWER_KEYS),
      Date.now(),
      releaseDomainsForChannel(process.env.NEXYFAB_RELEASE_CHANNEL),
    ),
    ...cadIndependentReleaseAuditV2Issues(await readCadIndependentAudit(process.env.CAD_INDEPENDENT_RELEASE_AUDIT_V2)),
  ];

  if (issues.length) {
    console.error('[commercial-release] BLOCKED');
    for (const issue of issues) console.error(`- ${issue.code}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }

  console.log('[commercial-release] PASS — configuration and operating evidence are current');
}

void main();
