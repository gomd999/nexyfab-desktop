// @vitest-environment jsdom
/**
 * DirectEditToolbar.test.tsx — Wave 2 Phase 3 Track E1.
 *
 * Tests:
 *   - Flag-OFF: renders nothing
 *   - Flag-ON: renders mode/undo/clear/status
 *   - Mode toggle button calls onModeChange with negated value
 *   - Undo button calls popOp
 *   - Clear button calls clearStack('manual')
 *   - Undo + Clear disabled when stack is empty
 *   - Status shows "no direct edits" when empty
 *   - Status shows the count when non-empty
 */

import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { DirectEditProvider, useDirectEditController } from '../DirectEditController';
import { DirectEditToolbar, type DirectEditSubMode } from '../DirectEditToolbar';

function Harness({
  enabled,
  initialMode = false,
  lang = 'en',
  prefilled = 0,
  withSubModes = false,
}: {
  enabled: boolean;
  initialMode?: boolean;
  lang?: string;
  prefilled?: number;
  withSubModes?: boolean;
}) {
  const [mode, setMode] = useState(initialMode);
  const [subMode, setSubMode] = useState<DirectEditSubMode>('push-pull');
  return (
    <DirectEditProvider enabled={enabled} historyVersion={0}>
      <Prefill count={prefilled} />
      <DirectEditToolbar
        lang={lang}
        modeActive={mode}
        onModeChange={setMode}
        subMode={withSubModes ? subMode : undefined}
        onSubModeChange={withSubModes ? setSubMode : undefined}
      />
    </DirectEditProvider>
  );
}

