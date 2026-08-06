import {
  validateComplexProductArchitecture,
  type ComplexProductArchitecture,
} from "./complexProductArchitecture";
import type {
  PartGenerationCertificate,
  PartGateStatus,
} from "./partGenerationCertificate";
import {
  verifyStepBodyMembership,
  type StepBodyMembershipEvidence,
} from "./stepBodyMembershipCertificate";

export interface OccurrenceTransformEvidence {
  occurrenceId: string;
  matrix: number[];
  source: "native_assembly" | "assembly_solver";
}

export interface JointAssemblyEvidence {
  interfaceId: string;
  occurrenceA: string;
  occurrenceB: string;
  type: ComplexProductArchitecture["interfaces"][number]["type"];
  solved: boolean;
  residual: number | null;
}

export interface ProductAssemblyEvidence {
  partCertificates: PartGenerationCertificate[];
  transforms?: OccurrenceTransformEvidence[];
  joints?: JointAssemblyEvidence[];
  topologyRebind?: {
    assemblySolveReady: boolean;
    blockingMateIds: string[];
    blockingInterfaceIds: string[];
    confirmationRequiredIds: string[];
    confirmedIds: string[];
  };
  stepBodyMembership?: StepBodyMembershipEvidence;
}

export interface ProductAssemblyGate {
  gate:
    | "architecture"
    | "part_certificates"
    | "topology_rebind"
    | "step_body_membership"
    | "transforms"
    | "joints";
  status: PartGateStatus;
  codes: string[];
}

export interface ProductAssemblyCertificate {
  schema: "nexyfab.product-assembly-certificate.v1";
  status: PartGateStatus;
  releaseReady: boolean;
  definitionCount: number;
  occurrenceCount: number;
  gates: ProductAssemblyGate[];
}

const gate = (
  name: ProductAssemblyGate["gate"],
  status: PartGateStatus,
  codes: string[] = [],
): ProductAssemblyGate => ({ gate: name, status, codes });
const finiteMatrix = (matrix: number[]) =>
  matrix.length === 16 && matrix.every(Number.isFinite);

function topologyRebindGate(
  evidence: ProductAssemblyEvidence["topologyRebind"],
): ProductAssemblyGate {
  if (!evidence) return gate("topology_rebind", "pass");
  const codes: string[] = [];
  if (
    !evidence.assemblySolveReady ||
    evidence.blockingMateIds.length ||
    evidence.blockingInterfaceIds.length
  ) {
    codes.push(
      ...evidence.blockingMateIds.map(
        (id) => `ASSEMBLY_TOPOLOGY_MATE_BLOCKED:${id}`,
      ),
    );
    codes.push(
      ...evidence.blockingInterfaceIds.map(
        (id) => `ASSEMBLY_TOPOLOGY_INTERFACE_BLOCKED:${id}`,
      ),
    );
    if (!codes.length) codes.push("ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED");
  }
  const confirmed = new Set(evidence.confirmedIds);
  for (const id of evidence.confirmationRequiredIds)
    if (!confirmed.has(id))
      codes.push(`ASSEMBLY_DERIVED_TOPOLOGY_UNCONFIRMED:${id}`);
  return gate("topology_rebind", codes.length ? "fail" : "pass", codes);
}

function partCertificateGate(
  architecture: ComplexProductArchitecture,
  certificates: PartGenerationCertificate[],
): ProductAssemblyGate {
  const parts = new Set(
    architecture.definitions
      .filter((item) => item.kind === "part")
      .map((item) => item.id),
  );
  const byPart = new Map<string, PartGenerationCertificate>();
  const codes: string[] = [];
  for (const certificate of certificates) {
    if (byPart.has(certificate.partId))
      codes.push(`ASSEMBLY_DUPLICATE_PART_CERTIFICATE:${certificate.partId}`);
    byPart.set(certificate.partId, certificate);
  }
  let missing = false;
  for (const partId of parts) {
    const certificate = byPart.get(partId);
    if (!certificate) {
      missing = true;
      codes.push(`ASSEMBLY_PART_CERTIFICATE_MISSING:${partId}`);
      continue;
    }
    if (certificate.status === "fail")
      codes.push(`ASSEMBLY_PART_NOT_RELEASE_READY:${partId}`);
    else if (certificate.status === "not_run" || !certificate.releaseReady) {
      missing = true;
      codes.push(`ASSEMBLY_PART_NOT_VERIFIED:${partId}`);
    }
  }
  const hardFailure = codes.some(
    (code) =>
      code.startsWith("ASSEMBLY_DUPLICATE") ||
      code.startsWith("ASSEMBLY_PART_NOT_RELEASE_READY"),
  );
  return gate(
    "part_certificates",
    hardFailure ? "fail" : missing ? "not_run" : "pass",
    codes,
  );
}

function stepBodyMembershipGate(
  architecture: ComplexProductArchitecture,
  evidence: StepBodyMembershipEvidence | undefined,
): ProductAssemblyGate {
  const report = verifyStepBodyMembership(architecture, evidence);
  return gate("step_body_membership", report.status, report.codes);
}

