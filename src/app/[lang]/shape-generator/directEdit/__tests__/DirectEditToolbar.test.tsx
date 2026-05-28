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
import { DirectEditToolbar, type DirectEditMode } from '../DirectEditToolbar';

function Harness({
  enabled,
  initialMode = false,
  lang = 'en',
  prefilled = 0,
}: {
  enabled: boolean;
  initialMode?: boolean;
  lang?: string;
  prefilled?: number;
}) {
  const [mode, setMode] = useState(initialMode);
  return (
    <DirectEditProvider enabled={enabled} historyVersion={0}>
      <Prefill count={prefilled} />
      <DirectEditToolbar
        lang={lang}
        modeActive={mode}
        onModeChange={setMode}
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
});

// ─── E3 union-API tests (mode={DirectEditMode}) ─────────────────────────────

function ModeHarness({
  enabled,
  initialMode = 'off' as DirectEditMode,
  lang = 'en',
}: {
  enabled: boolean;
  initialMode?: DirectEditMode;
  lang?: string;
}) {
  const [mode, setMode] = useState<DirectEditMode>(initialMode);
  return (
    <DirectEditProvider enabled={enabled} historyVersion={0}>
      <DirectEditToolbar
        lang={lang}
        mode={mode}
        onModeSelect={setMode}
      />
    </DirectEditProvider>
  );
}

describe('DirectEditToolbar — E3 mode union', () => {
  it('renders move-body + rotate-body buttons when mode prop is provided', () => {
    const { getByTestId } = render(<ModeHarness enabled={true} />);
    expect(getByTestId('direct-edit-move-body')).toBeTruthy();
    expect(getByTestId('direct-edit-rotate-body')).toBeTruthy();
  });

  it('clicking move-body activates move-body mode (aria-pressed flips)', () => {
    const { getByTestId } = render(<ModeHarness enabled={true} />);
    const btn = getByTestId('direct-edit-move-body');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    act(() => { fireEvent.click(btn); });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('selecting one mode deactivates the others (radio semantics)', () => {
    const { getByTestId } = render(<ModeHarness enabled={true} />);
    const move = getByTestId('direct-edit-move-body');
    const rot = getByTestId('direct-edit-rotate-body');
    act(() => { fireEvent.click(move); });
    expect(move.getAttribute('aria-pressed')).toBe('true');
    act(() => { fireEvent.click(rot); });
    expect(move.getAttribute('aria-pressed')).toBe('false');
    expect(rot.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking the active mode deselects (returns to off)', () => {
    const { getByTestId } = render(<ModeHarness enabled={true} initialMode="move-body" />);
    const move = getByTestId('direct-edit-move-body');
    expect(move.getAttribute('aria-pressed')).toBe('true');
    act(() => { fireEvent.click(move); });
    expect(move.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the mode status hint for move-body (EN)', () => {
    const { getByTestId, queryByTestId } = render(
      <ModeHarness enabled={true} initialMode="move-body" />,
    );
    expect(queryByTestId('direct-edit-mode-status')).not.toBeNull();
    expect(getByTestId('direct-edit-mode-status').textContent).toContain('Move');
  });

  it('renders Korean labels for E3 modes when lang=ko', () => {
    const { getByTestId } = render(<ModeHarness enabled={true} lang="ko" />);
    expect(getByTestId('direct-edit-move-body').textContent).toContain('바디 이동');
    expect(getByTestId('direct-edit-rotate-body').textContent).toContain('바디 회전');
  });

  it('hides the E3 mode buttons when host uses legacy boolean API (back-compat)', () => {
    function LegacyHarness() {
      const [active, setActive] = useState(false);
      return (
        <DirectEditProvider enabled={true} historyVersion={0}>
          <DirectEditToolbar
            modeActive={active}
            onModeChange={setActive}
          />
        </DirectEditProvider>
      );
    }
    const { queryByTestId } = render(<LegacyHarness />);
    expect(queryByTestId('direct-edit-move-body')).toBeNull();
    expect(queryByTestId('direct-edit-rotate-body')).toBeNull();
  });
});
