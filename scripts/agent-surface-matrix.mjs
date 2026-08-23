/**
 * Machine-readable inventory for the commercial Agent surfaces.
 *
 * This is deliberately an inventory, not a second dispatcher.  A surface is
 * only advertised here when its source points at a concrete dispatcher.  A
 * web-only surface must explicitly deny MCP/CLI parity and carry a reason;
 * otherwise a new route can silently become a false product claim.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  CAD_V1_ROUTE_EXPOSURE_HOLD,
  CAD_V1_ROUTE_EXPOSURE_HOLD_REASONS,
  DOWNLOADABLE_REMOTE_MCP_TOOLS,
  INSTALLER_SIDECAR_TOOLS,
} from './drawing-to-3d/capability-surface-manifest.mjs';

export const AGENT_SURFACE_MATRIX_SCHEMA = 'nexyfab.agent-surface-matrix.v1';
export const AGENT_SURFACE_MATRIX_PATH = 'docs/evidence/local/agent-surface-matrix-current.json';

const CAD_V1_MAPPINGS = [
  ['/api/cad/v1/product-decomposition', 'product_decomposition', 'design'],
  ['/api/cad/v1/system/verify', 'verify_complex_system_graph', null],
  ['/api/cad/v1/system/gearbox/verify', 'verify_gearbox_system_contract', null],
  ['/api/cad/v1/system/machine-skid/verify', 'verify_machine_skid_system_contract', null],
  ['/api/cad/v1/system/welded-enclosure/verify', 'verify_welded_enclosure_system_contract', null],
  ['/api/cad/v1/system/change-impact/verify', 'analyze_complex_system_change_impact', null],
  ['/api/cad/v1/system/scale/verify', 'verify_complex_assembly_scale', null],
  ['/api/cad/v1/feature-program', 'cad_feature_program', 'part'],
  ['/api/cad/v1/feature-tree-mesh', 'feature_tree_mesh', 'mesh'],
  ['/api/cad/v1/part-step', 'export_part_step', 'step'],
  ['/api/cad/v1/release/decision', 'decide_cad_release', 'release decision'],
  ['/api/cad/v1/reference/analyze', 'analyze_cad_reference', 'reference analyze'],
  ['/api/cad/v1/ifc/semantic-roundtrip', 'verify_ifc_semantic_roundtrip', 'ifc semantic-roundtrip'],
  ['/api/cad/v1/ifc/domain-ir', 'build_ifc_domain_ir', 'ifc domain-ir'],
  ['/api/cad/v1/ifc/spatial-ir', 'build_ifc_spatial_ir', 'ifc spatial-ir'],
  ['/api/cad/v1/step/mechanical-relations', 'analyze_step_mechanical_relations', 'reference mechanical-relations'],
  ['/api/cad/v1/ifc/recovery-plan', 'plan_ifc_geometry_recovery', 'ifc recovery-plan'],
  ['/api/cad/v1/ifc/recover-geometry', 'recover_ifc_geometry', 'ifc recover-geometry'],
  ['/api/cad/v1/topology/reconcile', 'reconcile_topology_references', 'topology reconcile'],
  ['/api/cad/v1/assembly/verify', 'verify_cad_assembly', 'assembly verify'],
  ['/api/cad/v1/project/verify', 'verify_cad_project', 'project verify'],
  ['/api/cad/v1/interior/door-swing/verify', 'verify_door_swing_clearance', 'interior door-swing --file'],
  ['/api/cad/v1/interior/space-boundary/verify', 'verify_space_boundary_closure', 'interior space-boundary --file'],
  ['/api/cad/v1/interior/egress/verify', 'verify_egress_routes', 'interior egress --file'],
  ['/api/cad/v1/interior/mep-interference/verify', 'verify_mep_interference', 'interior mep-interference --file'],
  ['/api/cad/v1/assembly/animation/evaluate', 'evaluate_assembly_animation', 'animation evaluate'],
  ['/api/cad/v1/assembly/animation/command', 'apply_assembly_animation_command', 'animation command'],
  ['/api/cad/v1/assembly/selection-edit', 'preview_assembly_selection_edit', 'assembly edit --verify-brep'],
  ['/api/cad/v1/brep/push-pull', 'push_pull_step_face', 'brep push-pull'],
  ['/api/cad/v1/assembly/animation/verify', 'verify_assembly_animation', 'animation verify'],
  ['/api/cad/v1/generation/verify', 'verify_ai_generation', 'generation verify'],
  ['/api/cad/v1/generation/refine', 'refine_ai_generation', null],
  ['/api/cad/v1/generation/state', 'transition_ai_generation_state', 'generation state --file'],
  ['/api/cad/v1/generation/advance', 'advance_ai_generation', 'generation advance --file'],
  ['/api/cad/v1/generation/finalize', 'finalize_ai_generation', 'generation finalize --file'],
  ['/api/cad/v1/physical-network/verify', 'verify_physical_network', null],
  ['/api/cad/v1/robot/generate', 'generate_robot_6axis', 'robot generate'],
  ['/api/cad/v1/manufacturing/verify', 'verify_manufacturing_evidence', 'manufacturing verify'],
  ['/api/cad/v1/sheet-metal/verify', 'verify_sheet_metal', 'sheet-metal verify'],
  ['/api/cad/v1/weldment/verify', 'verify_weldment', 'weldment verify'],
  ['/api/cad/v1/tolerance/analyze', 'analyze_tolerance_stack', 'tolerance analyze'],
  ['/api/cad/v1/pmi/verify', 'verify_cad_pmi', 'pmi verify'],
];

const CAD_SCOPE = Object.freeze({
  product_decomposition: 'propose', verify_complex_system_graph: 'read',
  verify_gearbox_system_contract: 'read', verify_machine_skid_system_contract: 'read',
  verify_welded_enclosure_system_contract: 'read', analyze_complex_system_change_impact: 'read',
  verify_complex_assembly_scale: 'read', cad_feature_program: 'propose', feature_tree_mesh: 'apply',
  export_part_step: 'export', decide_cad_release: 'read', analyze_cad_reference: 'read',
  verify_ifc_semantic_roundtrip: 'read', build_ifc_domain_ir: 'propose', build_ifc_spatial_ir: 'propose',
  analyze_step_mechanical_relations: 'read', plan_ifc_geometry_recovery: 'propose', recover_ifc_geometry: 'apply',
  reconcile_topology_references: 'propose', verify_cad_assembly: 'read', verify_cad_project: 'read',
  verify_door_swing_clearance: 'read', verify_space_boundary_closure: 'read', verify_egress_routes: 'read',
  verify_mep_interference: 'read', evaluate_assembly_animation: 'read', apply_assembly_animation_command: 'apply',
  preview_assembly_selection_edit: 'propose', push_pull_step_face: 'apply', verify_assembly_animation: 'read',
  verify_ai_generation: 'read', refine_ai_generation: 'propose', transition_ai_generation_state: 'propose',
  advance_ai_generation: 'propose', finalize_ai_generation: 'export', verify_physical_network: 'read',
  generate_robot_6axis: 'apply', verify_manufacturing_evidence: 'read', verify_sheet_metal: 'read',
  verify_weldment: 'read', analyze_tolerance_stack: 'read', verify_cad_pmi: 'read',
});
const CAD_AUTH_SCOPE = Object.freeze({
  feature_tree_mesh: 'write:projects',
  export_part_step: 'write:projects',
  recover_ifc_geometry: 'write:projects',
  apply_assembly_animation_command: 'write:projects',
  push_pull_step_face: 'write:projects',
  transition_ai_generation_state: 'write:projects',
  refine_ai_generation: 'write:projects',
  advance_ai_generation: 'write:projects',
  finalize_ai_generation: 'write:projects',
  generate_robot_6axis: 'write:projects',
});
const CAD_COMMERCIAL_PERSISTENCE = Object.freeze({
  refine_ai_generation: 'commercial_mode_postgres_generation_state',
  transition_ai_generation_state: 'commercial_mode_postgres_generation_state',
  advance_ai_generation: 'commercial_mode_postgres_generation_state_with_advance_replay_and_topology_lineage',
  finalize_ai_generation: 'commercial_mode_postgres_generation_state_with_verified_receipt_reference',
});
const DOWNLOADABLE_LOCAL_OVERLAP = Object.freeze([
  'edit_part', 'face_drag', 'part_op', 'analyze_fea', 'reconstruct_verify', 'reconstruct_fleet',
  'code_check', 'verify_domain', 'interior_check', 'landscape_check', 'bridge_check', 'load_path',
]);
const DOWNLOADABLE_REMOTE_ONLY = Object.freeze(['design_assembly', 'compose_part', 'domain_design']);

const PRECISION_AGENT_PATH = '/api/nexyfab/projects/[id]/precision-cad-agent';
const PRECISION_AGENT_SOURCE = 'src/app/api/nexyfab/projects/[id]/precision-cad-agent';
const SCAD_AGENT_PATH = '/api/nexyfab/scad-agent';
const SCAD_AGENT_SOURCE = 'src/app/api/nexyfab/scad-agent';
const ARCHITECTURE_AGENT_PATH = '/api/nexyfab/projects/[id]/architecture-interior-agent';
const ARCHITECTURE_AGENT_SOURCE = 'src/app/api/nexyfab/projects/[id]/architecture-interior-agent/route.ts';
const PRECISION_WEB_ONLY_REASON = 'Project binding, DB-backed continuation, approval challenges, and isolated execution are not exposed through a bounded MCP or CLI adapter.';
const SCAD_WEB_ONLY_REASON = 'The browser SCAD repair loop, signed continuation, plan budget, and live B-rep capability flow have no equivalent MCP or CLI contract.';
const DOMAIN_WEB_ONLY_REASON = 'The project-bound architecture/interior workspace, CAS mutation, approval, and history transaction have no MCP or CLI adapter.';
const RELEASE_NONCLAIM_REASON = 'This HTTP surface is inventory evidence only; it does not authorize a commercial release claim.';
const CAD_NONCLAIM_REASON = 'CAD v1 operation inventory is not a commercial release authorization; persistence is described per operation.';
const CAD_HTTP_APPROVAL_BOUNDARY = 'cad_http_boundary_only';
const RAW_MCP_APPROVAL_STATUS = 'HOLD_raw_mcp_entrypoint';

function routeFile(pathname) {
  const suffix = pathname.replace('/api/cad/v1/', '');
  return `src/app/api/cad/v1/${suffix}/route.ts`;
}

function surfaceDispatch(source, entrypoint, authType, scope, requiredAuthScope, { commercialPersistence = 'none' } = {}) {
  return {
    availability: 'dispatcher', source, entrypoint,
    authType, requiredAuthScope, mutationScope: scope,
    approvalRequirement: 'none_at_cad_http_boundary',
    approvalBoundary: CAD_HTTP_APPROVAL_BOUNDARY,
    commercialPersistence,
    releaseClaimAllowed: false,
    releaseClaimReason: CAD_NONCLAIM_REASON,
  };
}

function webOnlyAgentRoute({
  id, agentKind, method, pathName, source, authBoundary, requiredAuthScope,
  apiKeyScopeEnforcement, originRequirement, mutationScope,
  approvalRequirement, commercialPersistence, durability,
  processLocalState, crossReplica, holdReason, evidenceTokens,
  identitySemantics = 'authenticated_account_identity',
}) {
  return {
    id,
    agentKind,
    method,
    path: pathName,
    authType: ['cookie', 'bearer_api_key'],
    authBoundary,
    identitySemantics,
    requiredAuthScope,
    apiKeyScopeEnforcement,
    originRequirement,
    mutationScope,
    approvalRequirement,
    commercialPersistence,
    durability,
    runtimeBoundary: { processLocalState, crossReplica },
    releaseClaimAllowed: false,
    releaseClaimReason: RELEASE_NONCLAIM_REASON,
    exposure: 'web-only',
    mcp: { availability: 'HOLD', reason: holdReason },
    cli: { availability: 'HOLD', reason: holdReason },
    dispatcher: { source, entrypoint: method, evidenceTokens },
  };
}

export const WEB_AGENT_ROUTES = Object.freeze([
  webOnlyAgentRoute({
    id: 'scad-ai-design-agent', agentKind: 'ai_design_agent', method: 'POST',
    pathName: SCAD_AGENT_PATH, source: `${SCAD_AGENT_SOURCE}/route.ts`,
    authBoundary: 'plan_guard_free_or_higher; bearer API keys additionally require write:projects', requiredAuthScope: 'write:projects',
    apiKeyScopeEnforcement: 'explicit', originRequirement: 'same_origin_required',
    mutationScope: 'read|propose|apply|export', approvalRequirement: 'tool_authorizer_in_explicit_design_modes',
    commercialPersistence: 'signed_client_carried_session_plus_best_effort_telemetry_and_audit',
    durability: 'continuation_is_client_carried; generated_live_brep_handles_are_not_durable',
    processLocalState: 'live B-rep registry and request-local hydrated handles',
    crossReplica: 'signed continuation can travel; live handles cannot; canonical bootstrap refs are rehydrated per request',
    holdReason: SCAD_WEB_ONLY_REASON,
    evidenceTokens: ['checkOrigin(req)', "checkPlan(req, 'free')", "scopes.includes('write:projects')", 'verifyAgentSession', 'signAgentSession', 'runRepairLoop'],
  }),
  webOnlyAgentRoute({
    id: 'scad-ai-design-brep-mesh', agentKind: 'ai_design_agent', method: 'GET',
    pathName: `${SCAD_AGENT_PATH}/brep-mesh`, source: `${SCAD_AGENT_SOURCE}/brep-mesh/route.ts`,
    authBoundary: 'authenticated_user_plus_short_lived_handle_capability', requiredAuthScope: null,
    apiKeyScopeEnforcement: 'not_enforced_at_route', originRequirement: 'not_required_for_safe_method',
    mutationScope: 'read', approvalRequirement: 'short_lived_handle_capability',
    commercialPersistence: 'none', durability: 'reads a live process-local B-rep handle only',
    processLocalState: 'module-scoped B-rep registry', crossReplica: 'unsupported_for_raw_handle_lookup',
    holdReason: SCAD_WEB_ONLY_REASON,
    evidenceTokens: ['getAuthUser', 'verifyBrepHandleAccessToken', 'getShape(handle)'],
  }),
  webOnlyAgentRoute({
    id: 'scad-ai-design-brep-step', agentKind: 'ai_design_agent', method: 'GET',
    pathName: `${SCAD_AGENT_PATH}/brep-step`, source: `${SCAD_AGENT_SOURCE}/brep-step/route.ts`,
    authBoundary: 'authenticated_user_plus_short_lived_handle_capability', requiredAuthScope: null,
    apiKeyScopeEnforcement: 'not_enforced_at_route', originRequirement: 'not_required_for_safe_method',
    mutationScope: 'export', approvalRequirement: 'short_lived_handle_capability',
    commercialPersistence: 'none', durability: 'exports from a live process-local B-rep handle without storing the STEP result',
    processLocalState: 'module-scoped B-rep registry', crossReplica: 'unsupported_for_raw_handle_lookup',
    holdReason: SCAD_WEB_ONLY_REASON,
    evidenceTokens: ['getAuthUser', 'verifyBrepHandleAccessToken', 'exportOcctStep(handle)'],
  }),
  webOnlyAgentRoute({
    id: 'scad-ai-design-presence-read', agentKind: 'ai_design_agent', method: 'GET',
    pathName: `${SCAD_AGENT_PATH}/presence`, source: `${SCAD_AGENT_SOURCE}/presence/route.ts`,
    authBoundary: 'plan_guard_free_or_higher', requiredAuthScope: null,
    apiKeyScopeEnforcement: 'not_enforced_at_route', originRequirement: 'not_required_for_safe_method',
    mutationScope: 'read', approvalRequirement: 'none', commercialPersistence: 'none',
    durability: '60-second in-memory presence only', processLocalState: 'module-scoped presence rooms',
    crossReplica: 'unsupported; each replica has an independent room map', holdReason: SCAD_WEB_ONLY_REASON,
    identitySemantics: 'sessionId selects an ephemeral room and is not an authorization, audit, or ownership identity',
    evidenceTokens: ["checkPlan(req, 'free')", 'SAFE_SESSION_ID.test(sessionId)', 'gcRoom(sessionId)'],
  }),
  webOnlyAgentRoute({
    id: 'scad-ai-design-presence-heartbeat', agentKind: 'ai_design_agent', method: 'POST',
    pathName: `${SCAD_AGENT_PATH}/presence`, source: `${SCAD_AGENT_SOURCE}/presence/route.ts`,
    authBoundary: 'authenticated admission only; the bounded caller-supplied participant id is untrusted display data', requiredAuthScope: null,
    apiKeyScopeEnforcement: 'not_enforced_at_route', originRequirement: 'same_origin_required',
    mutationScope: 'presence_heartbeat', approvalRequirement: 'none', commercialPersistence: 'none',
    durability: '60-second in-memory presence only', processLocalState: 'module-scoped presence rooms and collaboration adapter',
    crossReplica: 'unsupported; each replica has an independent room map', holdReason: SCAD_WEB_ONLY_REASON,
    identitySemantics: 'tab-scoped pseudonym; never account identity, authorization, audit attribution, persistence ownership, or CAD ownership',
    evidenceTokens: ['checkOrigin(req)', "checkPlan(req, 'free')", 'SAFE_PARTICIPANT_ID.test(userId)', 'setSessionParticipants', 'const userId = requestedUserId'],
  }),
  webOnlyAgentRoute({
    id: 'architecture-interior-domain-agent-read', agentKind: 'domain_agent', method: 'GET',
    pathName: ARCHITECTURE_AGENT_PATH, source: ARCHITECTURE_AGENT_SOURCE,
    authBoundary: 'authenticated_project_member', requiredAuthScope: null,
    apiKeyScopeEnforcement: 'not_enforced_at_route', originRequirement: 'not_required_for_safe_method',
    mutationScope: 'read', approvalRequirement: 'none',
    commercialPersistence: 'reads_database_workspace_without_mutation', durability: 'shared database workspace and revision history',
    processLocalState: 'none_authoritative', crossReplica: 'supported_when_replicas_share_the_database',
    holdReason: DOMAIN_WEB_ONLY_REASON,
    evidenceTokens: ['getAuthUser', 'resolveProjectAccess', 'readArchitectureInteriorWorkspace'],
  }),
  webOnlyAgentRoute({
    id: 'architecture-interior-domain-agent-call', agentKind: 'domain_agent', method: 'POST',
    pathName: ARCHITECTURE_AGENT_PATH, source: ARCHITECTURE_AGENT_SOURCE,
    authBoundary: 'authenticated_project_member_with_editor_gate_for_mutation', requiredAuthScope: null,
    apiKeyScopeEnforcement: 'not_enforced_at_route', originRequirement: 'same_origin_required',
    mutationScope: 'read|apply', approvalRequirement: 'required_for_apply',
    commercialPersistence: 'workspace_and_history_committed_in_one_database_transaction',
    durability: 'CAS-bound database workspace revision plus append-only history event',
    processLocalState: 'none_authoritative', crossReplica: 'supported_when_replicas_share_the_database',
    holdReason: DOMAIN_WEB_ONLY_REASON,
    evidenceTokens: ['checkOrigin(req)', 'persistArchitectureInteriorWorkspace', 'appendArchitectureInteriorHistoryEventInTransaction'],
  }),
  webOnlyAgentRoute({
    id: 'precision-cad-remote-installer-catalog', agentKind: 'remote_installer_agent', method: 'GET',
    pathName: `${PRECISION_AGENT_PATH}/catalog`, source: `${PRECISION_AGENT_SOURCE}/catalog/route.ts`,
    authBoundary: 'authenticated_project_member', requiredAuthScope: 'read:projects',
    apiKeyScopeEnforcement: 'explicit', originRequirement: 'not_required_for_safe_method',
    mutationScope: 'read', approvalRequirement: 'none', commercialPersistence: 'none',
    durability: 'catalog is reloadable; project revision binding is read from the database',
    processLocalState: 'reloadable module catalog cache', crossReplica: 'safe_when_replicas_share_project_revision_data',
    holdReason: PRECISION_WEB_ONLY_REASON,
    evidenceTokens: ['hasPrecisionCadProjectScope', "'read:projects'", 'assertRemoteProjectRevision'],
  }),
  webOnlyAgentRoute({
    id: 'precision-cad-remote-installer-bootstrap', agentKind: 'remote_installer_agent', method: 'POST',
    pathName: `${PRECISION_AGENT_PATH}/bootstrap`, source: `${PRECISION_AGENT_SOURCE}/bootstrap/route.ts`,
    authBoundary: 'authenticated_project_editor', requiredAuthScope: 'write:projects',
    apiKeyScopeEnforcement: 'explicit', originRequirement: 'same_origin_required',
    mutationScope: 'session_bootstrap', approvalRequirement: 'none',
    commercialPersistence: 'signed_client_carried_session_bound_to_server_canonical_mapping',
    durability: 'canonical mapping is database-backed; runtime B-rep is rehydrated per worker',
    processLocalState: 'rehydrated worker-local B-rep handles only', crossReplica: 'no raw handle authority crosses replicas; canonical refs must rehydrate',
    holdReason: PRECISION_WEB_ONLY_REASON,
    evidenceTokens: ['checkOrigin(req)', 'hasPrecisionCadProjectScope', "'write:projects'", 'bootstrapPrecisionCadSession'],
  }),
  webOnlyAgentRoute({
    id: 'precision-cad-remote-installer-turn', agentKind: 'remote_installer_agent', method: 'POST',
    pathName: `${PRECISION_AGENT_PATH}/turn`, source: `${PRECISION_AGENT_SOURCE}/turn/route.ts`,
    authBoundary: 'authenticated_project_member', requiredAuthScope: 'write:projects',
    apiKeyScopeEnforcement: 'explicit', originRequirement: 'same_origin_required',
    mutationScope: 'provider_turn', approvalRequirement: 'delegated_to_call',
    commercialPersistence: 'database_backed_provider_continuation_with_30_minute_ttl',
    durability: 'provider messages and pending calls are stored in the shared database until expiry',
    processLocalState: 'reloadable module catalog cache only', crossReplica: 'supported_when_replicas_share_the_database',
    holdReason: PRECISION_WEB_ONLY_REASON,
    evidenceTokens: ['checkOrigin(req)', 'hasPrecisionCadProjectScope', "'write:projects'", 'runRemoteAgentTurn'],
  }),
  webOnlyAgentRoute({
    id: 'precision-cad-remote-installer-call', agentKind: 'remote_installer_agent', method: 'POST',
    pathName: `${PRECISION_AGENT_PATH}/call`, source: `${PRECISION_AGENT_SOURCE}/call/route.ts`,
    authBoundary: 'authenticated_project_member_with_editor_gate_for_apply_or_export', requiredAuthScope: 'write:projects',
    apiKeyScopeEnforcement: 'explicit', originRequirement: 'same_origin_required',
    mutationScope: 'read|propose|apply|export', approvalRequirement: 'database_challenge_required_for_apply_or_export',
    commercialPersistence: 'editor_outputs_to_immutable_artifacts; commercial_mode_queues_transactional_outbox',
    durability: 'commercial mode uses a DB outbox; default isolated child queue reports durableQueue=false',
    processLocalState: 'default isolated-worker queue and child execution are process-local',
    crossReplica: 'mixed: commercial DB outbox is durable; default in-process queue is not cross-replica durable',
    holdReason: PRECISION_WEB_ONLY_REASON,
    evidenceTokens: ['checkOrigin(req)', 'hasPrecisionCadProjectScope', "'write:projects'", 'enqueueCommercialExecutionTransaction', 'durableQueue: false'],
  }),
]);

function cadOperation([pathName, mcp, cli]) {
  const scope = CAD_SCOPE[mcp];
  const requiredAuthScope = CAD_AUTH_SCOPE[mcp] ?? 'read:projects';
  const commercialPersistence = CAD_COMMERCIAL_PERSISTENCE[mcp] ?? 'none';
  const dispatchOptions = { commercialPersistence };
  const cliValue = cli ?? { availability: 'HOLD', reason: 'No bounded CLI argument adapter is advertised for this operation.' };
  return {
    id: mcp,
    path: pathName,
    mcp: {
      name: mcp,
      ...surfaceDispatch('scripts/drawing-to-3d/mcp-server.mjs', 'callTool', ['bearer_api_key'], scope, requiredAuthScope, dispatchOptions),
      approvalStatus: RAW_MCP_APPROVAL_STATUS,
    },
    cli: cli ? { name: cli, ...surfaceDispatch('scripts/cli/nexyfab.mjs', 'main', ['bearer_api_key'], scope, requiredAuthScope, dispatchOptions) } : cliValue,
    web: surfaceDispatch(routeFile(pathName), 'POST', ['cookie', 'bearer_api_key'], scope, requiredAuthScope, dispatchOptions),
  };
}

export const CAD_V1_OPERATIONS = Object.freeze(CAD_V1_MAPPINGS.map(cadOperation));

export const AGENT_SURFACE_MATRIX = Object.freeze({
  schema: AGENT_SURFACE_MATRIX_SCHEMA,
  version: 1,
  claimPolicy: {
    unknownSurface: 'HOLD', missingDispatcher: 'HOLD', missingReason: 'HOLD',
    commercialPersistenceRequires: 'web_project_call_editor_boundary',
    releaseClaimDefault: false,
  },
  webAgent: { routes: WEB_AGENT_ROUTES },
  cadV1: {
    advertisedOperations: CAD_V1_OPERATIONS,
    heldRoutes: CAD_V1_ROUTE_EXPOSURE_HOLD.map(pathName => ({
      path: pathName,
      exposure: 'HOLD',
      reason: CAD_V1_ROUTE_EXPOSURE_HOLD_REASONS[pathName]
        ?? 'HOLD: Route exists, but bounded Agent/MCP/CLI adapter and commercial parity are not implemented.',
    })),
  },
  localMcp: {
    source: 'scripts/drawing-to-3d/mcp-server.mjs', expectedToolCount: 90,
    includesCadV1ByName: CAD_V1_MAPPINGS.map(([, name]) => name),
    writeApprovalFlag: 'confirmWrite',
    relationship: 'repository-local dispatcher; API-backed tools retain API-key/open-world boundary; no commercial release claim',
    releaseClaimAllowed: false, releaseClaimReason: RELEASE_NONCLAIM_REASON,
  },
  downloadableRemoteMcp: {
    source: 'public/downloads/nexyfab-mcp.mjs', expectedToolCount: 15,
    names: [...DOWNLOADABLE_REMOTE_MCP_TOOLS], authType: ['none', 'bearer_api_key'],
    writeApprovalFlag: 'confirmCall',
    relationship: 'standalone remote MCP product surface; distinct from local MCP and not a CAD v1 parity claim',
    localOverlapByName: [...DOWNLOADABLE_LOCAL_OVERLAP], remoteOnlyByName: [...DOWNLOADABLE_REMOTE_ONLY],
    releaseClaimAllowed: false, releaseClaimReason: RELEASE_NONCLAIM_REASON,
  },
  installerSidecar: {
    source: 'scripts/drawing-to-3d/installer-core-agent-server.mjs', expectedToolCount: 8,
    names: [...INSTALLER_SIDECAR_TOOLS], authType: ['none'], writeApprovalFlag: 'confirmWrite',
    relationship: 'local/downloadable Agent catalog used by the web project Agent; not a CAD v1 or CLI parity claim',
    agentKind: 'remote_installer_agent',
    releaseClaimAllowed: false, releaseClaimReason: RELEASE_NONCLAIM_REASON,
  },
});

const SCOPES = new Set(['read', 'propose', 'apply', 'export']);
const AUTH_TYPES = new Set(['cookie', 'bearer_api_key', 'none']);
const AGENT_KINDS = new Set(['ai_design_agent', 'domain_agent', 'remote_installer_agent']);
const ORIGIN_REQUIREMENTS = new Set(['same_origin_required', 'not_required_for_safe_method', 'not_enforced_at_route']);

function isRecord(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function hasText(value) { return typeof value === 'string' && value.trim().length > 0; }
function push(errors, condition, message) { if (!condition) errors.push(message); }
function stable(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function exportedHttpMethods(source) {
  const methods = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)) methods.add(match[1]);
  for (const match of source.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)) methods.add(match[1]);
  return [...methods];
}

/** Discover the user-facing Next route files independently of the matrix. */
export function discoverUserFacingAgentHttpRoutes(root = process.cwd()) {
  const apiRoot = path.resolve(root, 'src/app/api/nexyfab');
  const found = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(candidate);
        continue;
      }
      if (!entry.isFile() || entry.name !== 'route.ts') continue;
      const relativeDirectory = path.relative(apiRoot, path.dirname(candidate));
      const segments = relativeDirectory.split(path.sep);
      if (!segments.some(segment => segment.toLowerCase().endsWith('-agent'))) continue;
      const pathname = `/api/nexyfab/${segments.join('/')}`;
      const source = fs.readFileSync(candidate, 'utf8');
      for (const method of exportedHttpMethods(source)) {
        found.push({ method, path: pathname, source: path.relative(root, candidate).split(path.sep).join('/') });
      }
    }
  };
  visit(apiRoot);
  return found.sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
}

