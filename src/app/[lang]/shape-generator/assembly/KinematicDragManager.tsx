import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { AssemblyState } from './matesSolver';
import { solveAssembly } from './matesSolver';
import type { BomPartResult } from '../ShapePreview';

interface Props {
  enabled: boolean;
  bomParts: BomPartResult[];
  assemblyState: AssemblyState | null;
  onSolverUpdate: (solvedBodies: { position: THREE.Vector3; rotation: THREE.Euler }[]) => void;
  onDragStateChange: (dragging: boolean) => void;
  hitboxes: THREE.Object3D[]; // array of meshes to raycast against
}

/**
 * Attaches global pointer events to the canvas to handle raycast dragging
 * of assembly parts, and runs the kinematic solver in real-time.
 */
export default function KinematicDragManager({
  enabled,
  bomParts,
  assemblyState,
  onSolverUpdate,
  onDragStateChange,
  hitboxes
}: Props) {
  const { camera, gl, raycaster } = useThree();
  const draggingState = useRef<{
    partIndex: number;
    plane: THREE.Plane;
    offset: THREE.Vector3;
    startPos: THREE.Vector3;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !assemblyState) return;

    const dom = gl.domElement;
    const plane = new THREE.Plane();
    const planeNormal = new THREE.Vector3();
    const intersection = new THREE.Vector3();
    const offset = new THREE.Vector3();

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // Only left click

      const rect = dom.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const intersects = raycaster.intersectObjects(hitboxes, true);

      if (intersects.length > 0) {
        // Find which part was clicked based on user data
        const hit = intersects[0];
        const partName = hit.object.userData.partName;
        if (!partName) return;

        const partIndex = assemblyState.bodies.findIndex(b => b.name === partName);
        if (partIndex === -1 || assemblyState.bodies[partIndex].fixed) return; // Cannot drag fixed parts

        e.preventDefault();
        onDragStateChange(true);

        // Setup drag plane facing the camera
        camera.getWorldDirection(planeNormal);
        planeNormal.negate();
        plane.setFromNormalAndCoplanarPoint(planeNormal, hit.point);

        const partPos = assemblyState.bodies[partIndex].position;
        offset.copy(hit.point).sub(partPos);

        draggingState.current = {
          partIndex,
          plane: plane.clone(),
          offset: offset.clone(),
          startPos: partPos.clone()
        };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const state = draggingState.current;
      if (!state) return;

      e.preventDefault();
      const rect = dom.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      if (raycaster.ray.intersectPlane(state.plane, intersection)) {
        // Requested new position for the dragged part
        const newPos = intersection.sub(state.offset);
        
        // Temporarily apply it to the dragged body in the local assembly state copy
        assemblyState.bodies[state.partIndex].position.copy(newPos);

        // Run Kinematic Solver (Gauss-Seidel) to resolve all constraints including gears, hinges, etc.
        const res = solveAssembly(assemblyState, 50); // Fewer iterations for real-time 60fps drag

        // Callback to update the React state (which passes down new transforms to instances)
        onSolverUpdate(res.bodies);
      }
    };

    const onPointerUp = () => {
      if (draggingState.current) {
        draggingState.current = null;
        onDragStateChange(false);
      }
    };

    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [enabled, hitboxes, assemblyState, camera, gl.domElement, raycaster, onSolverUpdate, onDragStateChange]);

  return null;
}
