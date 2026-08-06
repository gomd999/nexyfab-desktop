import type { AiAssemblyProgram } from "./aiAssemblyProgram";
import { validateAiAssemblyProgram } from "./aiAssemblyProgram";
import {
  recordGenerationStage,
  type GenerationRunState,
  type StageCompletion,
} from "./generationRunState";
import { collisionGeometryFromFeatureTree } from "@/lib/assembly/featureTreePreciseInterference";

export type AssemblyVerificationResult = {
  ok?: boolean;
  releaseReady?: boolean;
  assemblyCertificate?: unknown;
  preciseInterference?: unknown;
  flaggedInterferences?: unknown[];
  verificationUnavailable?: string[];
  code?: string;
  message?: string;
};

export type GenerationAdvanceResult = {
  state: GenerationRunState;
  stoppedAt: "kernel" | "topology" | "assembly_solve" | "motion";
  assemblyVerification?: AssemblyVerificationResult;
};

export type AssemblyVerifier = (input: {
  state: AiAssemblyProgram["assembly"];
  featureTrees: Record<
    string,
    AiAssemblyProgram["parts"][number]["featureTree"]
  >;
  localBoxes: Record<
    string,
    {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    }
  >;
  allowedDoF: number;
  preciseInterference: true;
}) => Promise<AssemblyVerificationResult>;

export type GenerationTopologyRebindGate = {
  assemblySolveReady: boolean;
  blockingMateIds: string[];
  blockingInterfaceIds: string[];
  confirmationRequiredIds: string[];
  confirmedIds?: string[];
};

/**
 * Advances an AI generation run using real tessellated/OCCT part evidence.
 * Optional downstream gates are intentionally not guessed: motion remains
 * pending until the design supplies a governed motion study.
 */