function validateDispatch(entry, label, { allowHold = false } = {}) {
  const errors = [];
  if (allowHold && entry?.availability === 'HOLD') {
    push(errors, hasText(entry.reason), `${label}:hold_reason_missing`);
    return errors;
  }
  push(errors, entry?.availability === 'dispatcher', `${label}:dispatcher_missing`);
  push(errors, hasText(entry?.source), `${label}:source_missing`);
  push(errors, hasText(entry?.entrypoint), `${label}:entrypoint_missing`);
  push(errors, Array.isArray(entry?.authType) && entry.authType.length > 0 && entry.authType.every(value => AUTH_TYPES.has(value)), `${label}:auth_type_invalid`);
  push(errors, entry?.requiredAuthScope === 'read:projects' || entry?.requiredAuthScope === 'write:projects', `${label}:required_auth_scope_missing`);
  push(errors, SCOPES.has(entry?.mutationScope) || entry?.mutationScope === 'none' || entry?.mutationScope === 'session_bootstrap' || entry?.mutationScope === 'read|propose|apply|export', `${label}:mutation_scope_invalid`);
  push(errors, hasText(entry?.approvalRequirement), `${label}:approval_requirement_missing`);
  push(errors, entry?.approvalBoundary === CAD_HTTP_APPROVAL_BOUNDARY, `${label}:approval_boundary_invalid`);
  push(errors, hasText(entry?.commercialPersistence), `${label}:commercial_persistence_missing`);
  push(errors, entry?.releaseClaimAllowed === false && hasText(entry?.releaseClaimReason), `${label}:release_claim_boundary_missing`);
  return errors;
}

