/** @vitest-environment jsdom */
/**
 * ContextMenu (right-click) viewport wiring regression.
 *
 * Pins the contracts the host's viewport right-click depends on:
 *
 *  1. ContextMenu does NOT render at default state (no right-click yet).
 *  2. Right-click in face mode + a face selection → menu renders with the
 *     face-specific items at the top (offset / shell / push-pull / sketch
 *     from face / create-mate / extrude / ask-ai). Items appear via the
 *     deterministic `getContextItemsGeometry({ selectedType: 'face' })` path.
 *  3. Clicking an item fires the host's `onSelect(id)` dispatcher with the
 *     correct id, and the menu closes (mirroring production where
 *     `handleContextSelect` ends with `closeContextMenu()`).
 *  4. Esc closes the menu (the component subscribes to keydown when visible).
 *  5. Clicking outside closes the menu (mousedown handler with capture).
 *  6. Edge mode renders edge items (fillet / chamfer / measure / ask-ai),
 *     vertex mode renders vertex items (move / snap-grid / measure / ask-ai).
 *
 * The full ShapeGeneratorInner host pulls in Three.js, R3F, OCCT and a
 * dozen contexts — impractical in jsdom. This harness mirrors the actual
 * wiring (ShapeGeneratorInner.tsx handleContextMenu at lines 5638-5670 and
 * the SketchInputCluster ContextMenu mount). If ContextMenu or the items
 * builder change their contract this test catches it before the host breaks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState, useCallback } from 'react';
import ContextMenu, {
  getContextItemsGeometry,
  type ContextMenuItem,
} from '@/app/[lang]/shape-generator/ContextMenu';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

interface CtxState {
  x: number;
  y: number;
  visible: boolean;
  items: ContextMenuItem[];
}

/**
 * Minimal harness mirroring ShapeGeneratorInner's right-click wiring:
 *   - A viewport div with onContextMenu → builds geometry items keyed by
 *     `selectedType` and opens the menu at cursor coords (matches
 *     ShapeGeneratorInner lines 5638-5670).
 *   - The same shared `onSelect` / `onClose` callbacks the production
 *     SketchInputCluster threads in.
 *
 * Keep in sync with ShapeGeneratorInner.tsx (handleContextMenu) and
 * panels/SketchInputCluster.tsx (ContextMenu mount).
 */
function HostHarness({
  selectedType,
  onSelect,
  hasAssembly = false,
}: {
  selectedType: 'face' | 'edge' | 'vertex' | 'body' | null;
  onSelect?: (id: string) => void;
  hasAssembly?: boolean;
}) {
  const [ctxMenu, setCtxMenu] = useState<CtxState>({ x: 0, y: 0, visible: false, items: [] });

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const items = getContextItemsGeometry('en', { selectedType, hasAssembly });
    setCtxMenu({ x: e.clientX, y: e.clientY, visible: true, items });
  }, [selectedType, hasAssembly]);

  const handleClose = useCallback(() => {
    setCtxMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleSelect = useCallback((id: string) => {
    onSelect?.(id);
  }, [onSelect]);

  return (
    <div>
      <div
        data-testid="viewport"
        style={{ width: 400, height: 300 }}
        onContextMenu={handleContextMenu}
      >
        viewport
      </div>
      <button data-testid="outside-button">outside</button>
      <ContextMenu
        x={ctxMenu.x}
        y={ctxMenu.y}
        visible={ctxMenu.visible}
        items={ctxMenu.items}
        onSelect={handleSelect}
        onClose={handleClose}
      />
    </div>
  );
}

describe('ContextMenu viewport wiring', () => {
  it('does not render at default state (no right-click yet)', () => {
    render(<HostHarness selectedType="face" />);
    expect(screen.queryByTestId('context-menu-overlay')).toBeNull();
  });

  it('right-click in face mode + face selection renders face-specific items', () => {
    render(<HostHarness selectedType="face" hasAssembly />);
    fireEvent.contextMenu(screen.getByTestId('viewport'), { clientX: 50, clientY: 50 });

    expect(screen.getByTestId('context-menu-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-item-action-extrude')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-item-face-offset')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-item-face-shell')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-item-face-pushpull')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-item-face-sketch-from')).toBeInTheDocument();
    // Mate item only renders when hasAssembly
    expect(screen.getByTestId('context-menu-item-face-create-mate')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-item-action-ask-ai')).toBeInTheDocument();
  });

  it('does NOT show create-mate when there is no assembly (single body)', () => {
    render(<HostHarness selectedType="face" hasAssembly={false} />);
    fireEvent.contextMenu(screen.getByTestId('viewport'), { clientX: 50, clientY: 50 });
    expect(screen.queryByTestId('context-menu-item-face-create-mate')).toBeNull();
    // But offset/shell are still present (no assembly gate)
    expect(screen.getByTestId('context-menu-item-face-offset')).toBeInTheDocument();
  });

  it('right-click in edge mode renders edge-specific items', () => {
    render(<HostHarness selectedType="edge" />);
    fireEvent.contextMenu(screen.getByTestId('viewport'), { clientX: 50, clientY: 50 });

    expect(screen.getByTestId('context-menu-item-action-fillet')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-item-edge-chamfer')).toBeInTheDocument();
    // `measure` lives in the always-present block — present here too.
    expect(screen.getByTestId('context-menu-item-measure')).toBeInTheDocument();
    // No face-specific items
    expect(screen.queryByTestId('context-menu-item-face-offset')).toBeNull();
    expect(screen.queryByTestId('context-menu-item-face-shell')).toBeNull();
  });

  it('right-click in vertex mode renders vertex-specific items', () => {
    render(<HostHarness selectedType="vertex" />);
    fireEvent.contextMenu(screen.getByTestId('viewport'), { clientX: 50, clientY: 50 });

    expect(screen.getByTestId('context-menu-item-vertex-move')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-item-vertex-snap-grid')).toBeInTheDocument();
    // No face/edge-specific items
    expect(screen.queryByTestId('context-menu-item-face-offset')).toBeNull();
    expect(screen.queryByTestId('context-menu-item-action-fillet')).toBeNull();
  });

  it('clicking an item fires onSelect with the right id and closes the menu', () => {
    const onSelect = vi.fn();
    render(<HostHarness selectedType="face" onSelect={onSelect} />);
    fireEvent.contextMenu(screen.getByTestId('viewport'), { clientX: 50, clientY: 50 });

    fireEvent.click(screen.getByTestId('context-menu-item-face-offset'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('face-offset');
    // Menu closes after select
    expect(screen.queryByTestId('context-menu-overlay')).toBeNull();
  });

  it('Esc closes the menu', () => {
    render(<HostHarness selectedType="face" />);
    fireEvent.contextMenu(screen.getByTestId('viewport'), { clientX: 50, clientY: 50 });
    expect(screen.getByTestId('context-menu-overlay')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('context-menu-overlay')).toBeNull();
  });

  it('clicking outside closes the menu', () => {
    render(<HostHarness selectedType="face" />);
    fireEvent.contextMenu(screen.getByTestId('viewport'), { clientX: 50, clientY: 50 });
    expect(screen.getByTestId('context-menu-overlay')).toBeInTheDocument();

    // The outside-click handler is attached to window mousedown (capture).
    fireEvent.mouseDown(screen.getByTestId('outside-button'));
    expect(screen.queryByTestId('context-menu-overlay')).toBeNull();
  });
});
