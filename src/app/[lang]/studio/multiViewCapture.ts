'use client';
/**
 * Offscreen multi-view capture for the agentic refine loop. Renders the model
 * from 4 angles (iso / front / side / top) into one 2×2 composite PNG so the
 * vision reviewer can spot faults that hide from a single angle (wheels lying
 * flat, a missing back, floating parts). One reused WebGL context — creating a
 * renderer per call would exhaust the browser's context budget.
 */
import * as THREE from 'three';

let renderer: THREE.WebGLRenderer | null = null;
function getRenderer(tile: number): THREE.WebGLRenderer | null {
  try {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    }
    renderer.setSize(tile, tile, false);
    return renderer;
  } catch { return null; }
}

const VIEWS: { name: string; dir: [number, number, number]; up: [number, number, number] }[] = [
  { name: 'ISO',   dir: [1, 0.8, 1],    up: [0, 1, 0] },
  { name: 'FRONT', dir: [0, 0.05, 1],   up: [0, 1, 0] },
  { name: 'SIDE',  dir: [1, 0.05, 0],   up: [0, 1, 0] },
  { name: 'TOP',   dir: [0, 1, 0.001],  up: [0, 0, -1] },
];

/** Render `geo` from 4 angles into a labelled 2×2 PNG data URL (or null). */
export function captureMultiView(geo: THREE.BufferGeometry, tile = 260): string | null {
  let g: THREE.BufferGeometry | null = null;
  let mat: THREE.Material | null = null;
  try {
    const r = getRenderer(tile);
    if (!r) return null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141414);
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(0.5, 1, 0.8); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-0.6, 0.3, -0.5); scene.add(fill);

    g = geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const ctr = new THREE.Vector3(); bb.getCenter(ctr);
    const sz = new THREE.Vector3(); bb.getSize(sz);
    const radius = Math.max(sz.x, sz.y, sz.z) || 1;
    g.translate(-ctr.x, -ctr.y, -ctr.z);
    mat = new THREE.MeshStandardMaterial({ color: 0xb4b8be, metalness: 0.15, roughness: 0.6 });
    scene.add(new THREE.Mesh(g, mat));

    const cam = new THREE.PerspectiveCamera(38, 1, 0.01, radius * 100);
    const dist = radius * 2.4;

    const out = document.createElement('canvas');
    out.width = tile * 2; out.height = tile * 2;
    const ctx = out.getContext('2d');
    if (!ctx) return null;

    VIEWS.forEach((v, i) => {
      cam.position.set(...v.dir).normalize().multiplyScalar(dist);
      cam.up.set(...v.up);
      cam.lookAt(0, 0, 0);
      r.render(scene, cam);
      const x = (i % 2) * tile, y = Math.floor(i / 2) * tile;
      ctx.drawImage(r.domElement, x, y, tile, tile);
      ctx.fillStyle = '#ff9a3c';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(v.name, x + 6, y + 18);
    });

    return out.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    g?.dispose();
    mat?.dispose();
  }
}
