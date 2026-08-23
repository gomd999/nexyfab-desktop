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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AssemblyState, PartInstance } from '@/lib/assembly/assemblyState';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { classifyViewportTopologyPick, type ViewportPickMode } from '@/lib/assembly/viewportTopologyPick';
import { classifyFeatureTopologyPick } from '@/lib/assembly/featureTopologyPick';
import type { ToolbarSelectionRef } from './MateConstraintsToolbar';
import { buildTopologicalMap, type TopologicalMap } from '../topology/TopologicalNaming';
import { pickStableMeshFace } from '@/lib/cad/meshTopologyPick';
import {
  LARGE_ASSEMBLY_PROGRESSIVE_MIN_PARTS,
  LARGE_ASSEMBLY_TESSELLATION_CONCURRENCY,
  planProgressiveAssemblyLoad,
} from '@/lib/progressiveAssemblyLoad';

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

const progressiveDict: Record<Assembly3DViewerLang, { loading: string; proxy: string }> = {
  ko: { loading: '상세 형상 점진 로딩', proxy: '나머지는 경량 경계상자로 표시됩니다' },
  en: { loading: 'Progressively loading detail', proxy: 'Remaining parts use lightweight bounding boxes' },
  ja: { loading: '詳細形状を段階的に読み込み中', proxy: '残りのパーツは軽量境界ボックスで表示されます' },
  zh: { loading: '正在渐进加载详细几何', proxy: '其余零件以轻量包围盒显示' },
  es: { loading: 'Cargando detalle progresivamente', proxy: 'Las piezas restantes usan cajas envolventes ligeras' },
  ar: { loading: 'جارٍ تحميل التفاصيل تدريجيًا', proxy: 'تُعرض الأجزاء المتبقية بصناديق إحاطة خفيفة' },
};

// ─── colour palette ──────────────────────────────────────────────────────

const GRAY = '#9ca3af'; // tailwind gray-400
const EMERALD = '#10b981'; // tailwind emerald-500
const BACKGROUND = '#f9fafb'; // tailwind gray-50

// ─── default fallback geometry ───────────────────────────────────────────

const DEFAULT_SIZE = 30;
const meshBytesCache = new Map<string, Promise<ArrayBuffer | null>>();

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

/** Execute the base extrude as a real polygonal solid for the assembly view. */
export function geometryFromFeatureTree(
  tree: FeatureTree | undefined,
): { geometry: THREE.BufferGeometry; offset: { cx: number; cy: number; cz: number }; exact: boolean } {
  const bbox = bboxFromFeatureTree(tree);
  const node = tree?.nodes.find(item => item.payload.kind === 'extrude');
  if (node) {
    const extrude = node.payload as ExtrudeFeature;
    if (extrude.loop.length >= 3 && Number.isFinite(extrude.depth) && extrude.depth > 0) {
      try {
        const shape = new THREE.Shape();
        shape.moveTo(extrude.loop[0]!.x, extrude.loop[0]!.y);
        for (let index = 1; index < extrude.loop.length; index += 1) {
          shape.lineTo(extrude.loop[index]!.x, extrude.loop[index]!.y);
        }
        shape.closePath();
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: extrude.depth, bevelEnabled: false, steps: 1 });
        geometry.computeVertexNormals();
        return { geometry, offset: { cx: 0, cy: 0, cz: 0 }, exact: true };
      } catch { /* test mocks may not expose Shape/ExtrudeGeometry */ }
    }
  }
  const sx = bbox?.sx ?? DEFAULT_SIZE;
  const sy = bbox?.sy ?? DEFAULT_SIZE;
  const sz = bbox?.sz ?? DEFAULT_SIZE;
  return {
    geometry: new THREE.BoxGeometry(sx, sy, sz),
    offset: { cx: bbox?.cx ?? 0, cy: bbox?.cy ?? 0, cz: bbox?.cz ?? 0 },
    exact: false,
  };
}