export async function advanceGenerationRun(
  initial: GenerationRunState,
  program: AiAssemblyProgram,
  verifyAssembly: AssemblyVerifier,
  allowedDoF = 0,
  topologyRebind?: GenerationTopologyRebindGate,
): Promise<GenerationAdvanceResult> {
  if (initial.stages.part_programs.status !== "passed") {
    throw new Error("part_programs must pass before geometry advancement.");
  }
  const issues = validateAiAssemblyProgram(program);
  if (issues.length) {
    const completion: StageCompletion = {
      stage: "kernel",
      input: program.parts.map((part) => part.featureTree),
      status: "failed",
      errorCodes: ["INVALID_AI_ASSEMBLY_PROGRAM"],
      unresolved: issues.map((issue) => `${issue.path}: ${issue.message}`),
      affectedPartIds: program.parts.map((part) => part.instanceId),
    };
    return {
      state: recordGenerationStage(initial, completion),
      stoppedAt: "kernel",
    };
  }

  const built = await Promise.all(
    program.parts.map(async (part) => ({
      part,
      collision: await collisionGeometryFromFeatureTree(
        part.instanceId,
        part.featureTree,
      ),
    })),
  );
  const unavailable = built.filter((item) => !item.collision.available);
  const kernelOutput = built.map(({ part, collision }) => ({
    partId: part.instanceId,
    available: collision.available,
    reason: collision.reason,
    bodies: collision.geometry.bodies.map((body) => ({
      bodyId: body.bodyId,
      volumeMm3: body.volumeMm3,
    })),
    totalVolumeMm3: collision.geometry.totalVolumeMm3,
  }));
  let state = recordGenerationStage(initial, {
    stage: "kernel",
    input: program.parts.map((part) => ({
      partId: part.instanceId,
      tree: part.featureTree,
    })),
    output: kernelOutput,
    status: unavailable.length ? "failed" : "passed",
    errorCodes: unavailable.length ? ["PART_GEOMETRY_UNAVAILABLE"] : [],
    unresolved: unavailable.map(
      (item) =>
        item.collision.reason ??
        `${item.part.instanceId}: geometry unavailable`,
    ),
    affectedPartIds: unavailable.map((item) => item.part.instanceId),
    metrics: {
      parts: built.length,
      availableParts: built.length - unavailable.length,
    },
  });
  if (unavailable.length) return { state, stoppedAt: "kernel" };

  const invalidTopology = built.filter(
    ({ collision }) =>
      !collision.geometry.bbox ||
      collision.geometry.bodies.some(
        (body) =>
          !body.poly ||
          !body.watertight ||
          body.nonManifoldEdges > 0 ||
          body.poly.faces.length === 0,
      ),
  );
  const topologyOutput = built.map(({ part, collision }) => ({
    partId: part.instanceId,
    bodies: collision.geometry.bodies.map((body) => ({
      bodyId: body.bodyId,
      watertight: body.watertight,
      nonManifoldEdges: body.nonManifoldEdges,
      flippedFaces: body.flippedFaces,
      vertices: body.poly?.vertices.length ?? 0,
      faces: body.poly?.faces.length ?? 0,
    })),
  }));
  state = recordGenerationStage(state, {
    stage: "topology",
    input: kernelOutput,
    output: topologyOutput,
    status: invalidTopology.length ? "failed" : "passed",
    errorCodes: invalidTopology.length ? ["INVALID_BODY_TOPOLOGY"] : [],
    affectedPartIds: invalidTopology.map((item) => item.part.instanceId),
    metrics: {
      bodies: built.reduce(
        (sum, item) => sum + item.collision.geometry.bodies.length,
        0,
      ),
    },
  });
  if (invalidTopology.length) return { state, stoppedAt: "topology" };

  if (topologyRebind) {
    const confirmed = new Set(topologyRebind.confirmedIds ?? []);
    const unconfirmed = topologyRebind.confirmationRequiredIds.filter(
      (id) => !confirmed.has(id),
    );
    if (!topologyRebind.assemblySolveReady || unconfirmed.length) {
      const errorCodes = [
        ...(!topologyRebind.assemblySolveReady
          ? ["ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED"]
          : []),
        ...(unconfirmed.length
          ? ["ASSEMBLY_DERIVED_TOPOLOGY_UNCONFIRMED"]
          : []),
      ];
      state = recordGenerationStage(state, {
        stage: "assembly_solve",
        input: { assembly: program.assembly, allowedDoF, topologyRebind },
        output: {
          blocked: true,
          blockingMateIds: topologyRebind.blockingMateIds,
          blockingInterfaceIds: topologyRebind.blockingInterfaceIds,
          unconfirmed,
        },
        status: "failed",
        errorCodes,
        unresolved: [
          ...topologyRebind.blockingMateIds.map(
            (id) => `mate topology review required: ${id}`,
          ),
          ...topologyRebind.blockingInterfaceIds.map(
            (id) => `interface topology review required: ${id}`,
          ),
          ...unconfirmed.map(
            (id) => `derived topology confirmation required: ${id}`,
          ),
        ],
        affectedPartIds: program.parts.map((part) => part.instanceId),
        metrics: {
          blockingMates: topologyRebind.blockingMateIds.length,
          blockingInterfaces: topologyRebind.blockingInterfaceIds.length,
          unconfirmedDerived: unconfirmed.length,
        },
      });
      return { state, stoppedAt: "assembly_solve" };
    }
  }

  const featureTrees = Object.fromEntries(
    program.parts.map((part) => [part.instanceId, part.featureTree]),
  );
  const localBoxes = Object.fromEntries(
    built.map(({ part, collision }) => {
      const bbox = collision.geometry.bbox!;
      const [min, max] = [bbox.min, bbox.max];
      return [
        part.instanceId,
        {
          min: { x: min[0], y: min[1], z: min[2] },
          max: { x: max[0], y: max[1], z: max[2] },
        },
      ];
    }),
  );
  const verification = await verifyAssembly({
    state: program.assembly,
    featureTrees,
    localBoxes,
    allowedDoF,
    preciseInterference: true,
  });
  const assemblyPassed =
    verification.ok === true && verification.releaseReady === true;
  state = recordGenerationStage(state, {
    stage: "assembly_solve",
    input: { assembly: program.assembly, allowedDoF },
    output: verification,
    status: assemblyPassed ? "passed" : "failed",
    errorCodes: assemblyPassed
      ? []
      : [verification.code ?? "ASSEMBLY_NOT_RELEASE_READY"],
    unresolved: assemblyPassed
      ? []
      : [
          verification.message ??
            "Assembly certificate did not reach release-ready status.",
        ],
    affectedPartIds: assemblyPassed
      ? []
      : program.parts.map((part) => part.instanceId),
    metrics: {
      flaggedInterferences: verification.flaggedInterferences?.length ?? 0,
    },
  });
  return {
    state,
    stoppedAt: assemblyPassed ? "motion" : "assembly_solve",
    assemblyVerification: verification,
  };
}
