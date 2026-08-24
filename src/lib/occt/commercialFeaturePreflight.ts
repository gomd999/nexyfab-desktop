import {
  CAD_FEATURE_KINDS,
  lookupFeature,
  type FeatureRegistryEntry,
} from '@/lib/cad/featureRegistry';
import {
  decideFeatureExecution as decideRegistryFeatureExecution,
  type FeatureExecutionRuntime,
} from '@/lib/cad/featureRegistryDecision';
import type { FeatureNode, FeatureTree } from '@/lib/cad/featureTree';
import {
  featureTreeToOcctPlan,
  type OcctCommand,
  type OcctPlan,
  type UnsupportedNode,
} from './featurePlan';

/** Runtime facts are injected; this module never loads a kernel or executes a command. */
export type FeatureRuntimeCapability = FeatureExecutionRuntime;

export type PreflightIssueCode =
  | 'INVALID_INPUT'
  | 'INVALID_CAPABILITY'
  | 'FEATURE_UNSUPPORTED'
  | 'FEATURE_PREVIEW'
  | 'FEATURE_RUNTIME_UNAVAILABLE'
  | 'FEATURE_STUB_RUNTIME'
  | 'FEATURE_HANDLER_MISSING'
  | 'FEATURE_VERIFIER_MISSING'
  | 'FEATURE_COMMAND_MAPPING_MISSING'
  | 'FEATURE_COMMAND_MISMATCH'
  | 'FEATURE_PARAMETER_OUT_OF_BOUNDS'
  | 'PLAN_BUILD_ERROR'
  | 'PLAN_UNSUPPORTED'
  | 'PLAN_EMBEDDED_NODE'
  | 'PLAN_EMPTY'
  | 'PLAN_COMMAND_NODE_MISMATCH'
  | 'PLAN_FINAL_MISMATCH'
  | 'PLAN_TERMINAL_COUNT';

export interface PreflightIssue {
  code: PreflightIssueCode;
  detail: string;
  nodeId?: string;
  featureId?: string;
}

export interface FeatureExecutionDecision {
  status: 'READY' | 'HOLD';
  nodeId?: string;
  featureId: string;
  commandOp: OcctCommand['op'] | null;
  handlerId: string | null;
  issues: readonly PreflightIssue[];
}

export interface PreflightPlanSummary {
  commandCount: number;
  finalResultId: string;
  terminalIds: readonly string[];
  unsupported: readonly UnsupportedNode[];
  embeddedChildNodes: readonly string[];
}

export interface CommercialFeaturePreflightResult {
  status: 'PRECHECK_PASS' | 'HOLD';
  issues: readonly PreflightIssue[];
  decisions: readonly FeatureExecutionDecision[];
  plan?: PreflightPlanSummary;
}

const MAX_NODES = 128;
const MAX_DEPENDENCIES = 128;
const MAX_ARRAY = 256;
const MAX_DEPTH = 8;
const MAX_KEYS = 64;
const MAX_TEXT = 512;
const TREE_KEYS = ['nodes'] as const;
const NODE_KEYS = ['dependencies', 'id', 'name', 'payload', 'suppressed'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};

const boundedText = (value: unknown, max = MAX_TEXT): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= max
);

const uniqueBoundedStrings = (value: unknown, max: number): value is readonly string[] => (
  Array.isArray(value) && value.length <= max && value.every(item => boundedText(item, MAX_TEXT))
    && new Set(value).size === value.length
);

function boundedJson(value: unknown, depth = 0, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return typeof value !== 'string' || value.length <= MAX_TEXT;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth >= MAX_DEPTH || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return false;
    return value.every(item => boundedJson(item, depth + 1, seen));
  }
  if (!isRecord(value) || Object.keys(value).length > MAX_KEYS) return false;
  return Object.entries(value).every(([key, item]) => boundedText(key, 128) && boundedJson(item, depth + 1, seen));
}

