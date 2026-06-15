/**
 * @vitest-environment jsdom
 *
 * DirectEditHostBridge.test.tsx — E1-E4 host-side integration.
 *
 * Verifies the bridge wires every direct-edit op:
 *   - E1 push-pull:  pickFace      → applyPushPull       → scene + pushOp
 *   - E2 fillet:     pickEdge      → applyDynamicFillet  → scene + pushOp
 *   - E2 chamfer:    pickEdge      → applyDynamicChamfer → scene + pushOp
 *   - E3 move:       applyTransform→ applyMoveBody       → scene + pushOp
 *   - E3 rotate:     applyTransform→ applyRotateBody     → scene + pushOp
 *   - E4 subtract:   pickBody (×2) → applySubtractBody   → scene + pushOp
 *   - mode toggle resets per-mode overlay state
 *   - bridge renders nothing when ?direct-edit=v1 is OFF
 *   - rejection paths fire notify('error' | 'warn') without scene changes
 */

import React, { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { render, screen, act } from '@testing-library/react';
import {
  DirectEditProvider,
  useDirectEditStack,
} from '../DirectEditController';
import {
  DirectEditHostBridge,
  type DirectEditViewportHandle,
  type DirectEditSceneAdapter,
} from '../DirectEditHostBridge';
import { tagWholeGeometryFeature } from '../../features/faceProvenance';

function makeBox(size: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size);
  g.computeVertexNormals();
  return g;
}

/** Flat square stamped with one feature id — push-pull-friendly fixture
 *  (planar +Y face that the applier accepts). */
function makeStampedSquare(faceId = 'top'): THREE.BufferGeometry {
  const positions = new Float32Array([
    -5, 0, -5,
     5, 0, -5,
     5, 0,  5,
    -5, 0,  5,
  ]);
  const indices = [0, 2, 1, 0, 3, 2];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  tagWholeGeometryFeature(g, faceId);
  return g;
}

function makeSceneAdapter(over: Partial<DirectEditSceneAdapter> = {}): DirectEditSceneAdapter & {
  removeCalls: string[];
  replaceCalls: Array<{ id: string; vertCount: number }>;
  notifyCalls: Array<{ level: string; msg: string }>;
} {
  const targetGeo = makeBox(10);
  const toolGeo = makeBox(5);
  const bodies: Record<string, THREE.BufferGeometry | null> = {
    target: targetGeo,
    tool: toolGeo,
  };
  const removeCalls: string[] = [];
  const replaceCalls: Array<{ id: string; vertCount: number }> = [];
  const notifyCalls: Array<{ level: string; msg: string }> = [];
  return {
    getTargetGeometry: (id: string) => bodies[id] ?? null,
    removeBodyFromScene: (id: string) => { removeCalls.push(id); bodies[id] = null; },
    replaceBodyGeometry: (id, g) => {
      const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
      replaceCalls.push({ id, vertCount: pos?.count ?? 0 });
      bodies[id] = g;
    },
    notify: (level, msg) => { notifyCalls.push({ level, msg }); },
    removeCalls, replaceCalls, notifyCalls,
    ...over,
  };
}

/** Scene adapter that exposes a single primary body for the E1-E3 ops.
 *  Returns the supplied geometry from `getTargetGeometry('primary')`
 *  and reports `'primary'` as the active body id. */
function makePrimaryAdapter(
  primaryGeo: THREE.BufferGeometry,
  over: Partial<DirectEditSceneAdapter> = {},
): DirectEditSceneAdapter & {
  replaceCalls: Array<{ id: string; vertCount: number }>;
  notifyCalls: Array<{ level: string; msg: string }>;
  bodies: Record<string, THREE.BufferGeometry | null>;
} {
  const bodies: Record<string, THREE.BufferGeometry | null> = {
    primary: primaryGeo,
  };
  const replaceCalls: Array<{ id: string; vertCount: number }> = [];
  const notifyCalls: Array<{ level: string; msg: string }> = [];
  return {
    getActiveBodyId: () => 'primary',
    getTargetGeometry: (id) => bodies[id] ?? null,
    removeBodyFromScene: () => {},
    replaceBodyGeometry: (id, g) => {
      const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
      replaceCalls.push({ id, vertCount: pos?.count ?? 0 });
      bodies[id] = g;
    },
    notify: (level, msg) => { notifyCalls.push({ level, msg }); },
    replaceCalls, notifyCalls, bodies,
    ...over,
  };
}

/** Tiny probe component that captures the live direct-edit stack from
 *  context so tests can assert pushOp was called. */
