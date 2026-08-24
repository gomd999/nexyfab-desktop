import 'server-only';

import {
  validateAiDesignCandidateArtifact,
  type AiDesignCandidateArtifactV1,
} from './aiDesignCandidateArtifact';
import type { AiDesignChangeImpactPlanV1 } from './aiDesignChangeImpact';
import type { AiDesignCrossDomainConstraintGraphV1 } from './aiDesignCrossDomainConstraintGraph';
import type { AiDesignIntentResolutionArtifactV1 } from './aiDesignIntentResolution';
import {
  evaluateAiDesignCandidateWithCritics,
  type AiDesignMultiCriticBundleV1,
  type AiDesignMultiCriticOptions,
} from './aiDesignMultiCriticEvaluation';
import type { ProductStructureGraphV1 } from './aiDesignProductStructureGraph';
import { serverEvidenceSha256 } from './serverEvidence';

export interface AiDesignComplexEvaluationCandidateV1 {
  artifact: AiDesignCandidateArtifactV1;
  title: string;
  summary: string;
}

export interface AiDesignComplexEvaluationInputV1 {
  projectId: string;
  sessionId: string;
  runId: string;
  checkpointDigest: string;
  candidates: readonly AiDesignComplexEvaluationCandidateV1[];
  productStructure: ProductStructureGraphV1 | null;
  crossDomainGraph: AiDesignCrossDomainConstraintGraphV1 | null;
  resolutions?: readonly AiDesignIntentResolutionArtifactV1[];
  changeImpact?: AiDesignChangeImpactPlanV1 | null;
}

export interface AiDesignMultiCriticBundleSink {
  putCriticBundleImmutable(bundle: AiDesignMultiCriticBundleV1): Promise<void>;
}

export interface AiDesignComplexEvaluationDependencies extends Omit<AiDesignMultiCriticOptions, 'critics'> {
  sink: AiDesignMultiCriticBundleSink;
  critics?: AiDesignMultiCriticOptions['critics'];
}

/** Evaluates and stores every published concept; exact CAD/manufacturing remain outside this service. */
export async function evaluateAiDesignComplexCandidateSet(
  input: AiDesignComplexEvaluationInputV1,
  dependencies: AiDesignComplexEvaluationDependencies,
): Promise<readonly AiDesignMultiCriticBundleV1[]> {
  if (input.candidates.length < 2 || input.candidates.length > 3) throw new Error('AI_DESIGN_COMPLEX_EVALUATION_CANDIDATE_COUNT_INVALID');
  if (input.productStructure && (input.productStructure.projectId !== input.projectId || input.productStructure.sessionId !== input.sessionId)) throw new Error('AI_DESIGN_COMPLEX_EVALUATION_STRUCTURE_SCOPE_MISMATCH');
  if (input.crossDomainGraph && (input.crossDomainGraph.projectId !== input.projectId || input.crossDomainGraph.sessionId !== input.sessionId)) throw new Error('AI_DESIGN_COMPLEX_EVALUATION_CONSTRAINT_SCOPE_MISMATCH');
  const resolved = new Set((input.resolutions ?? []).filter(item => item.projectId === input.projectId && item.sessionId === input.sessionId).map(item => item.targetNodeId));
  const activeConflicts = (input.crossDomainGraph?.nodes ?? []).filter(item => item.kind === 'conflict' && item.status === 'active' && !resolved.has(item.id));
  const candidateSet = input.candidates.map(item => ({
    id: item.artifact.candidateId,
    title: item.title,
    summary: item.summary,
    parameterKeys: item.artifact.dependencies.parameterIds,
    featureKeys: item.artifact.dependencies.featureIds,
  }));
  const bundles: AiDesignMultiCriticBundleV1[] = [];
  for (const candidate of input.candidates) {
    const issues = validateAiDesignCandidateArtifact(candidate.artifact);
    if (issues.length) throw new Error(`AI_DESIGN_COMPLEX_EVALUATION_ARTIFACT_INVALID:${issues.join(',')}`);
    if (candidate.artifact.projectId !== input.projectId || candidate.artifact.sessionId !== input.sessionId || candidate.artifact.server.generationRunId !== input.runId) throw new Error('AI_DESIGN_COMPLEX_EVALUATION_ARTIFACT_SCOPE_MISMATCH');
    const structure = input.productStructure ? {
      digest: input.productStructure.graphDigest,
      productRootCount: input.productStructure.nodes.filter(item => item.parentId === null && item.kind === 'assembly').length,
      componentCount: input.productStructure.nodes.filter(item => item.kind === 'component' || item.kind === 'subassembly').length,
      interfaceCount: input.productStructure.interfaces.length,
      orphanCount: input.productStructure.nodes.filter(item => item.parentId !== null && !input.productStructure!.nodes.some(parent => parent.nodeId === item.parentId)).length,
      cycleCount: 0,
      unresolvedInterfaceCount: 0,
    } : null;
    const crossDomain = input.crossDomainGraph ? {
      digest: input.crossDomainGraph.contentHash,
      domainCount: new Set(input.crossDomainGraph.nodes.map(item => item.domain)).size,
      constraintCount: input.crossDomainGraph.nodes.filter(item => item.kind === 'constraint').length,
      conflictCount: activeConflicts.length,
      unresolvedCount: activeConflicts.length,
    } : null;
    const changeImpact = input.changeImpact ? {
      digest: serverEvidenceSha256(input.changeImpact),
      affectedArtifactCount: input.changeImpact.affectedArtifactIds.length,
      requiredReverificationCount: input.changeImpact.reverificationPlan.length,
      unsafePassCount: input.changeImpact.reverificationPlan.filter(item => item.status !== 'not_run').length,
    } : null;
    const bundle = await evaluateAiDesignCandidateWithCritics({
      projectId: input.projectId, sessionId: input.sessionId, runId: input.runId,
      candidateId: candidate.artifact.candidateId, candidateManifestDigest: candidate.artifact.manifestDigest,
      checkpointDigest: input.checkpointDigest,
      intentNodeIds: candidate.artifact.dependencies.intentNodeIds,
      parameterIds: candidate.artifact.dependencies.parameterIds,
      featureIds: candidate.artifact.dependencies.featureIds,
      candidateSet, structure, crossDomain, changeImpact,
      claimedExactVerificationStatus: 'NOT_RUN', claimedManufacturingReleaseReady: false,
    }, dependencies);
    await dependencies.sink.putCriticBundleImmutable(bundle);
    bundles.push(bundle);
  }
  return bundles;
}