function transformGate(
  architecture: ComplexProductArchitecture,
  evidence?: OccurrenceTransformEvidence[],
): ProductAssemblyGate {
  if (!evidence)
    return gate("transforms", "not_run", [
      "ASSEMBLY_TRANSFORM_EVIDENCE_MISSING",
    ]);
  const observed = new Map<string, OccurrenceTransformEvidence>();
  const codes: string[] = [];
  for (const item of evidence) {
    if (observed.has(item.occurrenceId))
      codes.push(`ASSEMBLY_DUPLICATE_TRANSFORM:${item.occurrenceId}`);
    observed.set(item.occurrenceId, item);
    if (!finiteMatrix(item.matrix))
      codes.push(`ASSEMBLY_TRANSFORM_INVALID:${item.occurrenceId}`);
  }
  let missing = false;
  for (const occurrence of architecture.occurrences)
    if (!observed.has(occurrence.id)) {
      missing = true;
      codes.push(`ASSEMBLY_TRANSFORM_NOT_INSPECTED:${occurrence.id}`);
    }
  const invalid = codes.some(
    (code) =>
      code.startsWith("ASSEMBLY_DUPLICATE") ||
      code.startsWith("ASSEMBLY_TRANSFORM_INVALID"),
  );
  return gate(
    "transforms",
    invalid ? "fail" : missing ? "not_run" : "pass",
    codes,
  );
}

function jointGate(
  architecture: ComplexProductArchitecture,
  evidence?: JointAssemblyEvidence[],
): ProductAssemblyGate {
  const physicalOccurrences = architecture.occurrences.filter(
    (occurrence) =>
      architecture.definitions.find(
        (definition) => definition.id === occurrence.definitionId,
      )?.kind !== "product",
  );
  if (!architecture.interfaces.length) {
    if (physicalOccurrences.length <= 1) return gate("joints", "pass");
    if (architecture.interfaceExpectation === "none")
      return gate("joints", "pass");
    return gate("joints", "not_run", [
      architecture.interfaceExpectation
        ? `ASSEMBLY_EXPECTED_INTERFACES_MISSING:${architecture.interfaceExpectation}`
        : "ASSEMBLY_INTERFACE_EXPECTATION_MISSING",
    ]);
  }
  if (architecture.interfaceExpectation === "none")
    return gate("joints", "fail", ["ASSEMBLY_UNEXPECTED_INTERFACES_PRESENT"]);
  if (architecture.interfaceExpectation === "unknown")
    return gate("joints", "not_run", [
      "ASSEMBLY_INTERFACE_EXPECTATION_UNRESOLVED",
    ]);
  if (!evidence)
    return gate("joints", "not_run", ["ASSEMBLY_JOINT_EVIDENCE_MISSING"]);
  const observed = new Map(evidence.map((item) => [item.interfaceId, item]));
  const codes: string[] = [];
  let missing = false;
  for (const expected of architecture.interfaces) {
    const item = observed.get(expected.id);
    if (!item) {
      missing = true;
      codes.push(`ASSEMBLY_JOINT_NOT_INSPECTED:${expected.id}`);
      continue;
    }
    if (
      item.occurrenceA !== expected.occurrenceA ||
      item.occurrenceB !== expected.occurrenceB ||
      item.type !== expected.type
    )
      codes.push(`ASSEMBLY_JOINT_IDENTITY_MISMATCH:${expected.id}`);
    if (!item.solved) codes.push(`ASSEMBLY_JOINT_UNSOLVED:${expected.id}`);
    if (item.residual === null) {
      missing = true;
      codes.push(`ASSEMBLY_JOINT_RESIDUAL_NOT_MEASURED:${expected.id}`);
    } else if (!Number.isFinite(item.residual) || item.residual < 0)
      codes.push(`ASSEMBLY_JOINT_RESIDUAL_INVALID:${expected.id}`);
  }
  const invalid = codes.some(
    (code) =>
      code.includes("MISMATCH") ||
      code.includes("UNSOLVED") ||
      code.includes("INVALID"),
  );
  return gate("joints", invalid ? "fail" : missing ? "not_run" : "pass", codes);
}

export function buildProductAssemblyCertificate(
  architecture: ComplexProductArchitecture,
  evidence: ProductAssemblyEvidence,
): ProductAssemblyCertificate {
  const validation = validateComplexProductArchitecture(architecture);
  const architectureGate = gate("architecture", validation.status, [
    ...validation.errors,
    ...validation.unresolved,
  ]);
  const gates = [
    architectureGate,
    partCertificateGate(architecture, evidence.partCertificates),
    topologyRebindGate(evidence.topologyRebind),
    stepBodyMembershipGate(architecture, evidence.stepBodyMembership),
    transformGate(architecture, evidence.transforms),
    jointGate(architecture, evidence.joints),
  ];
  const status: PartGateStatus = gates.some((item) => item.status === "fail")
    ? "fail"
    : gates.some((item) => item.status === "not_run")
      ? "not_run"
      : "pass";
  return {
    schema: "nexyfab.product-assembly-certificate.v1",
    status,
    releaseReady: status === "pass",
    definitionCount: architecture.definitions.length,
    occurrenceCount: architecture.occurrences.length,
    gates,
  };
}
