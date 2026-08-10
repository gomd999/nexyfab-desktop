export type ManufacturingGateId =
  "G0" | "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8" | "G9";

export type GateStatus = "passed" | "failed" | "not_run";

export interface ManufacturingGateResult {
  id: ManufacturingGateId;
  name: string;
  status: GateStatus;
  evidence: string[];
  failures: string[];
}

export interface ManufacturingGateReport {
  version: 1;
  gates: ManufacturingGateResult[];
  passed: boolean;
  firstBlockingGate: ManufacturingGateId | null;
}

export interface ManufacturingGateInput {
  /** Definition-level body membership contract; defaults to one solid. */
  bodyIntent?: {
    policy: "single_body" | "multi_body";
    expectedBodies: number | null;
  };
  /** G0: input provenance exists and customer retention policy was respected. */
  provenance?: {
    traceable: boolean;
    privacyCompliant: boolean;
    refs: string[];
  };
  /** G1: all manufacturing decisions are confirmed and conflict-free. */
  intent?: { resolved: boolean; unresolved: string[]; conflicts: string[] };
  /** G2: deterministic feature program contract. */
  program?: { valid: boolean; errors: string[]; hash?: string };
  /** G3: real analytic kernel build, never a mesh conversion. */
  kernel?: {
    built: boolean;
    analytic: boolean;
    engine?: string;
    errors: string[];
  };
  /** G4: topology of the built result. */
  topology?: {
    closed: boolean;
    solidCount: number;
    manifold: boolean;
    errors: string[];
  };
  /** G5: measured dimensions compared with intent. */
  dimensions?: {
    checked: number;
    maxErrorMm: number;
    toleranceMm: number;
    mismatches: string[];
  };
  /** G6: every requested feature was observed in the result. */
  features?: {
    requested: number;
    verified: number;
    skipped: string[];
    mismatches: string[];
    applicable?: boolean;
  };
  /** G7: process/material DFM review. */
  dfm?: {
    process: string;
    material: string;
    passed: boolean;
    violations: string[];
  };
  /** G8: exported STEP was re-imported and compared. */
  stepRoundtrip?: {
    reimported: boolean;
    topologyMatched: boolean;
    dimensionsMatched: boolean;
    errors: string[];
  };
  /** G9: exact artifact was authorized for manufacturing/quote release. */
  release?: {
    artifactId: string;
    exactArtifactVerified: boolean;
    authorized: boolean;
    reasons: string[];
  };
}

const NAMES: Record<ManufacturingGateId, string> = {
  G0: "Input provenance and privacy",
  G1: "Resolved design intent",
  G2: "Feature program validity",
  G3: "Analytic kernel build",
  G4: "Closed solid topology",
  G5: "Dimensional fidelity",
  G6: "Feature fidelity",
  G7: "Manufacturing DFM",
  G8: "STEP roundtrip",
  G9: "Exact artifact release",
};

function result(
  id: ManufacturingGateId,
  ran: boolean,
  passed: boolean,
  evidence: string[],
  failures: string[],
): ManufacturingGateResult {
  return {
    id,
    name: NAMES[id],
    status: !ran ? "not_run" : passed ? "passed" : "failed",
    evidence,
    failures,
  };
}

