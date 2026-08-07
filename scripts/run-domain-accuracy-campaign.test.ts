import { describe, expect, it } from 'vitest';
import { parseDomainCampaignArgs } from './run-domain-accuracy-campaign';

describe('domain campaign CLI', () => {
  const valid = ['--domain', 'civil', '--cases', 'cases.json', '--state', 'state.json', '--runs', 'runs.json', '--executor', 'validator'];
  it('requires the governed domain and all persistent paths', () => {
    expect(() => parseDomainCampaignArgs([])).toThrow('--domain');
    expect(() => parseDomainCampaignArgs(['--domain', 'unknown', ...valid.slice(2)])).toThrow('--domain');
    expect(() => parseDomainCampaignArgs(valid.slice(0, -2))).toThrow('--executor');
  });
  it('parses repeated executor args without using a shell', () => {
    expect(parseDomainCampaignArgs([...valid, '--executor-arg', 'worker.mjs', '--executor-arg', '--strict', '--timeout-ms', '120000'])).toMatchObject({
      domain: 'civil', executor: 'validator', executorArgs: ['worker.mjs', '--strict'], timeoutMs: 120000,
    });
  });
  it('rejects an unsafe or ineffective timeout', () => {
    expect(() => parseDomainCampaignArgs([...valid, '--timeout-ms', '10'])).toThrow('--timeout-ms');
  });
});
