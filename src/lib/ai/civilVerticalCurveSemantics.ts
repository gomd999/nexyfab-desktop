import type { CivilProfile, CivilVerticalCurve } from './civilDocument';

/**
 * A deterministic, bounded semantic evaluator for a parabolic vertical curve.
 *
 * This helper intentionally does not claim jurisdictional code compliance,
 * native Civil 3D/OpenRoads output, or a release-ready corridor. Any K-value
 * or grade limits are caller-supplied design criteria and are reported as
 * criteria results only. Because the bounded source record has one PVI and a
 * total length (not separate tangent lengths), this helper requires the PVI
 * to be the curve midpoint.
 */
export const CIVIL_VERTICAL_CURVE_SEMANTICS_SCHEMA = 'nexyfab.civil-vertical-curve-semantics.v1' as const;

const EPSILON = 1e-9;

export type CivilVerticalCurveDesignCriteria = {
  /** Optional criterion derived by the caller from its governing design basis. */
  designSpeedKph?: number;
  minimumKValueMPerPercent?: number;
  maximumGradePercent?: number;
};

export type CivilVerticalCurveCriterionStatus = 'not_run' | 'pass' | 'fail';

export type CivilVerticalCurveEvaluation = {
  schema: typeof CIVIL_VERTICAL_CURVE_SEMANTICS_SCHEMA;
  curveId: string;
  profileId: string;
  pviId: string;
  classification: 'crest' | 'sag';
  startStationM: number;
  endStationM: number;
  lengthM: number;
  pviStationM: number;
  pviElevationM: number;
  pvcElevationM: number;
  pvtElevationM: number;
  entryGradePercent: number;
  exitGradePercent: number;
  gradeChangePercent: number;
  kValueMPerPercent: number;
  criteria: {
    designSpeedKph?: number;
    minimumKValueMPerPercent?: number;
    maximumGradePercent?: number;
    kValue: CivilVerticalCurveCriterionStatus;
    entryGrade: CivilVerticalCurveCriterionStatus;
    exitGrade: CivilVerticalCurveCriterionStatus;
  };
  issues: string[];
};

export type CivilVerticalCurveEvaluationResult =
  | { ok: true; evaluation: CivilVerticalCurveEvaluation }
  | { ok: false; issues: string[] };

