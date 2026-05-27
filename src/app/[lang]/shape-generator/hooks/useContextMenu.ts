'use client';

/**
 * useContextMenu — owns the right-click / long-press context-menu state and
 * its open/close primitives.
 *
 * Extracted from the ShapeGeneratorInner monolith. The item-building logic
 * (which menu entries to show for the current selection) stays in the host
 * because it depends on CAD state; this hook just owns the position +
 * visibility + items state and the two transitions, so callers replace
 * ad-hoc `setCtxMenu({...})` writes with intent-named helpers.
 */

import { useCallback, useState } from 'react';
import type { ContextMenuItem } from '../ContextMenu';

export interface ContextMenuState {
  x: number;
  y: number;
  visible: boolean;
  items: ContextMenuItem[];
}

export interface ContextMenuController {
  ctxMenu: ContextMenuState;
  openContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  closeContextMenu: () => void;
}

export function useContextMenu(): ContextMenuController {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({ x: 0, y: 0, visible: false, items: [] });

  const openContextMenu = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    setCtxMenu({ x, y, visible: true, items });
  }, []);

  const closeContextMenu = useCallback(() => {
    setCtxMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  return { ctxMenu, openContextMenu, closeContextMenu };
}