function StackProbe({
  out,
}: {
  out: { last: ReturnType<typeof useDirectEditStack> | null };
}): null {
  const stack = useDirectEditStack();
  out.last = stack;
  return null;
}

function withProvider(child: React.ReactNode, enabled = true) {
  return (
    <DirectEditProvider enabled={enabled} historyVersion={0}>
      {child}
    </DirectEditProvider>
  );
}

describe('DirectEditHostBridge — gating', () => {
  it('renders nothing when ?direct-edit=v1 is OFF', () => {
    const adapter = makeSceneAdapter();
    const { container } = render(
      withProvider(<DirectEditHostBridge lang="en" sceneAdapter={adapter} />, false),
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the toolbar when enabled', () => {
    const adapter = makeSceneAdapter();
    render(withProvider(<DirectEditHostBridge lang="en" sceneAdapter={adapter} />));
    expect(screen.getByTestId('direct-edit-toolbar')).toBeTruthy();
  });
});

describe('DirectEditHostBridge — subtract-body flow', () => {
  it('viewport handle forwards picks to the overlay when mode=subtract-body', () => {
    const adapter = makeSceneAdapter();
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="subtract-body"
        />,
      ),
    );

    expect(screen.getByTestId('subtract-body-overlay')).toBeTruthy();
    act(() => handleRef.current!.pickBody('target'));
    expect(screen.getByTestId('subtract-step-pickTool')).toBeTruthy();
  });

  it('does NOT forward picks when mode is not subtract-body', () => {
    const adapter = makeSceneAdapter();
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="off"
        />,
      ),
    );

    // Overlay not rendered when mode='off'
    expect(screen.queryByTestId('subtract-body-overlay')).toBeNull();
    // Pick is a no-op
    act(() => handleRef.current!.pickBody('target'));
    expect(screen.queryByTestId('subtract-step-pickTool')).toBeNull();
  });

  it('mode toggle off resets overlay state', () => {
    const adapter = makeSceneAdapter();
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="subtract-body"
        />,
      ),
    );

    act(() => handleRef.current!.pickBody('target'));
    expect(screen.getByTestId('subtract-step-pickTool')).toBeTruthy();

    // Switching mode off resets the overlay's state machine.
    act(() => handleRef.current!.setMode('off'));
    expect(screen.queryByTestId('subtract-body-overlay')).toBeNull();

    // Back to subtract-body — overlay starts fresh at pickTarget
    act(() => handleRef.current!.setMode('subtract-body'));
    expect(screen.getByTestId('subtract-step-pickTarget')).toBeTruthy();
  });
});

describe('DirectEditHostBridge — apply path → scene adapter', () => {
  it('happy path: pick target → pick tool → Apply → scene updated + notify', () => {
    const adapter = makeSceneAdapter();
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="subtract-body"
        />,
      ),
    );

    act(() => handleRef.current!.pickBody('target'));
    act(() => handleRef.current!.pickBody('tool'));
    expect(screen.getByTestId('subtract-step-confirm')).toBeTruthy();

    const applyBtn = screen.getByTestId('subtract-apply');
    act(() => { applyBtn.click(); });

    expect(adapter.replaceCalls.length).toBe(1);
    expect(adapter.replaceCalls[0].id).toBe('target');
    expect(adapter.replaceCalls[0].vertCount).toBeGreaterThan(0);
    expect(adapter.removeCalls).toEqual(['tool']);
    expect(adapter.notifyCalls.some((n) => n.level === 'info' && n.msg.includes('Subtracted'))).toBe(true);
    // Overlay resets after successful Apply
    expect(screen.getByTestId('subtract-step-pickTarget')).toBeTruthy();
  });

  it('rejection path: target body not found → notify error, no scene change', () => {
    const adapter = makeSceneAdapter({
      getTargetGeometry: () => null,
    });
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="subtract-body"
        />,
      ),
    );

    act(() => handleRef.current!.pickBody('ghost-target'));
    act(() => handleRef.current!.pickBody('ghost-tool'));
    const applyBtn = screen.getByTestId('subtract-apply');
    act(() => { applyBtn.click(); });

    expect(adapter.replaceCalls).toEqual([]);
    expect(adapter.removeCalls).toEqual([]);
    expect(adapter.notifyCalls.some((n) => n.level === 'error' && n.msg.includes('not found'))).toBe(true);
  });

  it('resolveBodyLabel passes through to the overlay', () => {
    const adapter = makeSceneAdapter({
      resolveBodyLabel: (id) => `Body(${id})`,
    });
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="subtract-body"
        />,
      ),
    );

    act(() => handleRef.current!.pickBody('target'));
    expect(screen.getByText('Body(target)')).toBeTruthy();
  });
});

