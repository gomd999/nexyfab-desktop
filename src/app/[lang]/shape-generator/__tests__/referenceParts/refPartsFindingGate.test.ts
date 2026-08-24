import { describe, expect, it } from 'vitest';
import { blockingFindings, type Finding } from './refPartsHarness';

describe('reference-part blocking finding gate', () => {
  it('blocks critical and major product findings while retaining report-only findings', () => {
    const finding = (severity: Finding['severity']): Finding => ({
      part: 'fixture', severity, title: `${severity} title`, detail: `${severity} detail`,
    });
    expect(blockingFindings([
      finding('info'), finding('minor'), finding('major'), finding('critical'),
    ])).toEqual([finding('major'), finding('critical')]);
  });
});