// ─── component ───────────────────────────────────────────────────────────

export interface Assembly3DViewerProps {
  state: AssemblyState;
  /** Optional per-part FeatureTree map (keys: PartInstance.id). */
  featureTrees?: Record<string, FeatureTree>;
  /** Highlight a specific part (selected from the parts list). */
  selectedPartId?: string;
  /** Multi-selection highlight used by evidence remediation; legacy callers may omit it. */
  selectedPartIds?: readonly string[];
  /** Increment only for an explicit frame-selection request. */
  focusRevision?: number;
  /** Click handler — fires with the picked part's id. */
  onSelectPart?: (partId: string, options?: { additive: boolean }) => void;
  pickMode?: ViewportPickMode;
  onSelectReference?: (reference: ToolbarSelectionRef) => void;
  /** Canvas dimensions. Default 480×320 to fit a side panel. */
  width?: number;
  height?: number;
  /** Locale for the axis legend. */
  lang?: Assembly3DViewerLang;
  /** Publishes the live Three viewport so external editing overlays can attach. */
  onViewportReady?: (viewport: { scene: THREE.Scene; camera: THREE.Camera; domElement: HTMLElement } | null) => void;
}

/**
 * What we attach to each mesh's `userData` so the raycast handler can
 * recover the source part id without scanning the parts array.
 */
interface PartMeshUserData {
  partId: string;
  geometrySignature?: string;
  geometryOffset?: { cx: number; cy: number; cz: number };
  detailLevel?: 'proxy' | 'detail';
}

