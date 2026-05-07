import * as THREE from 'three';

/**
 * Renders mesh edges as an orthographic PNG (data URL) for use as a sketch reference underlay.
 * Geometry is centered; view matches the active sketch plane (projection along the plane normal).
 */
const MIN_REF_PX = 256;
const MAX_REF_PX = 1024;

/** Edge render for sketch underlay; `maxPixelSize` caps GPU work (default 768). */
export function bufferGeometryToReferenceDataUrl(
  geometry: THREE.BufferGeometry,
  plane: 'xy' | 'xz' | 'yz',
  maxPixelSize = 768,
): string {
  const pixelSize = Math.round(
    Math.max(MIN_REF_PX, Math.min(MAX_REF_PX, maxPixelSize)),
  );
  const geo = geometry.clone();
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) {
    geo.dispose();
    throw new Error('Missing bounding box');
  }
  const center = new THREE.Vector3();
  box.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  const sx = Math.max(size.x, 1e-6);
  const sy = Math.max(size.y, 1e-6);
  const sz = Math.max(size.z, 1e-6);
  const pad = 1.22;

  const edges = new THREE.EdgesGeometry(geo, 35);
  geo.dispose();

  const lineMat = new THREE.LineBasicMaterial({ color: 0xd8dce6 });
  const lines = new THREE.LineSegments(edges, lineMat);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x12141c);

  const pri = 0.1;
  const span = Math.max(sx, sy, sz) * pad * 3;
  const far = span * 4 + 20;

  let left: number;
  let right: number;
  let top: number;
  let bottom: number;
  let cam: THREE.OrthographicCamera;

  if (plane === 'xy') {
    left = (-sx * pad) / 2;
    right = (sx * pad) / 2;
    top = (sy * pad) / 2;
    bottom = (-sy * pad) / 2;
    cam = new THREE.OrthographicCamera(left, right, top, bottom, pri, far);
    cam.position.set(0, 0, far * 0.45);
    cam.lookAt(0, 0, 0);
    cam.up.set(0, 1, 0);
  } else if (plane === 'xz') {
    left = (-sx * pad) / 2;
    right = (sx * pad) / 2;
    top = (sz * pad) / 2;
    bottom = (-sz * pad) / 2;
    cam = new THREE.OrthographicCamera(left, right, top, bottom, pri, far);
    cam.position.set(0, far * 0.45, 0);
    cam.lookAt(0, 0, 0);
    cam.up.set(0, 0, 1);
  } else {
    left = (-sy * pad) / 2;
    right = (sy * pad) / 2;
    top = (sz * pad) / 2;
    bottom = (-sz * pad) / 2;
    cam = new THREE.OrthographicCamera(left, right, top, bottom, pri, far);
    cam.position.set(far * 0.45, 0, 0);
    cam.lookAt(0, 0, 0);
    cam.up.set(0, 0, 1);
  }

  scene.add(lines);

  const canvas = document.createElement('canvas');
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(pixelSize, pixelSize, false);
  renderer.render(scene, cam);

  const dataUrl = canvas.toDataURL('image/png');

  renderer.dispose();
  lineMat.dispose();
  edges.dispose();

  return dataUrl;
}