export type CivilVerticalCurveSample = {
  stationM: number;
  elevationM: number;
  gradePercent: number;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function fail(...issues: string[]): CivilVerticalCurveEvaluationResult {
  return { ok: false, issues: [...new Set(issues)] };
}

function criteriaIssues(criteria: CivilVerticalCurveDesignCriteria | undefined): string[] {
  if (!criteria) return [];
  const issues: string[] = [];
  if (criteria.designSpeedKph !== undefined && (!finite(criteria.designSpeedKph) || criteria.designSpeedKph <= 0)) issues.push('design_speed_invalid');
  if (criteria.minimumKValueMPerPercent !== undefined && (!finite(criteria.minimumKValueMPerPercent) || criteria.minimumKValueMPerPercent <= 0)) issues.push('minimum_k_value_invalid');
  if (criteria.maximumGradePercent !== undefined && (!finite(criteria.maximumGradePercent) || criteria.maximumGradePercent <= 0)) issues.push('maximum_grade_invalid');
  const hasSpeed = criteria.designSpeedKph !== undefined;
  const hasKValue = criteria.minimumKValueMPerPercent !== undefined;
  if (hasSpeed !== hasKValue) issues.push('speed_k_value_criterion_incomplete');
  return issues;
}

function hasStableIds(profile: CivilProfile): boolean {
  const ids = profile.points.map(point => point.id);
  return ids.every((id): id is string => typeof id === 'string' && id.trim().length > 0)
    && new Set(ids).size === ids.length;
}

/** Evaluate a profile-owned curve using the adjacent PVI tangent grades. */
export function evaluateCivilVerticalCurve(input: {
  profile: CivilProfile;
  curve: CivilVerticalCurve;
  criteria?: CivilVerticalCurveDesignCriteria;
}): CivilVerticalCurveEvaluationResult {
  const { profile, curve, criteria } = input;
  const structuralIssues = criteriaIssues(criteria);
  if (typeof profile.id !== 'string' || !profile.id.trim() || typeof curve.id !== 'string' || !curve.id.trim() || typeof curve.pviId !== 'string' || !curve.pviId.trim()) {
    structuralIssues.push('curve_identity_invalid');
  }
  if (profile.id !== curve.profileId) structuralIssues.push('profile_binding_mismatch');
  if (!profile.points || profile.points.length < 3 || !hasStableIds(profile)) structuralIssues.push('profile_requires_unique_stable_pvis');
  if (!finite(curve.startStationM) || !finite(curve.endStationM) || curve.endStationM <= curve.startStationM) structuralIssues.push('curve_station_range_invalid');
  if (!finite(curve.lengthM) || curve.lengthM <= 0 || Math.abs((curve.endStationM - curve.startStationM) - curve.lengthM) > EPSILON) structuralIssues.push('curve_length_mismatch');
  if (structuralIssues.length) return fail(...structuralIssues);

  const points = profile.points;
  for (let index = 1; index < points.length; index += 1) {
    if (!finite(points[index - 1]!.stationM) || !finite(points[index]!.stationM) || points[index]!.stationM <= points[index - 1]!.stationM) structuralIssues.push('profile_station_order_invalid');
    if (!finite(points[index - 1]!.elevationM) || !finite(points[index]!.elevationM)) structuralIssues.push('profile_elevation_invalid');
  }
  if (!finite(points.at(-1)!.elevationM)) structuralIssues.push('profile_elevation_invalid');
  const pviIndex = points.findIndex(point => point.id === curve.pviId);
  if (pviIndex <= 0 || pviIndex >= points.length - 1) structuralIssues.push('pvi_must_have_adjacent_tangents');
  const pvi = points[pviIndex];
  if (!pvi || !finite(pvi.stationM) || !finite(pvi.elevationM)) structuralIssues.push('pvi_invalid');
  if (pvi && (curve.startStationM < points[0]!.stationM || curve.endStationM > points.at(-1)!.stationM)) structuralIssues.push('curve_outside_profile');
  if (pvi && Math.abs(pvi.stationM - (curve.startStationM + curve.endStationM) / 2) > EPSILON) structuralIssues.push('pvi_must_be_curve_midpoint');
  if (structuralIssues.length) return fail(...structuralIssues);

  const previous = points[pviIndex - 1]!;
  const next = points[pviIndex + 1]!;
  if (curve.startStationM < previous.stationM - EPSILON || curve.endStationM > next.stationM + EPSILON) {
    return fail('curve_exceeds_adjacent_tangents');
  }
  const entryGrade = (pvi.elevationM - previous.elevationM) / (pvi.stationM - previous.stationM);
  const exitGrade = (next.elevationM - pvi.elevationM) / (next.stationM - pvi.stationM);
  const gradeChangePercent = (exitGrade - entryGrade) * 100;
  if (Math.abs(gradeChangePercent) <= EPSILON) return fail('curve_requires_nonzero_grade_change');
  const lengthM = curve.endStationM - curve.startStationM;
  const pvcElevationM = pvi.elevationM - entryGrade * (pvi.stationM - curve.startStationM);
  const pvtElevationM = pvcElevationM + entryGrade * lengthM + ((exitGrade - entryGrade) / (2 * lengthM)) * lengthM * lengthM;
  const kValueMPerPercent = lengthM / Math.abs(gradeChangePercent);
  const classification = gradeChangePercent < 0 ? 'crest' : 'sag';
  const maximumGrade = criteria?.maximumGradePercent;
  const minimumK = criteria?.minimumKValueMPerPercent;
  const evaluationIssues: string[] = [];
  const kValueStatus: CivilVerticalCurveCriterionStatus = minimumK === undefined ? 'not_run' : kValueMPerPercent + EPSILON >= minimumK ? 'pass' : 'fail';
  const entryGradeStatus: CivilVerticalCurveCriterionStatus = maximumGrade === undefined ? 'not_run' : Math.abs(entryGrade * 100) <= maximumGrade + EPSILON ? 'pass' : 'fail';
  const exitGradeStatus: CivilVerticalCurveCriterionStatus = maximumGrade === undefined ? 'not_run' : Math.abs(exitGrade * 100) <= maximumGrade + EPSILON ? 'pass' : 'fail';
  if (kValueStatus === 'fail') evaluationIssues.push('k_value_below_caller_criterion');
  if (entryGradeStatus === 'fail') evaluationIssues.push('entry_grade_above_caller_criterion');
  if (exitGradeStatus === 'fail') evaluationIssues.push('exit_grade_above_caller_criterion');
  return {
    ok: true,
    evaluation: {
      schema: CIVIL_VERTICAL_CURVE_SEMANTICS_SCHEMA,
      curveId: curve.id,
      profileId: profile.id,
      pviId: curve.pviId,
      classification,
      startStationM: curve.startStationM,
      endStationM: curve.endStationM,
      lengthM,
      pviStationM: pvi.stationM,
      pviElevationM: pvi.elevationM,
      pvcElevationM,
      pvtElevationM,
      entryGradePercent: entryGrade * 100,
      exitGradePercent: exitGrade * 100,
      gradeChangePercent,
      kValueMPerPercent,
      criteria: { ...criteria, kValue: kValueStatus, entryGrade: entryGradeStatus, exitGrade: exitGradeStatus },
      issues: evaluationIssues,
    },
  };
}

/** Sample the exact parabolic curve; callers must supply a station in range. */
export function sampleCivilVerticalCurve(evaluation: CivilVerticalCurveEvaluation, stationM: number): CivilVerticalCurveSample {
  if (!finite(stationM) || stationM < evaluation.startStationM - EPSILON || stationM > evaluation.endStationM + EPSILON) throw new Error('curve_sample_station_out_of_range');
  const station = Math.min(evaluation.endStationM, Math.max(evaluation.startStationM, stationM));
  const x = station - evaluation.startStationM;
  const entryGrade = evaluation.entryGradePercent / 100;
  const gradeDelta = evaluation.gradeChangePercent / 100;
  return { stationM: station, elevationM: evaluation.pvcElevationM + entryGrade * x + (gradeDelta / (2 * evaluation.lengthM)) * x * x, gradePercent: evaluation.entryGradePercent + evaluation.gradeChangePercent * x / evaluation.lengthM };
}
