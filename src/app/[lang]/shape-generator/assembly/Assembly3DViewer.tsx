'use client';

/**
 * Assembly3DViewer — Phase 3.A standalone Three.js viewport for the
 * assembly browser (NexyFab Pro own-CAD, ADR-013).
 *
 * Takes an {@link AssemblyState} (plus optional per-part {@link FeatureTree}
 * map) and renders each part as a coloured box positioned + oriented by the
 * part's `placement` (position + quaternion). Pure read-only viewer; all
 * mutation flows through {@link AssemblyBrowserModal}. Integration into the
 * modal happens in a follow-up batch — this component is shipped
 * standalone so the IR / hooks can stay untouched.
 *
 * Scope (Phase 3.A.viewer — minimal):
 *   - PerspectiveCamera + OrbitControls, single ambient + key light.
 *   - Each part = one MeshStandardMaterial box (gray); selected part
 *     repaints emerald.
 *   - Geometry per part:
 *       1. First `extrude` node in the part's FeatureTree → bbox of its
 *          `loop` xy points × `depth` z (Phase 1 approximation; OCCT
 *          tessellation comes in 3.A.brep).
 *       2. No tree / no extrude → fallback 30 × 30 × 30 cube centred on
 *          the placement origin.
 *   - Click-to-select via Raycaster + `onSelectPart` callback.
 *   - GridHelper (XY) + AxesHelper (X/Y/Z, 6-lang labels in DOM legend).
 *
 * Out of scope (Phase 3.A.viewer+1):
 *   - Real B-rep tessellation (OCCT) — replace the bbox stub.
 *   - Hover preview / drag-to-rotate-part / gizmo overlays.
 *   - Section view / measurement / explode animation.
 *   - Mate-glyph overlays (lives in MateGlyphLayer 3.A.glyphs).
 *
 * Test note: jsdom has no WebGL. Tests mock `three` + the OrbitControls
 * loader (matching the StlViewer playbook) so we exercise the mount /
 * cleanup / selection-state machinery without hitting WebGLRenderer.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AssemblyState, PartInstance } from '@/lib/assembly/assemblyState';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── i18n ────────────────────────────────────────────────────────────────

export type Assembly3DViewerLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface AxisDict {
  /** Short axis tags rendered next to the axes helper in the DOM legend. */
  x: string;
  y: string;
  z: string;
}

const axisDict: Record<Assembly3DViewerLang, AxisDict> = {
  ko: { x: 'X', y: 'Y', z: 'Z' },
  en: { x: 'X', y: 'Y', z: 'Z' },
  ja: { x: 'X', y: 'Y', z: 'Z' },
  zh: { x: 'X', y: 'Y', z: 'Z' },
  es: { x: 'X', y: 'Y', z: 'Z' },
  ar: { x: 'X', y: 'Y', z: 'Z' },
};

// ─── colour palette ──────────────────────────────────────────────────────

const GRAY = '#9ca3af'; // tailwind gray-400
const EMERALD = '#10b981'; // tailwind emerald-500
const BACKGROUND = '#f9fafb'; // tailwind gray-50

// ─── default fallback geometry ───────────────────────────────────────────

const DEFAULT_SIZE = 30;

interface Bbox3 {
  sx: number;
  sy: number;
  sz: number;
  cx: number;
  cy: number;
  cz: number;
}

/**
 * Compute a part's bbox from the first extrude node in its FeatureTree.
 * Pure helper so tests can verify the placement-bbox bridge without
 * needing the Three.js stack.
 *
 * Returns null when no usable extrude is found — caller falls back to the
 * default cube. Defensive: a tree with only patterns / fillets / holes
 * yields null until OCCT tessellation lands in 3.A.brep.
 */
export function bboxFromFeatureTree(tree: FeatureTree | undefined): Bbox3 | null {
  if (!tree || !tree.nodes || tree.nodes.length === 0) return null;
  for (const node of tree.nodes) {
    const payload = node.payload as { kind: string };
    if (payload.kind !== 'extrude') continue;
    const ex = payload as ExtrudeFeature;
    if (!ex.loop || ex.loop.length === 0) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of ex.loop) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) continue;
    const sx = Math.max(maxX - minX, 1e-6);
    const sy = Math.max(maxY - minY, 1e-6);
    const sz = Math.max(ex.depth, 1e-6);
    return {
      sx,
      sy,
      sz,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      cz: sz / 2,
    };
  }
  return null;
}

