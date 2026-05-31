import { useCallback, useMemo } from 'react';
import { useSelectionStore, type ClickMateType } from '../store/selectionStore';
import type { ElementSelectionInfo, FaceSelectionInfo, MultiSelectionInfo } from '../editing/selectionInfo';
import type { AssemblyMate, MateType } from '../assembly/AssemblyMates';

/**
 * Step 5.1 of the MainWorkspace decomposition plan
 * (docs/strategy/mainworkspace-decomposition.md).
 *
 * Encapsulates the click-on-face selection and mate-pairing logic that used
 * to live as an inline arrow function inside ShapeGeneratorInner.tsx. Moving
 * it out of the render body keeps stable callback identity (no re-creation
 * per render of the canvas), and unblocks step 5 because the MainWorkspace
 * component can call this hook directly instead of receiving the callback
 * as a prop.
 *
 * Side effects routed via callbacks the caller still owns:
 *   - onMateCreated:   notify the assembly panel + add the mate.
 *   - onUnpairedFace:  user picked two faces on the same part (invalid).
 *   - onParallelHint:  detected coplanar+same-direction; suggest a flip.
 *
 * The callback identity is stable across renders as long as the caller's
 * own callbacks are; pass them as useCallback values from the parent.
 *
 * Phase F (click-to-mate UX) behaviour:
 *   Instead of committing the mate immediately when the user clicks the
 *   second face, this hook now stages a `pendingMate` in the selection
 *   store with the heuristic's recommended type as the default. The
 *   MatePickerOverlay (mounted by ShapeGeneratorInner) reads that state
 *   and lets the user confirm or override before the mate hits
 *   `assemblyMates`. The overlay's onApply still funnels through the
 *   same `onMateCreated` callback so the assembly-mutation path stays a
 *   single point of truth.
 *
 *   The same-part guard (onUnpairedFace) still fires immediately — no
 *   reason to stage an invalid pick.
 */
export interface CanvasSelectionLabels {
  mateCoincident?: string;
  mateConcentric?: string;
  /** Phase F picker — distance + parallel labels for the override chips. */
  mateDistance?: string;
  mateParallel?: string;
}

export interface UseCanvasSelectionHandlersArgs {
  generateMateId: () => string;
  setSelectionActive: (active: boolean) => void;
  onMateCreated: (mate: AssemblyMate, partA: string, partB: string, mateLabel: string) => void;
  onUnpairedFace: () => void;
  onParallelHint: () => void;
  labels: CanvasSelectionLabels;
}

export interface UseCanvasSelectionHandlersResult {
  // `additive` is optional to match the existing ShapePreview prop shape;
  // false is the default for the non-shift-click path.
  onElementSelect: (info: ElementSelectionInfo, additive?: boolean) => void;
  highlightTriangles: number[] | undefined;
  /**
   * Commit the staged `pendingMate` with the user's chosen type. Called by
   * the MatePickerOverlay's Apply button. Funnels through `onMateCreated`
   * so the assembly-mutation path stays a single point of truth.
   * No-op when there is no pending mate (defensive — picker only mounts
   * when the store has one).
   */
  commitPendingMate: (chosenType: ClickMateType) => void;
  /** Clear pending mate + mate-face state (picker Cancel / Esc). */
  cancelPendingMate: () => void;
}

/**
 * Map the click-overlay's narrow ClickMateType back to a localized label
 * matching the toast format used by `lt.mateAdded`. Falls back to the
 * English type string when a label key is missing.
 */
function labelForType(type: ClickMateType, labels: CanvasSelectionLabels): string {
  switch (type) {
    case 'coincident': return labels.mateCoincident ?? 'Coincident';
    case 'concentric': return labels.mateConcentric ?? 'Concentric';
    case 'distance':   return labels.mateDistance   ?? 'Distance';
    case 'parallel':   return labels.mateParallel   ?? 'Parallel';
  }
}

/**
 * Heuristic v1: pick the most likely mate type from the two face
 * fingerprints (normals + tri counts + areas). This is the same logic
 * the pre-overlay flow used for auto-commit; now it merely seeds the
 * picker default so the user keeps the one-click happy path while
 * gaining the option to override.
 *
 *  - Both faces look like cylinder caps (small area-per-tri, many tris)
 *    → concentric (typical pin-in-hole).
 *  - Otherwise → coincident (face-to-face contact, the most common
 *    pairing for plate-on-plate / bracket-on-plate).
 *
 * Returns `{ type, parallelHint }`. `parallelHint` is true when the
 * normals point the SAME direction — coincident expects opposed
 * normals, so the picker should warn that one part needs flipping.
 */
function suggestMateType(faceA: FaceSelectionInfo, faceB: FaceSelectionInfo): { type: ClickMateType; parallelHint: boolean } {
  const nA = faceA.normal;
  const nB = faceB.normal;
  const dot = nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2];
  const triA = faceA.triangleCount;
  const triB = faceB.triangleCount;
  const stripA = triA > 12 && faceA.area / triA < 30;
  const stripB = triB > 12 && faceB.area / triB < 30;
  const isConcentric = stripA && stripB;
  return {
    type: isConcentric ? 'concentric' : 'coincident',
    // Same-direction normals only matter for the coincident default;
    // concentric handles anti-parallel axes natively.
    parallelHint: !isConcentric && dot > 0.95,
  };
}

