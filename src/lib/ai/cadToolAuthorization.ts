import {
  getCadCapability,
  listCadCapabilities,
  snapshotCadHostAdapters,
  cadSelectionOwnershipFromSession,
  checkCadSelectionOwnership,
  type CadMutationScope,
  type CadOperationMode,
  type CadSelectionContext,
  type CadSelectionOwnership,
  type CadHostAdapterName,
} from './cadCapabilityRegistry';
import type { AgentSession, ToolCall, ToolExecutorMap, ToolResult } from './scad-agent/types';
import type { ToolHostAdapters } from './scad-agent/tools';

export type CadToolCallAuthorizer = (
  call: ToolCall,
  session: AgentSession,
) => ToolResult | null | Promise<ToolResult | null>;

interface CadToolAuthorizerOptions {
  hostAdapters: Partial<ToolHostAdapters>;
  tools: ToolExecutorMap;
  mode: CadOperationMode;
  prompt?: string;
  scope?: CadMutationScope;
  mockAdapters?: readonly CadHostAdapterName[];
  /** Optional server-provided ownership index (normally read from session). */
  ownership?: CadSelectionOwnership;
}

const MANAGED_TOOLS = new Set(
  listCadCapabilities().flatMap(definition => {
    if (definition.source !== 'scad-agent' && !definition.tool) return [];
    return [definition.tool ?? definition.id];
  }),
);

const VERIFY_OR_EXPORT_TOOLS = new Set([
  'render', 'view_render', 'read_dfm', 'brep_to_mesh', 'brep_export_step',
  'brep_to_drawing', 'brep_export_drawing', 'fea_setup', 'fea_solve', 'fea_stress', 'sim_cfd', 'sim_mbd',
  'sim_cam', 'sim_mold_fill', 'sim_optics', 'sim_thermal',
]);
const MODIFY_TOOLS = new Set([
  'brep_boolean', 'brep_fillet', 'brep_chamfer', 'brep_shell', 'brep_draft',
  'sketch_add_constraint', 'sketch_solve', 'add_mate', 'solve_mates',
]);

function requestedAction(tool: string): 'create' | 'modify' | 'verify' {
  if (VERIFY_OR_EXPORT_TOOLS.has(tool)) return 'verify';
  if (MODIFY_TOOLS.has(tool)) return 'modify';
  return 'create';
}

function strings(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}

function collectByKey(value: unknown, pattern: RegExp, depth = 0): string[] {
  if (depth > 8 || !value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(item => collectByKey(item, pattern, depth + 1));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    ...(pattern.test(key) ? strings(child) : []),
    ...collectByKey(child, pattern, depth + 1),
  ]);
}

/** Derives the minimum selection evidence from a bounded model tool call. */
export function selectionFromCadToolCall(call: ToolCall): CadSelectionContext {
  const args = call.args;
  const partIds = collectByKey(args, /^part(?:Id|Ids)$/i);
  const featureIds = collectByKey(args, /^feature(?:Id|Ids)$/i);
  const edgeIds = collectByKey(args, /^(?:edge|edges|edgeId|edgeIds)$/i);
  const faceIds = collectByKey(args, /^(?:face|faces|faceId|faceIds)$/i);
  const sketchIds = collectByKey(args, /^(?:sketch|sketchName|sketchId|sketchIds|profile|profileId)$/i);
  const entityIds = collectByKey(args, /^(?:entity|entities|entityId|entityIds)$/i);
  const mateIds = collectByKey(args, /^(?:mate|mateId|mateIds)$/i);
  const bodyIds = collectByKey(args, /^(?:hostHandle|toolHandle|handle|handleA|handleB|body|bodyId|bodyIds|brepHandle|brepHandles)$/i);
  return {
    ...(partIds.length ? { partIds } : {}),
    ...(featureIds.length ? { featureIds } : {}),
    ...(edgeIds.length ? { edgeIds } : {}),
    ...(faceIds.length ? { faceIds } : {}),
    ...(sketchIds.length ? { sketchIds } : {}),
    ...(entityIds.length ? { entityIds } : {}),
    ...(mateIds.length ? { mateIds } : {}),
    ...(bodyIds.length ? { bodyIds } : {}),
  };
}

function selectionForCall(call: ToolCall, session: AgentSession): CadSelectionContext {
  const selection = selectionFromCadToolCall(call);
  // solve_mates has no args; its target is the complete signed mate set.
  if (call.name === 'solve_mates' && (session.mates?.length ?? 0) > 0) {
    return { ...selection, mateIds: session.mates.map(mate => mate.id) };
  }
  return selection;
}

/**
 * Production execution guard for capability-managed CAD tools. Utility tools
 * remain governed by their own schemas and session security checks.
 */
export function createCadToolCallAuthorizer(options: CadToolAuthorizerOptions): CadToolCallAuthorizer {
  return (call, session) => {
    if (!MANAGED_TOOLS.has(call.name)) return null;
    const selection = selectionForCall(call, session);
    const ownership = options.ownership ?? cadSelectionOwnershipFromSession(session);
    if (options.mode === 'scoped-modification' && !options.scope) {
      return {
        ok: false,
        code: 'CAD_TARGET_OWNERSHIP_REQUIRED',
        error: `CAD tool "${call.name}" requires a server-declared mutation scope in scoped-modification mode.`,
      };
    }
    if (options.mode === 'scoped-modification' && options.scope) {
      const ownershipCheck = checkCadSelectionOwnership(selection, options.scope, ownership, call.name);
      if (!['not-required', 'not-checked', 'proven'].includes(ownershipCheck.decision)) {
        const code = ownershipCheck.decision === 'out-of-scope'
          ? 'CAD_TARGET_OUT_OF_SCOPE'
          : ownershipCheck.decision === 'mixed'
            ? 'CAD_CROSS_PART_OPERATION'
            : 'CAD_TARGET_OWNERSHIP_REQUIRED';
        return {
          ok: false,
          code,
          error: `CAD tool "${call.name}" target ownership is not authorized (${ownershipCheck.reason ?? ownershipCheck.decision}).`,
        };
      }
    }
    const report = getCadCapability({
      feature: call.name,
      mode: options.mode,
      prompt: options.prompt,
      scope: options.scope,
      selection,
      environment: {
        hostAdapters: snapshotCadHostAdapters(options.hostAdapters),
        tools: options.tools,
        mockAdapters: options.mockAdapters,
        genericPlannerAvailable: true,
        ownership: ownership ?? undefined,
      },
    });
    const action = requestedAction(call.name);
    if (report.executionGate === 'open' && report.status === 'executable') {
      if (report.allowedActions.includes(action)) return null;
      return {
        ok: false,
        code: 'CAD_ACTION_NOT_ALLOWED',
        error: `CAD tool "${call.name}" requested action "${action}", which is not allowed in ${report.operationMode} mode.`,
      };
    }
    return {
      ok: false,
      code: report.status === 'mock-partial' ? 'CAD_CAPABILITY_MOCK_ONLY' : 'CAD_CAPABILITY_BLOCKED',
      error: [
        `CAD tool "${call.name}" is not authorized for this run.`,
        `Capability status: ${report.status}.`,
        `Reason: ${report.reason}.`,
        report.missingHostAdapters.length
          ? `Missing adapters: ${report.missingHostAdapters.join(', ')}.`
          : '',
        report.requiredSelection && !report.selectionSatisfied
          ? `Required selection: ${report.requiredSelection}.`
          : '',
      ].filter(Boolean).join(' '),
    };
  };
}
