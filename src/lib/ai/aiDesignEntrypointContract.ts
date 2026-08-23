/**
 * Machine-readable map of the user-visible AI design entrypoints that can
 * mutate or hand a candidate to the CAD workspace. It describes deployed
 * source topology and trust boundaries; it is not a marketing capability
 * list and cannot grant manufacturing release.
 */

export const AI_DESIGN_ENTRYPOINT_CONTRACT_SCHEMA = 'nexyfab.ai-design-entrypoint-contract.v1' as const;

export type AiDesignEntrypointAuth =
  | 'public_bounded_request'
  | 'guest_or_account_quota'
  | 'authenticated_account'
  | 'authenticated_project_editor_origin';

export type AiDesignPersistence =
  | 'browser_local_candidate'
  | 'chat_thread_and_candidate'
  | 'browser_atomic_revision'
  | 'browser_carried_signed_session'
  | 'approved_project_concept_revision';

export type AiDesignCadArtifactDurability =
  | 'browser_local'
  | 'request_or_process_local'
  | 'server_project_revision';

export type AiDesignFidelity =
  | 'concept_preview'
  | 'editable_candidate_reverify'
  | 'analytic_brep_per_artifact_evidence'
  | 'agent_tool_result_reverify';

export interface AiDesignEntrypointContract {
  id: string;
  label: string;
  availability: 'available' | 'beta';
  pageRoute: string;
  pageSource: string;
  promptSource: string;
  transportSource: string;
  apiEndpoint: string;
  apiRouteSource: string;
  auth: AiDesignEntrypointAuth;
  intentSources: readonly string[];
  orchestratorSources: readonly string[];
  cadHandoffSources: readonly string[];
  persistence: AiDesignPersistence;
  cadArtifactDurability: AiDesignCadArtifactDurability;
  fidelity: AiDesignFidelity;
  perArtifactEvidenceRequired: true;
  inheritedVerificationAllowed: false;
  manufacturingReleaseReady: false;
  holdReasons: readonly string[];
}

