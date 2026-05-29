/**
 * @vitest-environment jsdom
 *
 * DirectEditHostBridge.test.tsx — E4 host-side integration.
 *
 * Verifies the bridge wires:
 *   - viewport raycast handle → SubtractBodyOverlay.pickBody
 *   - SubtractBodyOverlay.onApply → applySubtractBody → sceneAdapter
 *     (getTargetGeometry / replaceBodyGeometry / removeBodyFromScene)
 *   - mode toggle resets per-mode overlay state
 *   - bridge renders nothing when ?direct-edit=v1 is OFF
 */

import React, { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { render, screen, act } from '@testing-library/react';
import { DirectEditProvider } from '../DirectEditController';
import {
  DirectEditHostBridge,
  type DirectEditViewportHandle,
  type DirectEditSceneAdapter,
} from '../DirectEditHostBridge';

function makeBox(size: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size);
  g.computeVertexNormals();
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
