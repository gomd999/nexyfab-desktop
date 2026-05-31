import { create } from 'zustand'
import type { ElementSelectionInfo, FaceSelectionInfo } from '../editing/selectionInfo'
import type { MateType } from '../assembly/AssemblyMates'

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
 *
 * Phase F (click-to-mate UX) addition: `pendingMate` stages the picked
 * face pair after the user clicks the second face but BEFORE the mate is
 * committed to `assemblyMates`. The MatePickerOverlay reads this and
 * lets the user confirm or override the suggested mate type; on apply
 * the overlay clears `pendingMate` and the existing onMateCreated path
 * runs unchanged (single point of truth for assembly mutation).
 */

/**
 * Mate types the click-to-mate UX exposes. A subset of the full
 * `MateType` enum (which also has hinge/slider/gear/tangent for the
 * solver) — those four need extra parameters (axis, gear ratio, value)
 * and the click overlay doesn't have UI for that yet.
 */
export type ClickMateType = Extract<MateType, 'coincident' | 'concentric' | 'distance' | 'parallel'>

export interface PendingMate {
  faceA: FaceSelectionInfo
  faceB: FaceSelectionInfo
  /** The mate type the heuristic picked — used as the picker's default. */
  suggestedType: ClickMateType
  /** Whether the two face normals were near-parallel (same direction)
   *  — surfaces a flip-warning chip in the picker when true. */
  parallelHint: boolean
}

interface SelectionState {
  selectedElement: ElementSelectionInfo | null
  mateFaceA: FaceSelectionInfo | null
  pendingMate: PendingMate | null
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
type SetPendingMate = (
  next: PendingMate | null | ((prev: PendingMate | null) => PendingMate | null)
) => void

interface SelectionActions {
  setSelectedElement: SetSelected
  setMateFaceA: SetMateFace
  setPendingMate: SetPendingMate
  clear: () => void
}

type SelectionStore = SelectionState & SelectionActions

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectedElement: null,
  mateFaceA: null,
  pendingMate: null,
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
  setPendingMate: (next) =>
    set((state) => ({
      pendingMate:
        typeof next === 'function' ? next(state.pendingMate) : next,
    })),
  clear: () => set({ selectedElement: null, mateFaceA: null, pendingMate: null }),
}))