function issue(code: PreflightIssueCode, detail: string, nodeId?: string, featureId?: string): PreflightIssue {
  return { code, detail, ...(nodeId ? { nodeId } : {}), ...(featureId ? { featureId } : {}) };
}

function validateCapability(input: unknown): FeatureRuntimeCapability | null {
  const probe = decideRegistryFeatureExecution({
    featureId: 'tree:extrude',
    intent: 'AUTHORITATIVE',
    runtime: input,
  });
  return probe.reason === 'invalid_request' ? null : input as FeatureRuntimeCapability;
}

function validateTreeInput(input: unknown): FeatureTree | null {
  if (!isRecord(input) || !exactKeys(input, TREE_KEYS) || !Array.isArray(input.nodes) || input.nodes.length > MAX_NODES) return null;
  const ids = new Set<string>();
  for (const rawNode of input.nodes) {
    if (!isRecord(rawNode)) return null;
    const allowedKeys = rawNode.suppressed === undefined ? NODE_KEYS.filter(key => key !== 'suppressed') : NODE_KEYS;
    if (!exactKeys(rawNode, allowedKeys)) return null;
    if (!boundedText(rawNode.id, 256) || ids.has(rawNode.id)) return null;
    ids.add(rawNode.id);
    if (!boundedText(rawNode.name)) return null;
    if (!Array.isArray(rawNode.dependencies) || rawNode.dependencies.length > MAX_DEPENDENCIES || !rawNode.dependencies.every(dep => boundedText(dep, 256))) return null;
    if (rawNode.suppressed !== undefined && typeof rawNode.suppressed !== 'boolean') return null;
    if (!isRecord(rawNode.payload) || !boundedJson(rawNode.payload)) return null;
    if (typeof rawNode.payload.kind !== 'string' || !(CAD_FEATURE_KINDS as readonly string[]).includes(rawNode.payload.kind)) return null;
    if (rawNode.payload.kind === 'shell') {
      for (const key of ['openTopFace', 'openBottomFace']) {
        if (rawNode.payload[key] !== undefined && typeof rawNode.payload[key] !== 'boolean') return null;
      }
    }
  }
  return input as unknown as FeatureTree;
}

function canonicalIdForNode(node: FeatureNode): string {
  if (node.payload.kind === 'shell') {
    const shell = node.payload as { openTopFace?: boolean; openBottomFace?: boolean };
    if (shell.openTopFace === true || shell.openBottomFace === true) return 'cad.mechanical.shell-open';
  }
  if (node.payload.kind === 'boolean') {
    const variant = node.payload.op === 'difference' ? 'subtract'
      : node.payload.op === 'intersection' ? 'intersect'
        : node.payload.op;
    return `cad.mechanical.boolean-${variant}`;
  }
  return `tree:${node.payload.kind}`;
}

const COMMAND_OPS: Readonly<Record<string, OcctCommand['op']>> = {
  'occt.sketchExtrude': 'extrude',
  'occt.revolve': 'revolve',
  'occt.hole': 'hole',
  'occt.fillet': 'fillet',
  'occt.chamfer': 'chamfer',
  'occt.shell.open': 'shell',
  'occt.boolean.union': 'boolean',
  'occt.boolean.subtract': 'boolean',
  'occt.boolean.intersect': 'boolean',
};

function validLoop(loop: unknown): boolean {
  return Array.isArray(loop) && loop.length >= 3 && loop.length <= 10_000
    && loop.every(point => isRecord(point) && exactKeys(point, ['x', 'y'])
      && typeof point.x === 'number' && Number.isFinite(point.x) && Math.abs(point.x) <= 1e9
      && typeof point.y === 'number' && Number.isFinite(point.y) && Math.abs(point.y) <= 1e9);
}