function Prefill({ count }: { count: number }) {
  const { pushOp } = useDirectEditController();
  // Push N ops on first render.
  React.useEffect(() => {
    for (let i = 0; i < count; i++) {
      pushOp({
        kind: 'pushPull',
        faceId: `face-${i}`,
        offsetMm: 1,
        createdAt: i,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe('DirectEditToolbar', () => {
  it('renders nothing when flag is OFF', () => {
    const { queryByTestId } = render(<Harness enabled={false} />);
    expect(queryByTestId('direct-edit-toolbar')).toBeNull();
  });

  it('renders the toolbar when flag is ON', () => {
    const { getByTestId } = render(<Harness enabled={true} />);
    expect(getByTestId('direct-edit-toolbar')).toBeTruthy();
    expect(getByTestId('direct-edit-mode-toggle')).toBeTruthy();
    expect(getByTestId('direct-edit-undo')).toBeTruthy();
    expect(getByTestId('direct-edit-clear-all')).toBeTruthy();
    expect(getByTestId('direct-edit-status')).toBeTruthy();
  });

  it('clicking mode toggle activates the mode (host state flips)', () => {
    const { getByTestId } = render(<Harness enabled={true} />);
    const btn = getByTestId('direct-edit-mode-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('undo button is disabled when stack is empty', () => {
    const { getByTestId } = render(<Harness enabled={true} />);
    const undo = getByTestId('direct-edit-undo') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
  });

  it('clear button is disabled when stack is empty', () => {
    const { getByTestId } = render(<Harness enabled={true} />);
    const clear = getByTestId('direct-edit-clear-all') as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
  });

  it('status shows "No direct edits" when empty (EN)', () => {
    const { getByTestId } = render(<Harness enabled={true} lang="en" />);
    expect(getByTestId('direct-edit-status').textContent).toBe('No direct edits');
  });

  it('status shows count when non-empty (EN, 2 ops)', () => {
    const { getByTestId } = render(<Harness enabled={true} prefilled={2} />);
    expect(getByTestId('direct-edit-status').textContent).toContain('2');
    expect(getByTestId('direct-edit-status').textContent).toContain('direct edit');
  });

  it('clicking undo pops the last op', () => {
    const { getByTestId } = render(<Harness enabled={true} prefilled={3} />);
    const status = getByTestId('direct-edit-status');
    expect(status.textContent).toContain('3');
    const undo = getByTestId('direct-edit-undo');
    act(() => { fireEvent.click(undo); });
    expect(status.textContent).toContain('2');
  });

  it('clicking clear empties the stack', () => {
    const { getByTestId } = render(<Harness enabled={true} prefilled={3} />);
    const clear = getByTestId('direct-edit-clear-all');
    act(() => { fireEvent.click(clear); });
    const status = getByTestId('direct-edit-status');
    expect(status.textContent).toBe('No direct edits');
  });

  it('renders Korean label when lang=ko', () => {
    const { getByTestId } = render(<Harness enabled={true} lang="ko" />);
    expect(getByTestId('direct-edit-mode-toggle').textContent).toContain('직접편집');
  });

  // ─── E2 sub-mode selector ────────────────────────────────────────────────

  it('does NOT render sub-mode selector when onSubModeChange is absent', () => {
    const { queryByTestId } = render(
      <Harness enabled={true} initialMode={true} withSubModes={false} />,
    );
    expect(queryByTestId('direct-edit-submode-group')).toBeNull();
  });

  it('does NOT render sub-mode selector when mode is inactive', () => {
    const { queryByTestId } = render(
      <Harness enabled={true} initialMode={false} withSubModes={true} />,
    );
    expect(queryByTestId('direct-edit-submode-group')).toBeNull();
  });

  it('renders the three sub-mode buttons when active + provider is set', () => {
    const { getByTestId } = render(
      <Harness enabled={true} initialMode={true} withSubModes={true} />,
    );
    expect(getByTestId('direct-edit-submode-group')).toBeTruthy();
    expect(getByTestId('direct-edit-submode-push-pull')).toBeTruthy();
    expect(getByTestId('direct-edit-submode-dynamic-fillet')).toBeTruthy();
    expect(getByTestId('direct-edit-submode-dynamic-chamfer')).toBeTruthy();
  });

  it('defaults to push-pull sub-mode active', () => {
    const { getByTestId } = render(
      <Harness enabled={true} initialMode={true} withSubModes={true} />,
    );
    expect(getByTestId('direct-edit-submode-push-pull').getAttribute('aria-checked')).toBe('true');
    expect(getByTestId('direct-edit-submode-dynamic-fillet').getAttribute('aria-checked')).toBe('false');
    expect(getByTestId('direct-edit-submode-dynamic-chamfer').getAttribute('aria-checked')).toBe('false');
  });

  it('clicking dynamic-fillet sub-mode flips the radio group', () => {
    const { getByTestId } = render(
      <Harness enabled={true} initialMode={true} withSubModes={true} />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-submode-dynamic-fillet')); });
    expect(getByTestId('direct-edit-submode-dynamic-fillet').getAttribute('aria-checked')).toBe('true');
    expect(getByTestId('direct-edit-submode-push-pull').getAttribute('aria-checked')).toBe('false');
  });

  it('clicking dynamic-chamfer flips to chamfer, leaving others inactive', () => {
    const { getByTestId } = render(
      <Harness enabled={true} initialMode={true} withSubModes={true} />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-submode-dynamic-chamfer')); });
    expect(getByTestId('direct-edit-submode-dynamic-chamfer').getAttribute('aria-checked')).toBe('true');
    expect(getByTestId('direct-edit-submode-dynamic-fillet').getAttribute('aria-checked')).toBe('false');
    expect(getByTestId('direct-edit-submode-push-pull').getAttribute('aria-checked')).toBe('false');
  });

  it('sub-mode group has role=radiogroup with aria-label', () => {
    const { getByTestId } = render(
      <Harness enabled={true} initialMode={true} withSubModes={true} />,
    );
    const group = getByTestId('direct-edit-submode-group');
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders Japanese sub-mode labels when lang=ja', () => {
    const { getByTestId } = render(
      <Harness enabled={true} initialMode={true} withSubModes={true} lang="ja" />,
    );
    expect(getByTestId('direct-edit-submode-dynamic-fillet').textContent)
      .toContain('ダイナミック');
  });
});
