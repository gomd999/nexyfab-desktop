// @vitest-environment jsdom
/**
 * DirectEditController.test.tsx — Wave 2 Phase 3 Track E1.
 *
 * Tests:
 *   - Stack lifecycle: push/pop/clear
 *   - Flag-OFF: pushOp warns + no-ops
 *   - History-rerun: stack clears + custom event fires
 *   - Empty stack on initial mount
 *   - clearStack(reason='manual') does not fire the toast event
 *   - clearStack(reason='historyRerun') fires the toast event
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  DirectEditProvider,
  useDirectEditController,
  useDirectEditStack,
  useDirectEditEnabled,
  DIRECT_EDIT_INVALIDATED_EVENT,
  type DirectEditInvalidatedDetail,
} from '../DirectEditController';
import type { DirectEditOp } from '../directEditTypes';

const sampleOp = (faceId = 'face-a', offsetMm = 5): DirectEditOp => ({
  kind: 'pushPull',
  faceId,
  offsetMm,
  createdAt: Date.now(),
});

function makeHarness() {
  // Sink writes through a setter so the react-hooks/immutability rule
  // sees a function call (allowed) instead of direct property write.
  let api: ReturnType<typeof useDirectEditController> | null = null;
  let stack: ReturnType<typeof useDirectEditStack> | null = null;
  let enabled: boolean | null = null;
  const setApi = (a: ReturnType<typeof useDirectEditController>) => { api = a; };
  const setStack = (s: ReturnType<typeof useDirectEditStack>) => { stack = s; };
  const setEnabled = (e: boolean) => { enabled = e; };
  function Reader() {
    setApi(useDirectEditController());
    setStack(useDirectEditStack());
    setEnabled(useDirectEditEnabled());
    return null;
  }
  return {
    Reader,
    get api() { return api!; },
    get stack() { return stack!; },
    get enabled() { return enabled!; },
  };
}

describe('DirectEditProvider — flag ON', () => {
  let toasts: DirectEditInvalidatedDetail[] = [];
  beforeEach(() => {
    toasts = [];
    const listener = (e: Event) => {
      toasts.push((e as CustomEvent<DirectEditInvalidatedDetail>).detail);
    };
    window.addEventListener(DIRECT_EDIT_INVALIDATED_EVENT, listener);
    return () => window.removeEventListener(DIRECT_EDIT_INVALIDATED_EVENT, listener);
  });

  it('initial stack is empty', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    expect(harness.stack.ops).toEqual([]);
    expect(harness.stack.historyVersion).toBe(0);
  });

  it('enabled flag is true', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    expect(harness.enabled).toBe(true);
  });

  it('pushOp appends to the stack', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={1}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('face-a')));
    expect(harness.stack.ops).toHaveLength(1);
    expect(harness.stack.ops[0]).toMatchObject({ kind: 'pushPull', faceId: 'face-a' });
    expect(harness.stack.historyVersion).toBe(1);
  });

  it('pushOp twice keeps order', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('face-a')));
    act(() => harness.api.pushOp(sampleOp('face-b')));
    expect(harness.stack.ops).toHaveLength(2);
    expect((harness.stack.ops[1] as { faceId: string }).faceId).toBe('face-b');
  });

  it('popOp removes the last op', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('face-a')));
    act(() => harness.api.pushOp(sampleOp('face-b')));
    act(() => harness.api.popOp());
    expect(harness.stack.ops).toHaveLength(1);
    expect((harness.stack.ops[0] as { faceId: string }).faceId).toBe('face-a');
  });

  it('popOp on empty stack is a no-op', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.popOp());
    expect(harness.stack.ops).toEqual([]);
  });

  it('clearStack empties the stack', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('face-a')));
    act(() => harness.api.pushOp(sampleOp('face-b')));
    act(() => harness.api.clearStack('manual'));
    expect(harness.stack.ops).toEqual([]);
  });

  it('clearStack(manual) does not emit the toast event', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('face-a')));
    act(() => harness.api.clearStack('manual'));
    expect(toasts).toEqual([]);
  });

  it('clearStack(historyRerun) emits the toast event', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('face-a')));
    act(() => harness.api.pushOp(sampleOp('face-b')));
    act(() => harness.api.clearStack('historyRerun'));
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.clearedCount).toBe(2);
  });

  it('history-version bump invalidates non-empty stack + emits toast', () => {
    const harness = makeHarness();
    const { rerender } = render(
      <DirectEditProvider enabled={true} historyVersion={1}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('face-a')));
    expect(harness.stack.ops).toHaveLength(1);
    // Bump version → controller should clear + toast.
    rerender(
      <DirectEditProvider enabled={true} historyVersion={2}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    expect(harness.stack.ops).toEqual([]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.clearedCount).toBe(1);
    expect(toasts[0]!.newHistoryVersion).toBe(2);
  });

  it('history-version bump on empty stack does NOT emit toast', () => {
    const harness = makeHarness();
    const { rerender } = render(
      <DirectEditProvider enabled={true} historyVersion={1}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    rerender(
      <DirectEditProvider enabled={true} historyVersion={2}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    expect(toasts).toEqual([]);
  });
});

describe('DirectEditProvider — flag OFF', () => {
  it('enabled is false', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={false} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    expect(harness.enabled).toBe(false);
  });

  it('pushOp warns and does not mutate', () => {
    const harness = makeHarness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <DirectEditProvider enabled={false} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('face-a')));
    expect(harness.stack.ops).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('hooks outside provider', () => {
  it('useDirectEditStack returns empty stack with no provider', () => {
    const harness = makeHarness();
    render(<harness.Reader />);
    expect(harness.stack.ops).toEqual([]);
  });

  it('useDirectEditController returns NULL_API with no provider', () => {
    const harness = makeHarness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<harness.Reader />);
    expect(harness.api.enabled).toBe(false);
    act(() => harness.api.pushOp(sampleOp()));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('useDirectEditEnabled returns false with no provider', () => {
    const harness = makeHarness();
    render(<harness.Reader />);
    expect(harness.enabled).toBe(false);
  });
});

// ─── E5 (W7) — shiftOps + beginCommitFlow ───────────────────────────────────

describe('DirectEditProvider — E5 shiftOps', () => {
  it('removes the first N ops from the stack', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('a')));
    act(() => harness.api.pushOp(sampleOp('b')));
    act(() => harness.api.pushOp(sampleOp('c')));
    act(() => harness.api.shiftOps(2));
    expect(harness.stack.ops).toHaveLength(1);
    expect((harness.stack.ops[0] as { faceId: string }).faceId).toBe('c');
  });

  it('no-op when count <= 0', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('a')));
    act(() => harness.api.shiftOps(0));
    expect(harness.stack.ops).toHaveLength(1);
    act(() => harness.api.shiftOps(-1));
    expect(harness.stack.ops).toHaveLength(1);
  });

  it('clamps count to the current stack length', () => {
    const harness = makeHarness();
    render(
      <DirectEditProvider enabled={true} historyVersion={0}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('a')));
    act(() => harness.api.shiftOps(99));
    expect(harness.stack.ops).toEqual([]);
  });
});

describe('DirectEditProvider — E5 beginCommitFlow suppresses toast', () => {
  let toasts: DirectEditInvalidatedDetail[] = [];
  beforeEach(() => {
    toasts = [];
    const listener = (e: Event) => {
      toasts.push((e as CustomEvent<DirectEditInvalidatedDetail>).detail);
    };
    window.addEventListener(DIRECT_EDIT_INVALIDATED_EVENT, listener);
    return () => window.removeEventListener(DIRECT_EDIT_INVALIDATED_EVENT, listener);
  });

  it('history-version bump during a commit flow does NOT emit toast', () => {
    const harness = makeHarness();
    const { rerender } = render(
      <DirectEditProvider enabled={true} historyVersion={1}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    act(() => harness.api.pushOp(sampleOp('a')));
    expect(harness.stack.ops).toHaveLength(1);
    // Open a commit flow before the bump.
    let release: () => void = () => {};
    act(() => { release = harness.api.beginCommitFlow(); });
    rerender(
      <DirectEditProvider enabled={true} historyVersion={2}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    // Stack is cleared but no toast fired.
    expect(harness.stack.ops).toEqual([]);
    expect(toasts).toEqual([]);
    act(() => release());
  });

  it('history-version bump AFTER releasing the commit flow DOES emit toast', () => {
    const harness = makeHarness();
    const { rerender } = render(
      <DirectEditProvider enabled={true} historyVersion={1}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    let release: () => void = () => {};
    act(() => { release = harness.api.beginCommitFlow(); });
    act(() => release());
    act(() => harness.api.pushOp(sampleOp('a')));
    rerender(
      <DirectEditProvider enabled={true} historyVersion={2}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    expect(toasts).toHaveLength(1);
  });

  it('release is idempotent (calling twice does not over-decrement)', () => {
    const harness = makeHarness();
    const { rerender } = render(
      <DirectEditProvider enabled={true} historyVersion={1}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    let r1: () => void = () => {};
    let r2: () => void = () => {};
    act(() => { r1 = harness.api.beginCommitFlow(); });
    act(() => { r2 = harness.api.beginCommitFlow(); });
    act(() => r1());
    act(() => r1()); // duplicate release
    // Counter still > 0 because r2 not yet released.
    act(() => harness.api.pushOp(sampleOp('a')));
    rerender(
      <DirectEditProvider enabled={true} historyVersion={2}>
        <harness.Reader />
      </DirectEditProvider>,
    );
    expect(toasts).toEqual([]);
    act(() => r2());
  });
});