// ─── E1 push-pull dispatch ──────────────────────────────────────────────────

describe('DirectEditHostBridge — push-pull (E1) flow', () => {
  it('pickFace in push-pull mode → applyPushPull + scene + pushOp', () => {
    const adapter = makePrimaryAdapter(makeStampedSquare('top'));
    const handleRef = createRef<DirectEditViewportHandle>();
    const probe: { last: ReturnType<typeof useDirectEditStack> | null } = { last: null };
    render(
      withProvider(
        <>
          <StackProbe out={probe} />
          <DirectEditHostBridge
            lang="en"
            sceneAdapter={adapter}
            viewportRaycastRef={handleRef}
            initialMode="push-pull"
            defaultPushPullOffsetMm={5}
          />
        </>,
      ),
    );

    act(() => handleRef.current!.pickFace('top'));

    expect(adapter.replaceCalls.length).toBe(1);
    expect(adapter.replaceCalls[0].id).toBe('primary');
    expect(adapter.replaceCalls[0].vertCount).toBe(4);
    expect(probe.last?.ops.length).toBe(1);
    expect(probe.last?.ops[0].kind).toBe('pushPull');
    expect(adapter.notifyCalls.some((n) => n.level === 'info' && n.msg.includes('Push-pull'))).toBe(true);
  });

  it('honours per-pick offsetMm override on pickFace', () => {
    const adapter = makePrimaryAdapter(makeStampedSquare('top'));
    const handleRef = createRef<DirectEditViewportHandle>();
    const probe: { last: ReturnType<typeof useDirectEditStack> | null } = { last: null };
    render(
      withProvider(
        <>
          <StackProbe out={probe} />
          <DirectEditHostBridge
            lang="en"
            sceneAdapter={adapter}
            viewportRaycastRef={handleRef}
            initialMode="push-pull"
          />
        </>,
      ),
    );

    act(() => handleRef.current!.pickFace('top', { offsetMm: 12 }));

    expect(probe.last?.ops.length).toBe(1);
    const op = probe.last!.ops[0];
    expect(op.kind === 'pushPull' && op.offsetMm).toBe(12);
  });

  it('pickFace while mode is OFF is a no-op', () => {
    const adapter = makePrimaryAdapter(makeStampedSquare('top'));
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="off"
        />,
      ),
    );

    act(() => handleRef.current!.pickFace('top'));
    expect(adapter.replaceCalls).toEqual([]);
  });

  it('pickFace on unknown faceId → notify warn, no scene change', () => {
    const adapter = makePrimaryAdapter(makeStampedSquare('top'));
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="push-pull"
        />,
      ),
    );

    act(() => handleRef.current!.pickFace('does-not-exist'));

    expect(adapter.replaceCalls).toEqual([]);
    expect(adapter.notifyCalls.some((n) => n.level === 'warn')).toBe(true);
  });
});

// ─── E3 move / rotate dispatch ──────────────────────────────────────────────

