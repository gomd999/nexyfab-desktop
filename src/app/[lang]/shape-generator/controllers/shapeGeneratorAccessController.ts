/**
 * Pure capability boundary for Shape Generator commands.
 *
 * This module deliberately knows nothing about React, users, or providers. It
 * only answers whether a stable command identity is allowed in a UI mode.
 * Unknown identities and modes are denied (fail closed).
 */

export const SHAPE_GENERATOR_ACTION_IDS = Object.freeze({
  view: 'shape-generator.view',
  selection: 'shape-generator.selection',
  export: 'shape-generator.export',
  documentMutation: 'shape-generator.document-mutation',
  persistence: 'shape-generator.persistence',
  import: 'shape-generator.import',
  analysisMutation: 'shape-generator.analysis-mutation',
} as const);

export type ShapeGeneratorActionId =
  (typeof SHAPE_GENERATOR_ACTION_IDS)[keyof typeof SHAPE_GENERATOR_ACTION_IDS];

export type ShapeGeneratorAccessMode = 'readonly' | 'normal';

export type ShapeGeneratorAccessDecision = Readonly<{
  allowed: boolean;
  actionId: ShapeGeneratorActionId | null;
  mode: ShapeGeneratorAccessMode | null;
  reason: 'allowed' | 'unknown_action' | 'unknown_mode' | 'mode_denied';
}>;

const KNOWN_ACTIONS: ReadonlySet<string> = new Set(Object.values(SHAPE_GENERATOR_ACTION_IDS));
const READONLY_ACTIONS: ReadonlySet<ShapeGeneratorActionId> = new Set([
  SHAPE_GENERATOR_ACTION_IDS.view,
  SHAPE_GENERATOR_ACTION_IDS.selection,
  SHAPE_GENERATOR_ACTION_IDS.export,
]);

const READONLY_SHELL_TOOL_ACTIONS: Readonly<Record<string, ShapeGeneratorActionId>> = Object.freeze({
  measure: SHAPE_GENERATOR_ACTION_IDS.selection,
  section: SHAPE_GENERATOR_ACTION_IDS.view,
  'mass-props': SHAPE_GENERATOR_ACTION_IDS.view,
  'view.scad': SHAPE_GENERATOR_ACTION_IDS.view,
  scad: SHAPE_GENERATOR_ACTION_IDS.view,
  'bom.export': SHAPE_GENERATOR_ACTION_IDS.export,
  'output.pdf': SHAPE_GENERATOR_ACTION_IDS.export,
  'output.print': SHAPE_GENERATOR_ACTION_IDS.export,
});

export function isShapeGeneratorActionId(value: unknown): value is ShapeGeneratorActionId {
  return typeof value === 'string' && KNOWN_ACTIONS.has(value);
}

export function isShapeGeneratorAccessMode(value: unknown): value is ShapeGeneratorAccessMode {
  return value === 'readonly' || value === 'normal';
}

export function evaluateShapeGeneratorAccess(
  actionId: unknown,
  mode: unknown,
): ShapeGeneratorAccessDecision {
  const knownAction = isShapeGeneratorActionId(actionId);
  const knownMode = isShapeGeneratorAccessMode(mode);
  const normalizedAction = knownAction ? actionId : null;
  const normalizedMode = knownMode ? mode : null;

  if (!knownAction) {
    return { allowed: false, actionId: normalizedAction, mode: normalizedMode, reason: 'unknown_action' };
  }
  if (!knownMode) {
    return { allowed: false, actionId: normalizedAction, mode: normalizedMode, reason: 'unknown_mode' };
  }
  const allowed = mode === 'normal' || READONLY_ACTIONS.has(actionId);
  return {
    allowed,
    actionId: normalizedAction,
    mode: normalizedMode,
    reason: allowed ? 'allowed' : 'mode_denied',
  };
}

export function canAccessShapeGeneratorAction(actionId: unknown, mode: unknown): boolean {
  return evaluateShapeGeneratorAccess(actionId, mode).allowed;
}

/** Newly added shell tools default to document mutation and stay read-only denied. */
export function classifyShapeGeneratorShellTool(toolId: unknown): ShapeGeneratorActionId | null {
  if (typeof toolId !== 'string' || toolId.length === 0) return null;
  return READONLY_SHELL_TOOL_ACTIONS[toolId] ?? SHAPE_GENERATOR_ACTION_IDS.documentMutation;
}

export function canDispatchShapeGeneratorShellTool(toolId: unknown, mode: unknown): boolean {
  const actionId = classifyShapeGeneratorShellTool(toolId);
  return actionId !== null && canAccessShapeGeneratorAction(actionId, mode);
}