function commandBoundsProblem(command: OcctCommand): string | null {
  if (command.op === 'extrude') {
    if (!validLoop(command.feature.loop) || !Number.isFinite(command.feature.depth)
      || command.feature.depth <= 0 || command.feature.depth > 1e9) return 'extrude profile/depth is outside the commercial bound';
  } else if (command.op === 'revolve') {
    if (!validLoop(command.feature.loop) || !Number.isFinite(command.feature.angleDegrees)
      || command.feature.angleDegrees <= 0 || command.feature.angleDegrees > 360) return 'revolve profile/angle is outside the commercial bound';
  } else if (command.op === 'hole') {
    const feature = command.feature;
    if (![feature.center.x, feature.center.y, feature.diameter, feature.depth].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)
      || feature.diameter <= 0 || feature.depth <= 0) return 'hole center/diameter/depth is outside the commercial bound';
  } else if (command.op === 'fillet') {
    if (!Number.isFinite(command.radius) || command.radius <= 0 || command.radius > 1e9 || command.edgeIds.length === 0) return 'fillet radius/selection is outside the commercial bound';
  } else if (command.op === 'chamfer') {
    if (!Number.isFinite(command.distance) || command.distance <= 0 || command.distance > 1e9 || command.edgeIds.length === 0) return 'chamfer distance/selection is outside the commercial bound';
  } else if (command.op === 'shell') {
    if (!Number.isFinite(command.thickness) || command.thickness <= 0 || command.thickness > 1e6
      || command.faceIds.length < 1 || command.faceIds.length > 2) return 'open-shell thickness/face selection is outside the commercial bound';
  } else if (command.op === 'boolean') {
    if (!boundedText(command.base, 256) || command.tools.length < 1 || command.tools.length > 128
      || !command.tools.every(tool => boundedText(tool, 256))
      || new Set([command.base, ...command.tools]).size !== command.tools.length + 1) return 'boolean operands are outside the commercial bound';
  }
  return null;
}

function registryDecisionIssues(
  featureId: string,
  capability: FeatureRuntimeCapability,
): PreflightIssue[] {
  const decision = decideRegistryFeatureExecution({ featureId, intent: 'AUTHORITATIVE', runtime: capability });
  if (decision.status === 'ALLOW_EXACT') return [];
  const detail = `${decision.reason}${decision.missing.length ? `:${decision.missing.join(',')}` : ''}`;
  if (decision.reason === 'preview_not_authoritative') return [issue('FEATURE_PREVIEW', detail, undefined, decision.featureId ?? featureId)];
  if (decision.reason === 'feature_unsupported' || decision.reason === 'unknown_feature') return [issue('FEATURE_UNSUPPORTED', detail, undefined, decision.featureId ?? featureId)];
  if (decision.reason === 'stub_fallback_forbidden') return [issue('FEATURE_STUB_RUNTIME', detail, undefined, decision.featureId ?? featureId)];
  if (decision.reason === 'handler_unavailable') return [issue('FEATURE_HANDLER_MISSING', detail, undefined, decision.featureId ?? featureId)];
  if (decision.reason === 'verification_unavailable') return [issue('FEATURE_VERIFIER_MISSING', detail, undefined, decision.featureId ?? featureId)];
  return [issue('FEATURE_RUNTIME_UNAVAILABLE', detail, undefined, decision.featureId ?? featureId)];
}

