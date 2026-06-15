/**
 * @vitest-environment jsdom
 *
 * SubtractBodyOverlay.test.tsx — E4 2-body picker UI.
 *
 * Asserts:
 *  - inactive → renders nothing
 *  - initial state shows "Pick target" prompt
 *  - host-driven pickBody advances state machine: pickTarget →
 *    pickTool → confirm
 *  - self-subtract (same body picked twice) is rejected at pick time
 *  - Apply fires onApply({ targetBodyId, toolBodyId }) + resets state
 *  - Cancel resets state without firing onApply
 *  - resolveBodyLabel customizes the displayed body labels
 */

import React, { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  SubtractBodyOverlay,
  type SubtractBodyOverlayHandle,
} from '../SubtractBodyOverlay';

describe('SubtractBodyOverlay — visibility', () => {
  it('renders nothing when active=false', () => {
    const { container } = render(
      <SubtractBodyOverlay active={false} onApply={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the pickTarget step when active=true', () => {
    render(<SubtractBodyOverlay active={true} onApply={vi.fn()} lang="en" />);
    expect(screen.getByTestId('subtract-body-overlay')).toBeTruthy();
    expect(screen.getByTestId('subtract-step-pickTarget')).toBeTruthy();
    expect(screen.queryByTestId('subtract-step-pickTool')).toBeNull();
    expect(screen.queryByTestId('subtract-step-confirm')).toBeNull();
  });
});

describe('SubtractBodyOverlay — picker state machine', () => {
  it('pickBody (target) → advances to pickTool with target label visible', () => {
    const handleRef = createRef<SubtractBodyOverlayHandle>();
    render(
      <SubtractBodyOverlay active onApply={vi.fn()} testHandleRef={handleRef} />,
    );

    act(() => handleRef.current!.pickBody('Body_A'));

    expect(screen.getByTestId('subtract-step-pickTool')).toBeTruthy();
    expect(screen.getByText('Body_A')).toBeTruthy();
    expect(screen.queryByTestId('subtract-step-pickTarget')).toBeNull();
  });

  it('pickBody (tool) → advances to confirm with both labels visible', () => {
    const handleRef = createRef<SubtractBodyOverlayHandle>();
    render(<SubtractBodyOverlay active onApply={vi.fn()} testHandleRef={handleRef} />);

    act(() => handleRef.current!.pickBody('Body_A'));
    act(() => handleRef.current!.pickBody('Body_B'));

    expect(screen.getByTestId('subtract-step-confirm')).toBeTruthy();
    expect(screen.getByTestId('subtract-apply')).toBeTruthy();
    expect(screen.getByTestId('subtract-cancel')).toBeTruthy();
  });

  it('self-subtract (same id twice) is rejected — stays in pickTool', () => {
    const handleRef = createRef<SubtractBodyOverlayHandle>();
    render(<SubtractBodyOverlay active onApply={vi.fn()} testHandleRef={handleRef} />);

    act(() => handleRef.current!.pickBody('Body_A'));
    act(() => handleRef.current!.pickBody('Body_A')); // self-subtract

    // Still on pickTool — second click rejected.
    expect(screen.getByTestId('subtract-step-pickTool')).toBeTruthy();
    expect(screen.queryByTestId('subtract-step-confirm')).toBeNull();
  });

  it('reset() returns to pickTarget state', () => {
    const handleRef = createRef<SubtractBodyOverlayHandle>();
    render(<SubtractBodyOverlay active onApply={vi.fn()} testHandleRef={handleRef} />);

    act(() => handleRef.current!.pickBody('Body_A'));
    act(() => handleRef.current!.reset());

    expect(screen.getByTestId('subtract-step-pickTarget')).toBeTruthy();
    expect(screen.queryByTestId('subtract-step-pickTool')).toBeNull();
  });

  it('further picks in confirm state are ignored until Apply/Cancel', () => {
    const handleRef = createRef<SubtractBodyOverlayHandle>();
    render(<SubtractBodyOverlay active onApply={vi.fn()} testHandleRef={handleRef} />);

    act(() => handleRef.current!.pickBody('Body_A'));
    act(() => handleRef.current!.pickBody('Body_B'));
    // Already in confirm state — extra pick is no-op.
    act(() => handleRef.current!.pickBody('Body_C'));

    // Still in confirm with original A/B pair.
    expect(screen.getByTestId('subtract-step-confirm')).toBeTruthy();
  });
});

describe('SubtractBodyOverlay — apply + cancel', () => {
  it('Apply fires onApply({ targetBodyId, toolBodyId }) + resets state', () => {
    const handleRef = createRef<SubtractBodyOverlayHandle>();
    const onApply = vi.fn();
    render(<SubtractBodyOverlay active onApply={onApply} testHandleRef={handleRef} />);

    act(() => handleRef.current!.pickBody('Target'));
    act(() => handleRef.current!.pickBody('Tool'));

    act(() => {
      fireEvent.click(screen.getByTestId('subtract-apply'));
    });

    expect(onApply).toHaveBeenCalledWith({ targetBodyId: 'Target', toolBodyId: 'Tool' });
    // State resets to pickTarget after a successful Apply.
    expect(screen.getByTestId('subtract-step-pickTarget')).toBeTruthy();
  });

  it('Cancel resets state without firing onApply', () => {
    const handleRef = createRef<SubtractBodyOverlayHandle>();
    const onApply = vi.fn();
    render(<SubtractBodyOverlay active onApply={onApply} testHandleRef={handleRef} />);

    act(() => handleRef.current!.pickBody('Target'));
    act(() => handleRef.current!.pickBody('Tool'));

    act(() => {
      fireEvent.click(screen.getByTestId('subtract-cancel'));
    });

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('subtract-step-pickTarget')).toBeTruthy();
  });
});

describe('SubtractBodyOverlay — label resolver', () => {
  it('resolveBodyLabel customizes the displayed body label', () => {
    const handleRef = createRef<SubtractBodyOverlayHandle>();
    render(
      <SubtractBodyOverlay
        active
        onApply={vi.fn()}
        testHandleRef={handleRef}
        resolveBodyLabel={(id) => `Custom(${id})`}
      />,
    );

    act(() => handleRef.current!.pickBody('Body_1'));
    expect(screen.getByText('Custom(Body_1)')).toBeTruthy();
  });
});
