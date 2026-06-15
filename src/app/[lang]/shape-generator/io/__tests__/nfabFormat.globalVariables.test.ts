import { describe, it, expect } from 'vitest';
import { parseProject, serializeProject, toJsonString } from '../nfabFormat';
import type { FeatureHistory } from '../../useFeatureStack';

// Minimal valid scene for serializeProject input.
const SCENE = {
  selectedId: 'box',
  params: { width: 80, height: 30, depth: 20 },
  paramExpressions: {},
  materialId: 'aluminum',
  color: '#888',
  isSketchMode: false,
  sketchPlane: 'xy' as const,
  sketchProfile: { closed: false, segments: [] },
  sketchConfig: { mode: 'extrude' as const, depth: 10, revolveAngle: 360, revolveAxis: 'y' as const, segments: 32 },
};

const HISTORY: FeatureHistory = {
  nodes: [],
  rootId: 'r',
  activeNodeId: 'r',
  editingNodeId: null,
};

describe('.nfab scene.globalVariables persistence', () => {
  it('round-trips global variables (name + raw expression only)', () => {
    const project = serializeProject({
      name: 'gv-test',
      history: HISTORY,
      scene: {
        ...SCENE,
        globalVariables: [
          { name: 'W', expression: '80' },
          { name: 'half', expression: 'W / 2' },
        ],
      },
    });
    const parsed = parseProject(toJsonString(project));
    expect(parsed.scene.globalVariables).toEqual([
      { name: 'W', expression: '80' },
      { name: 'half', expression: 'W / 2' },
    ]);
  });

  it('files without the field load with globalVariables undefined (legacy-safe)', () => {
    const project = serializeProject({ name: 'no-gv', history: HISTORY, scene: SCENE });
    const parsed = parseProject(toJsonString(project));
    expect(parsed.scene.globalVariables).toBeUndefined();
  });

  it('v1 files (pre-variables) migrate cleanly with no globalVariables', () => {
    const v1 = {
      magic: 'nfab',
      version: 1,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      name: 'legacy',
      tree: { nodes: [], rootId: 'r', activeNodeId: 'r' },
      scene: { ...SCENE },
    };
    const parsed = parseProject(JSON.stringify(v1));
    expect(parsed.version).toBe(3);
    expect(parsed.scene.globalVariables).toBeUndefined();
  });

  it('sanitizes malformed rows: bad names / non-string expressions dropped, duplicates keep the last', () => {
    const raw = {
      magic: 'nfab',
      version: 3,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      name: 'dirty',
      tree: { nodes: [], rootId: 'r', activeNodeId: 'r' },
      scene: {
        ...SCENE,
        globalVariables: [
          { name: 'W', expression: '80' },
          { name: '2bad', expression: '1' },          // invalid identifier
          { name: 'noExpr' },                          // missing expression
          { name: 'W', expression: '100' },            // duplicate — later wins
          'garbage',                                   // not an object
        ],
      },
    };
    const parsed = parseProject(JSON.stringify(raw));
    expect(parsed.scene.globalVariables).toEqual([{ name: 'W', expression: '100' }]);
  });

  it('drops the field entirely when every row is invalid', () => {
    const raw = {
      magic: 'nfab',
      version: 3,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      name: 'all-bad',
      tree: { nodes: [], rootId: 'r', activeNodeId: 'r' },
      scene: { ...SCENE, globalVariables: [{ name: '!!', expression: '1' }, 42] },
    };
    const parsed = parseProject(JSON.stringify(raw));
    expect(parsed.scene.globalVariables).toBeUndefined();
  });

  it('feature-node paramExpressions ride along inside tree.nodes', () => {
    const history: FeatureHistory = {
      nodes: [
        {
          id: 'f1', type: 'feature', label: 'Fillet 1', icon: '◠', featureType: 'fillet',
          params: { radius: 40, segments: 4 },
          paramExpressions: { radius: 'W / 2' },
          enabled: true, expanded: false, parentId: 'r', children: [],
          editingActive: false, timestamp: 1700000000000,
        },
      ],
      rootId: 'r',
      activeNodeId: 'f1',
      editingNodeId: null,
    };
    const project = serializeProject({ name: 'fp-expr', history, scene: SCENE });
    const parsed = parseProject(toJsonString(project));
    expect(parsed.tree.nodes[0].paramExpressions).toEqual({ radius: 'W / 2' });
    expect(parsed.tree.nodes[0].params.radius).toBe(40); // evaluated value persists too
  });
});