export default function Assembly3DViewer({
  state,
  featureTrees,
  selectedPartId,
  selectedPartIds,
  focusRevision = 0,
  onSelectPart,
  pickMode = 'part',
  onSelectReference,
  width = 480,
  height = 320,
  lang = 'en',
  onViewportReady,
}: Assembly3DViewerProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Refs persist across renders so we can keep a single renderer / scene
  // and react to prop changes without a full re-mount.
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const topologyMapsRef = useRef<Map<string,TopologicalMap>>(new Map());
  const onSelectRef = useRef<typeof onSelectPart>(onSelectPart);
  const onSelectReferenceRef = useRef(onSelectReference);
  const [tessellated, setTessellated] = useState<Record<string, THREE.BufferGeometry>>({});
  const onViewportReadyRef = useRef(onViewportReady);
  const treeSignature = useMemo(() => JSON.stringify(featureTrees ?? {}), [featureTrees]);
  const selectedIdSet = useMemo(() => new Set(selectedPartIds ?? (selectedPartId ? [selectedPartId] : [])), [selectedPartId, selectedPartIds]);
  const selectedIdSetRef = useRef(selectedIdSet);
  selectedIdSetRef.current = selectedIdSet;
  const partIdSignature = useMemo(() => state.parts.map((part) => part.id).join('\u001f'), [state.parts]);
  const partTreeSignatures = useMemo(() => Object.fromEntries(
    Object.entries(featureTrees ?? {}).map(([partId, tree]) => [partId, JSON.stringify(tree)]),
  ), [featureTrees]);
  const [detailedPartIds, setDetailedPartIds] = useState<Set<string>>(() => new Set());
  const detailedPartSignature = useMemo(
    () => Array.from(detailedPartIds).sort().join('\u001f'),
    [detailedPartIds],
  );

  // Paint every occurrence immediately as a lightweight proxy, then promote
  // detail in idle-time batches. This bounds main-thread stalls while keeping
  // selection/focus usable before the full 500+ part assembly is ready.
  useEffect(() => {
    const ids = state.parts.map((part) => part.id);
    const plan = planProgressiveAssemblyLoad(ids, Array.from(selectedIdSetRef.current));
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let idleHandle: number | null = null;
    setDetailedPartIds(new Set(plan.batches[0] ?? []));
    let batchIndex = 1;
    const scheduleNext = () => {
      if (cancelled || batchIndex >= plan.batches.length) return;
      const promote = () => {
        if (cancelled) return;
        const batch = plan.batches[batchIndex++] ?? [];
        setDetailedPartIds((previous) => {
          const next = new Set(previous);
          for (const id of batch) next.add(id);
          return next;
        });
        scheduleNext();
      };
      const idleWindow = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      };
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleHandle = idleWindow.requestIdleCallback(promote, { timeout: 80 });
      } else {
        timer = setTimeout(promote, 16);
      }
    };
    scheduleNext();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      const idleWindow = window as Window & { cancelIdleCallback?: (handle: number) => void };
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);
    };
  }, [partIdSignature, state.parts]);

  useEffect(() => {
    if (selectedIdSet.size === 0) return;
    setDetailedPartIds((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const id of selectedIdSet) {
        if (!next.has(id)) { next.add(id); changed = true; }
      }
      return changed ? next : previous;
    });
  }, [selectedIdSet]);

  // Full-stack replay: complex trees are rendered once on the server and
  // replace the immediate base-extrude preview when their STL is ready.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const entries = Object.entries(featureTrees ?? {}).filter(([, tree]) =>
      tree.nodes.length > 1 || tree.nodes[0]?.payload.kind !== 'extrude');
    const order = planProgressiveAssemblyLoad(
      entries.map(([partId]) => partId),
      Array.from(selectedIdSetRef.current),
    ).orderedPartIds;
    const byId = new Map(entries);
    const queue = order.map((partId) => [partId, byId.get(partId)!] as const);
    setTessellated((previous) => {
      for (const geometry of Object.values(previous)) geometry.dispose();
      return {};
    });
    if (entries.length === 0) {
      return () => controller.abort();
    }
    let cursor = 0;
    const loadOne = async ([partId, tree]: readonly [string, FeatureTree]) => {
      const key = JSON.stringify(tree);
      let pending = meshBytesCache.get(key);
      if (!pending) {
        pending = fetch('/api/feature-tree-mesh', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tree }), signal: controller.signal,
        }).then(async response => {
          if (!response.ok) return null;
          const data = (await response.json()) as { ok?: boolean; stl?: string };
          return data.ok && data.stl ? base64ToArrayBuffer(data.stl) : null;
        }).catch(() => null);
        meshBytesCache.set(key, pending);
      }
      const bytes = await pending;
      if (!bytes || !active) return null;
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const geometry = new STLLoader().parse(bytes);
      geometry.computeVertexNormals();
      if (!active) { geometry.dispose(); return; }
      setTessellated((previous) => {
        previous[partId]?.dispose();
        return { ...previous, [partId]: geometry };
      });
    };
    const worker = async () => {
      while (active) {
        const index = cursor++;
        const item = queue[index];
        if (!item) return;
        await loadOne(item);
      }
    };
    void Promise.all(Array.from(
      { length: Math.min(LARGE_ASSEMBLY_TESSELLATION_CONCURRENCY, queue.length) },
      () => worker(),
    ));
    return () => { active = false; controller.abort(); };
  }, [treeSignature, featureTrees]);

  // Keep the click handler ref in sync without re-running the mount effect.
  useEffect(() => {
    onSelectRef.current = onSelectPart;
  }, [onSelectPart]);
  useEffect(() => { onViewportReadyRef.current = onViewportReady; }, [onViewportReady]);
  useEffect(() => { onSelectReferenceRef.current = onSelectReference; }, [onSelectReference]);

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
    if (renderer?.domElement) onViewportReadyRef.current?.({ scene, camera, domElement: renderer.domElement });

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
      onViewportReadyRef.current?.(null);
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

    // Add every part immediately. Large assemblies start with cheap bounding
    // boxes and promote each occurrence to full feature geometry in batches.
    for (const part of state.parts) {
      const existing = meshes.get(part.id);
      const tree = featureTrees?.[part.id];
      const bbox = bboxFromFeatureTree(tree);
      const detailed = detailedPartIds.has(part.id);
      const finalGeometry = detailed ? tessellated[part.id] : undefined;
      const geometrySignature = detailed
        ? `detail:${partTreeSignatures[part.id] ?? 'fallback'}:${finalGeometry ? 'server' : 'local'}`
        : `proxy:${bbox?.sx ?? DEFAULT_SIZE}:${bbox?.sy ?? DEFAULT_SIZE}:${bbox?.sz ?? DEFAULT_SIZE}`;
      const previousData = existing?.userData as PartMeshUserData | undefined;
      const needsGeometry = !existing || previousData?.geometrySignature !== geometrySignature;
      let built: ReturnType<typeof geometryFromFeatureTree> | null = null;
      if (needsGeometry) {
        try {
          built = detailed
            ? (finalGeometry
                ? { geometry: finalGeometry.clone(), offset: { cx: 0, cy: 0, cz: 0 }, exact: true }
                : geometryFromFeatureTree(tree))
            : {
                geometry: new THREE.BoxGeometry(bbox?.sx ?? DEFAULT_SIZE, bbox?.sy ?? DEFAULT_SIZE, bbox?.sz ?? DEFAULT_SIZE),
                offset: { cx: bbox?.cx ?? 0, cy: bbox?.cy ?? 0, cz: bbox?.cz ?? 0 },
                exact: false,
              };
        } catch {
          built = {
            geometry: { dispose: () => {} } as unknown as THREE.BufferGeometry,
            offset: { cx: bbox?.cx ?? 0, cy: bbox?.cy ?? 0, cz: bbox?.cz ?? 0 },
            exact: false,
          };
        }
      }

      let mesh = existing;
      if (!mesh) {
        let geometry: THREE.BufferGeometry;
        try {
          geometry = built!.geometry;
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
        const ud: PartMeshUserData = {
          partId: part.id,
          geometrySignature,
          geometryOffset: built!.offset,
          detailLevel: detailed ? 'detail' : 'proxy',
        };
        mesh.userData = ud;
        mesh.name = `part-mesh-${part.id}`;
        try {
          scene.add?.(mesh);
        } catch {
          /* ignore */
        }
        meshes.set(part.id, mesh);
      } else if (built) {
        // Refresh geometry in place if the part now wants a different size
        // (e.g. the FeatureTree's first extrude was edited). Cheap enough
        // for Phase 1; OCCT path will incrementalize this.
        try {
          mesh.geometry?.dispose?.();
          mesh.geometry = built.geometry;
          const data = mesh.userData as PartMeshUserData;
          data.geometrySignature = geometrySignature;
          data.geometryOffset = built.offset;
          data.detailLevel = detailed ? 'detail' : 'proxy';
        } catch {
          /* ignore mock failure */
        }
      }

      // Apply placement = position + quaternion. Also pre-offset by the
      // bbox center so the box hugs the part origin instead of dangling
      // in the +Z corner.
      const data = mesh.userData as PartMeshUserData;
      applyPlacement(mesh, part, data.geometryOffset ?? { cx: 0, cy: 0, cz: 0 });
      try{const previous=topologyMapsRef.current.get(part.id);topologyMapsRef.current.set(part.id,buildTopologicalMap(mesh.geometry,previous,tree?.nodes.at(-1)?.id??part.partTemplateId));}catch{/* mock geometry has no attributes */}

      // Apply selection colour.
      applySelectionColor(mesh, selectedIdSet.has(part.id));
    }
  }, [state, featureTrees, tessellated, detailedPartIds, detailedPartSignature, partTreeSignatures]);

  // Selection-only re-paint (cheap, skips geometry rebuild) — also runs
  // for free above; this duplicate effect lets a parent toggle highlight
  // without churning state objects.
  useEffect(() => {
    for (const [id, mesh] of meshesRef.current) {
      applySelectionColor(mesh, selectedIdSet.has(id));
    }
  }, [selectedIdSet]);

  // Explicit evidence-queue framing only. Selection changes from ordinary
  // clicks do not move the user's camera.
  useEffect(() => {
    const focusIds = selectedIdSetRef.current;
    if (focusRevision <= 0 || focusIds.size === 0) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const bounds = new THREE.Box3();
    let found = false;
    for (const id of focusIds) {
      const mesh = meshesRef.current.get(id);
      if (!mesh) continue;
      try { bounds.expandByObject(mesh); found = true; } catch { /* incomplete test mock */ }
    }
    if (!found || bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 10);
    const direction = camera.position.clone().sub(controls.target).normalize();
    if (!Number.isFinite(direction.x) || direction.lengthSq() < 1e-8) direction.set(1, 1, 1).normalize();
    const distance = radius / Math.tan((camera.fov * Math.PI / 180) / 2) * 1.35;
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(distance / 1000, 0.1);
    camera.far = Math.max(distance * 100, 10_000);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }, [focusRevision]);

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
      let hits: Array<{ object: THREE.Object3D; point?:THREE.Vector3; face?:{normal:THREE.Vector3}; faceIndex?:number }> = [];
      try {
        hits = raycaster.intersectObjects(targets, false) as Array<{ object: THREE.Object3D }>;
      } catch {
        /* mock returns empty */
      }
      if (hits.length === 0) return;
      const ud = hits[0]?.object?.userData as PartMeshUserData | undefined;
      if (ud?.partId) {
        if(pickMode!=='part'&&onSelectReferenceRef.current){
          const hit=hits[0],mesh=hit?.object as THREE.Mesh;
          try{mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;if(box&&hit?.point&&hit.face){const localPoint=mesh.worldToLocal(hit.point.clone());const semantic=classifyFeatureTopologyPick(featureTrees?.[ud.partId],localPoint,pickMode);const boundary=semantic??classifyViewportTopologyPick(pickMode,localPoint,hit.face.normal,box);if(boundary){onSelectReferenceRef.current({partId:ud.partId,...boundary});return;}if(pickMode==='face'&&Number.isInteger(hit.faceIndex)){const map=topologyMapsRef.current.get(ud.partId),stable=map&&pickStableMeshFace(mesh.geometry,hit.faceIndex!,map);if(stable){onSelectReferenceRef.current({partId:ud.partId,refId:`mesh-face:${stable.stableId}`,refKind:'face'});return;}}}}catch{/* unsupported mock or non-pickable geometry */}
          return;
        }
        const additive = e.ctrlKey || e.metaKey || e.shiftKey;
        if (additive) callback(ud.partId, { additive: true }); else callback(ud.partId);
      }
    },
    [width, height, pickMode, featureTrees],
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
      {state.parts.length >= LARGE_ASSEMBLY_PROGRESSIVE_MIN_PARTS && detailedPartIds.size < state.parts.length ? (
        <div
          data-testid="assembly-progressive-load"
          data-loaded-parts={detailedPartIds.size}
          data-total-parts={state.parts.length}
          role="status"
          aria-live="polite"
          title={(progressiveDict[lang] ?? progressiveDict.en).proxy}
          style={{
            position: 'absolute', top: 8, left: 8, zIndex: 2, padding: '5px 8px',
            borderRadius: 6, background: 'rgba(17,24,39,.88)', color: '#fff',
            fontSize: 11, pointerEvents: 'none',
          }}
        >
          {(progressiveDict[lang] ?? progressiveDict.en).loading}: {detailedPartIds.size}/{state.parts.length}
        </div>
      ) : null}
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

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/** Re-export the helper used in tests. */
export { applyPlacement, applySelectionColor };

/** Re-export FeatureNode for downstream tests. */
export type { FeatureNode };