function validateWebDispatcher(entry, label) {
  const errors = [];
  push(errors, isRecord(entry) && hasText(entry.source), `${label}:dispatcher_source_missing`);
  push(errors, isRecord(entry) && hasText(entry.entrypoint), `${label}:dispatcher_entrypoint_missing`);
  return errors;
}

/**
 * Validate both the inventory itself and optional runtime inventories.
 * Runtime lists are injected by tests/builds so this module never performs a
 * network call or silently treats an unavailable source as an empty list.
 */
export function validateAgentSurfaceMatrix(matrix = AGENT_SURFACE_MATRIX, { root = process.cwd(), actual } = {}) {
  const errors = [];
  push(errors, matrix?.schema === AGENT_SURFACE_MATRIX_SCHEMA, 'schema_invalid');
  push(errors, matrix?.version === 1, 'version_invalid');
  push(errors, Array.isArray(matrix?.webAgent?.routes) && matrix.webAgent.routes.length === 11, 'web_agent_route_count_invalid');
  const webIds = new Set();
  const webEntrypoints = new Set();
  const observedAgentKinds = new Set();
  for (const route of matrix?.webAgent?.routes ?? []) {
    const label = `web:${route?.id ?? 'unknown'}`;
    push(errors, hasText(route?.id) && !webIds.has(route.id), `${label}:id_missing_or_duplicate`);
    webIds.add(route?.id);
    const entrypoint = `${route?.method ?? ''} ${route?.path ?? ''}`;
    push(errors, hasText(route?.path) && hasText(route?.method) && !webEntrypoints.has(entrypoint), `${label}:entrypoint_missing_or_duplicate`);
    webEntrypoints.add(entrypoint);
    push(errors, AGENT_KINDS.has(route?.agentKind), `${label}:agent_kind_invalid`);
    observedAgentKinds.add(route?.agentKind);
    push(errors, route?.exposure === 'web-only', `${label}:must_be_web_only`);
    push(errors, Array.isArray(route?.authType) && route.authType.length === 2 && route.authType.includes('cookie') && route.authType.includes('bearer_api_key'), `${label}:auth_type_invalid`);
    push(errors, hasText(route?.authBoundary), `${label}:auth_boundary_missing`);
    push(errors, hasText(route?.identitySemantics), `${label}:identity_semantics_missing`);
    push(errors, route?.apiKeyScopeEnforcement === 'explicit' || route?.apiKeyScopeEnforcement === 'not_enforced_at_route', `${label}:api_key_scope_enforcement_invalid`);
    if (route?.apiKeyScopeEnforcement === 'explicit') {
      push(errors, route?.requiredAuthScope === 'read:projects' || route?.requiredAuthScope === 'write:projects', `${label}:required_auth_scope_missing`);
    } else {
      push(errors, route?.requiredAuthScope === null, `${label}:unscoped_route_must_not_invent_scope`);
    }
    push(errors, ORIGIN_REQUIREMENTS.has(route?.originRequirement), `${label}:origin_requirement_invalid`);
    push(errors, hasText(route?.mutationScope), `${label}:mutation_scope_missing`);
    push(errors, hasText(route?.approvalRequirement), `${label}:approval_requirement_missing`);
    push(errors, hasText(route?.commercialPersistence), `${label}:commercial_persistence_missing`);
    push(errors, hasText(route?.durability), `${label}:durability_missing`);
    push(errors, isRecord(route?.runtimeBoundary) && hasText(route.runtimeBoundary.processLocalState) && hasText(route.runtimeBoundary.crossReplica), `${label}:runtime_boundary_missing`);
    push(errors, route?.releaseClaimAllowed === false && hasText(route?.releaseClaimReason), `${label}:release_claim_boundary_missing`);
    push(errors, route?.mcp?.availability === 'HOLD' && hasText(route?.mcp?.reason), `${label}:mcp_claim_not_closed`);
    push(errors, route?.cli?.availability === 'HOLD' && hasText(route?.cli?.reason), `${label}:cli_claim_not_closed`);
    errors.push(...validateWebDispatcher(route?.dispatcher, label));
    try {
      const file = path.resolve(root, route.dispatcher.source);
      push(errors, fs.statSync(file).isFile(), `${label}:dispatcher_source_missing`);
      const source = fs.readFileSync(file, 'utf8');
      push(errors, exportedHttpMethods(source).includes(route.method), `${label}:dispatcher_method_missing`);
      push(errors, Array.isArray(route.dispatcher.evidenceTokens) && route.dispatcher.evidenceTokens.length > 0
        && route.dispatcher.evidenceTokens.every(token => hasText(token) && source.includes(token)), `${label}:dispatcher_evidence_mismatch`);
    } catch { errors.push(`${label}:dispatcher_source_missing`); }
  }
  push(errors, [...AGENT_KINDS].every(kind => observedAgentKinds.has(kind)), 'web_agent_kind_coverage_invalid');
  try {
    const discovered = discoverUserFacingAgentHttpRoutes(root).map(item => ({ method: item.method, path: item.path, source: item.source }));
    const inventoried = (matrix?.webAgent?.routes ?? []).map(item => ({ method: item.method, path: item.path, source: item.dispatcher.source }));
    push(errors, stable(discovered) === stable([...inventoried].sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`))), 'discovered_web_agent_routes_mismatch');
  } catch {
    errors.push('web_agent_route_discovery_failed');
  }

  const operations = matrix?.cadV1?.advertisedOperations;
  push(errors, Array.isArray(operations) && operations.length === 42, 'cad_v1_operation_count_invalid');
  const paths = new Set();
  const names = new Set();
  const cliNames = [];
  for (const operation of operations ?? []) {
    const label = `cad:${operation?.id ?? 'unknown'}`;
    push(errors, hasText(operation?.path) && !paths.has(operation.path), `${label}:path_missing_or_duplicate`); paths.add(operation?.path);
    push(errors, hasText(operation?.mcp?.name) && !names.has(operation.mcp.name), `${label}:mcp_name_missing_or_duplicate`); names.add(operation?.mcp?.name);
    errors.push(...validateDispatch(operation?.web, `${label}:web`));
    errors.push(...validateDispatch(operation?.mcp, `${label}:mcp`));
    push(errors, operation?.mcp?.approvalStatus === RAW_MCP_APPROVAL_STATUS, `${label}:mcp_approval_hold_missing`);
    try {
      push(errors, fs.statSync(path.resolve(root, operation.web.source)).isFile(), `${label}:web_dispatcher_source_missing`);
    } catch { errors.push(`${label}:web_dispatcher_source_missing`); }
    if (operation?.cli?.availability === 'HOLD') push(errors, hasText(operation.cli.reason), `${label}:cli_hold_reason_missing`);
    else { errors.push(...validateDispatch(operation?.cli, `${label}:cli`)); cliNames.push(operation?.cli?.name); }
  }
  push(errors, cliNames.length === 34 && new Set(cliNames).size === 34, 'cad_v1_cli_count_invalid');
  for (const held of matrix?.cadV1?.heldRoutes ?? []) push(errors, hasText(held?.path) && held?.exposure === 'HOLD' && hasText(held?.reason), 'held_route_missing_reason');
  push(errors, JSON.stringify((matrix?.cadV1?.heldRoutes ?? []).map(item => item.path)) === JSON.stringify([...CAD_V1_ROUTE_EXPOSURE_HOLD]), 'held_route_inventory_mismatch');
  push(errors, Array.isArray(matrix?.localMcp?.includesCadV1ByName) && JSON.stringify(matrix.localMcp.includesCadV1ByName) === JSON.stringify(CAD_V1_MAPPINGS.map(([, name]) => name)), 'local_cad_relationship_invalid');
  push(errors, matrix?.localMcp?.expectedToolCount === 90, 'local_mcp_count_invalid');
  push(errors, matrix?.localMcp?.writeApprovalFlag === 'confirmWrite', 'local_mcp_write_approval_contract_invalid');
  push(errors, matrix?.downloadableRemoteMcp?.expectedToolCount === 15 && JSON.stringify(matrix.downloadableRemoteMcp.names) === JSON.stringify([...DOWNLOADABLE_REMOTE_MCP_TOOLS]), 'downloadable_mcp_count_invalid');
  push(errors, JSON.stringify(matrix?.downloadableRemoteMcp?.authType) === JSON.stringify(['none', 'bearer_api_key']) && matrix?.downloadableRemoteMcp?.writeApprovalFlag === 'confirmCall', 'downloadable_mcp_permission_contract_invalid');
  push(errors, JSON.stringify(matrix?.downloadableRemoteMcp?.localOverlapByName) === JSON.stringify([...DOWNLOADABLE_LOCAL_OVERLAP]), 'downloadable_local_overlap_invalid');
  push(errors, JSON.stringify(matrix?.downloadableRemoteMcp?.remoteOnlyByName) === JSON.stringify([...DOWNLOADABLE_REMOTE_ONLY]), 'downloadable_remote_only_invalid');
  push(errors, matrix?.installerSidecar?.expectedToolCount === 8 && JSON.stringify(matrix.installerSidecar.names) === JSON.stringify([...INSTALLER_SIDECAR_TOOLS]), 'installer_sidecar_count_invalid');
  push(errors, matrix?.installerSidecar?.writeApprovalFlag === 'confirmWrite', 'installer_sidecar_write_approval_contract_invalid');
  for (const [label, surface] of [
    ['local_mcp', matrix?.localMcp],
    ['downloadable_remote_mcp', matrix?.downloadableRemoteMcp],
    ['installer_sidecar', matrix?.installerSidecar],
  ]) {
    push(errors, surface?.releaseClaimAllowed === false && hasText(surface?.releaseClaimReason), `${label}:release_claim_boundary_missing`);
  }

  if (actual) {
    const same = (a, b) => stable(a) === stable(b);
    if (actual.webRoutes) {
      const expected = (matrix.webAgent.routes ?? []).map(item => `${item.method} ${item.path}`).sort();
      push(errors, same([...actual.webRoutes].sort(), expected), 'runtime_web_routes_mismatch');
    }
    if (actual.cadV1Operations) {
      const expected = (operations ?? []).map(item => ({ path: item.path, mcp: item.mcp.name, cli: item.cli?.name ?? null }));
      push(errors, same(actual.cadV1Operations, expected), 'runtime_cad_v1_operations_mismatch');
    }
    if (actual.cadV1RoutePaths) {
      const expected = [...new Set([...(operations ?? []).map(item => item.path), ...(matrix.cadV1.heldRoutes ?? []).map(item => item.path)])].sort();
      push(errors, same([...actual.cadV1RoutePaths].sort(), expected), 'runtime_cad_v1_route_partition_mismatch');
    }
    if (actual.localMcpTools) push(errors, actual.localMcpTools.length === 90 && matrix.localMcp.includesCadV1ByName.every(name => actual.localMcpTools.includes(name)), 'runtime_local_mcp_mismatch');
    if (actual.downloadableMcpTools) push(errors, same(actual.downloadableMcpTools, matrix.downloadableRemoteMcp.names), 'runtime_downloadable_mcp_mismatch');
    if (actual.installerSidecarTools) push(errors, same(actual.installerSidecarTools, matrix.installerSidecar.names), 'runtime_installer_sidecar_mismatch');
    if (actual.cliCommands) push(errors, same(actual.cliCommands, cliNames), 'runtime_cli_mismatch');
  }
  return { ok: errors.length === 0, errors };
}

function bindSource(root, relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const bytes = fs.readFileSync(path.resolve(root, normalized));
  return {
    path: normalized,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Build deterministic, source-bound local evidence without implying release approval. */
export function buildAgentSurfaceMatrixEvidence(root = process.cwd()) {
  const validation = validateAgentSurfaceMatrix(AGENT_SURFACE_MATRIX, { root });
  const sourcePaths = new Set([
    'scripts/agent-surface-matrix.mjs',
    'scripts/drawing-to-3d/capability-surface-manifest.mjs',
    AGENT_SURFACE_MATRIX.localMcp.source,
    AGENT_SURFACE_MATRIX.downloadableRemoteMcp.source,
    AGENT_SURFACE_MATRIX.installerSidecar.source,
    'scripts/cli/nexyfab.mjs',
    ...AGENT_SURFACE_MATRIX.webAgent.routes.map(route => route.dispatcher.source),
    ...AGENT_SURFACE_MATRIX.cadV1.advertisedOperations.map(operation => operation.web.source),
  ]);
  return {
    ...AGENT_SURFACE_MATRIX,
    evidence: {
      status: validation.ok ? 'PASS_LOCAL' : 'HOLD',
      localReady: validation.ok,
      commercialReleaseEligible: false,
      validationErrors: validation.errors,
      sourceBindings: [...sourcePaths].sort().map(relativePath => bindSource(root, relativePath)),
    },
  };
}

export function writeAgentSurfaceMatrixEvidence(root = process.cwd(), outputPath = AGENT_SURFACE_MATRIX_PATH) {
  const evidence = buildAgentSurfaceMatrixEvidence(root);
  const destination = path.resolve(root, outputPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(JSON.parse(stable(evidence)), null, 2)}\n`, 'utf8');
  return { destination, evidence };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = validateAgentSurfaceMatrix();
  const write = process.argv.includes('--write');
  const written = write && result.ok ? writeAgentSurfaceMatrixEvidence() : null;
  process.stdout.write(`${JSON.stringify({ schema: AGENT_SURFACE_MATRIX_SCHEMA, ...result, written: written?.destination ?? null })}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
