import { describe, it, expect } from 'vitest';
import {
  captureMasterSnapshot,
  projectNodesToMaster,
  restoreMasterSnapshotOps,
  type MasterSnapshot,
} from '../masterSnapshot';

function makeScene(params: Record<string, number>, paramExpressions: Record<string, string> = {}) {
  return { params, paramExpressions };
}

interface TestNode {
  id: string;
  type: string;
  enabled: boolean;
}

const root: TestNode = { id: 'root', type: 'baseShape', enabled: true };

function makeHistory(...nodes: TestNode[]) {
  return { nodes: [root, ...nodes], rootId: 'root' };
}

describe('captureMasterSnapshot', () => {
  it('copies scene params + paramExpressions (defensive clone)', () => {
    const scene = makeScene({ width: 100, depth: 50 }, { radius: '$width / 2' });
    const snap = captureMasterSnapshot(scene, makeHistory());
    expect(snap.scene.params).toEqual({ width: 100, depth: 50 });
    expect(snap.scene.paramExpressions).toEqual({ radius: '$width / 2' });
    // Mutating the source must not bleed into the snapshot.
    scene.params.width = 999;
    expect(snap.scene.params.width).toBe(100);
  });

  it('captures featureEnabled per non-root non-baseShape node', () => {
    const snap = captureMasterSnapshot(
      makeScene({}),
      makeHistory(
        { id: 'F1', type: 'feature', enabled: true },
        { id: 'F2', type: 'feature', enabled: false },
        { id: 'F3', type: 'feature', enabled: true },
      ),
    );
    expect(snap.featureEnabled).toEqual({ F1: true, F2: false, F3: true });
  });

  it('excludes root and baseShape nodes from featureEnabled', () => {
    const snap = captureMasterSnapshot(
      makeScene({}),
      makeHistory({ id: 'base2', type: 'baseShape', enabled: true }),
    );
    expect(snap.featureEnabled).toEqual({});
  });
});

describe('restoreMasterSnapshotOps', () => {
  const snap: MasterSnapshot = {
    scene: { params: { width: 100 }, paramExpressions: {} },
    featureEnabled: { F1: true, F2: false },
  };

  it('produces scene values cloned from the snapshot', () => {
    const ops = restoreMasterSnapshotOps(snap, makeHistory());
    expect(ops.scene.params).toEqual({ width: 100 });
    // Returned object is a fresh clone — mutating it cannot corrupt snap.
    ops.scene.params.width = 999;
    expect(snap.scene.params.width).toBe(100);
  });

  it('restores per-feature enabled flags from the snapshot', () => {
    const ops = restoreMasterSnapshotOps(
      snap,
      makeHistory(
        { id: 'F1', type: 'feature', enabled: false },
        { id: 'F2', type: 'feature', enabled: true },
      ),
    );
    expect(ops.enabledOverrides).toEqual([
      { id: 'F1', enabled: true },
      { id: 'F2', enabled: false },
    ]);
  });

  it('defaults post-master nodes to enabled', () => {
    const ops = restoreMasterSnapshotOps(
      snap,
      makeHistory(
        { id: 'F1', type: 'feature', enabled: false },
        { id: 'F3', type: 'feature', enabled: false }, // not in snap — post-master
      ),
    );
    expect(ops.enabledOverrides).toEqual([
      { id: 'F1', enabled: true },
      { id: 'F3', enabled: true },
    ]);
  });

  it('ignores root and baseShape nodes', () => {
    const ops = restoreMasterSnapshotOps(
      snap,
      makeHistory(
        { id: 'F1', type: 'feature', enabled: false },
        { id: 'base2', type: 'baseShape', enabled: true },
      ),
    );
    expect(ops.enabledOverrides.map(o => o.id)).toEqual(['F1']);
  });
});

describe('projectNodesToMaster', () => {
  const snap: MasterSnapshot = {
    scene: { params: {}, paramExpressions: {} },
    featureEnabled: { F1: true, F2: false },
  };

  it('overrides node.enabled with master values', () => {
    const nodes: TestNode[] = [
      root,
      { id: 'F1', type: 'feature', enabled: false }, // config flipped it off
      { id: 'F2', type: 'feature', enabled: true },  // config flipped it on
    ];
    const projected = projectNodesToMaster(nodes, 'root', snap);
    expect(projected[1]!.enabled).toBe(true);  // F1 master enabled=true
    expect(projected[2]!.enabled).toBe(false); // F2 master enabled=false
  });

  it('leaves post-master nodes (not in snapshot) at their current enabled', () => {
    const nodes: TestNode[] = [
      root,
      { id: 'F1', type: 'feature', enabled: false },
      { id: 'F3', type: 'feature', enabled: false }, // post-master
    ];
    const projected = projectNodesToMaster(nodes, 'root', snap);
    expect(projected[2]!.enabled).toBe(false); // unchanged
  });

  it('does not mutate the input array', () => {
    const nodes: TestNode[] = [
      root,
      { id: 'F1', type: 'feature', enabled: false },
    ];
    const original = nodes[1]!.enabled;
    projectNodesToMaster(nodes, 'root', snap);
    expect(nodes[1]!.enabled).toBe(original);
  });

  it('passes through root and baseShape nodes untouched', () => {
    const otherBase: TestNode = { id: 'base2', type: 'baseShape', enabled: false };
    const nodes: TestNode[] = [root, otherBase];
    const projected = projectNodesToMaster(nodes, 'root', snap);
    expect(projected[0]).toBe(root);
    expect(projected[1]).toBe(otherBase);
  });
});

describe('end-to-end: capture → mutate → restore round-trip', () => {
  it('master values survive a simulated config-activate cycle', () => {
    // 1. Master state.
    const masterScene = makeScene({ radius: 5, depth: 10 });
    const history = makeHistory(
      { id: 'F1', type: 'feature', enabled: true },
      { id: 'F2', type: 'feature', enabled: true },
    );

    // 2. User adds a config, activates it — capture master.
    const snap = captureMasterSnapshot(masterScene, history);

    // 3. Config mutates scene + node enabled.
    masterScene.params.radius = 99;
    history.nodes[1]!.enabled = false; // F1
    history.nodes[2]!.enabled = false; // F2

    // 4. User deactivates — restore via ops.
    const ops = restoreMasterSnapshotOps(snap, history);

    // 5. Verify master values come back.
    expect(ops.scene.params).toEqual({ radius: 5, depth: 10 });
    expect(ops.enabledOverrides).toEqual([
      { id: 'F1', enabled: true },
      { id: 'F2', enabled: true },
    ]);
  });
});
