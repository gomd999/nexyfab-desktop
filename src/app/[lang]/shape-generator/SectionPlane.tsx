'use client';
/**
 * SectionPlane.tsx
 *
 * Real mesh clipping via Three.js renderer.localClippingEnabled + material.clippingPlanes.
 * Replaces the old visual-overlay-only approach.
 *
 * - Clipping plane is set on the renderer via useThree()
 * - A semi-transparent cap plane is drawn at the cut position so the interior is visible
 * - Edge border lines mark the cutting boundary
 */
import React, { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ShapeResult } from './shapes';

interface SectionPlaneProps {
  enabled: boolean;
  axis?: 'x' | 'y' | 'z';
  /** 0..1 — position along the bounding-box axis. 0.5 = centre. */
  offset?: number;
  result: ShapeResult | null;
}

export default function SectionPlane({ enabled, axis = 'y', offset = 0.5, result }: SectionPlaneProps) {
  const { gl, scene } = useThree();

  // ── 1. Enable renderer local clipping ──────────────────────────────────────
  useEffect(() => {
    gl.localClippingEnabled = true;
    return () => {
      // On unmount restore and clear clipping planes from all materials
      gl.localClippingEnabled = false;
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => { (m as THREE.MeshStandardMaterial).clippingPlanes = []; });
        }
      });
    };
  }, [gl, scene]);

  // ── 2. Compute the THREE.Plane ──────────────────────────────────────────────
  const clipPlane = useMemo((): THREE.Plane | null => {
    if (!result) return null;
    result.geometry.computeBoundingBox();
    const bb = result.geometry.boundingBox;
    if (!bb) return null;

    const t = Math.max(0, Math.min(1, offset));
    const normal = new THREE.Vector3(
      axis === 'x' ? -1 : 0,
      axis === 'y' ? -1 : 0,
      axis === 'z' ? -1 : 0,
    );
    const pos = axis === 'x' ? bb.min.x + t * (bb.max.x - bb.min.x)
              : axis === 'y' ? bb.min.y + t * (bb.max.y - bb.min.y)
              : bb.min.z + t * (bb.max.z - bb.min.z);
    // constant = -(normal · point on plane)
    return new THREE.Plane(normal, pos);
  }, [result, axis, offset]);

  // ── 3. Apply clip plane to all mesh materials when enabled ──────────────────
  useEffect(() => {
    if (!enabled || !clipPlane) {
      // Remove clipping from all meshes
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => { (m as THREE.MeshStandardMaterial).clippingPlanes = []; });
        }
      });
      return;
    }
    // Apply to every mesh in the scene (exclude the cap plane itself via userData flag)
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.isSectionCap) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        (m as THREE.MeshStandardMaterial).clippingPlanes = [clipPlane];
        (m as THREE.MeshStandardMaterial).clipShadows = true;
      });
    });
  }, [enabled, clipPlane, scene]);

  // ── 4. Cap plane geometry (semi-transparent fill + border) ─────────────────
  const capData = useMemo(() => {
    if (!enabled || !result || !clipPlane) return null;
    result.geometry.computeBoundingBox();
    const bb = result.geometry.boundingBox!;
    const size = bb.getSize(new THREE.Vector3());
    const center = bb.getCenter(new THREE.Vector3());
    const t = Math.max(0, Math.min(1, offset));
    const extent = Math.max(size.x, size.y, size.z) * 1.5;

    let position: THREE.Vector3;
    let rotation: THREE.Euler;
    const hw = extent / 2;

    if (axis === 'x') {
      const x = bb.min.x + t * size.x;
      position = new THREE.Vector3(x, center.y, center.z);
      rotation = new THREE.Euler(0, Math.PI / 2, 0);
    } else if (axis === 'z') {
      const z = bb.min.z + t * size.z;
      position = new THREE.Vector3(center.x, center.y, z);
      rotation = new THREE.Euler(Math.PI / 2, 0, 0);
    } else {
      const y = bb.min.y + t * size.y;
      position = new THREE.Vector3(center.x, y, center.z);
      rotation = new THREE.Euler(-Math.PI / 2, 0, 0);
    }

    // Border line loop
    const pts = [
      new THREE.Vector3(-hw, -hw, 0),
      new THREE.Vector3( hw, -hw, 0),
      new THREE.Vector3( hw,  hw, 0),
      new THREE.Vector3(-hw,  hw, 0),
      new THREE.Vector3(-hw, -hw, 0),
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(pts);

    return { position, rotation, borderGeo, extent };
  }, [enabled, result, clipPlane, axis, offset]);

  if (!enabled || !capData) return null;

  const { position, rotation, borderGeo, extent } = capData;

  return (
    <group position={position} rotation={rotation}>
      {/* Semi-transparent interior fill */}
      <mesh userData={{ isSectionCap: true }}>
        <planeGeometry args={[extent, extent]} />
        <meshBasicMaterial
          color="#ef4444"
          opacity={0.12}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Border edge */}
      <lineSegments geometry={borderGeo} userData={{ isSectionCap: true }}>
        <lineBasicMaterial color="#ef4444" opacity={0.7} transparent />
      </lineSegments>

      {/* Axis label */}
      <mesh position={[0, extent / 2 + 2, 0]} userData={{ isSectionCap: true }}>
        <planeGeometry args={[0, 0]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