export const AI_DESIGN_ENTRYPOINTS = [
  {
    id: 'nexyfab-ai-chat',
    label: 'NexyFab AI design chat',
    availability: 'available',
    pageRoute: '/[lang]/nexyfab/ai',
    pageSource: 'src/app/[lang]/nexyfab/ai/page.tsx',
    promptSource: 'src/app/[lang]/ChatHero.tsx',
    transportSource: 'src/app/[lang]/ChatHero.tsx',
    apiEndpoint: '/api/eng-chat/',
    apiRouteSource: 'src/app/api/eng-chat/route.ts',
    auth: 'guest_or_account_quota',
    intentSources: [
      'src/lib/ai/domainPromptClassifier.ts',
      'src/app/api/eng-chat/action/route.ts',
    ],
    orchestratorSources: [
      'src/app/[lang]/ChatHero.tsx',
      'src/app/api/nexyfab/drawing/compose/route.ts',
      'src/app/api/nexyfab/drawing/assemble/route.ts',
    ],
    cadHandoffSources: [
      'src/app/api/nexyfab/drawing/export-step/route.ts',
      'src/components/nexyfab/DesignResultTrustPanel.tsx',
    ],
    persistence: 'chat_thread_and_candidate',
    cadArtifactDurability: 'browser_local',
    fidelity: 'concept_preview',
    perArtifactEvidenceRequired: true,
    inheritedVerificationAllowed: false,
    manufacturingReleaseReady: false,
    holdReasons: [
      'engineering_chat_response_is_advisory',
      'compose_and_assembly_results_are_review_candidates',
      'step_and_release_require_separate_artifact_gates',
    ],
  },
  {
    id: 'studio-precise-mechanical',
    label: 'Studio AI precise mechanical part',
    availability: 'available',
    pageRoute: '/[lang]/studio',
    pageSource: 'src/app/[lang]/studio/page.tsx',
    promptSource: 'src/app/[lang]/studio/StudioInner.tsx',
    transportSource: 'src/app/[lang]/studio/StudioInner.tsx',
    apiEndpoint: '/api/nexyfab/cad-feature-program',
    apiRouteSource: 'src/app/api/nexyfab/cad-feature-program/route.ts',
    auth: 'guest_or_account_quota',
    intentSources: [
      'src/lib/ai/cadFeatureProgram.ts',
      'src/lib/ai/manufacturingContext.ts',
    ],
    orchestratorSources: [
      'src/app/api/nexyfab/cad-feature-program/route.ts',
      'src/lib/ai/index.ts',
    ],
    cadHandoffSources: [
      'src/app/[lang]/studio/emitScadFromProgram.ts',
      'src/app/api/nexyfab/openscad-render/route.ts',
      'src/app/api/nexyfab/cad-feature-step/route.ts',
      'src/lib/ai/precisionCadHandoff.ts',
      'src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx',
    ],
    persistence: 'browser_local_candidate',
    cadArtifactDurability: 'browser_local',
    fidelity: 'analytic_brep_per_artifact_evidence',
    perArtifactEvidenceRequired: true,
    inheritedVerificationAllowed: false,
    manufacturingReleaseReady: false,
    holdReasons: [
      'studio_preview_is_openscad_tessellation',
      'step_export_requires_route_gate_receipt',
      'manufacturing_release_authorization_not_performed',
    ],
  },
  {
    id: 'expert-design-brief',
    label: 'Expert modeler AI design brief',
    availability: 'beta',
    pageRoute: '/[lang]/shape-generator',
    pageSource: 'src/app/[lang]/shape-generator/page.tsx',
    promptSource: 'src/app/[lang]/shape-generator/design-brief/DesignBriefPanel.tsx',
    transportSource: 'src/app/[lang]/shape-generator/design-brief/DesignBriefPanel.tsx',
    apiEndpoint: '/api/nexyfab/design-brief',
    apiRouteSource: 'src/app/api/nexyfab/design-brief/route.ts',
    auth: 'authenticated_account',
    intentSources: [
      'src/lib/ai/design-driver/llmPlanner.ts',
      'src/lib/ai/design-driver/fixturePlanner.ts',
    ],
    orchestratorSources: [
      'src/app/api/nexyfab/design-brief/runner.ts',
      'src/lib/ai/design-driver/designDriver.ts',
      'src/lib/ai/design-driver/workspaceCandidate.ts',
    ],
    cadHandoffSources: [
      'src/app/[lang]/shape-generator/design-brief/workspaceCandidateToModeler.ts',
      'src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx',
    ],
    persistence: 'browser_atomic_revision',
    cadArtifactDurability: 'browser_local',
    fidelity: 'editable_candidate_reverify',
    perArtifactEvidenceRequired: true,
    inheritedVerificationAllowed: false,
    manufacturingReleaseReady: false,
    holdReasons: [
      'free_text_generation_is_closed_beta',
      'workspace_apply_resets_verification',
      'exact_kernel_and_human_release_review_required',
    ],
  },
  {
    id: 'expert-in-context-feature-edit',
    label: 'Expert viewport AI feature edit',
    availability: 'available',
    pageRoute: '/[lang]/shape-generator',
    pageSource: 'src/app/[lang]/shape-generator/page.tsx',
    promptSource: 'src/app/[lang]/shape-generator/ai/FloatingAiPrompt.tsx',
    transportSource: 'src/app/[lang]/shape-generator/ai/featureEditFromPrompt.ts',
    apiEndpoint: '/api/featureTree-intent',
    apiRouteSource: 'src/app/api/featureTree-intent/route.ts',
    auth: 'public_bounded_request',
    intentSources: [
      'src/app/[lang]/shape-generator/ai/nlFeatureEditParser.ts',
      'src/app/api/featureTree-intent/handler.ts',
      'src/app/[lang]/shape-generator/ai/planIntentToFeatureEdit.ts',
    ],
    orchestratorSources: [
      'src/app/[lang]/shape-generator/ai/featureEditFromPrompt.ts',
      'src/lib/ai/featureTreePlanner.ts',
    ],
    cadHandoffSources: [
      'src/app/[lang]/shape-generator/ai/featureEditDispatcher.ts',
      'src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx',
    ],
    persistence: 'browser_atomic_revision',
    cadArtifactDurability: 'browser_local',
    fidelity: 'editable_candidate_reverify',
    perArtifactEvidenceRequired: true,
    inheritedVerificationAllowed: false,
    manufacturingReleaseReady: false,
    holdReasons: [
      'intent_parse_is_not_geometry_verification',
      'intent_endpoint_has_no_account_or_project_authority',
      'atomic_edit_still_requires_kernel_rebuild',
      'manufacturing_release_not_performed',
    ],
  },
  {
    id: 'expert-cad-agent',
    label: 'Expert AI design and precision CAD agent',
    availability: 'beta',
    pageRoute: '/[lang]/shape-generator',
    pageSource: 'src/app/[lang]/shape-generator/page.tsx',
    promptSource: 'src/app/[lang]/shape-generator/_shell/sidebars/AiChatPanel.tsx',
    transportSource: 'src/app/[lang]/shape-generator/_shell/sidebars/aiChatTransport.ts',
    apiEndpoint: '/api/nexyfab/scad-agent/',
    apiRouteSource: 'src/app/api/nexyfab/scad-agent/route.ts',
    auth: 'authenticated_account',
    intentSources: [
      'src/lib/ai/scad-agent/intentSchema.ts',
      'src/lib/ai/scad-agent/parseToolCalls.ts',
    ],
    orchestratorSources: [
      'src/lib/ai/scad-agent/runScadAgent.ts',
      'src/lib/ai/scad-agent/repairLoop.ts',
      'src/lib/ai/cadToolAuthorization.ts',
    ],
    cadHandoffSources: [
      'src/lib/ai/scad-agent/tools.ts',
      'src/lib/ai/scad-agent/sessionIntegrity.ts',
      'src/app/api/nexyfab/scad-agent/brep-mesh/route.ts',
      'src/app/api/nexyfab/scad-agent/brep-step/route.ts',
      'src/app/[lang]/shape-generator/features/agentBrepAdoption.ts',
      'src/app/[lang]/shape-generator/_shell/sidebars/aiChatTransport.ts',
    ],
    persistence: 'browser_carried_signed_session',
    cadArtifactDurability: 'request_or_process_local',
    fidelity: 'agent_tool_result_reverify',
    perArtifactEvidenceRequired: true,
    inheritedVerificationAllowed: false,
    manufacturingReleaseReady: false,
    holdReasons: [
      'agent_done_event_is_not_release_evidence',
      'session_is_browser_carried_hmac_not_a_durable_server_run',
      'ordinary_brep_download_handles_are_process_local_and_cross_replica_hold',
      'precision_mutation_requires_signed_ownership_scope',
      'artifact_specific_verification_and_approval_required',
    ],
  },
  {
    id: 'architecture-interior-concept-ai',
    label: 'Architecture and interior AI concept design',
    availability: 'beta',
    pageRoute: '/[lang]/shape-generator',
    pageSource: 'src/app/[lang]/shape-generator/page.tsx',
    promptSource: 'src/app/[lang]/shape-generator/_shell/spatial/ArchitectureInteriorAiDesignPanel.tsx',
    transportSource: 'src/app/[lang]/shape-generator/_shell/spatial/ArchitectureInteriorAiDesignPanel.tsx',
    apiEndpoint: '/api/nexyfab/projects/[id]/architecture-interior-ai-design',
    apiRouteSource: 'src/app/api/nexyfab/projects/[id]/architecture-interior-ai-design/route.ts',
    auth: 'authenticated_project_editor_origin',
    intentSources: [
      'src/lib/ai/architectureInteriorAiDesignProposal.ts',
      'src/lib/ai/architectureInteriorAiDesignRuntime.ts',
    ],
    orchestratorSources: [
      'src/app/api/nexyfab/projects/[id]/architecture-interior-ai-design/route.ts',
      'src/lib/ai/architectureInteriorAiCandidateWorkspace.ts',
    ],
    cadHandoffSources: [
      'src/app/api/nexyfab/projects/[id]/architecture-interior-ai-design/commit/route.ts',
      'src/lib/ai/architectureInteriorWorkspaceStore.ts',
      'src/app/[lang]/shape-generator/_shell/spatial/ArchitectureInteriorPrecisionWorkflowPanel.tsx',
    ],
    persistence: 'approved_project_concept_revision',
    cadArtifactDurability: 'server_project_revision',
    fidelity: 'concept_preview',
    perArtifactEvidenceRequired: true,
    inheritedVerificationAllowed: false,
    manufacturingReleaseReady: false,
    holdReasons: [
      'candidate_is_non_persisted_until_explicit_approval',
      'committed_workspace_is_concept_only',
      'exact_compliance_and_release_are_not_run',
    ],
  },
] as const satisfies readonly AiDesignEntrypointContract[];

