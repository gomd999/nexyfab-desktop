import { readFile } from 'node:fs/promises';
import { cadTechnicalReleaseAuditV3Issues } from '../src/lib/cad-technical-release-audit-v3';
import { domainAccuracyReleaseIssues, parseTrustedDomainReleaseReviewers } from '../src/lib/ai/domainAccuracyReleaseGate';
import { releaseDomainsForChannel } from '../src/lib/ai/releaseChannel';

async function main(): Promise<void> {
  const path = process.env.CAD_TECHNICAL_RELEASE_AUDIT_V3;
  let audit: unknown = null;
  if (path?.trim()) {
    try { audit = JSON.parse(await readFile(path, 'utf8')); } catch { audit = null; }
  }
  const issues = [
    ...cadTechnicalReleaseAuditV3Issues(audit),
    ...await domainAccuracyReleaseIssues(
      process.env.DOMAIN_ACCURACY_EVIDENCE_DIR,
      parseTrustedDomainReleaseReviewers(process.env.NEXYFAB_DOMAIN_REVIEWER_KEYS),
      Date.now(),
      releaseDomainsForChannel(process.env.NEXYFAB_RELEASE_CHANNEL),
    ),
  ];
  if (issues.length) {
    console.error('[technical-release] BLOCKED');
    for (const issue of issues) console.error(`- ${issue.code}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }
  console.log('[technical-release] PASS — technical private-pilot evidence is complete; payment and legal remain deferred');
}

void main();
