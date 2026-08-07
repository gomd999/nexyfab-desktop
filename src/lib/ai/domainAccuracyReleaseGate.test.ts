import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
});
