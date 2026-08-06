import { describe, expect, it } from 'vitest';
import { verifyRadianceGoldenEvidence, type RadianceGoldenExpectation, type RadianceGoldenMeasurement } from './radianceReleaseGate';

const hash = 'a'.repeat(64);
const expected: RadianceGoldenExpectation = { fixtureId: 'daylight-room-v1', radianceVersionPattern: 'RADIANCE\\s+6\\.0', sceneSha256: hash, sensorsSha256: hash, weatherSha256: hash, pointIlluminanceLux: [100, 500], annual: { sda300_50Percent: 50, ase1000_250Percent: 0 }, tolerance: { pointRelativePercent: 2, pointAbsoluteLux: 1, annualPercentagePoints: 0.5 } };
const actual: RadianceGoldenMeasurement = { fixtureId: expected.fixtureId, radianceVersion: 'RADIANCE 6.0', sceneSha256: hash, sensorsSha256: hash, weatherSha256: hash, pointIlluminanceLux: [101, 499], annual: { sda300_50Percent: 50.4, ase1000_250Percent: 0 }, pointOutputSha256: hash, annualOutputSha256: hash };

describe('Radiance accuracy release gate', () => {
  it('passes complete, in-tolerance, provenance-bound evidence', () => expect(verifyRadianceGoldenEvidence(expected, actual)).toMatchObject({ status: 'pass', releaseReady: true }));
  it('fails a result outside point or annual tolerance', () => expect(verifyRadianceGoldenEvidence(expected, { ...actual, pointIlluminanceLux: [110, 499], annual: { ...actual.annual, sda300_50Percent: 51 } })).toMatchObject({ status: 'fail', releaseReady: false, checks: { point: false, annual: false } }));
  it('returns not_run when the deployed-engine measurement is absent', () => expect(verifyRadianceGoldenEvidence(expected)).toMatchObject({ status: 'not_run', releaseReady: false }));
});
