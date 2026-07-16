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
import { buildAssembly, COLOR_LABEL } from './assembly.mjs';
import { emitComposite } from './compose.mjs';
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
  } else if (spec.intent && Array.isArray(spec.intent.features)) {
    // 범용 자유조합 intent(compose_3d) — features[].kind
    scad = emitComposite(spec.intent); name = spec.intent.name ?? 'composite';
  } else if (spec.intent) {
    // 7어휘 재구성 intent — type
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

/**
 * 계통색 GA 3D — 피처 `_col`(assemblyToComposeIntent 가 부품 service/type 에서 전파) 별로
 * STL 을 따로 렌더해 three.js 다중메시로 합성한다. 배관·부품 계통이 색으로 구분됨 + 범례.
 * @param spec {assembly} 또는 {intent}(features[] with _col)
 */
export async function renderColoredHtml(spec, { title = 'NexyFab GA', subtitle = '' } = {}) {
  let features, name;
  if (spec.assembly) {
    const b = buildAssembly(spec.assembly);
    if (!b.ok) throw new Error('assembly gate: ' + (b.gateErrors ?? []).join('; '));
    features = b.composeIntent.features; name = spec.assembly.name ?? 'assembly';
  } else if (spec.intent && Array.isArray(spec.intent.features)) {
    features = spec.intent.features; name = spec.intent.name ?? 'composite';
  } else throw new Error('renderColoredHtml: spec.assembly 또는 spec.intent 필요');

  const groups = [...new Set(features.map((f) => f._col || '#9aa7b5'))];
  const meshes = [];
  for (const col of groups) {
    try {
      const stl = await renderStl(emitComposite({ name, features: features.filter((f) => (f._col || '#9aa7b5') === col) }));
      meshes.push({ col, b64: bytesToBase64(stl) });
    } catch { /* 빈/실패 그룹 skip */ }
  }
  if (!meshes.length) throw new Error('renderColoredHtml: 렌더된 메시 없음');
  const metal = new Set(['#3f4756', '#5b6472', '#59606b', '#9aa7b5', '#8b98a6', '#78838f', '#8a5a2b']);
  const mj = meshes.map((m) => `{b64:"${m.b64}",col:0x${m.col.slice(1)},metal:${metal.has(m.col) ? 0.9 : 0.28},rough:${metal.has(m.col) ? 0.35 : 0.45},label:${JSON.stringify(COLOR_LABEL[m.col] || '부품')}}`).join(',');
  // 조정 패널(2026-07-16 사용자 요청): 계통 표시 토글·계통 분해·단면(3축)·엣지·뷰 프리셋·자동회전·치수
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#eef1f4;font-family:'Segoe UI',sans-serif}
#hud{position:fixed;top:14px;left:18px;color:#2a3440;z-index:10}#hud h1{font-size:15px;margin:0 0 3px}#hud p{font-size:11px;margin:0;color:#5a6875}
#dims{position:fixed;left:18px;bottom:14px;z-index:10;font-size:11px;color:#334155;background:rgba(255,255,255,.85);padding:6px 12px;border-radius:8px;font-variant-numeric:tabular-nums}
#panel{position:fixed;top:14px;right:18px;z-index:10;width:212px;font-size:11px;color:#2a3440;background:rgba(255,255,255,.92);padding:10px 12px;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.12);max-height:calc(100% - 40px);overflow:auto}
#panel h2{font-size:11px;margin:8px 0 4px;color:#5a6875;font-weight:700}#panel h2:first-child{margin-top:0}
#panel label{display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer;line-height:1.5}
#panel input[type=range]{width:100%}
#panel .views{display:flex;gap:4px;flex-wrap:wrap}#panel .views button{flex:1;padding:4px 0;border:1px solid #cdd5de;border-radius:6px;background:#fff;font-size:10.5px;cursor:pointer}
#panel .sw{display:inline-block;width:10px;height:10px;border-radius:2px}
#shot{width:100%;margin-top:8px;padding:7px 0;border:0;border-radius:8px;background:#2a3440;color:#fff;font-size:12px;cursor:pointer}</style></head>
<body><div id="hud"><h1>${esc(title)}</h1><p>${esc(subtitle || name)}</p></div>
<div id="dims"></div>
<div id="panel">
  <h2>계통 표시</h2><div id="grp"></div>
  <h2>계통 분해</h2><input id="explode" type="range" min="0" max="100" value="0">
  <h2>단면</h2>
  <label><input id="secOn" type="checkbox"> 단면 켜기</label>
  <div class="views"><button data-ax="0">X</button><button data-ax="1">Y</button><button data-ax="2">Z</button></div>
  <input id="secPos" type="range" min="0" max="100" value="50">
  <h2>표시</h2>
  <label><input id="edges" type="checkbox"> 엣지 라인</label>
  <label><input id="rot" type="checkbox"> 자동 회전</label>
  <label><input id="dark" type="checkbox"> 어두운 배경</label>
  <h2>뷰</h2><div class="views"><button data-v="iso">ISO</button><button data-v="front">정면</button><button data-v="top">평면</button><button data-v="side">측면</button></div>
  <button id="shot">📷 PNG</button>
</div>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.160.0/build/three.module.js","three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
import*as THREE from'three';import{OrbitControls}from'three/addons/controls/OrbitControls.js';import{STLLoader}from'three/addons/loaders/STLLoader.js';import{RoomEnvironment}from'three/addons/environments/RoomEnvironment.js';
const M=[${mj}];const r=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(innerWidth,innerHeight);r.setPixelRatio(Math.min(devicePixelRatio,2));r.toneMapping=THREE.ACESFilmicToneMapping;r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;r.localClippingEnabled=true;document.body.appendChild(r.domElement);
const sc=new THREE.Scene();sc.background=new THREE.Color(0xeef1f4);sc.environment=new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(),0.04).texture;
const cam=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,1,1e5);const ctl=new OrbitControls(cam,r.domElement);ctl.enableDamping=true;
function b2a(b){const s=atob(b);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer}
const root=new THREE.Group();root.rotation.x=-Math.PI/2;const ld=new STLLoader();
const clip=new THREE.Plane(new THREE.Vector3(-1,0,0),1e9);
const items=[];
for(const m of M){const g=ld.parse(b2a(m.b64));g.computeVertexNormals();
  const mat=new THREE.MeshStandardMaterial({color:m.col,metalness:m.metal,roughness:m.rough,clippingPlanes:[clip],clipShadows:true});
  const me=new THREE.Mesh(g,mat);me.castShadow=me.receiveShadow=true;root.add(me);
  const eg=new THREE.LineSegments(new THREE.EdgesGeometry(g,28),new THREE.LineBasicMaterial({color:0x27313d,transparent:true,opacity:.55,clippingPlanes:[clip]}));eg.visible=false;me.add(eg);
  items.push({m,me,eg,base:null,dir:null});}
