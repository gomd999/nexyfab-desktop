import {
  remapTopologyEntities,
  type TopologyEntitySnapshot,
  type TopologyRemapOptions,
  type TopologyRemapResult,
} from "./topologyRemap";

export type TopologySurvivalEvidence = {
  schema: "nexyfab.topology-survival-evidence.v1";
  status: "passed" | "failed" | "not_run";
  targetRate: number;
  minimumSamples: number;
  sampleCount: number;
  resolvedCount: number;
  persistentCount: number;
  derivedCount: number;
  ambiguousCount: number;
  brokenCount: number;
  survivalRate: number | null;
  persistentRate: number | null;
  results: TopologyRemapResult[];
  reasons: string[];
};

/**
 * Produces an honest, thresholded topology-regeneration certificate.
 * Derived mappings count as survived but still require user/reviewer
 * confirmation; ambiguous and broken mappings never count as survived.
 */
export function evaluateTopologySurvival(input: {
  before: readonly TopologyEntitySnapshot[];
  after: readonly TopologyEntitySnapshot[];
  criticalRefs?: readonly string[];
  targetRate?: number;
  minimumSamples?: number;
  remap?: TopologyRemapOptions;
}): TopologySurvivalEvidence {
  const targetRate = input.targetRate ?? 0.95;
  const minimumSamples = input.minimumSamples ?? 20;
  if (!(targetRate > 0 && targetRate <= 1))
    throw new Error("targetRate must be in (0, 1].");
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1)
    throw new Error("minimumSamples must be a positive integer.");
  const wanted = input.criticalRefs ? new Set(input.criticalRefs) : null;
  const before = wanted
    ? input.before.filter((item) => wanted.has(item.persistentRef))
    : [...input.before];
  const missing = wanted
    ? [...wanted]
        .filter((ref) => !before.some((item) => item.persistentRef === ref))
        .sort()
    : [];
  const results = remapTopologyEntities(before, input.after, input.remap);
  const count = (quality: TopologyRemapResult["quality"]) =>
    results.filter((item) => item.quality === quality).length;
  const persistentCount = count("persistent");
  const derivedCount = count("derived");
  const ambiguousCount = count("ambiguous");
  const brokenCount = count("broken") + missing.length;
  const sampleCount = results.length + missing.length;
  const resolvedCount = persistentCount + derivedCount;
  const survivalRate = sampleCount ? resolvedCount / sampleCount : null;
  const persistentRate = sampleCount ? persistentCount / sampleCount : null;
  const reasons: string[] = [];
  let status: TopologySurvivalEvidence["status"];
  if (sampleCount < minimumSamples) {
    status = "not_run";
    reasons.push(`insufficient samples: ${sampleCount}/${minimumSamples}`);
  } else if (survivalRate === null || survivalRate < targetRate) {
    status = "failed";
    reasons.push(
      `survival rate ${(survivalRate ?? 0).toFixed(6)} is below target ${targetRate.toFixed(6)}`,
    );
  } else {
    status = "passed";
  }
  if (missing.length)
    reasons.push(
      `critical references absent before regeneration: ${missing.join(", ")}`,
    );
  if (derivedCount)
    reasons.push(`${derivedCount} derived mapping(s) require confirmation`);
  if (ambiguousCount)
    reasons.push(`${ambiguousCount} ambiguous mapping(s) require review`);
  if (brokenCount) reasons.push(`${brokenCount} reference(s) are broken`);
  return {
    schema: "nexyfab.topology-survival-evidence.v1",
    status,
    targetRate,
    minimumSamples,
    sampleCount,
    resolvedCount,
    persistentCount,
    derivedCount,
    ambiguousCount,
    brokenCount,
    survivalRate,
    persistentRate,
    results,
    reasons,
  };
}