// ─── component ───────────────────────────────────────────────────────────

export interface Assembly3DViewerProps {
  state: AssemblyState;
  /** Optional per-part FeatureTree map (keys: PartInstance.id). */
  featureTrees?: Record<string, FeatureTree>;
  /** Highlight a specific part (selected from the parts list). */
  selectedPartId?: string;
  /** Click handler — fires with the picked part's id. */
  onSelectPart?: (partId: string) => void;
  /** Canvas dimensions. Default 480×320 to fit a side panel. */
  width?: number;
  height?: number;
  /** Locale for the axis legend. */
  lang?: Assembly3DViewerLang;
}

/**
 * What we attach to each mesh's `userData` so the raycast handler can
 * recover the source part id without scanning the parts array.
 */
interface PartMeshUserData {
  partId: string;
}

export default function Assembly3DViewer({
  state,
  featureTrees,
  selectedPartId,
  onSelectPart,
  width = 480,
  height = 320,
  lang = 'en',
}: Assembly3DViewerProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Refs persist across renders so we can keep a single renderer / scene
  // and react to prop changes without a full re-mount.
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const onSelectRef = useRef<typeof onSelectPart>(onSelectPart);

  // Keep the click handler ref in sync without re-running the mount effect.
  useEffect(() => {
    onSelectRef.current = onSelectPart;
  }, [onSelectPart]);

  // Stable copy of axis labels for the DOM legend (no re-render churn).
  const labels = useMemo(() => axisDict[lang] ?? axisDict.en, [lang]);

  // ── mount: create scene, camera, renderer, controls, helpers ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Snapshot the mesh registry at mount so the cleanup closure walks the
    // same Map even after the ref may have been rebound (placates the
    // react-hooks/exhaustive-deps "ref likely changed" warning).
    const meshes = meshesRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    camera.position.set(200, 200, 200);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      // setPixelRatio is missing in some jsdom mocks — guard for tests.
      if (typeof renderer.setPixelRatio === 'function' && typeof window !== 'undefined') {
        renderer.setPixelRatio(window.devicePixelRatio ?? 1);
      }
      if (renderer.domElement) {
        renderer.domElement.setAttribute('data-testid', 'assembly-3d-canvas');
        container.appendChild(renderer.domElement);
      }
    } catch (err) {
      // jsdom + no real WebGL: skip renderer init but keep the rest of the
      // pipeline so unit tests can still poke at meshesRef / selection.
      console.warn('Assembly3DViewer: WebGLRenderer init failed (likely jsdom)', err);
    }
    rendererRef.current = renderer;

    // Lights — single ambient + key directional. Plenty for box geometry.
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(150, 200, 150);
    scene.add(key);

    // Grid + axes helpers. Grid in XY plane, 500 units across, 20 divisions.
    try {
      const grid = new THREE.GridHelper(500, 20, 0xd1d5db, 0xe5e7eb);
      // Rotate so the grid sits on XY (Z-up world frame to match CAD).
      grid.rotation.x = Math.PI / 2;
      scene.add(grid);
    } catch {
      // GridHelper missing in mocks — non-fatal.
    }
    try {
      const axes = new THREE.AxesHelper(120);
      scene.add(axes);
    } catch {
      // AxesHelper missing in mocks — non-fatal.
    }

    // Controls — orbit only, no roll. Tolerant to mocks that omit ctor.
    if (renderer && renderer.domElement) {
      try {
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.target.set(0, 0, 0);
        controls.update();
        controlsRef.current = controls;
      } catch {
        // OrbitControls mock might be a no-op stub.
      }
    }

    // Animation loop. Guard requestAnimationFrame — jsdom provides it but
    // some test envs override it. We bail out cleanly on each frame if the
    // renderer was never created.
    let frameId: number | null = null;
    const animate = () => {
      const c = controlsRef.current;
      if (c && typeof c.update === 'function') c.update();
      const r = rendererRef.current;
      const s = sceneRef.current;
      const cam = cameraRef.current;
      if (r && s && cam && typeof r.render === 'function') {
        try {
          r.render(s, cam);
        } catch {
          // Suppress per-frame render errors in mocked envs.
        }
      }
      if (typeof requestAnimationFrame === 'function') {
        frameId = requestAnimationFrame(animate);
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      animate();
    }

    return () => {
      if (frameId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameId);
      }
      // Dispose every per-part mesh before the scene goes.
      for (const mesh of meshes.values()) {
        try {
          mesh.geometry?.dispose?.();
          (mesh.material as THREE.Material | undefined)?.dispose?.();
          sceneRef.current?.remove?.(mesh);
        } catch {
          /* mock dispose may throw — ignore */
        }
      }
      meshes.clear();
      controlsRef.current?.dispose?.();
      controlsRef.current = null;
      if (rendererRef.current) {
        try {
          rendererRef.current.dispose?.();
        } catch {
          /* ignore */
        }
        const dom = rendererRef.current.domElement;
        if (dom && dom.parentNode === container) {
          container.removeChild(dom);
        }
        rendererRef.current = null;
      }
      sceneRef.current = null;
      cameraRef.current = null;
    };
    // We intentionally rebuild the renderer when size changes; part / state
    // diffs are handled by the next effect.
  }, [width, height]);

  // ── sync parts → meshes whenever state / featureTrees change ──
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const meshes = meshesRef.current;
    const wantedIds = new Set<string>(state.parts.map((p) => p.id));

    // Remove meshes whose part is gone.
    for (const [id, mesh] of meshes) {
      if (!wantedIds.has(id)) {
        try {
          mesh.geometry?.dispose?.();
          (mesh.material as THREE.Material | undefined)?.dispose?.();
          scene.remove?.(mesh);
        } catch {
          /* ignore */
        }
        meshes.delete(id);
      }
    }

    // Add / refresh meshes for every part.
    for (const part of state.parts) {
      const existing = meshes.get(part.id);
      const tree = featureTrees?.[part.id];
      const bbox = bboxFromFeatureTree(tree);
      const sx = bbox?.sx ?? DEFAULT_SIZE;
      const sy = bbox?.sy ?? DEFAULT_SIZE;
      const sz = bbox?.sz ?? DEFAULT_SIZE;
      const cx = bbox?.cx ?? 0;
      const cy = bbox?.cy ?? 0;
      const cz = bbox?.cz ?? 0;

      let mesh = existing;
      if (!mesh) {
        let geometry: THREE.BufferGeometry;
        try {
          geometry = new THREE.BoxGeometry(sx, sy, sz);
        } catch {
          // Mock geometry path — create a plain object that satisfies the
          // dispose() contract so cleanup doesn't blow up.
          geometry = { dispose: () => {} } as unknown as THREE.BufferGeometry;
        }
        let material: THREE.Material;
        try {
          material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(GRAY),
            roughness: 0.6,
            metalness: 0.1,
          });
        } catch {
          material = { dispose: () => {} } as unknown as THREE.Material;
        }
        try {
          mesh = new THREE.Mesh(geometry, material);
        } catch {
          // Bare-bones mock — preserve userData + position + quaternion
          // surface so the rest of the logic still works.
          mesh = {
            geometry,
            material,
            userData: {} as PartMeshUserData,
            position: { set: () => {} },
            quaternion: { set: () => {} },
          } as unknown as THREE.Mesh;
        }
        const ud: PartMeshUserData = { partId: part.id };
        mesh.userData = ud;
        try {
          scene.add?.(mesh);
        } catch {
          /* ignore */
        }
        meshes.set(part.id, mesh);
      } else {
        // Refresh geometry in place if the part now wants a different size
        // (e.g. the FeatureTree's first extrude was edited). Cheap enough
        // for Phase 1; OCCT path will incrementalize this.
        try {
          mesh.geometry?.dispose?.();
          mesh.geometry = new THREE.BoxGeometry(sx, sy, sz);
        } catch {
          /* ignore mock failure */
        }
      }

      // Apply placement = position + quaternion. Also pre-offset by the
      // bbox center so the box hugs the part origin instead of dangling
      // in the +Z corner.
      applyPlacement(mesh, part, { cx, cy, cz });

      // Apply selection colour.
      applySelectionColor(mesh, part.id === selectedPartId);
    }
  }, [state, featureTrees, selectedPartId]);

  // Selection-only re-paint (cheap, skips geometry rebuild) — also runs
  // for free above; this duplicate effect lets a parent toggle highlight
  // without churning state objects.
  useEffect(() => {
    for (const [id, mesh] of meshesRef.current) {
      applySelectionColor(mesh, id === selectedPartId);
    }
  }, [selectedPartId]);

  // ── click → raycast → onSelectPart ──
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const callback = onSelectRef.current;
      if (!callback) return;
      const container = containerRef.current;
      const camera = cameraRef.current;
      const scene = sceneRef.current;
      if (!container || !camera || !scene) return;

      const rect = container.getBoundingClientRect();
      const w = rect.width || width;
      const h = rect.height || height;
      const ndc = {
        x: ((e.clientX - rect.left) / Math.max(w, 1)) * 2 - 1,
        y: -((e.clientY - rect.top) / Math.max(h, 1)) * 2 + 1,
      };

      let raycaster: THREE.Raycaster | null = null;
      try {
        raycaster = new THREE.Raycaster();
      } catch {
        // Mock env without Raycaster — fall back to first-mesh-wins so the
        // onSelectPart wire is still exercised by tests.
        const first = meshesRef.current.values().next();
        if (!first.done) {
          const ud = first.value.userData as PartMeshUserData;
          if (ud?.partId) callback(ud.partId);
        }
        return;
      }
      try {
        const v = new THREE.Vector2(ndc.x, ndc.y);
        raycaster.setFromCamera(v, camera);
      } catch {
        /* mock setFromCamera may be a stub — continue anyway */
      }

      // Intersect against the per-part meshes only (skip helpers / lights).
      const targets = Array.from(meshesRef.current.values());
      let hits: Array<{ object: THREE.Object3D }> = [];
      try {
        hits = raycaster.intersectObjects(targets, false) as Array<{ object: THREE.Object3D }>;
      } catch {
        /* mock returns empty */
      }
      if (hits.length === 0) return;
      const ud = hits[0]?.object?.userData as PartMeshUserData | undefined;
      if (ud?.partId) callback(ud.partId);
    },
    [width, height],
  );

  return (
    <div
      ref={containerRef}
      data-testid="assembly-3d-viewer"
      onClick={handleClick}
      style={{
        position: 'relative',
        width,
        height,
        border: '1px solid #d1d5db',
        borderRadius: 4,
        overflow: 'hidden',
        background: BACKGROUND,
      }}
    >
      <div
        data-testid="assembly-3d-axis-legend"
        style={{
          position: 'absolute',
          bottom: 4,
          left: 6,
          fontSize: 11,
          fontFamily: 'monospace',
          color: '#6b7280',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <span data-testid="assembly-3d-axis-x" style={{ color: '#dc2626' }}>{labels.x}</span>
        {' · '}
        <span data-testid="assembly-3d-axis-y" style={{ color: '#16a34a' }}>{labels.y}</span>
        {' · '}
        <span data-testid="assembly-3d-axis-z" style={{ color: '#2563eb' }}>{labels.z}</span>
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────

/**
 * Place a mesh into world coordinates. Quaternion comes first (rotate
 * about origin), then we translate by the part's `position`. The bbox
 * centre offset is folded in so the rendered box is centred on the
 * part's placement origin instead of pinned to the +X+Y+Z corner.
 */
function applyPlacement(
  mesh: THREE.Mesh,
  part: PartInstance,
  bboxCenter: { cx: number; cy: number; cz: number },
): void {
  const q = part.orientation;
  try {
    mesh.quaternion?.set?.(q.x, q.y, q.z, q.w);
  } catch {
    /* mock */
  }
  try {
    mesh.position?.set?.(
      part.position.x + bboxCenter.cx,
      part.position.y + bboxCenter.cy,
      part.position.z + bboxCenter.cz,
    );
  } catch {
    /* mock */
  }
}

/**
 * Re-tint a mesh based on whether it's the currently selected part.
 * Tolerant to mocks that ship a stub Material without `.color`.
 */
function applySelectionColor(mesh: THREE.Mesh, selected: boolean): void {
  const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
  if (!mat) return;
  const hex = selected ? EMERALD : GRAY;
  if (mat.color && typeof (mat.color as { set?: (c: string) => void }).set === 'function') {
    (mat.color as { set: (c: string) => void }).set(hex);
  } else {
    // Mock path — stash for test inspection.
    (mat as unknown as { _color: string })._color = hex;
  }
}

/** Re-export the helper used in tests. */
export { applyPlacement, applySelectionColor };

/** Re-export FeatureNode for downstream tests. */
export type { FeatureNode };