sc.add(root);
const bb=new THREE.Box3().setFromObject(root);const sz=bb.getSize(new THREE.Vector3());const c=bb.getCenter(new THREE.Vector3());
for(const it of items){const b=new THREE.Box3().setFromObject(it.me);const cc=b.getCenter(new THREE.Vector3());it.base=it.me.position.clone();
  const dw=root.worldToLocal(cc.clone()).sub(root.worldToLocal(c.clone()));it.dir=dw.lengthSq()<1e-6?new THREE.Vector3(0,0,1):dw.normalize();}
const gr=new THREE.Mesh(new THREE.CircleGeometry(Math.max(sz.x,sz.y,sz.z)*2,64),new THREE.MeshStandardMaterial({color:0xe3e7eb,roughness:1}));gr.rotation.x=-Math.PI/2;gr.position.y=bb.min.y;gr.receiveShadow=true;sc.add(gr);
const d=Math.max(sz.x,sz.y,sz.z);const key=new THREE.DirectionalLight(0xffffff,2.2);key.position.set(d*1.3,d*1.8,d);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-d,right:d,top:d,bottom:-d,far:d*6});sc.add(key,new THREE.AmbientLight(0xffffff,0.28));
ctl.target.copy(c);
const V={iso:[c.x+sz.x*1.25,c.y+sz.y*0.7,c.z+sz.z*2.1],front:[c.x,c.y,c.z+d*2.2],top:[c.x,c.y+d*2.2,c.z+1],side:[c.x+d*2.2,c.y,c.z]};
cam.position.set(...V.iso);
document.getElementById('dims').textContent='전체 W '+Math.round(sz.x)+' × D '+Math.round(sz.z)+' × H '+Math.round(sz.y)+' mm · 드래그=회전 · 휠=줌';
// 계통 토글
const grp=document.getElementById('grp');
items.forEach((it,i)=>{const l=document.createElement('label');l.innerHTML='<input type="checkbox" checked><span class="sw" style="background:#'+it.m.col.toString(16).padStart(6,'0')+'"></span>'+it.m.label;
  l.querySelector('input').onchange=(e)=>{it.me.visible=e.target.checked};grp.appendChild(l);});
