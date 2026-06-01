'use client';

/**
 * StlViewer — Phase 2.A.4 Three.js 3D viewport for extrude render output.
 *
 * Takes binary STL bytes (base64-encoded) and renders an interactive
 * WebGL scene with orbit controls + auto-fit camera. Pairs with the
 * /api/extrude-render route's includeStl response field.
 *
 * Scope (Phase 2.A.4 minimal):
 *   - Single STL mesh; default material (matcap-like Phong)
 *   - Orbit controls (drag to rotate, right-drag to pan, wheel to zoom)
 *   - Auto-fit camera frames the mesh on mount
 *   - Cleanup on unmount (release WebGL resources)
 *
 * Out of scope (Phase 2.A.5+):
 *   - Multi-mesh scenes (different colors per body)
 *   - Section view / clipping plane
 *   - Measurement tools (distance/angle on click)
 *   - Wireframe / hidden-line toggle
 *   - Export-to-PNG snapshot button
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export interface StlViewerProps {
  /** Binary STL as base64 string (from /api/extrude-render `stl` field). */
  stlBase64: string;
  /** Render size. Defaults to 400×400. */
  width?: number;
  height?: number;
  /** Mesh color (CSS hex or three.js color). Defaults to '#a3b8d8'. */
  color?: string;
  /** Background color. Defaults to '#f3f4f6'. */
  background?: string;
}

export default function StlViewer({
  stlBase64,
  width = 400,
  height = 400,
  color = '#a3b8d8',
  background = '#f3f4f6',
}: StlViewerProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── scene + camera + renderer ──
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    camera.position.set(50, 50, 50);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // ── lights ──
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(100, 100, 100);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-50, 50, -50);
    scene.add(fill);

    // ── controls ──
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // ── parse STL + add mesh ──
    let mesh: THREE.Mesh | null = null;
    try {
      const binary = base64ToArrayBuffer(stlBase64);
      const loader = new STLLoader();
      const geometry = loader.parse(binary);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(color),
        flatShading: false,
        shininess: 40,
      });
      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      // Auto-fit camera to bounding box.
      const box = geometry.boundingBox!;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = (camera.fov * Math.PI) / 180;
      const dist = (maxDim * 1.5) / (2 * Math.tan(fov / 2));
      camera.position.set(center.x + dist, center.y + dist, center.z + dist);
      controls.target.copy(center);
      controls.update();
    } catch (e) {
      console.error('StlViewer: failed to parse STL', e);
    }

    // ── animation loop ──
    let frameId: number;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    // ── cleanup ──
    return () => {
      cancelAnimationFrame(frameId);
      controls.dispose();
      if (mesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        scene.remove(mesh);
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [stlBase64, width, height, color, background]);

  return (
    <div
      ref={containerRef}
      data-testid="stl-viewer"
      style={{ width, height, border: '1px solid #d1d5db', borderRadius: 4, overflow: 'hidden' }}
    />
  );
}

// ─── base64 → ArrayBuffer (no Buffer dependency in browser) ──────────────

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
