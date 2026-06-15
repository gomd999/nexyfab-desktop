import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { AssemblyState } from './matesSolver';
import {
  beginDragGesture,
  kinematicDragStep,
  snapshotPoses,
  type DragGesture,
  type BodyPoseSnapshot,
} from './kinematicDragSolve';
import type { BomPartResult } from '../ShapePreview';

interface Props {
  enabled: boolean;
  bomParts: BomPartResult[];
  assemblyState: AssemblyState | null;
  onSolverUpdate: (solvedBodies: { position: THREE.Vector3; rotation: THREE.Euler }[]) => void;
  onDragStateChange: (dragging: boolean) => void;
  /** Fired once per completed gesture with before/after pose snapshots, so
   *  the host can register a SINGLE undo step for the whole drag. */
  onGestureEnd?: (before: BodyPoseSnapshot[], after: BodyPoseSnapshot[]) => void;
  hitboxes: THREE.Object3D[]; // array of meshes to raycast against
}

/**
 * Attaches global pointer events to the canvas to handle raycast dragging
 * of assembly parts, and runs the kinematic solver in real-time.
 *
 * Drag semantics live in `kinematicDragSolve` (pure, unit-tested): a part
 * hinged to a fixed partner rotates about the hinge axis, a slider-mated
 * part slides along its axis, anything else translates with the solver
 * re-polishing constraints each frame (soft-pin, sketch drag-solve style).
 */
export default function KinematicDragManager({
  enabled,
  bomParts: _bomParts,
  assemblyState,
  onSolverUpdate,
  onDragStateChange,
  onGestureEnd,
  hitboxes
}: Props) {
  const { camera, gl, raycaster } = useThree();
  const draggingState = useRef<{
    gesture: DragGesture;
    plane: THREE.Plane;
    before: BodyPoseSnapshot[];
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !assemblyState) return;

    const dom = gl.domElement;
    const plane = new THREE.Plane();
    const planeNormal = new THREE.Vector3();
    const intersection = new THREE.Vector3();

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

        // Setup drag plane facing the camera through the grab point
        camera.getWorldDirection(planeNormal);
        planeNormal.negate();
        plane.setFromNormalAndCoplanarPoint(planeNormal, hit.point);

        draggingState.current = {
          gesture: beginDragGesture(assemblyState, partIndex, hit.point.clone()),
          plane: plane.clone(),
          before: snapshotPoses(assemblyState),
          moved: false,
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
        // One soft-pin + re-polish frame: pose the dragged part toward the
        // cursor along its joint, re-solve everything else (gears, hinges,
        // limit mates...), and write the result back for warm-starting.
        const res = kinematicDragStep(assemblyState, state.gesture, intersection.clone(), { iterations: 50 });
        state.moved = true;

        // Callback to update the React state (which passes down new transforms to instances)
        onSolverUpdate(res.bodies);
      }
    };

    const onPointerUp = () => {
      const state = draggingState.current;
      if (state) {
        draggingState.current = null;
        if (state.moved && onGestureEnd) {
          onGestureEnd(state.before, snapshotPoses(assemblyState));
        }
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
  }, [enabled, hitboxes, assemblyState, camera, gl.domElement, raycaster, onSolverUpdate, onDragStateChange, onGestureEnd]);

  return null;
}