// 분해(계통 단위 — 부품 단위 분해는 후속)
document.getElementById('explode').oninput=(e)=>{const f=e.target.value/100*d*0.45;for(const it of items)it.me.position.copy(it.base).addScaledVector(it.dir,f)};
// 단면
let axis=0;const axV=[new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,-1,0)];// X/Y(CAD)/Z(CAD=three Y)
const secOn=document.getElementById('secOn'),secPos=document.getElementById('secPos');
function updClip(){if(!secOn.checked){clip.constant=1e9;return}const n=axV[axis];clip.normal.copy(n);
  const mn=bb.min,mx=bb.max,t=secPos.value/100;
  const lo=axis===0?mn.x:axis===1?mn.z:mn.y,hi=axis===0?mx.x:axis===1?mx.z:mx.y;
  clip.constant=-(lo+(hi-lo)*t)*(axis===1?-1:1)*(axis===2?-1:1)*-1;
  // 부호 안정화: 평면점 p에서 constant=-n·p
  const p=new THREE.Vector3(axis===0?lo+(hi-lo)*t:c.x,axis===2?lo+(hi-lo)*t:c.y,axis===1?lo+(hi-lo)*t:c.z);
  clip.constant=-n.dot(p);}
secOn.onchange=updClip;secPos.oninput=updClip;
document.querySelectorAll('#panel .views button[data-ax]').forEach(b=>b.onclick=()=>{axis=+b.dataset.ax;secOn.checked=true;updClip()});
// 엣지·회전·배경
document.getElementById('edges').onchange=(e)=>{for(const it of items)it.eg.visible=e.target.checked};
document.getElementById('rot').onchange=(e)=>{ctl.autoRotate=e.target.checked;ctl.autoRotateSpeed=1.4};
document.getElementById('dark').onchange=(e)=>{sc.background=new THREE.Color(e.target.checked?0x121a2e:0xeef1f4);gr.material.color.set(e.target.checked?0x1a2438:0xe3e7eb)};
document.querySelectorAll('#panel .views button[data-v]').forEach(b=>b.onclick=()=>{cam.position.set(...V[b.dataset.v]);ctl.target.copy(c)});
document.getElementById('shot').onclick=()=>{r.render(sc,cam);const a=document.createElement('a');a.download='GA.png';a.href=r.domElement.toDataURL('image/png');a.click()};
addEventListener('resize',()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();r.setSize(innerWidth,innerHeight)});
(function loop(){requestAnimationFrame(loop);ctl.update();r.render(sc,cam)})();
</script></body></html>`;
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('html-render.mjs');
if (isMain && process.argv[2]) {
  const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const html = await renderHtml(spec.type || Array.isArray(spec.features) ? { intent: spec } : spec);
  const out = process.argv[3] ?? 'render.html';
  writeFileSync(out, html);
  console.log('written', out, (html.length / 1024).toFixed(0) + 'KB');
}
