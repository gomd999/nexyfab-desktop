/**
 * toolAverageWear.ts — Average tool wear analysis across a job /
 * shift / batch.
 *
 * Stage 1 (`toolWearTaylor`) tracks ONE tool through one job. In a
 * production shop you have N tools running across many jobs and
 * need to:
 *
 *   - Track each tool's cumulative wear.
 *   - Project when each tool will need replacement.
 *   - Identify which tool is *consistently* exceeding expected
 *     wear (suggests bad batch / wrong material).
 *   - Compute job-level cost-of-tooling.
 *
 * Output: per-tool state + replacement schedule + outlier flags.
 */

export interface JobRecord {
  jobId: string;
  toolId: string;
  /** Duration this tool was cutting in this job, minutes. */
  cuttingMin: number;
  /** Fraction of life consumed (0..1+). */
  wearFraction: number;
  /** Cost of the cut, USD. */
  costUsd: number;
  /** Was this run flagged as abnormal? */
  abnormal?: boolean;
}

export interface ToolState {
  toolId: string;
  totalCuttingMin: number;
  totalWearFraction: number;
  totalCostUsd: number;
  jobsRunOn: number;
  /** Average wear per minute. */
  averageWearRate: number;
  /** Estimated remaining minutes at the average wear rate. */
  remainingMin: number;
  /** Replace immediately? */
  needsReplacement: boolean;
}

export interface AnalysisResult {
  toolStates: ToolState[];
  /** Sorted by remaining life ascending (most urgent first). */
  replacementSchedule: ToolState[];
  /** Outlier flags: tools whose wear rate exceeds 2× the fleet average. */
  outlierToolIds: string[];
  totalJobCount: number;
  totalToolingCostUsd: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function analyzeFleet(records: JobRecord[]): AnalysisResult {
  const toolMap = new Map<string, JobRecord[]>();
  for (const r of records) {
    const list = toolMap.get(r.toolId) ?? [];
    list.push(r);
    toolMap.set(r.toolId, list);
  }

  const states: ToolState[] = [];
  for (const [toolId, jobs] of toolMap) {
    const totalMin = jobs.reduce((s, j) => s + j.cuttingMin, 0);
    const totalWear = jobs.reduce((s, j) => s + j.wearFraction, 0);
    const totalCost = jobs.reduce((s, j) => s + j.costUsd, 0);
    const rate = totalMin > 0 ? totalWear / totalMin : 0;
    const remaining = rate > 0 ? Math.max(0, (1 - totalWear) / rate) : Infinity;
    states.push({
      toolId,
      totalCuttingMin: totalMin,
      totalWearFraction: totalWear,
      totalCostUsd: totalCost,
      jobsRunOn: jobs.length,
      averageWearRate: rate,
      remainingMin: remaining,
      needsReplacement: totalWear >= 1.0,
    });
  }

  // Fleet average wear rate.
  const fleetRates = states.map(s => s.averageWearRate).filter(r => r > 0);
  const fleetAvg = fleetRates.length > 0 ? fleetRates.reduce((s, r) => s + r, 0) / fleetRates.length : 0;
  const outliers = states.filter(s => fleetAvg > 0 && s.averageWearRate > 2 * fleetAvg).map(s => s.toolId);

  const schedule = [...states].sort((a, b) => a.remainingMin - b.remainingMin);
  const totalJobs = new Set(records.map(r => r.jobId)).size;
  const totalCost = records.reduce((s, r) => s + r.costUsd, 0);

  return {
    toolStates: states,
    replacementSchedule: schedule,
    outlierToolIds: outliers,
    totalJobCount: totalJobs,
    totalToolingCostUsd: totalCost,
  };
}

// ── Job-level cost ────────────────────────────────────────────

export interface JobToolingCost {
  jobId: string;
  totalCostUsd: number;
  toolCount: number;
  abnormalRunCount: number;
}

export function jobLevelCost(records: JobRecord[]): JobToolingCost[] {
  const map = new Map<string, JobRecord[]>();
  for (const r of records) {
    const list = map.get(r.jobId) ?? [];
    list.push(r);
    map.set(r.jobId, list);
  }
  const out: JobToolingCost[] = [];
  for (const [jobId, recs] of map) {
    const tools = new Set(recs.map(r => r.toolId));
    out.push({
      jobId,
      totalCostUsd: recs.reduce((s, r) => s + r.costUsd, 0),
      toolCount: tools.size,
      abnormalRunCount: recs.filter(r => r.abnormal === true).length,
    });
  }
  return out.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

// ── Replacement priority ─────────────────────────────────────

export function pickReplacementCandidates(result: AnalysisResult, count: number = 3): ToolState[] {
  return result.replacementSchedule.filter(s => s.remainingMin < Infinity).slice(0, count);
}

// ── Summary ────────────────────────────────────────────────────

export interface AnalysisSummary {
  toolCount: number;
  jobCount: number;
  toolsNeedingReplacement: number;
  outlierCount: number;
  totalToolingCostUsd: number;
  shortestRemainingMin: number;
}

export function summarize(result: AnalysisResult): AnalysisSummary {
  const replaceCount = result.toolStates.filter(s => s.needsReplacement).length;
  const shortest = result.replacementSchedule.length > 0
    ? result.replacementSchedule[0]!.remainingMin
    : Infinity;
  return {
    toolCount: result.toolStates.length,
    jobCount: result.totalJobCount,
    toolsNeedingReplacement: replaceCount,
    outlierCount: result.outlierToolIds.length,
    totalToolingCostUsd: result.totalToolingCostUsd,
    shortestRemainingMin: shortest,
  };
}
