import { createHash, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildDomainAccuracyEvidence, type DomainAccuracyCase, type DomainAccuracyRun } from './domainAccuracyEvidence';
import { DOMAIN_ACCURACY_DOMAINS, type DomainAccuracyDomain } from './domainAccuracyProgram';

export interface DomainAccuracyReleaseIssue { code: string; message: string }
export type DomainReleaseReviewerRole = 'domain-reviewer' | 'independent-reviewer';
export interface TrustedDomainReleaseReviewer {
  publicKey: string;
  roles: DomainReleaseReviewerRole[];
}
export type TrustedDomainReleaseReviewers = Record<string, TrustedDomainReleaseReviewer>;
export interface DomainAccuracyReleaseSignoff {
  reviewerId: string;
  role: DomainReleaseReviewerRole;
  decision: 'approved';
  reviewedAt: string;
  signature: string;
}
export interface DomainAccuracyReleaseManifest {
  schema: 'nexyfab.domain-accuracy-release-manifest.v1';
  domain: DomainAccuracyDomain;
  casesSha256: string;
  runsSha256: string;
  signoffs: DomainAccuracyReleaseSignoff[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

export function domainAccuracyReleaseSignoffPayload(
  manifest: Pick<DomainAccuracyReleaseManifest, 'schema' | 'domain' | 'casesSha256' | 'runsSha256'>,
  signoff: Omit<DomainAccuracyReleaseSignoff, 'signature'>,
): string {
  return canonical({ ...manifest, ...signoff });
}

export function domainAccuracyReleaseManifestIssues(
  domain: DomainAccuracyDomain,
  casesBytes: Uint8Array,
  runsBytes: Uint8Array,
  value: unknown,
  trustedReviewers: TrustedDomainReleaseReviewers,
  now = Date.now(),
): DomainAccuracyReleaseIssue[] {
  const manifest = value as Partial<DomainAccuracyReleaseManifest> | null;
  const prefix = `domain_accuracy.${domain}.release_manifest`;
  if (!manifest || typeof manifest !== 'object') return [{ code: `${prefix}.missing`, message: `${domain} signed release manifest is required` }];
  const issues: DomainAccuracyReleaseIssue[] = [];
  if (manifest.schema !== 'nexyfab.domain-accuracy-release-manifest.v1') issues.push({ code: `${prefix}.schema`, message: 'release manifest schema must be v1' });
  if (manifest.domain !== domain) issues.push({ code: `${prefix}.domain`, message: 'release manifest domain mismatch' });
  if (!SHA256.test(String(manifest.casesSha256 ?? '')) || manifest.casesSha256 !== digest(casesBytes)) issues.push({ code: `${prefix}.cases_hash`, message: 'cases file SHA-256 mismatch' });
  if (!SHA256.test(String(manifest.runsSha256 ?? '')) || manifest.runsSha256 !== digest(runsBytes)) issues.push({ code: `${prefix}.runs_hash`, message: 'runs file SHA-256 mismatch' });

  const signoffs = Array.isArray(manifest.signoffs) ? manifest.signoffs : [];
  const valid = new Map<DomainReleaseReviewerRole, Set<string>>([
    ['domain-reviewer', new Set()],
    ['independent-reviewer', new Set()],
  ]);
  for (const item of signoffs) {
    const reviewerId = typeof item?.reviewerId === 'string' ? item.reviewerId : '';
    const role = item?.role;
    const code = `${prefix}.signoff.${reviewerId || 'missing'}`;
    const registration = trustedReviewers[reviewerId];
    if (!reviewerId || (role !== 'domain-reviewer' && role !== 'independent-reviewer') || item?.decision !== 'approved') {
      issues.push({ code, message: 'approved reviewer identity and role are required' });
      continue;
    }
    const reviewedAt = Date.parse(item.reviewedAt);
    if (!Number.isFinite(reviewedAt) || reviewedAt > now || now - reviewedAt > 90 * 86_400_000) {
      issues.push({ code: `${code}.freshness`, message: 'review signoff must be a valid timestamp within 90 days' });
      continue;
    }
    if (!registration || !registration.roles.includes(role)) {
      issues.push({ code: `${code}.trust`, message: 'reviewer is not trusted for this role' });
      continue;
    }
    const unsigned = { reviewerId, role, decision: 'approved' as const, reviewedAt: item.reviewedAt };
    const core = { schema: 'nexyfab.domain-accuracy-release-manifest.v1' as const, domain, casesSha256: String(manifest.casesSha256), runsSha256: String(manifest.runsSha256) };
    let signatureValid = false;
    try { signatureValid = verify(null, Buffer.from(domainAccuracyReleaseSignoffPayload(core, unsigned)), registration.publicKey, Buffer.from(item.signature, 'base64')); } catch { signatureValid = false; }
    if (!signatureValid) issues.push({ code: `${code}.signature`, message: 'reviewer signature is invalid' });
    else valid.get(role)!.add(reviewerId);
  }
  const domainReviewers = valid.get('domain-reviewer')!;
  const independentReviewers = valid.get('independent-reviewer')!;
  if (!domainReviewers.size || !independentReviewers.size || [...domainReviewers].some(id => independentReviewers.has(id))) {
    issues.push({ code: `${prefix}.dual_review`, message: 'distinct trusted domain and independent reviewer signatures are required' });
  }
  return issues;
}

async function array<T>(bytes: Uint8Array): Promise<T[]> {
  const parsed: unknown = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
  if (!Array.isArray(parsed)) throw new TypeError('expected JSON array');
  return parsed as T[];
}

/** Commercial and technical releases require signed independent 95% reports for their declared product channel. */
export async function domainAccuracyReleaseIssues(
  evidenceDir: string | undefined,
  trustedReviewers: TrustedDomainReleaseReviewers = {},
  now = Date.now(),
  requiredDomains: readonly DomainAccuracyDomain[] = DOMAIN_ACCURACY_DOMAINS,
): Promise<DomainAccuracyReleaseIssue[]> {
  const scope = requiredDomains.join(',');
  if (!evidenceDir?.trim()) return [{ code: 'domain_accuracy.evidence_dir_missing', message: `DOMAIN_ACCURACY_EVIDENCE_DIR must point to approved campaign evidence for: ${scope}` }];
  const issues: DomainAccuracyReleaseIssue[] = [];
  for (const domain of requiredDomains) {
    try {
      const casesBytes = await readFile(join(evidenceDir, `${domain}.cases.json`));
      const runsBytes = await readFile(join(evidenceDir, `${domain}.runs.json`));
      const cases = await array<DomainAccuracyCase>(casesBytes);
      const runs = await array<DomainAccuracyRun>(runsBytes);
      const result = buildDomainAccuracyEvidence(domain, cases, runs);
      if (!result.assessment.eligible) {
        issues.push({
          code: `domain_accuracy.${domain}.not_eligible`,
          message: [...result.issues, ...result.assessment.blockers].join(', ') || '95% campaign is not eligible',
        });
      }
      const manifest = JSON.parse(await readFile(join(evidenceDir, `${domain}.release.json`), 'utf8')) as unknown;
      issues.push(...domainAccuracyReleaseManifestIssues(domain, casesBytes, runsBytes, manifest, trustedReviewers, now));
      const signerIds = new Set((manifest as Partial<DomainAccuracyReleaseManifest>)?.signoffs?.map(item => item.reviewerId) ?? []);
      for (const item of cases) {
        if (![...signerIds].every(id => item.approvalReviewerIds.includes(id))) {
          issues.push({ code: `domain_accuracy.${domain}.case_signer_binding`, message: `${item.caseId} is not approved by every release signer` });
          break;
        }
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

export function parseTrustedDomainReleaseReviewers(value: string | undefined): TrustedDomainReleaseReviewers {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as TrustedDomainReleaseReviewers;
  } catch { return {}; }
}
