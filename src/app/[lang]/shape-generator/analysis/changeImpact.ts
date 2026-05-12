/**
 * Change-impact analysis (F6).
 *
 * Goal: before deleting / suppressing / modifying a feature, surface the
 * cascade — which parametric expressions reference its outputs, which
 * downstream features depend on its geometry, which assembly mates would
 * become invalid. Lets the user decide before a destructive action.
 *
 * Wires together three existing data sources:
 *   - features (history.nodes)         : sequential pipeline order
 *   - paramExpressions (sceneStore)    : formula references via
 *                                        ExpressionEngine.findDependentExpressions
 *   - assemblyMates                    : face-index references on each part
 *
 * Annotation impact (GDT, dimension annotations attached to specific faces)
 * is deferred — it requires face-provenance tracking which is a separate
 * roadmap item (B1).
 */

import { findDependentExpressions } from '../ExpressionEngine';
import type { FeatureInstance } from '../features/types';

export interface ChangeImpactInput {
  /** Feature being modified or deleted. */
  targetFeatureId: string;
  /** Full ordered feature list (history.nodes). */
  features: FeatureInstance[];
  /** Map of param key → expression string (sceneStore.paramExpressions). */
  paramExpressions: Record<string, string>;
  /** Optional: assembly mate references — face indices per part. */
  assemblyMates?: Array<{ id: string; faceA?: number; faceB?: number; partA?: string; partB?: string }>;
}

export interface ChangeImpactResult {
  /** Param expressions that would break if `targetFeatureId` is deleted. */
  brokenExpressions: Array<{ key: string; expression: string; references: string[] }>;
  /** Features whose `apply()` runs AFTER the target — their geometry is downstream. */
  downstreamFeatures: FeatureInstance[];
  /** Mate IDs that reference faces from the target feature's part (best-effort heuristic). */
  affectedMates: string[];
  /** Severity classification — guides the modal message tone. */
  severity: 'safe' | 'minor' | 'major';
  /** Human-readable summary; localised externally via lt. */
  summary: {
    /** "X expressions, Y downstream features, Z mates" — counts */
    expressionCount: number;
    downstreamCount: number;
    mateCount: number;
  };
}

/**
 * Compute the impact of removing/suppressing `targetFeatureId`. Pure function
 * — no side effects, easy to unit test. The UI dialog uses the result to
 * render bullet lists per category.
 */
export function analyzeChangeImpact(input: ChangeImpactInput): ChangeImpactResult {
  const { targetFeatureId, features, paramExpressions, assemblyMates = [] } = input;

  const target = features.find(f => f.id === targetFeatureId);
  if (!target) {
    return {
      brokenExpressions: [],
      downstreamFeatures: [],
      affectedMates: [],
      severity: 'safe',
      summary: { expressionCount: 0, downstreamCount: 0, mateCount: 0 },
    };
  }

  // 1) Param-expression cascade — anything referencing the target's param
  //    names becomes broken when the target is removed.
  const targetParamNames = Object.keys(target.params);
  const brokenExpressions = findDependentExpressions(
    paramExpressions,
    targetParamNames,
  );

  // 2) Sequential downstream features — anything appearing AFTER the target
  //    in the feature list takes its geometry as input.
  const targetIdx = features.findIndex(f => f.id === targetFeatureId);
  const downstreamFeatures = targetIdx >= 0 ? features.slice(targetIdx + 1) : [];

  // 3) Assembly mate impact — face index heuristic. We can't tell with
  //    certainty which mates reference faces produced by the target without
  //    face provenance (B1), but we can surface ALL mates as "potentially
  //    affected" if the target is a topology-altering feature (boolean,
  //    fillet, chamfer, hole, shell, draft). This is intentionally
  //    conservative — false positives are better than missed breakages.
  const TOPOLOGY_ALTERING = new Set([
    'boolean', 'fillet', 'chamfer', 'hole', 'shell', 'draft',
    'splitBody', 'mirror', 'revolve', 'sweep', 'loft',
  ]);
  const isTopologyAltering = TOPOLOGY_ALTERING.has(target.type);
  const affectedMates = isTopologyAltering
    ? assemblyMates.map(m => m.id)
    : [];

  // 4) Severity classification.
  let severity: ChangeImpactResult['severity'] = 'safe';
  const totalImpact =
    brokenExpressions.length + downstreamFeatures.length + affectedMates.length;
  if (totalImpact === 0) severity = 'safe';
  else if (downstreamFeatures.length >= 3 || brokenExpressions.length >= 2 || affectedMates.length >= 1) {
    severity = 'major';
  } else {
    severity = 'minor';
  }

  return {
    brokenExpressions,
    downstreamFeatures,
    affectedMates,
    severity,
    summary: {
      expressionCount: brokenExpressions.length,
      downstreamCount: downstreamFeatures.length,
      mateCount: affectedMates.length,
    },
  };
}
