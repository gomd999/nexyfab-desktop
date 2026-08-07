import { describe, expect, it } from 'vitest';
import { parseDomainReportArgs } from './report-domain-accuracy';

describe('domain accuracy report CLI', () => {
  it('parses an explicit domain and evidence files', () => {
    expect(parseDomainReportArgs([
      '--domain', 'mechanical', '--cases', 'cases.json', '--runs', 'runs.json',
    ])).toEqual({ domain: 'mechanical', casesFile: 'cases.json', runsFile: 'runs.json' });
  });

  it('rejects an unknown domain', () => {
    expect(() => parseDomainReportArgs([
      '--domain', 'generic', '--cases', 'cases.json', '--runs', 'runs.json',
    ])).toThrow('mechanical, civil, building, landscape, interior');
  });

  it('requires both evidence files', () => {
    expect(() => parseDomainReportArgs(['--domain', 'civil'])).toThrow('--cases');
    expect(() => parseDomainReportArgs(['--domain', 'civil', '--cases', 'cases.json'])).toThrow('--runs');
  });
});