/** Decide one planned command without executing it. Runtime identity is mandatory. */
export function decidePlannedFeatureExecution(
  entry: FeatureRegistryEntry | null,
  commandOp: OcctCommand['op'] | null,
  runtimeCapabilityInput: FeatureRuntimeCapability,
  featureId = entry?.featureId ?? 'unknown',
): FeatureExecutionDecision {
  const runtimeCapability = validateCapability(runtimeCapabilityInput);
  if (!runtimeCapability) {
    return {
      status: 'HOLD',
      featureId: entry?.featureId ?? featureId,
      commandOp,
      handlerId: entry?.handlerId ?? null,
      issues: [issue('INVALID_CAPABILITY', 'runtime capability shape is invalid', undefined, featureId)],
    };
  }
  const requestedFeatureId = entry?.featureId ?? featureId;
  const issues = registryDecisionIssues(requestedFeatureId, runtimeCapability);
  if (issues.length === 0 && entry?.handlerId) {
    const expectedOp = COMMAND_OPS[entry.handlerId];
    if (!expectedOp) issues.push(issue('FEATURE_COMMAND_MAPPING_MISSING', `no command mapping for handler ${entry.handlerId}`, undefined, entry.featureId));
    else if (commandOp !== null && expectedOp !== commandOp) issues.push(issue('FEATURE_COMMAND_MISMATCH', `handler ${entry.handlerId} expects ${expectedOp}, planned ${commandOp}`, undefined, entry.featureId));
  }
  return {
    status: issues.length === 0 ? 'READY' : 'HOLD',
    featureId: entry?.featureId ?? featureId,
    commandOp,
    handlerId: entry?.handlerId ?? null,
    issues,
  };
}

function consumedIds(plan: OcctPlan): Set<string> {
  const consumed = new Set<string>();
  for (const command of plan.commands) {
    if (command.op === 'boolean') {
      consumed.add(command.base);
      command.tools.forEach(tool => consumed.add(tool));
    } else if (command.op === 'fillet' || command.op === 'chamfer' || command.op === 'hole' || command.op === 'shell') {
      consumed.add(command.target);
    }
  }
  return consumed;
}

function terminalIds(plan: OcctPlan): string[] {
  const produced = new Set(plan.commands.map(command => command.resultId));
  const consumed = consumedIds(plan);
  return [...produced].filter(resultId => !consumed.has(resultId));
}

function freezeResult(result: CommercialFeaturePreflightResult): CommercialFeaturePreflightResult {
  for (const decision of result.decisions) {
    Object.freeze(decision.issues);
    Object.freeze(decision);
  }
  Object.freeze(result.decisions);
  Object.freeze(result.issues);
  if (result.plan) {
    Object.freeze(result.plan.terminalIds);
    Object.freeze(result.plan.unsupported);
    Object.freeze(result.plan.embeddedChildNodes);
    Object.freeze(result.plan);
  }
  return Object.freeze(result);
}

/**
 * Pure commercial-authority preflight. It may construct a plan, but never
 * invokes a bridge, kernel, exporter, verifier, or final release transition.
 */
