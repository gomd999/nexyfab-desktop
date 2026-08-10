import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  domainAccuracyReleaseManifestIssues,
  domainAccuracyReleaseSignoffPayload,
  type DomainAccuracyReleaseManifest,
} from './domainAccuracyReleaseGate';
import { domainAccuracyReleaseIssues } from './domainAccuracyReleaseGate';

describe('domain accuracy commercial release gate', () => {
  it('fails closed without an evidence directory', async () => {
    await expect(domainAccuracyReleaseIssues(undefined)).resolves.toEqual([
      expect.objectContaining({ code: 'domain_accuracy.evidence_dir_missing' }),
    ]);
  });
  it('reports every missing or malformed domain evidence set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexyfab-domain-accuracy-'));
    await writeFile(join(dir, 'civil.cases.json'), '{}');
    const issues = await domainAccuracyReleaseIssues(dir);
    expect(issues).toHaveLength(5);
    expect(issues.map(item => item.code)).toEqual(expect.arrayContaining([
      'domain_accuracy.mechanical.evidence_unreadable',
      'domain_accuracy.civil.evidence_unreadable',
      'domain_accuracy.interior.evidence_unreadable',
    ]));
  });

  it('requires distinct trusted signatures bound to the exact cases and runs bytes', () => {
    const cases = new TextEncoder().encode('[]\n');
    const runs = new TextEncoder().encode('[]\n');
    const domainKey = generateKeyPairSync('ed25519');
    const independentKey = generateKeyPairSync('ed25519');
    const core = {
      schema: 'nexyfab.domain-accuracy-release-manifest.v1' as const,
      domain: 'mechanical' as const,
      casesSha256: createHash('sha256').update(cases).digest('hex'),
      runsSha256: createHash('sha256').update(runs).digest('hex'),
    };
    const reviewedAt = '2026-08-10T00:00:00.000Z';
    const make = (reviewerId: string, role: 'domain-reviewer' | 'independent-reviewer', privateKey: typeof domainKey.privateKey) => {
      const unsigned = { reviewerId, role, decision: 'approved' as const, reviewedAt };
      return { ...unsigned, signature: sign(null, Buffer.from(domainAccuracyReleaseSignoffPayload(core, unsigned)), privateKey).toString('base64') };
    };
    const manifest: DomainAccuracyReleaseManifest = {
      ...core,
      signoffs: [make('domain-1', 'domain-reviewer', domainKey.privateKey), make('independent-1', 'independent-reviewer', independentKey.privateKey)],
    };
    const keys = {
      'domain-1': { publicKey: domainKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['domain-reviewer' as const] },
      'independent-1': { publicKey: independentKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['independent-reviewer' as const] },
    };
    const now = Date.parse('2026-08-10T01:00:00.000Z');
    expect(domainAccuracyReleaseManifestIssues('mechanical', cases, runs, manifest, keys, now)).toEqual([]);
    expect(domainAccuracyReleaseManifestIssues('mechanical', new TextEncoder().encode('[{}]\n'), runs, manifest, keys, now).map(item => item.code)).toContain('domain_accuracy.mechanical.release_manifest.cases_hash');
    const untrusted = domainAccuracyReleaseManifestIssues('mechanical', cases, runs, manifest, {}, now);
    expect(untrusted.map(item => item.code)).toEqual(expect.arrayContaining([
      'domain_accuracy.mechanical.release_manifest.signoff.domain-1.trust',
      'domain_accuracy.mechanical.release_manifest.signoff.independent-1.trust',
      'domain_accuracy.mechanical.release_manifest.dual_review',
    ]));
  });
});
