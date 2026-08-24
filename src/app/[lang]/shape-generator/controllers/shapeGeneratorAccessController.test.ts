import { describe, expect, it } from 'vitest';
import {
  SHAPE_GENERATOR_ACTION_IDS,
  canAccessShapeGeneratorAction,
  canDispatchShapeGeneratorShellTool,
  classifyShapeGeneratorShellTool,
  evaluateShapeGeneratorAccess,
  isShapeGeneratorActionId,
} from './shapeGeneratorAccessController';

describe('shape generator access controller', () => {
  it('uses explicit stable action IDs', () => {
    expect(SHAPE_GENERATOR_ACTION_IDS).toEqual({
      view: 'shape-generator.view',
      selection: 'shape-generator.selection',
      export: 'shape-generator.export',
      documentMutation: 'shape-generator.document-mutation',
      persistence: 'shape-generator.persistence',
      import: 'shape-generator.import',
      analysisMutation: 'shape-generator.analysis-mutation',
    });
    expect(isShapeGeneratorActionId(SHAPE_GENERATOR_ACTION_IDS.view)).toBe(true);
  });

  it('allows only non-mutating actions in readonly mode', () => {
    expect(canAccessShapeGeneratorAction(SHAPE_GENERATOR_ACTION_IDS.view, 'readonly')).toBe(true);
    expect(canAccessShapeGeneratorAction(SHAPE_GENERATOR_ACTION_IDS.selection, 'readonly')).toBe(true);
    expect(canAccessShapeGeneratorAction(SHAPE_GENERATOR_ACTION_IDS.export, 'readonly')).toBe(true);
    expect(canAccessShapeGeneratorAction(SHAPE_GENERATOR_ACTION_IDS.documentMutation, 'readonly')).toBe(false);
    expect(canAccessShapeGeneratorAction(SHAPE_GENERATOR_ACTION_IDS.persistence, 'readonly')).toBe(false);
    expect(canAccessShapeGeneratorAction(SHAPE_GENERATOR_ACTION_IDS.import, 'readonly')).toBe(false);
    expect(canAccessShapeGeneratorAction(SHAPE_GENERATOR_ACTION_IDS.analysisMutation, 'readonly')).toBe(false);
  });

  it('allows all registered actions in normal mode', () => {
    for (const actionId of Object.values(SHAPE_GENERATOR_ACTION_IDS)) {
      expect(canAccessShapeGeneratorAction(actionId, 'normal')).toBe(true);
    }
  });

  it('fails closed for unknown action and mode values', () => {
    expect(evaluateShapeGeneratorAccess('shape-generator.future', 'normal')).toEqual({
      allowed: false, actionId: null, mode: 'normal', reason: 'unknown_action',
    });
    expect(evaluateShapeGeneratorAccess(SHAPE_GENERATOR_ACTION_IDS.view, 'admin')).toEqual({
      allowed: false, actionId: SHAPE_GENERATOR_ACTION_IDS.view, mode: null, reason: 'unknown_mode',
    });
    expect(evaluateShapeGeneratorAccess({ toString: () => 'shape-generator.view' }, 'normal').allowed).toBe(false);
  });

  it('does not invoke hostile coercion', () => {
    let invoked = false;
    const hostile = { get value() { invoked = true; return 'shape-generator.view'; } };
    expect(canAccessShapeGeneratorAction(hostile, hostile)).toBe(false);
    expect(invoked).toBe(false);
  });

  it('allows only explicitly classified shell inspect and export tools in readonly mode', () => {
    for (const toolId of ['measure', 'section', 'mass-props', 'view.scad', 'scad', 'bom.export', 'output.pdf', 'output.print']) {
      expect(canDispatchShapeGeneratorShellTool(toolId, 'readonly')).toBe(true);
    }
    for (const toolId of ['extrude', 'sketch', 'direct.delete-face', 'mate.coincident', 'ai.suggest', 'future-tool']) {
      expect(classifyShapeGeneratorShellTool(toolId)).toBe(SHAPE_GENERATOR_ACTION_IDS.documentMutation);
      expect(canDispatchShapeGeneratorShellTool(toolId, 'readonly')).toBe(false);
      expect(canDispatchShapeGeneratorShellTool(toolId, 'normal')).toBe(true);
    }
    expect(canDispatchShapeGeneratorShellTool('', 'normal')).toBe(false);
    expect(canDispatchShapeGeneratorShellTool({ toString: () => 'measure' }, 'normal')).toBe(false);
  });
});