export function aiDesignEntrypointSourcePaths(
  entries: readonly AiDesignEntrypointContract[] = AI_DESIGN_ENTRYPOINTS,
): string[] {
  return [...new Set(entries.flatMap(entry => [
    entry.promptSource,
    entry.pageSource,
    entry.transportSource,
    entry.apiRouteSource,
    ...entry.intentSources,
    ...entry.orchestratorSources,
    ...entry.cadHandoffSources,
  ]))].sort();
}

/** Semantic validation used by CI and any readiness builder consuming this map. */
export function validateAiDesignEntrypointContract(
  entries: readonly AiDesignEntrypointContract[] = AI_DESIGN_ENTRYPOINTS,
): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) issues.push(`duplicate_or_empty_id:${entry.id}`);
    ids.add(entry.id);
    if (!entry.pageRoute.startsWith('/')) issues.push(`invalid_page_route:${entry.id}`);
    if (!entry.apiEndpoint.startsWith('/api/')) issues.push(`invalid_api_endpoint:${entry.id}`);
    if (!entry.apiRouteSource.endsWith('/route.ts')) issues.push(`invalid_api_route_source:${entry.id}`);
    if (entry.manufacturingReleaseReady !== false) issues.push(`false_release_claim:${entry.id}`);
    if (entry.inheritedVerificationAllowed !== false) issues.push(`inherited_verification_claim:${entry.id}`);
    if (entry.perArtifactEvidenceRequired !== true) issues.push(`artifact_evidence_not_required:${entry.id}`);
    if (entry.holdReasons.length === 0) issues.push(`missing_hold_reason:${entry.id}`);
    if (entry.intentSources.length === 0 || entry.orchestratorSources.length === 0 || entry.cadHandoffSources.length === 0) {
      issues.push(`incomplete_dispatch_chain:${entry.id}`);
    }
    if (entry.fidelity === 'concept_preview' && entry.manufacturingReleaseReady !== false) {
      issues.push(`preview_release_claim:${entry.id}`);
    }
  }
  return issues;
}

export function getAiDesignEntrypoint(id: string): AiDesignEntrypointContract | null {
  return AI_DESIGN_ENTRYPOINTS.find(entry => entry.id === id) ?? null;
}