describe('DirectEditHostBridge — move/rotate body (E3) flow', () => {
  it('applyTransform(move) in move-body mode → applyMoveBody + scene + pushOp', () => {
    const adapter = makePrimaryAdapter(makeStampedSquare('top'));
    const handleRef = createRef<DirectEditViewportHandle>();
    const probe: { last: ReturnType<typeof useDirectEditStack> | null } = { last: null };
    render(
      withProvider(
        <>
          <StackProbe out={probe} />
          <DirectEditHostBridge
            lang="en"
            sceneAdapter={adapter}
            viewportRaycastRef={handleRef}
            initialMode="move-body"
          />
        </>,
      ),
    );

    act(() =>
      handleRef.current!.applyTransform({ kind: 'move', translation: [10, 0, 0] }),
    );

    expect(adapter.replaceCalls.length).toBe(1);
    expect(adapter.replaceCalls[0].id).toBe('primary');
    expect(probe.last?.ops.length).toBe(1);
    const op = probe.last!.ops[0];
    expect(op.kind).toBe('moveBody');
    if (op.kind === 'moveBody') {
      expect(op.translation).toEqual([10, 0, 0]);
      expect(op.bodyId).toBe('primary');
    }
  });

  it('applyTransform(rotate) in rotate-body mode → applyRotateBody + scene + pushOp', () => {
    const adapter = makePrimaryAdapter(makeStampedSquare('top'));
    const handleRef = createRef<DirectEditViewportHandle>();
    const probe: { last: ReturnType<typeof useDirectEditStack> | null } = { last: null };
    render(
      withProvider(
        <>
          <StackProbe out={probe} />
          <DirectEditHostBridge
            lang="en"
            sceneAdapter={adapter}
            viewportRaycastRef={handleRef}
            initialMode="rotate-body"
          />
        </>,
      ),
    );

    act(() =>
      handleRef.current!.applyTransform({
        kind: 'rotate',
        rotation: {
          axis: [0, 1, 0],
          angleRad: Math.PI / 2,
          pivot: [0, 0, 0],
        },
      }),
    );

    expect(adapter.replaceCalls.length).toBe(1);
    expect(probe.last?.ops.length).toBe(1);
    const op = probe.last!.ops[0];
    expect(op.kind).toBe('rotateBody');
    if (op.kind === 'rotateBody') {
      expect(op.rotation.angleRad).toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it('mode/payload mismatch (move payload while rotate-body) is a no-op', () => {
    const adapter = makePrimaryAdapter(makeStampedSquare('top'));
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="rotate-body"
        />,
      ),
    );

    act(() =>
      handleRef.current!.applyTransform({ kind: 'move', translation: [5, 0, 0] }),
    );
    expect(adapter.replaceCalls).toEqual([]);
  });

  it('move with NaN translation → notify warn, no scene change', () => {
    const adapter = makePrimaryAdapter(makeStampedSquare('top'));
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="move-body"
        />,
      ),
    );

    act(() =>
      handleRef.current!.applyTransform({
        kind: 'move',
        translation: [Number.NaN, 0, 0],
      }),
    );

    expect(adapter.replaceCalls).toEqual([]);
    expect(adapter.notifyCalls.some((n) => n.level === 'warn')).toBe(true);
  });
});

// ─── E2 fillet / chamfer dispatch ───────────────────────────────────────────

describe('DirectEditHostBridge — dynamic edge (E2) dispatch', () => {
  it('pickEdge in fillet-edge mode dispatches to fillet applier (rejected → notify warn)', () => {
    // The stamped square fixture has no two-face dihedral so the
    // dynamic fillet applier rejects — but the bridge MUST still
    // route the pick (warn fired, no scene change, no pushOp).
    const adapter = makePrimaryAdapter(makeStampedSquare('top'));
    const handleRef = createRef<DirectEditViewportHandle>();
    const probe: { last: ReturnType<typeof useDirectEditStack> | null } = { last: null };
    render(
      withProvider(
        <>
          <StackProbe out={probe} />
          <DirectEditHostBridge
            lang="en"
            sceneAdapter={adapter}
            viewportRaycastRef={handleRef}
            initialMode="fillet-edge"
          />
        </>,
      ),
    );

    act(() => handleRef.current!.pickEdge('e:0,0,0|10,0,0'));

    expect(adapter.replaceCalls).toEqual([]);
    expect(probe.last?.ops.length).toBe(0);
    expect(adapter.notifyCalls.some((n) => n.level === 'warn')).toBe(true);
  });

  it('pickEdge while mode is push-pull is silently ignored', () => {
    const adapter = makePrimaryAdapter(makeStampedSquare('top'));
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="push-pull"
        />,
      ),
    );

    act(() => handleRef.current!.pickEdge('e:0,0,0|10,0,0'));
    // No warn fires because the bridge no-ops the wrong-mode edge pick.
    expect(adapter.replaceCalls).toEqual([]);
    expect(adapter.notifyCalls).toEqual([]);
  });
});

// ─── Notify on applier rejection path (all ops) ─────────────────────────────

describe('DirectEditHostBridge — applier rejection notifies', () => {
  it('push-pull body lookup miss → notify error', () => {
    const adapter = makePrimaryAdapter(makeStampedSquare('top'), {
      getTargetGeometry: () => null,
    });
    const handleRef = createRef<DirectEditViewportHandle>();
    render(
      withProvider(
        <DirectEditHostBridge
          lang="en"
          sceneAdapter={adapter}
          viewportRaycastRef={handleRef}
          initialMode="push-pull"
        />,
      ),
    );

    act(() => handleRef.current!.pickFace('top'));

    expect(adapter.replaceCalls).toEqual([]);
    expect(adapter.notifyCalls.some((n) => n.level === 'error' && n.msg.includes('not found'))).toBe(true);
  });
});
