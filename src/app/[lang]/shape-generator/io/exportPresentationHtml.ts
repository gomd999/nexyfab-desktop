/**
 * exportPresentationHtml — export the current model as a self-contained,
 * shareable presentation viewer (single .html file).
 *
 * What it produces: an offline-openable HTML with the part meshes embedded
 * as base64 binary STL, rendered by three.js (CDN importmap) with PBR
 * materials, studio environment light, soft shadows, orbit controls and a
 * one-click PNG screenshot button — proposal/quote-ready renders without
 * any CAD software on the recipient's side.
 *
 * Per-part colors: pass the viewer's per-part color overrides (assembly
 * context-menu colors) so the exported HTML matches what the user styled
 * on screen.
 *
 * Note: the HTML loads three.js from unpkg at open time (needs internet);
 * the geometry itself is fully embedded and never leaves the file.
 */

import * as THREE from 'three';

export interface PresentationPart {
  name: string;
  geometry: THREE.BufferGeometry;
  /** CSS hex like '#c8ccd2'. Falls back to stainless grey. */
  color?: string;
  metalness?: number;
  roughness?: number;
}

export interface PresentationOptions {
  title?: string;
  subtitle?: string;
  filename?: string;
}

/** Serialize a BufferGeometry to binary STL bytes (little-endian). */
export function geometryToBinaryStl(geometry: THREE.BufferGeometry): Uint8Array {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const triCount = pos.count / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const cb = new THREE.Vector3(); const ab = new THREE.Vector3();
  let o = 84;
  for (let i = 0; i < triCount; i++) {
    a.fromBufferAttribute(pos, i * 3);
    b.fromBufferAttribute(pos, i * 3 + 1);
    c.fromBufferAttribute(pos, i * 3 + 2);
    cb.subVectors(c, b); ab.subVectors(a, b); cb.cross(ab).normalize();
    dv.setFloat32(o, cb.x, true); dv.setFloat32(o + 4, cb.y, true); dv.setFloat32(o + 8, cb.z, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true);
      o += 12;
    }
    dv.setUint16(o, 0, true); o += 2;
  }
  if (g !== geometry) g.dispose();
  return new Uint8Array(buf);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildPresentationHtml(parts: PresentationPart[], opts: PresentationOptions = {}): string {
  const title = opts.title ?? 'NexyFab Model';
  const subtitle = opts.subtitle ?? '';
  const payload = parts.map((p) => ({
    name: p.name,
    color: p.color ?? '#c8ccd2',
    metalness: p.metalness ?? 0.9,
    roughness: p.roughness ?? 0.35,
    stl: bytesToBase64(geometryToBinaryStl(p.geometry)),
  }));

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#eef1f4;font-family:'Segoe UI',sans-serif}
  #hud{position:fixed;top:16px;left:20px;color:#2a3440;z-index:10;user-select:none}
  #hud h1{font-size:17px;margin:0 0 4px;font-weight:600}
  #hud p{font-size:12px;margin:0;color:#5a6875}
  #shot{position:fixed;top:16px;right:20px;z-index:10;padding:8px 14px;border:0;border-radius:8px;
        background:#2a3440;color:#fff;font-size:12px;cursor:pointer}
  #shot:hover{background:#3d4c5c}
  #legend{position:fixed;bottom:16px;left:20px;z-index:10;font-size:11px;color:#5a6875}
  #legend span{display:inline-block;margin-right:14px}
  #legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
</style>
</head>
<body>
<div id="hud"><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
<button id="shot">📷 PNG</button>
<div id="legend"></div>
<script type="importmap">
{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js",
"three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}
</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const PARTS = ${JSON.stringify(payload)};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef1f4);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(40, innerWidth/innerHeight, 1, 100000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const loader = new STLLoader();
const root = new THREE.Group();
scene.add(root);
const legend = document.getElementById('legend');
function b64ToBuf(b64){const s=atob(b64);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer;}
for (const p of PARTS) {
  const geo = loader.parse(b64ToBuf(p.stl));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: p.color, metalness: p.metalness, roughness: p.roughness }));
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  legend.insertAdjacentHTML('beforeend',
    '<span><i style="background:'+p.color+'"></i>'+p.name.replace(/[<>&]/g,'')+'</span>');
}
const bb0 = new THREE.Box3().setFromObject(root);
const size0 = bb0.getSize(new THREE.Vector3());
const ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(size0.x,size0.y,size0.z)*2, 64),
  new THREE.MeshStandardMaterial({ color: 0xe3e7eb, roughness: 1 }));
ground.rotation.x = -Math.PI/2; ground.position.y = bb0.min.y; ground.receiveShadow = true; scene.add(ground);
const key = new THREE.DirectionalLight(0xffffff, 2.2);
const d = Math.max(size0.x, size0.y, size0.z);
key.position.set(d*1.3, d*1.8, d);
key.castShadow = true; key.shadow.mapSize.set(2048,2048);
Object.assign(key.shadow.camera, { left:-d, right:d, top:d, bottom:-d, far:d*6 });
scene.add(key, new THREE.AmbientLight(0xffffff, 0.25));
const c = bb0.getCenter(new THREE.Vector3());
controls.target.copy(c);
camera.position.set(c.x + size0.x*1.15, c.y + size0.y*0.75, c.z + size0.z*2.1);
document.getElementById('shot').onclick = () => {
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.download = 'render.png'; a.href = renderer.domElement.toDataURL('image/png'); a.click();
};
addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
(function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
</script>
</body>
</html>`;
}

/** Build + trigger a browser download of the presentation HTML. */
export function exportPresentationHtml(parts: PresentationPart[], opts: PresentationOptions = {}): void {
  const html = buildPresentationHtml(parts, opts);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${opts.filename ?? 'model'}_presentation.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
