// @vitest-environment jsdom
/**
 * CommitToHistoryButton.test.tsx — Wave 2 Phase 3 Track E5 (W7).
 *
 * Tests for the commit-to-history button + modal flow.
 *
 * Coverage:
 *   - Hidden when flag is OFF
 *   - Hidden when stack is empty (even with flag ON)
 *   - Visible when flag ON + stack non-empty
 *   - Clicking the button opens the confirm modal
 *   - "Cancel" closes the modal without committing
 *   - "Commit" with all-pushPull appends N nodes + clears stack + toast
 *   - "Commit" with a reserved-op failure opens the partial chooser
 *   - "Commit partial" appends the prefix and shifts the stack
 *   - i18n: KR label renders Korean text
 *   - Commit toast fires the CustomEvent when no emitToast prop is given
 */

import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import {
  DirectEditProvider,
  useDirectEditController,
} from '../DirectEditController';
import { CommitToHistoryButton, COMMIT_TO_HISTORY_TOAST_EVENT } from '../CommitToHistoryButton';
import type { DirectEditOp } from '../directEditTypes';
import type { HistoryNode } from '../../useFeatureStack';

function Prefill({ ops }: { ops: DirectEditOp[] }) {
  const { pushOp } = useDirectEditController();
  React.useEffect(() => {
    for (const op of ops) pushOp(op);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

interface HarnessProps {
  enabled: boolean;
  ops?: DirectEditOp[];
  lang?: string;
  onAppend?: (nodes: HistoryNode[]) => void;
  emitToast?: (msg: string) => void;
}

function Harness({
  enabled,
  ops = [],
  lang = 'en',
  onAppend,
  emitToast,
}: HarnessProps) {
  const [appended, setAppended] = useState<HistoryNode[]>([]);
  const handleAppend = (nodes: HistoryNode[]) => {
    setAppended(prev => [...prev, ...nodes]);
    onAppend?.(nodes);
  };
  return (
    <DirectEditProvider enabled={enabled} historyVersion={0}>
      <Prefill ops={ops} />
      <CommitToHistoryButton
        lang={lang}
        getFaceFeatureId={() => 'owner-1'}
        activeNodeId="root"
        nextNodeId={(() => {
          let i = 0;
          return () => `node-${++i}`;
        })()}
        appendHistoryNodes={handleAppend}
        {...(emitToast ? { emitToast } : {})}
      />
      <span data-testid="appended-count">{appended.length}</span>
    </DirectEditProvider>
  );
}

function pp(offset: number, faceId = 'face'): DirectEditOp {
  return { kind: 'pushPull', faceId, offsetMm: offset, createdAt: 0 };
}

describe('CommitToHistoryButton — visibility', () => {
  it('renders nothing when flag is OFF', () => {
    const { queryByTestId } = render(<Harness enabled={false} ops={[pp(5)]} />);
    expect(queryByTestId('direct-edit-commit-button')).toBeNull();
  });

  it('renders nothing when stack is empty (flag ON)', () => {
    const { queryByTestId } = render(<Harness enabled={true} ops={[]} />);
    expect(queryByTestId('direct-edit-commit-button')).toBeNull();
  });

  it('renders the button when flag ON + non-empty stack', () => {
    const { getByTestId } = render(
      <Harness enabled={true} ops={[pp(5)]} />,
    );
    expect(getByTestId('direct-edit-commit-button')).toBeTruthy();
  });

  it('renders Korean label when lang=ko', () => {
    const { getByTestId } = render(
      <Harness enabled={true} ops={[pp(5)]} lang="ko" />,
    );
    expect(getByTestId('direct-edit-commit-button').textContent).toBe('히스토리에 적용');
  });
});

describe('CommitToHistoryButton — confirm modal', () => {
  it('clicking the button opens the confirm modal', () => {
    const { getByTestId, queryByTestId } = render(
      <Harness enabled={true} ops={[pp(5)]} />,
    );
    expect(queryByTestId('direct-edit-commit-modal')).toBeNull();
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    expect(getByTestId('direct-edit-commit-modal')).toBeTruthy();
  });

  it('modal body shows the op count', () => {
    const { getByTestId } = render(
      <Harness enabled={true} ops={[pp(1), pp(2), pp(3)]} />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    expect(getByTestId('direct-edit-commit-modal-body').textContent).toContain('3');
  });

  it('clicking Cancel closes the modal without committing', () => {
    const onAppend = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <Harness enabled={true} ops={[pp(5)]} onAppend={onAppend} />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-cancel')); });
    expect(queryByTestId('direct-edit-commit-modal')).toBeNull();
    expect(onAppend).not.toHaveBeenCalled();
  });
});

describe('CommitToHistoryButton — full success commit', () => {
  it('clicking Commit appends nodes and closes the modal', () => {
    const onAppend = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <Harness
        enabled={true}
        ops={[pp(1), pp(2)]}
        onAppend={onAppend}
      />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-confirm')); });
    expect(queryByTestId('direct-edit-commit-modal')).toBeNull();
    expect(onAppend).toHaveBeenCalledTimes(1);
    const nodes = onAppend.mock.calls[0]![0] as HistoryNode[];
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.params.offsetMm).toBe(1);
    expect(nodes[1]!.params.offsetMm).toBe(2);
  });

  it('after a successful commit the button hides (stack empty)', () => {
    const { getByTestId, queryByTestId } = render(
      <Harness enabled={true} ops={[pp(5)]} />,
    );
    expect(getByTestId('direct-edit-commit-button')).toBeTruthy();
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-confirm')); });
    expect(queryByTestId('direct-edit-commit-button')).toBeNull();
  });

  it('emits the success toast via emitToast prop', () => {
    const emitToast = vi.fn();
    const { getByTestId } = render(
      <Harness enabled={true} ops={[pp(5), pp(7)]} emitToast={emitToast} />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-confirm')); });
    expect(emitToast).toHaveBeenCalledTimes(1);
    expect(emitToast.mock.calls[0]![0]).toContain('2');
  });

  it('emits the CustomEvent when no emitToast is provided', () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => { events.push(e as CustomEvent); };
    window.addEventListener(COMMIT_TO_HISTORY_TOAST_EVENT, listener);
    try {
      const { getByTestId } = render(
        <Harness enabled={true} ops={[pp(5)]} />,
      );
      act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
      act(() => { fireEvent.click(getByTestId('direct-edit-commit-confirm')); });
      expect(events).toHaveLength(1);
      expect(events[0]!.detail.appended).toBe(1);
      expect(events[0]!.detail.remaining).toBe(0);
    } finally {
      window.removeEventListener(COMMIT_TO_HISTORY_TOAST_EVENT, listener);
    }
  });
});

describe('CommitToHistoryButton — partial-commit flow', () => {
  it('on rejection the partial modal opens', () => {
    const { getByTestId, queryByTestId } = render(
      <Harness
        enabled={true}
        ops={[
          pp(1),
          pp(2),
          { kind: 'unknownTestKind' } as unknown as DirectEditOp,
          pp(4),
        ]}
      />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    expect(queryByTestId('direct-edit-commit-modal-partial')).toBeNull();
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-confirm')); });
    expect(getByTestId('direct-edit-commit-modal-partial')).toBeTruthy();
  });

  it('partial-modal body reports the committed/total ratio and the reason', () => {
    const { getByTestId } = render(
      <Harness
        enabled={true}
        ops={[
          pp(1),
          pp(2),
          { kind: 'unknownTestKind' } as unknown as DirectEditOp,
        ]}
      />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-confirm')); });
    const body = getByTestId('direct-edit-commit-modal-partial-body').textContent ?? '';
    expect(body).toContain('2');
    expect(body).toContain('3');
    expect(body.toLowerCase()).toContain('unknown');
  });

  it('clicking "Commit partial" appends the prefix only', () => {
    const onAppend = vi.fn();
    const { getByTestId } = render(
      <Harness
        enabled={true}
        ops={[
          pp(1),
          pp(2),
          { kind: 'unknownTestKind' } as unknown as DirectEditOp,
          pp(4),
        ]}
        onAppend={onAppend}
      />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-confirm')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-partial')); });
    expect(onAppend).toHaveBeenCalledTimes(1);
    const nodes = onAppend.mock.calls[0]![0] as HistoryNode[];
    expect(nodes).toHaveLength(2);
    expect(nodes.map(n => n.params.offsetMm)).toEqual([1, 2]);
  });

  it('after partial commit the button stays visible (stack non-empty)', () => {
    const { getByTestId, queryByTestId } = render(
      <Harness
        enabled={true}
        ops={[
          pp(1),
          { kind: 'unknownTestKind' } as unknown as DirectEditOp,
          pp(3),
        ]}
      />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-confirm')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-partial')); });
    // Stack still has the failing op + the post-failure ops.
    expect(queryByTestId('direct-edit-commit-button')).toBeTruthy();
  });

  it('Cancel from the partial modal does not commit', () => {
    const onAppend = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <Harness
        enabled={true}
        ops={[pp(1), { kind: 'unknownTestKind' } as unknown as DirectEditOp]}
        onAppend={onAppend}
      />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-confirm')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-cancel')); });
    expect(queryByTestId('direct-edit-commit-modal-partial')).toBeNull();
    expect(onAppend).not.toHaveBeenCalled();
  });

  it('when the very first op fails partial-commit button is disabled', () => {
    const { getByTestId } = render(
      <Harness
        enabled={true}
        ops={[{ kind: 'unknownTestKind' } as unknown as DirectEditOp, pp(2)]}
      />,
    );
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-button')); });
    act(() => { fireEvent.click(getByTestId('direct-edit-commit-confirm')); });
    const btn = getByTestId('direct-edit-commit-partial') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
