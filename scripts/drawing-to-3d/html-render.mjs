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

// ── H1 오프라인 자립화(260718 — 현장 인터넷 없음): three.js 를 data: URL 로 인라인.
// CDN(unpkg) 의존 제거 — 단일 HTML 파일이 오프라인에서 완전 작동. 메모화(1회 로딩).
import { createRequire as _cr } from 'node:module';
let _OFFLINE_IMPORTMAP = null;
function offlineImportMap() {
  if (_OFFLINE_IMPORTMAP) return _OFFLINE_IMPORTMAP;
  const req = _cr(import.meta.url);
  // three 패키지 루트: resolve 경로에서 /three/ 까지 절단
  const cand = req.resolve('three').split('\\').join('/');
  const base = cand.slice(0, cand.indexOf('/three/') + '/three/'.length);
  const dataUrl = (p) => 'data:text/javascript;base64,' + readFileSync(p).toString('base64');
  const b = (rel) => dataUrl(base + rel);
  // three r170+ 는 three.module.min.js 가 ./three.core.min.js 를 상대 임포트 — data: URL
  // 모듈은 상대 해석 불가(base 비계층). bare 지정자 'three-core' 로 치환 + 맵에 등록.
  const threeSrc = readFileSync(base + 'build/three.module.min.js', 'utf8');
  const hasCore = threeSrc.includes('./three.core.min.js');
  const threePatched = hasCore
    ? threeSrc.split('"./three.core.min.js"').join('"three-core"').split("'./three.core.min.js'").join("'three-core'")
    : threeSrc;
  const toData = (txt) => 'data:text/javascript;base64,' + Buffer.from(txt).toString('base64');
  _OFFLINE_IMPORTMAP = JSON.stringify({ imports: {
    'three': toData(threePatched),
    ...(hasCore ? { 'three-core': b('build/three.core.min.js') } : {}),
    'three/addons/controls/OrbitControls.js': b('examples/jsm/controls/OrbitControls.js'),
    'three/addons/loaders/STLLoader.js': b('examples/jsm/loaders/STLLoader.js'),
    'three/addons/environments/RoomEnvironment.js': b('examples/jsm/environments/RoomEnvironment.js'),
  } });
  return _OFFLINE_IMPORTMAP;
}

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
<script type="importmap">${offlineImportMap()}</script>
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
// 카메라 FOV 피팅(260717 예시폴더 점검: 축별 배수는 세장 형상 잘림·far 1e5 고정은 km급 클리핑)
const fit=(d/2)/Math.tan(cam.fov*Math.PI/360)*1.4;
cam.near=Math.max(d/1000,0.1);cam.far=fit*30;cam.updateProjectionMatrix();
ctl.target.copy(c);cam.position.copy(c).add(new THREE.Vector3(0.55,0.45,1).normalize().multiplyScalar(fit));
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
export async function renderColoredHtml(spec, { title = 'NexyFab GA', subtitle = '', parts = null, colorLabels = null } = {}) {
  let features, name;
  if (spec.assembly) {
    const b = buildAssembly(spec.assembly);
    if (!b.ok) throw new Error('assembly gate: ' + (b.gateErrors ?? []).join('; '));
    features = b.composeIntent.features; name = spec.assembly.name ?? 'assembly';
    if (!parts && Array.isArray(spec.assembly.parts)) {
      // 부품 피킹 데이터 자동 유도(260718t 수정: buildAssembly().parts 는 {id,aabb}뿐이라
      // partAabb(type,params) 호출이 전부 실패 → 검색 패널이 항상 빠지던 버그 —
      // 원본 assembly.parts + placedAabb(회전 인지 월드 AABB)로 유도)
      const { placedAabb } = await import('./assembly.mjs');
      parts = spec.assembly.parts.map((p) => {
        try {
          const ab = placedAabb(p);
          return { label: p.id ?? p.type, desc: [p.type, p.role, p.service, p.material].filter(Boolean).join(' · '), min: ab.min, max: ab.max };
        } catch { return null; }
      }).filter(Boolean);
    }
  } else if (spec.intent && Array.isArray(spec.intent.features)) {
    features = spec.intent.features; name = spec.intent.name ?? 'composite';
  } else throw new Error('renderColoredHtml: spec.assembly 또는 spec.intent 필요');

  // 계통 그룹핑(260719): 부품 system 라벨 우선 — 같은 색이라도 계통이 다르면 별도 토글.
  // system 미지정 피처는 기존 색 그룹 유지(하위호환).
  const gkey = (f) => f._sys || f._col || '#9aa7b5';
  const groups = [...new Set(features.map(gkey))];
  const meshes = [];
  // 바이너리 STL 병합(부품별 렌더 결과를 한 색 그룹 메시로)
  const mergeStls = (stls) => {
    const cnt = (s) => new DataView(s.buffer, s.byteOffset).getUint32(80, true);
    const total = stls.reduce((n, s) => n + cnt(s), 0);
    const out = new Uint8Array(84 + total * 50);
    new DataView(out.buffer).setUint32(80, total, true);
    let o = 84;
    for (const s of stls) { const n = cnt(s); out.set(s.subarray(84, 84 + n * 50), o); o += n * 50; }
    return out;
  };
  for (const key of groups) {
    const fl = features.filter((f) => gkey(f) === key);
    const col = fl.find((f) => f._col)?._col ?? '#9aa7b5';
    const label = fl[0]?._sys ?? null;
    try {
      let stl;
      const pids = [...new Set(fl.map((f) => f._pid))];
      if (pids.length > 1 || pids[0] !== undefined) {
        // 부품 스코프(_pid, 260718t): 같은 색 그룹이라도 subtract 는 자기 부품만 깎는다
        // (전역 subtract 가 동색 이웃 부품을 삭제하던 번짐 수정) — 부품별 렌더 후 병합.
        const per = [];
        for (const pid of pids) {
          try { per.push(await renderStl(emitComposite({ name, features: fl.filter((f) => f._pid === pid) }))); }
          catch { /* 부품 실패 skip — 아래 빈 그룹 검사 */ }
        }
        if (!per.length) throw new Error('empty group');
        stl = mergeStls(per);
      } else {
        stl = await renderStl(emitComposite({ name, features: fl }));
      }
      meshes.push({ col, b64: bytesToBase64(stl), label });
    } catch { /* 빈/실패 그룹 skip */ }
  }
  if (!meshes.length) throw new Error('renderColoredHtml: 렌더된 메시 없음');
  const metal = new Set(['#3f4756', '#5b6472', '#59606b', '#9aa7b5', '#8b98a6', '#78838f', '#8a5a2b']);
  // 뷰 전용 명도 보정(Phase1-③): 짙은 구조색이 ACES+PBR에서 검게 뭉개짐 — 3D 표시만 밝게,
  // 범례·도면 계통색 의미는 불변(SERVICE_COL 원본 유지).
  const viewCol = (c) => ({ '#3f4756': '#5a6478', '#5b6472': '#727c8c', '#59606b': '#6e7683' }[c] ?? c);
  const mj = meshes.map((m) => `{b64:"${m.b64}",col:0x${viewCol(m.col).slice(1)},metal:${metal.has(m.col) ? 0.85 : 0.3},rough:${metal.has(m.col) ? 0.32 : 0.42},label:${JSON.stringify(m.label || (colorLabels && colorLabels[m.col]) || COLOR_LABEL[m.col] || '부품')}}`).join(',');
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
#shot{width:100%;margin-top:8px;padding:7px 0;border:0;border-radius:8px;background:#2a3440;color:#fff;font-size:12px;cursor:pointer}
#tip{position:fixed;display:none;z-index:20;pointer-events:none;background:rgba(15,23,42,.92);color:#fff;font-size:11px;padding:4px 9px;border-radius:6px;max-width:280px}
#info{position:fixed;display:none;z-index:20;left:18px;bottom:52px;background:rgba(255,255,255,.95);border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.15);padding:10px 14px;font-size:12px;color:#1f2937;max-width:320px}
#info .fx{margin-top:3px;font-size:11px;color:#475569;line-height:1.5}#info .sz{margin-top:3px;font-size:11px;color:#0f766e;font-variant-numeric:tabular-nums}#info .cl{margin-top:5px;font-size:9.5px;color:#94a3b8}</style></head>
<body><div id="hud"><h1>${esc(title)}</h1><p>${esc(subtitle || name)}</p></div>
<div id="dims"></div><div id="tip"></div><div id="info"></div>
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
<script type="importmap">${offlineImportMap()}</script>
<script type="module">
import*as THREE from'three';import{OrbitControls}from'three/addons/controls/OrbitControls.js';import{STLLoader}from'three/addons/loaders/STLLoader.js';import{RoomEnvironment}from'three/addons/environments/RoomEnvironment.js';
const M=[${mj}];const PARTS=${JSON.stringify((parts ?? []).map((p) => ({ l: p.label, d: p.desc ?? '', n: p.min, x: p.max })))};const r=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(innerWidth,innerHeight);r.setPixelRatio(Math.min(devicePixelRatio,2));r.toneMapping=THREE.ACESFilmicToneMapping;r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;r.localClippingEnabled=true;document.body.appendChild(r.domElement);
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
// FOV 피팅(260717 예시폴더 점검: far 1e5 고정=1.3km 모델 전체 클리핑 → 스케일 연동)
const fit=(d/2)/Math.tan(cam.fov*Math.PI/360)*1.4;
cam.near=Math.max(d/1000,0.1);cam.far=fit*30;cam.updateProjectionMatrix();
const isoD=new THREE.Vector3(0.55,0.45,1).normalize().multiplyScalar(fit);
const V={iso:[c.x+isoD.x,c.y+isoD.y,c.z+isoD.z],front:[c.x,c.y,c.z+fit],top:[c.x,c.y+fit,c.z+d*0.01],side:[c.x+fit,c.y,c.z]};
cam.position.set(...V.iso);
document.getElementById('dims').textContent='전체 W '+Math.round(sz.x)+' × D '+Math.round(sz.z)+' × H '+Math.round(sz.y)+' mm · 드래그=회전 · 휠=줌 · 호버/클릭=부품 정보';
// 부품 피킹 — 계통별 병합 메시라 개별 메시 선택 불가 → 히트점을 모델좌표로 되돌려
// 부품 AABB 포함검사(최소 부피 우선). 부품 미매칭이면 계통 라벨 폴백.
const tip=document.getElementById('tip'),info=document.getElementById('info');
const ray=new THREE.Raycaster();const mou=new THREE.Vector2();let hiBox=null;
items.forEach(it=>{it.me.userData.label=it.m.label});
function pick(ev){const rc=r.domElement.getBoundingClientRect();mou.x=((ev.clientX-rc.left)/rc.width)*2-1;mou.y=-((ev.clientY-rc.top)/rc.height)*2+1;ray.setFromCamera(mou,cam);
  const hits=ray.intersectObjects(items.filter(i=>i.me.visible).map(i=>i.me),false);if(!hits.length)return null;
  const h=hits[0];const lp=root.worldToLocal(h.point.clone());const pad=2;let best=null,bv=1e18;
  for(const p of PARTS){if(lp.x<p.n[0]-pad||lp.x>p.x[0]+pad||lp.y<p.n[1]-pad||lp.y>p.x[1]+pad||lp.z<p.n[2]-pad||lp.z>p.x[2]+pad)continue;
    const v=(p.x[0]-p.n[0])*(p.x[1]-p.n[1])*(p.x[2]-p.n[2]);if(v<bv){bv=v;best=p}}
  return {part:best,group:(h.object.userData&&h.object.userData.label)||'',};}
let rafP=0;
addEventListener('pointermove',(ev)=>{if(rafP)return;rafP=requestAnimationFrame(()=>{rafP=0;
  const res=pick(ev);
  if(res&&(res.part||res.group)){tip.style.display='block';tip.style.left=(ev.clientX+14)+'px';tip.style.top=(ev.clientY+10)+'px';
    tip.textContent=res.part?res.part.l:res.group;r.domElement.style.cursor='pointer';}
  else{tip.style.display='none';r.domElement.style.cursor='';}});});
addEventListener('click',(ev)=>{if(ev.target!==r.domElement)return;const res=pick(ev);
  if(hiBox){root.remove(hiBox);hiBox=null;}
  if(!res){info.style.display='none';return}
  const p=res.part;
  info.style.display='block';
  if(p){const w=Math.round(p.x[0]-p.n[0]),dd=Math.round(p.x[1]-p.n[1]),hh=Math.round(p.x[2]-p.n[2]);
    info.innerHTML='<b>'+p.l+'</b>'+(p.d?'<div class="fx">'+p.d+'</div>':'')+'<div class="sz">'+w+' × '+dd+' × '+hh+' mm (AABB)</div><div class="cl">계통: '+res.group+' · 빈 곳 클릭=닫기</div>';
    const b3=new THREE.Box3(new THREE.Vector3(p.n[0],p.n[1],p.n[2]),new THREE.Vector3(p.x[0],p.x[1],p.x[2]));
    hiBox=new THREE.Box3Helper(b3,0xff8800);root.add(hiBox);}
  else{info.innerHTML='<b>'+res.group+'</b><div class="fx">계통(배관·부속) — 부품 단위 정보 없음</div><div class="cl">빈 곳 클릭=닫기</div>';}});
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

// H3 현장 검색(260718): 부품명 검색 → AABB 하이라이트 박스 + 카메라 이동 없음(맥락 유지)
(function(){
  if(!PARTS||!PARTS.length)return;
  var panel=document.getElementById('panel'); if(!panel)return;
  var wrap=document.createElement('div'); wrap.style.cssText='margin:8px 0;border-top:1px solid #e2e8f0;padding-top:6px';
  wrap.innerHTML='<input id="nfq" placeholder="부품 검색(예: pump)" style="width:100%;box-sizing:border-box;padding:4px 6px;font-size:11px;border:1px solid #cbd5e1;border-radius:6px"/><div id="nfqr" style="max-height:120px;overflow:auto;margin-top:4px"></div>';
  panel.insertBefore(wrap, panel.firstChild.nextSibling);
  var hl=null;
  function highlight(p){
    if(hl){sc.remove(hl);hl=null;}
    var b=new THREE.Box3(new THREE.Vector3(p.n[0],p.n[2],-p.x[1]),new THREE.Vector3(p.x[0],p.x[2],-p.n[1]));
    hl=new THREE.Box3Helper(b,0xff2d55); sc.add(hl);
    setTimeout(function(){if(hl){sc.remove(hl);hl=null;}},4000);
  }
  document.getElementById('nfq').addEventListener('input',function(){
    var q=this.value.trim().toLowerCase(); var out=document.getElementById('nfqr'); out.innerHTML='';
    if(q.length<2)return;
    PARTS.filter(function(p){return (p.l+' '+(p.d||'')).toLowerCase().includes(q)}).slice(0,12).forEach(function(p){
      var d2=document.createElement('div'); d2.textContent=p.l; d2.style.cssText='cursor:pointer;padding:2px 4px;border-radius:4px;font-size:11px';
      d2.onmouseenter=function(){d2.style.background='#eef2ff'}; d2.onmouseleave=function(){d2.style.background=''};
      d2.onclick=function(){highlight(p)}; out.appendChild(d2);
    });
  });
})();
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