export function useCanvasSelectionHandlers(
  args: UseCanvasSelectionHandlersArgs,
): UseCanvasSelectionHandlersResult {
  const {
    generateMateId,
    setSelectionActive,
    onMateCreated,
    onUnpairedFace,
    onParallelHint,
    labels,
  } = args;

  const selectedElement = useSelectionStore(s => s.selectedElement);
  const setSelectedElement = useSelectionStore(s => s.setSelectedElement);
  const mateFaceA = useSelectionStore(s => s.mateFaceA);
  const setMateFaceA = useSelectionStore(s => s.setMateFaceA);
  const pendingMate = useSelectionStore(s => s.pendingMate);
  const setPendingMate = useSelectionStore(s => s.setPendingMate);

  const onElementSelect = useCallback((info: ElementSelectionInfo, additive?: boolean) => {
    // Shift+click: accumulate multi-face selection.
    if (additive && info.type === 'face') {
      setSelectedElement(prev => {
        const newFace = info as FaceSelectionInfo;
        const prevFaces: FaceSelectionInfo[] =
          prev?.type === 'multi' ? (prev as MultiSelectionInfo).faces
          : prev?.type === 'face' ? [prev as FaceSelectionInfo]
          : [];
        const merged = [...prevFaces, newFace];
        return {
          type: 'multi',
          faces: merged,
          totalArea: merged.reduce((s, f) => s + f.area, 0),
          totalTriangleCount: merged.reduce((s, f) => s + f.triangleCount, 0),
          allTriangleIndices: merged.flatMap(f => f.triangleIndices),
        };
      });
      return;
    }

    if (mateFaceA && info.type === 'face') {
      const faceB = info as FaceSelectionInfo;
      if (mateFaceA.partName && faceB.partName && mateFaceA.partName !== faceB.partName) {
        // Phase F: stage the pair with the suggested type rather than
        // committing immediately. The MatePickerOverlay reads
        // `pendingMate` and confirms / overrides.
        const { type, parallelHint } = suggestMateType(mateFaceA, faceB);
        setPendingMate({ faceA: mateFaceA, faceB, suggestedType: type, parallelHint });
        // Mate-face state cleared so a future "Create Mate" press starts
        // fresh; the picker still has its own copy in pendingMate.
        setMateFaceA(null);
        setSelectedElement(null);
        setSelectionActive(false);
      } else {
        onUnpairedFace();
        setMateFaceA(null);
        setSelectedElement(null);
        setSelectionActive(false);
      }
    } else {
      setSelectedElement(info);
    }
  }, [mateFaceA, setSelectedElement, setMateFaceA, setPendingMate, setSelectionActive, onUnpairedFace]);

  /** Picker → Apply. Builds the AssemblyMate from the staged faces +
   *  user's chosen type, fires the same `onMateCreated` the old auto-
   *  commit used, then clears the pending state. The parallel-hint
   *  toast still fires (informational) when coincident is committed
   *  against same-direction normals. */
  const commitPendingMate = useCallback((chosenType: ClickMateType) => {
    if (!pendingMate) return;
    const { faceA, faceB, parallelHint } = pendingMate;
    if (!faceA.partName || !faceB.partName) {
      // Defensive — staging already gated on partName; if both are
      // present here we still skip rather than crash.
      setPendingMate(null);
      return;
    }
    const mateType: MateType = chosenType;
    const mateLabel: string = labelForType(chosenType, labels);
    // Surface the flip warning when the user committed coincident
    // against parallel normals — same condition the auto-commit had.
    if (chosenType === 'coincident' && parallelHint) {
      onParallelHint();
    }
    const newMate: AssemblyMate = {
      id: generateMateId(),
      type: mateType,
      partA: faceA.partName,
      partB: faceB.partName,
      faceA: faceA.triangleIndices[0],
      faceB: faceB.triangleIndices[0],
      locked: false,
    };
    onMateCreated(newMate, faceA.partName, faceB.partName, mateLabel);
    setPendingMate(null);
  }, [pendingMate, setPendingMate, generateMateId, onMateCreated, onParallelHint, labels]);

  const cancelPendingMate = useCallback(() => {
    setPendingMate(null);
    setMateFaceA(null);
  }, [setPendingMate, setMateFaceA]);

  const highlightTriangles = useMemo<number[] | undefined>(() => {
    if (mateFaceA?.triangleIndices) return mateFaceA.triangleIndices;
    if (selectedElement?.type === 'face') {
      return (selectedElement as FaceSelectionInfo).triangleIndices;
    }
    if (selectedElement?.type === 'multi') {
      return (selectedElement as MultiSelectionInfo).allTriangleIndices;
    }
    return undefined;
  }, [mateFaceA, selectedElement]);

  return { onElementSelect, highlightTriangles, commitPendingMate, cancelPendingMate };
}
