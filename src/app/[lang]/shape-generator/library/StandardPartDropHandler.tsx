import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { autoPlaceStandardPart } from './standardPartPlacement';
import type { PlacedStandardPart, StandardPartParams } from './standardPartPlacement';

export type { PlacedStandardPart, StandardPartParams };
export { autoPlaceStandardPart, updatePlacedPartParams, serialisePlacedPart, deserialisePlacedPart } from './standardPartPlacement';

export interface StandardPartDropEvent {
  partId: string;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  intersectedPartName?: string;
  /** Auto-placement result — available when autoPlace is true */
  placement?: PlacedStandardPart;
  geometry?: THREE.BufferGeometry;
}

interface Props {
  onDropStandardPart: (evt: StandardPartDropEvent) => void;
  hitboxes: THREE.Object3D[];
  /** When true, auto-computes snap transform and provides placement data */
  autoPlace?: boolean;
  /** Default params override for dropped parts */
  defaultParams?: Record<string, StandardPartParams>;
}

/**
 * Attaches HTML5 drag and drop listeners to the WebGL Canvas.
 * When a standard part is dropped, raycasts to find the 3D position
 * and the face normal, then optionally auto-places with a snap transform.
 *
 * Enhanced v2:
 *  - Uses autoPlaceStandardPart() to compute alignment + snap transform.
 *  - Returns the PlacedStandardPart descriptor via the event for persistence.
 *  - Supports defaultParams per partId for multi-instance customization.
 */
export default function StandardPartDropHandler({
  onDropStandardPart,
  hitboxes,
  autoPlace = true,
  defaultParams = {},
}: Props) {
  const { camera, gl, raycaster } = useThree();

  useEffect(() => {
    const dom = gl.domElement;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };

    const handleDrop = (e: DragEvent) => {
      const partId = e.dataTransfer?.getData('application/vnd.nexyfab.standardpart');
      if (!partId) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = dom.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const intersects = raycaster.intersectObjects(hitboxes, true);

      let position: THREE.Vector3;
      let normal: THREE.Vector3;
      let hostPartName: string | undefined;

      if (intersects.length > 0) {
        const hit = intersects[0];
        position = hit.point.clone();
        normal = (
          hit.face?.normal?.clone()?.transformDirection(hit.object.matrixWorld)?.normalize()
          ?? new THREE.Vector3(0, 1, 0)
        );
        hostPartName = hit.object.userData.partName as string | undefined;
      } else {
        // Ground plane fallback
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const pt = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, pt)) return;
        position = pt;
        normal = new THREE.Vector3(0, 1, 0);
      }

      if (autoPlace) {
        try {
          const params = defaultParams[partId];
          const result = autoPlaceStandardPart(partId, position, normal, params, hostPartName);
          onDropStandardPart({
            partId,
            position,
            normal,
            intersectedPartName: hostPartName,
            placement: result.placed,
            geometry: result.geometry,
          });
          return;
        } catch (err) {
          // If auto-place fails (unknown part id, etc.) fall through to basic event
          console.warn('StandardPartDropHandler autoPlace failed:', err);
        }
      }

      onDropStandardPart({ partId, position, normal, intersectedPartName: hostPartName });
    };

    dom.addEventListener('dragover', handleDragOver);
    dom.addEventListener('drop', handleDrop);

    return () => {
      dom.removeEventListener('dragover', handleDragOver);
      dom.removeEventListener('drop', handleDrop);
    };
  }, [camera, gl.domElement, hitboxes, onDropStandardPart, raycaster, autoPlace, defaultParams]);

  return null;
}
