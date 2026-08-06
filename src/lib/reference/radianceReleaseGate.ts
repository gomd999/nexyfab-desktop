export interface RadianceGoldenExpectation {
  fixtureId: string;
  radianceVersionPattern: string;
  sceneSha256: string;
  sensorsSha256: string;
  weatherSha256: string;
  pointIlluminanceLux: number[];
  annual: { sda300_50Percent: number; ase1000_250Percent: number };
  tolerance: { pointRelativePercent: number; pointAbsoluteLux: number; annualPercentagePoints: number };
}

export interface RadianceGoldenMeasurement {
  fixtureId: string;
  radianceVersion: string;
  sceneSha256: string;
  sensorsSha256: string;
  weatherSha256: string;
  pointIlluminanceLux: number[];
  annual: { sda300_50Percent: number; ase1000_250Percent: number };
  pointOutputSha256: string;
  annualOutputSha256: string;
}

export interface RadianceReleaseGateResult { status: 'pass' | 'fail' | 'not_run'; releaseReady: boolean; checks: { provenance: boolean; version: boolean; point: boolean; annual: boolean }; errors: string[] }
const sha256 = /^[a-f0-9]{64}$/;

export function verifyRadianceGoldenEvidence(expected: RadianceGoldenExpectation, actual?: RadianceGoldenMeasurement): RadianceReleaseGateResult {
  const empty = { provenance: false, version: false, point: false, annual: false };
  if (!actual) return { status: 'not_run', releaseReady: false, checks: empty, errors: ['radiance_golden_evidence_missing'] };
  const errors: string[] = [];
  const provenance = actual.fixtureId === expected.fixtureId && actual.sceneSha256 === expected.sceneSha256 && actual.sensorsSha256 === expected.sensorsSha256 && actual.weatherSha256 === expected.weatherSha256 && sha256.test(actual.pointOutputSha256) && sha256.test(actual.annualOutputSha256);
  if (!provenance) errors.push('radiance_golden_provenance_mismatch');
  let version = false;
  try { version = new RegExp(expected.radianceVersionPattern).test(actual.radianceVersion); } catch { throw new Error('invalid_radiance_version_pattern'); }
  if (!version) errors.push('radiance_version_mismatch');
  let point = actual.pointIlluminanceLux.length === expected.pointIlluminanceLux.length;
  if (point) for (let index = 0; index < expected.pointIlluminanceLux.length; index++) {
    const target = expected.pointIlluminanceLux[index], value = actual.pointIlluminanceLux[index];
    const tolerance = Math.max(expected.tolerance.pointAbsoluteLux, Math.abs(target) * expected.tolerance.pointRelativePercent / 100);
    if (!Number.isFinite(value) || Math.abs(value - target) > tolerance) { point = false; break; }
  }
  if (!point) errors.push('radiance_point_golden_mismatch');
  const annualValues = [actual.annual.sda300_50Percent, actual.annual.ase1000_250Percent];
  const annual = annualValues.every(Number.isFinite) && Math.abs(actual.annual.sda300_50Percent - expected.annual.sda300_50Percent) <= expected.tolerance.annualPercentagePoints && Math.abs(actual.annual.ase1000_250Percent - expected.annual.ase1000_250Percent) <= expected.tolerance.annualPercentagePoints;
  if (!annual) errors.push('radiance_annual_golden_mismatch');
  const checks = { provenance, version, point, annual }, releaseReady = Object.values(checks).every(Boolean) && errors.length === 0;
  return { status: releaseReady ? 'pass' : 'fail', releaseReady, checks, errors };
}
