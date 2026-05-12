import { create } from 'zustand'
import type { ElementSelectionInfo, FaceSelectionInfo } from '../editing/selectionInfo'

/**
 * Step 1 of the MainWorkspace decomposition plan
 * (docs/strategy/mainworkspace-decomposition.md).
 *
 * Moves the canvas selection state out of `ShapeGeneratorInner.tsx` local
 * useState into a Zustand store so future steps can extract pieces of the
 * canvas without dragging 60+ props through the tree.
 *
 * Behavior is identical to the prior useState: callers read
 * `selectedElement` / `mateFaceA` and call the same setters.
 */
interface SelectionState {
  selectedElement: ElementSelectionInfo | null
  mateFaceA: FaceSelectionInfo | null
}

// Matches React's setState signature: accept either a new value or an
// updater function that receives the current value. The Inner.tsx call
// sites use the functional form for shift-click multi-select accumulation.
type SetSelected = (
  next: ElementSelectionInfo | null | ((prev: ElementSelectionInfo | null) => ElementSelectionInfo | null)
) => void
type SetMateFace = (
  next: FaceSelectionInfo | null | ((prev: FaceSelectionInfo | null) => FaceSelectionInfo | null)
) => void

interface SelectionActions {
  setSelectedElement: SetSelected
  setMateFaceA: SetMateFace
  clear: () => void
}

type SelectionStore = SelectionState & SelectionActions

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectedElement: null,
  mateFaceA: null,
  setSelectedElement: (next) =>
    set((state) => ({
      selectedElement:
        typeof next === 'function' ? next(state.selectedElement) : next,
    })),
  setMateFaceA: (next) =>
    set((state) => ({
      mateFaceA:
        typeof next === 'function' ? next(state.mateFaceA) : next,
    })),
  clear: () => set({ selectedElement: null, mateFaceA: null }),
}))