/** Fail-closed, deterministic G0-G9 evaluator. Missing evidence is `not_run`, never pass. */
export function evaluateManufacturingGates(
  input: ManufacturingGateInput,
): ManufacturingGateReport {
  const p = input.provenance;
  const i = input.intent;
  const program = input.program;
  const kernel = input.kernel;
  const topology = input.topology;
  const dimensions = input.dimensions;
  const features = input.features;
  const dfm = input.dfm;
  const step = input.stepRoundtrip;
  const release = input.release;
  const bodyIntent = input.bodyIntent ?? {
    policy: "single_body" as const,
    expectedBodies: 1,
  };
  const bodyCountMatches = !topology
    ? false
    : bodyIntent.policy === "single_body"
      ? topology.solidCount === 1
      : bodyIntent.expectedBodies === null
        ? topology.solidCount >= 2
        : topology.solidCount === bodyIntent.expectedBodies;
  const expectedBodies =
    bodyIntent.policy === "single_body"
      ? "one solid"
      : bodyIntent.expectedBodies === null
        ? "at least two solids"
        : `${bodyIntent.expectedBodies} solids`;

  const gates: ManufacturingGateResult[] = [
    result(
      "G0",
      !!p,
      !!p?.traceable && !!p?.privacyCompliant && (p?.refs.length ?? 0) > 0,
      p?.refs ?? [],
      !p
        ? ["Provenance check was not run."]
        : [
            ...(!p.traceable ? ["Input is not traceable."] : []),
            ...(!p.privacyCompliant
              ? ["Input retention is not privacy compliant."]
              : []),
            ...(p.refs.length === 0 ? ["No provenance reference exists."] : []),
          ],
    ),
    result(
      "G1",
      !!i,
      !!i?.resolved && i.unresolved.length === 0 && i.conflicts.length === 0,
      i?.resolved ? ["Design intent marked resolved."] : [],
      !i
        ? ["Intent gate was not run."]
        : [
            ...i.unresolved.map((value) => `Unresolved: ${value}`),
            ...i.conflicts.map((value) => `Conflict: ${value}`),
          ],
    ),
    result(
      "G2",
      !!program,
      !!program?.valid && program.errors.length === 0,
      program?.hash ? [`program:${program.hash}`] : [],
      program ? program.errors : ["Program validation was not run."],
    ),
    result(
      "G3",
      !!kernel,
      !!kernel?.built && !!kernel?.analytic && kernel.errors.length === 0,
      kernel?.engine ? [`engine:${kernel.engine}`] : [],
      kernel
        ? [
            ...(!kernel.built ? ["Kernel build failed."] : []),
            ...(!kernel.analytic ? ["Result is not analytic B-Rep."] : []),
            ...kernel.errors,
          ]
        : ["Kernel build was not run."],
    ),
    result(
      "G4",
      !!topology,
      !!topology?.closed &&
        !!topology?.manifold &&
        bodyCountMatches &&
        topology.errors.length === 0,
      topology
        ? [
            `solidCount:${topology.solidCount}`,
            `bodyPolicy:${bodyIntent.policy}`,
          ]
        : [],
      topology
        ? [
            ...(!topology.closed ? ["Shell is not closed."] : []),
            ...(!topology.manifold ? ["Topology is non-manifold."] : []),
            ...(!bodyCountMatches
              ? [`Expected ${expectedBodies}, found ${topology.solidCount}.`]
              : []),
            ...topology.errors,
          ]
        : ["Topology check was not run."],
    ),
    result(
      "G5",
      !!dimensions,
      !!dimensions &&
        dimensions.checked > 0 &&
        dimensions.maxErrorMm <= dimensions.toleranceMm &&
        dimensions.mismatches.length === 0,
      dimensions
        ? [
            `checked:${dimensions.checked}`,
            `maxErrorMm:${dimensions.maxErrorMm}`,
            `toleranceMm:${dimensions.toleranceMm}`,
          ]
        : [],
      dimensions
        ? [
            ...(dimensions.checked === 0
              ? ["No dimensions were measured."]
              : []),
            ...dimensions.mismatches,
            ...(dimensions.maxErrorMm > dimensions.toleranceMm
              ? ["Maximum dimensional error exceeds tolerance."]
              : []),
          ]
        : ["Dimension check was not run."],
    ),
    result(
      "G6",
      !!features && (features.applicable === false || features.requested > 0),
      !!features &&
        (features.applicable === false ||
          (features.requested > 0 &&
            features.requested === features.verified &&
            features.skipped.length === 0 &&
            features.mismatches.length === 0)),
      features
        ? [
            features.applicable === false
              ? "feature-check:not-applicable"
              : `verified:${features.verified}/${features.requested}`,
          ]
        : [],
      features
        ? [
            ...(features.applicable !== false && features.requested === 0
              ? [
                  "No requested features were supplied; applicability was not explicitly false.",
                ]
              : []),
            ...features.skipped.map((value) => `Skipped: ${value}`),
            ...features.mismatches,
            ...(features.applicable !== false && features.requested !== features.verified
              ? ["Requested and verified feature counts differ."]
              : []),
          ]
        : ["Feature fidelity check was not run."],
    ),
    result(
      "G7",
      !!dfm,
      !!dfm?.passed && dfm.violations.length === 0,
      dfm ? [`process:${dfm.process}`, `material:${dfm.material}`] : [],
      dfm ? dfm.violations : ["DFM check was not run."],
    ),
    result(
      "G8",
      !!step,
      !!step?.reimported &&
        !!step?.topologyMatched &&
        !!step?.dimensionsMatched &&
        step.errors.length === 0,
      step?.reimported ? ["STEP re-import completed."] : [],
      step
        ? [
            ...(!step.reimported ? ["STEP was not re-imported."] : []),
            ...(!step.topologyMatched ? ["Roundtrip topology differs."] : []),
            ...(!step.dimensionsMatched
              ? ["Roundtrip dimensions differ."]
              : []),
            ...step.errors,
          ]
        : ["STEP roundtrip was not run."],
    ),
    result(
      "G9",
      !!release,
      !!release?.artifactId &&
        !!release?.exactArtifactVerified &&
        !!release?.authorized &&
        release.reasons.length === 0,
      release?.artifactId ? [`artifact:${release.artifactId}`] : [],
      release
        ? [
            ...(!release.exactArtifactVerified
              ? ["The exact artifact was not verified."]
              : []),
            ...(!release.authorized
              ? ["Manufacturing release is not authorized."]
              : []),
            ...release.reasons,
          ]
        : ["Release authorization was not run."],
    ),
  ];
  const firstBlocking = gates.find((gate) => gate.status !== "passed");
  return {
    version: 1,
    gates,
    passed: !firstBlocking,
    firstBlockingGate: firstBlocking?.id ?? null,
  };
}
