/**
 * feaReport.ts — Consolidated FEA preview report.
 *
 * Brings together `stressField` statistics, `safetyFactor` analysis,
 * and `displacement` magnitudes into one summary the inspector panel
 * shows after a run. The format is print-friendly + JSON-serialisable
 * so the same report drives both the on-screen sidebar and any
 * downstream "share as PDF" feature.
 *
 * Scope per `nexyfab-gtm`: this is the **preview** layer — fields are
 * labelled with units and a clear "approximate, validate with Ansys
 * before manufacturing" disclaimer that lives in the UI shell.
 */

import { statisticsOf, hotspotsOf, type StressField, type Hotspot } from './stressField';
import { analyseField, type SafetyFactorBands, type SafetyFactorReport } from './safetyFactor';
import { displacementMagnitudes } from './displacement';

export interface FeaPreviewReport {
  /** Material id used for the SF analysis. */
  materialId: string;
  /** Generated at (ms epoch). */
  generatedAt: number;
  stressMPa: {
    min: number;
    max: number;
    mean: number;
    p95: number;
    invalidCount: number;
  };
  displacementMm: {
    min: number;
    max: number;
    mean: number;
  };
  /** Top-5 stress hotspots (vertex index + value). */
  hotspots: Hotspot[];
  /** Safety-factor analysis. `null` when the material isn't in the catalogue. */
  safetyFactor: SafetyFactorReport | null;
  /** Overall verdict: `pass` iff SF analysis passed, `fail` if any
   *  vertex falls below the fail threshold, `inconclusive` if SF couldn't run. */
  verdict: 'pass' | 'fail' | 'inconclusive';
}

export interface ReportOptions {
  materialId: string;
  /** Top-N count. Default 5. */
  hotspotCount?: number;
  /** SF band overrides. */
  bands?: SafetyFactorBands;
  /** Override timestamp (test injection). */
  now?: () => number;
}

function statsOf(arr: Float32Array): { min: number; max: number; mean: number } {
  let min = Infinity, max = -Infinity, sum = 0, count = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    count++;
  }
  return {
    min: count > 0 ? min : 0,
    max: count > 0 ? max : 0,
    mean: count > 0 ? sum / count : 0,
  };
}

/** Produce the full report from a stress field. */
export function buildFeaReport(field: StressField, opts: ReportOptions): FeaPreviewReport {
  const stressStats = statisticsOf(field);
  const dispMagnitudes = displacementMagnitudes(field);
  const dispStats = statsOf(dispMagnitudes);
  const hotspots = hotspotsOf(field, opts.hotspotCount ?? 5);
  const sf = analyseField(field, opts.materialId, opts.bands);
  const verdict: FeaPreviewReport['verdict'] = !sf
    ? 'inconclusive'
    : sf.decision === 'fail' ? 'fail' : 'pass';
  return {
    materialId: opts.materialId,
    generatedAt: (opts.now ?? Date.now)(),
    stressMPa: {
      min: stressStats.min,
      max: stressStats.max,
      mean: stressStats.mean,
      p95: stressStats.p95,
      invalidCount: stressStats.invalidCount,
    },
    displacementMm: dispStats,
    hotspots,
    safetyFactor: sf,
    verdict,
  };
}

/** Pretty-print the report as a copy-pastable text block — used in
 *  the export sidebar's "copy to clipboard" button. */
export function formatReportText(report: FeaPreviewReport): string {
  const lines: string[] = [];
  lines.push('=== FEA Preview Report ===');
  lines.push(`Material: ${report.materialId}`);
  lines.push(`Generated: ${new Date(report.generatedAt).toISOString()}`);
  lines.push(`Verdict:  ${report.verdict.toUpperCase()}`);
  lines.push('');
  lines.push(`Stress (MPa)        min ${report.stressMPa.min.toFixed(2)}  max ${report.stressMPa.max.toFixed(2)}  mean ${report.stressMPa.mean.toFixed(2)}  p95 ${report.stressMPa.p95.toFixed(2)}`);
  lines.push(`Displacement (mm)   min ${report.displacementMm.min.toFixed(3)}  max ${report.displacementMm.max.toFixed(3)}  mean ${report.displacementMm.mean.toFixed(3)}`);
  if (report.safetyFactor) {
    lines.push(`Safety factor       min ${report.safetyFactor.minSf.toFixed(2)} @ vertex ${report.safetyFactor.minSfVertex}  mean ${report.safetyFactor.meanSf.toFixed(2)}`);
    lines.push(`  bands: fail=${report.safetyFactor.bandCounts.fail} marginal=${report.safetyFactor.bandCounts.marginal} acceptable=${report.safetyFactor.bandCounts.acceptable} safe=${report.safetyFactor.bandCounts.safe}`);
  }
  if (report.hotspots.length > 0) {
    lines.push('');
    lines.push('Top hotspots:');
    for (const h of report.hotspots) {
      lines.push(`  vertex ${h.vertexIndex}: ${h.stress.toFixed(2)} MPa`);
    }
  }
  lines.push('');
  lines.push('NOTE: preview-grade analysis — validate with Ansys before manufacturing.');
  return lines.join('\n');
}
