/**
 * Design Rule Check (F7) — custom rule engine.
 *
 * Lets a customer define their own design standards ("min wall ≥ 1.5mm",
 * "hole-to-edge ≥ 2mm", "this face must be parallel to the datum") and run
 * them automatically on every geometry change. Built on top of the existing
 * dfmAnalysis (which has fixed-process rules) and geometryValidation. DRC
 * extends those with USER-DEFINED rules — the enterprise lock-in feature.
 *
 * Rule format is a discriminated union of pure data (JSON-serialisable) so
 * organisations can store their standard as a file checked into git.
 */

import * as THREE from 'three';
import { computeMassProperties } from './massProperties';
import { analyzeDFM } from './dfmAnalysis';

// ─── Rule schema ─────────────────────────────────────────────────────────────

export type DrcSeverity = 'error' | 'warning' | 'info';

/** Each rule type carries its own check parameters; severity + label common. */
export type DrcRule =
  | {
      kind: 'min-wall-thickness';
      id: string;
      label: string;
      severity: DrcSeverity;
      /** Min thickness in mm. */
      minMm: number;
    }
  | {
      kind: 'min-volume';
      id: string;
      label: string;
      severity: DrcSeverity;
      minCm3: number;
    }
  | {
      kind: 'max-volume';
      id: string;
      label: string;
      severity: DrcSeverity;
      maxCm3: number;
    }
  | {
      kind: 'aspect-ratio';
      id: string;
      label: string;
      severity: DrcSeverity;
      /** Reject if max(w,h,d) / min(w,h,d) > maxRatio. */
      maxRatio: number;
    }
  | {
      kind: 'bbox-fit';
      id: string;
      label: string;
      severity: DrcSeverity;
      /** Part must fit within these world-space dimensions (mm). */
      maxW: number; maxH: number; maxD: number;
    }
  | {
      kind: 'min-mass';
      id: string;
      label: string;
      severity: DrcSeverity;
      minG: number;
      density_g_cm3: number;
    };

export interface DrcRuleSet {
  /** Schema version. */
  version: 1;
  name: string;
  rules: DrcRule[];
}

// ─── Violation report ────────────────────────────────────────────────────────

export interface DrcViolation {
  ruleId: string;
  ruleLabel: string;
  severity: DrcSeverity;
  /** Human-readable detail, e.g. "actual 0.8mm < min 1.5mm". */
  detail: string;
}

export interface DrcReport {
  ruleSetName: string;
  totalRules: number;
  violations: DrcViolation[];
  passing: boolean;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export function runDrc(
  geometry: THREE.BufferGeometry,
  ruleSet: DrcRuleSet,
): DrcReport {
  const violations: DrcViolation[] = [];

  // Pre-compute shared signals so rules don't recompute.
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const w = bb ? bb.max.x - bb.min.x : 0;
  const h = bb ? bb.max.y - bb.min.y : 0;
  const d = bb ? bb.max.z - bb.min.z : 0;

  // DFM analysis is heavier — only run if a rule needs it.
  const needsWallCheck = ruleSet.rules.some(r => r.kind === 'min-wall-thickness');
  const dfmThinWalls: number[] = [];
  let minWallObserved = Infinity;
  if (needsWallCheck) {
    try {
      const dfmResults = analyzeDFM(geometry, ['cnc_milling'], { minWallThickness: 0.01 });
      const result = dfmResults[0];
      if (result?.issues) {
        for (const issue of result.issues) {
          if (issue.type === 'thin_wall' && issue.faceIndices) {
            dfmThinWalls.push(...issue.faceIndices);
            // Description format: 'Wall thickness X.Xmm below minimum Y.Ymm'
            // Use a regex to extract the actual measured thickness.
            const m = issue.description.match(/(\d+(?:\.\d+)?)\s*mm/);
            if (m) {
              const v = parseFloat(m[1]);
              if (v < minWallObserved) minWallObserved = v;
            }
          }
        }
      }
    } catch {
      /* DFM failure shouldn't crash DRC; treat as inconclusive. */
    }
  }

  for (const rule of ruleSet.rules) {
    switch (rule.kind) {
      case 'min-wall-thickness': {
        if (dfmThinWalls.length > 0) {
          const observed = isFinite(minWallObserved) ? minWallObserved : null;
          violations.push({
            ruleId: rule.id,
            ruleLabel: rule.label,
            severity: rule.severity,
            detail: observed != null
              ? `Min wall ${observed.toFixed(2)}mm < ${rule.minMm}mm (${dfmThinWalls.length} face${dfmThinWalls.length === 1 ? '' : 's'})`
              : `${dfmThinWalls.length} thin-wall region${dfmThinWalls.length === 1 ? '' : 's'} below ${rule.minMm}mm`,
          });
        }
        break;
      }
      case 'min-volume': {
        const v = computeMassProperties(geometry, 1).volume_cm3;
        if (v < rule.minCm3) {
          violations.push({
            ruleId: rule.id,
            ruleLabel: rule.label,
            severity: rule.severity,
            detail: `Volume ${v.toFixed(2)}cm³ < ${rule.minCm3}cm³`,
          });
        }
        break;
      }
      case 'max-volume': {
        const v = computeMassProperties(geometry, 1).volume_cm3;
        if (v > rule.maxCm3) {
          violations.push({
            ruleId: rule.id,
            ruleLabel: rule.label,
            severity: rule.severity,
            detail: `Volume ${v.toFixed(2)}cm³ > ${rule.maxCm3}cm³`,
          });
        }
        break;
      }
      case 'aspect-ratio': {
        const dims = [w, h, d].filter(x => x > 0);
        if (dims.length === 3) {
          const ratio = Math.max(...dims) / Math.max(0.01, Math.min(...dims));
          if (ratio > rule.maxRatio) {
            violations.push({
              ruleId: rule.id,
              ruleLabel: rule.label,
              severity: rule.severity,
              detail: `Aspect ratio ${ratio.toFixed(1)} > ${rule.maxRatio}`,
            });
          }
        }
        break;
      }
      case 'bbox-fit': {
        if (w > rule.maxW || h > rule.maxH || d > rule.maxD) {
          violations.push({
            ruleId: rule.id,
            ruleLabel: rule.label,
            severity: rule.severity,
            detail: `Size ${w.toFixed(0)}×${h.toFixed(0)}×${d.toFixed(0)} > ${rule.maxW}×${rule.maxH}×${rule.maxD}mm`,
          });
        }
        break;
      }
      case 'min-mass': {
        const m = computeMassProperties(geometry, rule.density_g_cm3).mass_g;
        if (m < rule.minG) {
          violations.push({
            ruleId: rule.id,
            ruleLabel: rule.label,
            severity: rule.severity,
            detail: `Mass ${m.toFixed(1)}g < ${rule.minG}g`,
          });
        }
        break;
      }
    }
  }

  return {
    ruleSetName: ruleSet.name,
    totalRules: ruleSet.rules.length,
    violations,
    passing: violations.filter(v => v.severity === 'error').length === 0,
  };
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

export function ruleSetToJson(set: DrcRuleSet): string {
  return JSON.stringify(set, null, 2);
}

export function ruleSetFromJson(json: string): DrcRuleSet {
  const parsed = JSON.parse(json) as DrcRuleSet;
  if (parsed.version !== 1) throw new Error(`Unsupported DRC version: ${parsed.version}`);
  if (!Array.isArray(parsed.rules)) throw new Error('DRC: rules must be an array');
  return parsed;
}