function preflightCommercialFeatureTreeUnsafe(
  input: unknown,
  runtimeCapabilityInput: unknown,
): CommercialFeaturePreflightResult {
  const runtimeCapability = validateCapability(runtimeCapabilityInput);
  if (!runtimeCapability) return freezeResult({ status: 'HOLD', issues: [issue('INVALID_CAPABILITY', 'runtime capability shape is invalid')], decisions: [] });
  const tree = validateTreeInput(input);
  if (!tree) return freezeResult({ status: 'HOLD', issues: [issue('INVALID_INPUT', 'feature tree shape is invalid or exceeds bounds')], decisions: [] });

  const activeNodes = tree.nodes.filter(node => node.suppressed !== true);
  const activeTree: FeatureTree = { nodes: activeNodes };
  const decisions: FeatureExecutionDecision[] = [];
  const issues: PreflightIssue[] = [];
  const entriesByNode = new Map<string, FeatureRegistryEntry | null>();

  for (const node of activeNodes) {
    const featureId = canonicalIdForNode(node);
    const lookup = lookupFeature(featureId);
    const entry = lookup.ok ? lookup.feature : null;
    entriesByNode.set(node.id, entry);
    const preliminary = decidePlannedFeatureExecution(entry, null, runtimeCapability, featureId);
    decisions.push({ ...preliminary, nodeId: node.id });
    issues.push(...preliminary.issues.map(item => ({ ...item, nodeId: node.id })));
  }

  let plan: OcctPlan;
  try {
    plan = featureTreeToOcctPlan(activeTree);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'featureTreeToOcctPlan threw a non-error value';
    return freezeResult({ status: 'HOLD', issues: [...issues, issue('PLAN_BUILD_ERROR', detail)], decisions });
  }
  if (plan.unsupported.length > 0) {
    for (const unsupported of plan.unsupported) issues.push(issue('PLAN_UNSUPPORTED', unsupported.reason, unsupported.resultId));
  }
  if (plan.embeddedChildNodes.length > 0) {
    for (const nodeId of plan.embeddedChildNodes) issues.push(issue('PLAN_EMBEDDED_NODE', 'embedded child snapshot is not authoritative', nodeId));
  }
  if (plan.commands.length === 0) issues.push(issue('PLAN_EMPTY', 'authoritative preflight requires at least one planned command'));

  const nodeById = new Map(activeNodes.map(node => [node.id, node]));
  const commandByResultId = new Map<string, OcctCommand>();
  for (const command of plan.commands) {
    if (commandByResultId.has(command.resultId)) issues.push(issue('PLAN_COMMAND_NODE_MISMATCH', `duplicate planned resultId ${command.resultId}`, command.resultId));
    commandByResultId.set(command.resultId, command);
    if (!nodeById.has(command.resultId)) issues.push(issue('PLAN_COMMAND_NODE_MISMATCH', `planned command has no active source node`, command.resultId));
  }
  for (const node of activeNodes) {
    const command = commandByResultId.get(node.id);
    const decision = decisions.find(item => item.nodeId === node.id);
    if (!command) {
      issues.push(issue('PLAN_COMMAND_NODE_MISMATCH', `active node produced no exact OCCT command`, node.id, decision?.featureId));
      continue;
    }
    const entry = entriesByNode.get(node.id) ?? null;
    const checked = decidePlannedFeatureExecution(entry, command.op, runtimeCapability, decision?.featureId ?? canonicalIdForNode(node));
    const boundsProblem = commandBoundsProblem(command);
    if (boundsProblem) checked.issues = [...checked.issues, issue('FEATURE_PARAMETER_OUT_OF_BOUNDS', boundsProblem, node.id, checked.featureId)];
    checked.status = checked.issues.length === 0 ? 'READY' : 'HOLD';
    if (decision) {
      decision.commandOp = command.op;
      decision.issues = checked.issues.map(item => ({ ...item, nodeId: node.id }));
      decision.status = checked.status;
      decision.handlerId = checked.handlerId;
    }
    issues.push(...checked.issues.map(item => ({ ...item, nodeId: node.id })));
  }

  const terminals = terminalIds(plan);
  if (terminals.length !== 1) issues.push(issue('PLAN_TERMINAL_COUNT', `expected exactly one unconsumed produced terminal, got ${terminals.length}`));
  if (!plan.finalResultId || terminals.length !== 1 || plan.finalResultId !== terminals[0]) {
    issues.push(issue('PLAN_FINAL_MISMATCH', `finalResultId=${plan.finalResultId ?? 'null'} terminals=${terminals.join(',') || 'none'}`));
  }
  const summary = plan.finalResultId && terminals.length === 1
    ? {
      commandCount: plan.commands.length,
      finalResultId: plan.finalResultId,
      terminalIds: terminals,
      unsupported: plan.unsupported,
      embeddedChildNodes: plan.embeddedChildNodes,
    }
    : undefined;
  return freezeResult({ status: issues.length === 0 ? 'PRECHECK_PASS' : 'HOLD', issues, decisions, ...(summary ? { plan: summary } : {}) });
}

export function preflightCommercialFeatureTree(
  input: unknown,
  runtimeCapabilityInput: unknown,
): CommercialFeaturePreflightResult {
  try {
    return preflightCommercialFeatureTreeUnsafe(input, runtimeCapabilityInput);
  } catch {
    return freezeResult({
      status: 'HOLD',
      issues: [issue('INVALID_INPUT', 'feature tree inspection was unreadable')],
      decisions: [],
    });
  }
}
