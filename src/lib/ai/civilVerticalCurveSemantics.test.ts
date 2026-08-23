import { describe, expect, it } from 'vitest';
import type { CivilProfile } from './civilDocument';
import { evaluateCivilVerticalCurve, sampleCivilVerticalCurve } from './civilVerticalCurveSemantics';

const profile: CivilProfile = {
  id: 'profile:road', alignmentId: 'alignment:road', kind: 'proposed', points: [
    { id: 'pvi:before', stationM: 0, elevationM: 100 },
    { id: 'pvi:center', stationM: 50, elevationM: 105 },
    { id: 'pvi:after', stationM: 100, elevationM: 102 },
  ],
};

const curve = { id: 'curve:crest', profileId: 'profile:road', pviId: 'pvi:center', startStationM: 25, endStationM: 75, lengthM: 50 } as const;

describe('civil vertical curve semantics', () => {
  it('evaluates a centered parabolic crest and samples endpoint/interior grades deterministically', () => {
    const result = evaluateCivilVerticalCurve({ profile, curve, criteria: { designSpeedKph: 60, minimumKValueMPerPercent: 4, maximumGradePercent: 12 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.classification).toBe('crest');
    expect(result.evaluation.entryGradePercent).toBe(10);
    expect(result.evaluation.exitGradePercent).toBe(-6);
    expect(result.evaluation.gradeChangePercent).toBe(-16);
    expect(result.evaluation.kValueMPerPercent).toBe(3.125);
    expect(result.evaluation.criteria).toMatchObject({ designSpeedKph: 60, kValue: 'fail', entryGrade: 'pass', exitGrade: 'pass' });
    expect(result.evaluation.issues).toContain('k_value_below_caller_criterion');
    expect(sampleCivilVerticalCurve(result.evaluation, 25)).toMatchObject({ stationM: 25, elevationM: 102.5, gradePercent: 10 });
    expect(sampleCivilVerticalCurve(result.evaluation, 50)).toMatchObject({ stationM: 50, elevationM: 104, gradePercent: 2 });
    expect(sampleCivilVerticalCurve(result.evaluation, 75)).toMatchObject({ stationM: 75, elevationM: 103.5, gradePercent: -6 });
  });

  it('fails closed for non-centered PVI, incomplete stable identity, and invalid criteria', () => {
    expect(evaluateCivilVerticalCurve({ profile, curve: { ...curve, startStationM: 20, endStationM: 70, lengthM: 50 } })).toMatchObject({ ok: false, issues: expect.arrayContaining(['pvi_must_be_curve_midpoint']) });
    const idless = structuredClone(profile); delete idless.points[0]!.id;
    expect(evaluateCivilVerticalCurve({ profile: idless, curve })).toMatchObject({ ok: false, issues: expect.arrayContaining(['profile_requires_unique_stable_pvis']) });
    expect(evaluateCivilVerticalCurve({ profile, curve, criteria: { designSpeedKph: 60 } })).toMatchObject({ ok: false, issues: expect.arrayContaining(['speed_k_value_criterion_incomplete']) });
    expect(evaluateCivilVerticalCurve({ profile, curve: { ...curve, id: '' } })).toMatchObject({ ok: false, issues: expect.arrayContaining(['curve_identity_invalid']) });
    const narrowTangents: CivilProfile = { ...profile, points: [
      { id: 'pvi:outer-before', stationM: 0, elevationM: 98 },
      { id: 'pvi:before', stationM: 30, elevationM: 100 },
      profile.points[1]!,
      { id: 'pvi:after', stationM: 70, elevationM: 102 },
      { id: 'pvi:outer-after', stationM: 100, elevationM: 101 },
    ] };
    expect(evaluateCivilVerticalCurve({ profile: narrowTangents, curve })).toMatchObject({ ok: false, issues: expect.arrayContaining(['curve_exceeds_adjacent_tangents']) });
  });

  it('distinguishes a valid sag and rejects out-of-range sampling without claiming release readiness', () => {
    const sagProfile: CivilProfile = { ...profile, points: [{ id: 'pvi:before', stationM: 0, elevationM: 105 }, { id: 'pvi:center', stationM: 50, elevationM: 100 }, { id: 'pvi:after', stationM: 100, elevationM: 103 }] };
    const result = evaluateCivilVerticalCurve({ profile: sagProfile, curve: { ...curve, id: 'curve:sag' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.classification).toBe('sag');
    expect(result.evaluation.criteria.kValue).toBe('not_run');
    expect(() => sampleCivilVerticalCurve(result.evaluation, 76)).toThrow('curve_sample_station_out_of_range');
  });
});
