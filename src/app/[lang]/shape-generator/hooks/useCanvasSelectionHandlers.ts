import { useCallback, useMemo } from 'react';
import { useSelectionStore } from '../store/selectionStore';
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
 */
export interface CanvasSelectionLabels {
  mateCoincident?: string;
  mateConcentric?: string;
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
        // E4: pick the mate type by analysing the selected face normals + sizes.
        // Cylindrical-looking strips (small area / many tris) → concentric;
        // parallel same-direction → coincident with a flip warning.
        const nA = mateFaceA.normal;
        const nB = faceB.normal;
        const dot = nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2];
        const triA = mateFaceA.triangleCount;
        const triB = faceB.triangleCount;
        const stripA = triA > 12 && mateFaceA.area / triA < 30;
        const stripB = triB > 12 && faceB.area / triB < 30;
        let mateType: MateType = 'coincident';
        let mateLabel: string = labels.mateCoincident ?? 'Coincident';
        if (stripA && stripB) {
          mateType = 'concentric';
          mateLabel = labels.mateConcentric ?? 'Concentric';
        } else if (dot > 0.95) {
          onParallelHint();
        }
        const newMate: AssemblyMate = {
          id: generateMateId(),
          type: mateType,
          partA: mateFaceA.partName,
          partB: faceB.partName,
          faceA: mateFaceA.triangleIndices[0],
          faceB: faceB.triangleIndices[0],
          locked: false,
        };
        onMateCreated(newMate, mateFaceA.partName, faceB.partName, mateLabel);
      } else {
        onUnpairedFace();
      }
      setMateFaceA(null);
      setSelectedElement(null);
      setSelectionActive(false);
    } else {
      setSelectedElement(info);
    }
  }, [mateFaceA, setSelectedElement, setMateFaceA, generateMateId, setSelectionActive, onMateCreated, onUnpairedFace, onParallelHint, labels.mateCoincident, labels.mateConcentric]);

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

  return { onElementSelect, highlightTriangles };
}
