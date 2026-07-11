/**
 * 2D→3D HTML 렌더 — intent(또는 어셈블리)를 브라우저에서 바로 열리는 자립형
 * 3D 뷰어 HTML로 만든다. 사용자가 요청한 "html형 랜더링" 산출물.
 *
 * 재구성 SCAD → openscad-wasm 실렌더(STL) → base64로 HTML에 임베드 + three.js(CDN)
 * PBR 재질·조명·궤도컨트롤·📷 스크린샷 버튼. 오프라인 파일 하나로 공유(제안서용).
 * (shape-generator의 exportPresentationHtml.ts와 동일 사상, CLI/MCP용 .mjs 포트)
 *
 * usage: node html-render.mjs '<intent.json>' out.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { toOpenScad } from './reconstruct.mjs';
import { buildAssembly } from './assembly.mjs';
import { renderStl } from './verify.mjs';

function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return Buffer.from(bin, 'binary').toString('base64');
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * intent 또는 assembly → 자립형 HTML 문자열.
 * @param spec {intent} 또는 {assembly}
 */
export async function renderHtml(spec, { title = 'NexyFab 3D', subtitle = '' } = {}) {
  let scad, name;
  if (spec.assembly) {
    const b = buildAssembly(spec.assembly);
    if (!b.ok) throw new Error('assembly gate: ' + b.gateErrors.join('; '));
    scad = b.openscad; name = spec.assembly.name ?? 'assembly';
  } else if (spec.intent) {
    scad = toOpenScad(spec.intent); name = spec.intent.type;
  } else {
    throw new Error('renderHtml: spec.intent 또는 spec.assembly 필요');
  }
  const stl = await renderStl(scad);
  const b64 = bytesToBase64(stl);

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#eef1f4;font-family:'Segoe UI',sans-serif}
#hud{position:fixed;top:16px;left:20px;color:#2a3440;z-index:10}#hud h1{font-size:16px;margin:0 0 3px}#hud p{font-size:12px;margin:0;color:#5a6875}
#shot{position:fixed;top:16px;right:20px;z-index:10;padding:8px 14px;border:0;border-radius:8px;background:#2a3440;color:#fff;font-size:12px;cursor:pointer}</style></head>
<body><div id="hud"><h1>${esc(title)}</h1><p>${esc(subtitle || name)}</p></div><button id="shot">📷 PNG</button>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const B64="${b64}";
const r=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(innerWidth,innerHeight);r.setPixelRatio(Math.min(devicePixelRatio,2));
r.toneMapping=THREE.ACESFilmicToneMapping;r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(r.domElement);
const sc=new THREE.Scene();sc.background=new THREE.Color(0xeef1f4);sc.environment=new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(),0.04).texture;
const cam=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,1,1e5);const ctl=new OrbitControls(cam,r.domElement);ctl.enableDamping=true;
function b2a(b){const s=atob(b);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer;}
const g=new STLLoader().parse(b2a(B64));g.computeVertexNormals();
const root=new THREE.Group();root.rotation.x=-Math.PI/2;// CAD Z-up → three Y-up
const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xc8ccd2,metalness:0.9,roughness:0.34}));mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);sc.add(root);
const bb=new THREE.Box3().setFromObject(root);const sz=bb.getSize(new THREE.Vector3());const c=bb.getCenter(new THREE.Vector3());
const gr=new THREE.Mesh(new THREE.CircleGeometry(Math.max(sz.x,sz.y,sz.z)*2,64),new THREE.MeshStandardMaterial({color:0xe3e7eb,roughness:1}));gr.rotation.x=-Math.PI/2;gr.position.y=bb.min.y;gr.receiveShadow=true;sc.add(gr);
const d=Math.max(sz.x,sz.y,sz.z);const key=new THREE.DirectionalLight(0xffffff,2.2);key.position.set(d*1.3,d*1.8,d);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-d,right:d,top:d,bottom:-d,far:d*6});sc.add(key,new THREE.AmbientLight(0xffffff,0.25));
ctl.target.copy(c);cam.position.set(c.x+sz.x*1.15,c.y+sz.y*0.75,c.z+sz.z*2.1);
document.getElementById('shot').onclick=()=>{r.render(sc,cam);const a=document.createElement('a');a.download='render.png';a.href=r.domElement.toDataURL('image/png');a.click();};
addEventListener('resize',()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();r.setSize(innerWidth,innerHeight);});
(function loop(){requestAnimationFrame(loop);ctl.update();r.render(sc,cam);})();
</script></body></html>`;
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('html-render.mjs');
if (isMain && process.argv[2]) {
  const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const html = await renderHtml(spec.type ? { intent: spec } : spec);
  const out = process.argv[3] ?? 'render.html';
  writeFileSync(out, html);
  console.log('written', out, (html.length / 1024).toFixed(0) + 'KB');
}
