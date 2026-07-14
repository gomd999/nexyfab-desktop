'use client';

/**
 * AssemblyViewer3D — 어셈블리 3D 픽킹 뷰어 (P2: "사람이 면을 잡으면 파라미터가 잡힌다").
 *
 * 각 파트를 로컬 AABB 박스 + at 배치(tx/ty/tz, rz 90° 지원 — OpenSCAD translate·rotate
 * 규약: world = T · Rz · local)로 렌더하고, 클릭 레이캐스트로 파트·면(±x/±y/±z 로컬 키)을
 * 판정한 뒤 /api/nexyfab/drawing/face-map 에 {type, face}로 질의해 onPick 으로 돌려준다.
 * 면 법선은 지오메트리 오브젝트 공간(=파트 로컬)에서 읽으므로 rz 역회전이 필요 없다.
 *
 * 픽킹 모드 3종:
 *  - face : 면 1개 → 파라미터 1개 (기존)
 *  - edge : 모서리(면 2개 교차, Alt+클릭으로도 진입) — face-map 2회 호출을 클라에서 병합
 *           (scripts/drawing-to-3d/face-param-map.mjs mapEdge 미러 — 라우트 추가 금지)
 *  - dist : 파트 A→B 순서 클릭 → 중심차 지배축('x'|'y')·간격(mm) — 매핑은 패널(DISTANCE_MAP 미러)
 *
 * plain three (react-three-fiber 아님) — 번들 예측 가능성 유지. 부모(next/dynamic ssr:false)
 * 에서만 로드되고, 장면 생성은 useEffect(마운트 후)에서만 수행한다.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ViewerPart {
  id?: string;
  type?: string;
  role?: string;
  material?: string;
  params?: Record<string, unknown>;
  at?: { tx?: number; ty?: number; tz?: number; rx?: number; ry?: number; rz?: number };
  aabb?: { min: number[]; max: number[] };
}

export interface FaceMapResult {
  ok?: boolean;
  param?: string;
  dragSign?: number;
  face?: string;
  reason?: string;
  sectionParams?: string[];
  note?: string;
  error?: string;
}

export interface EdgeCandidate { param: string; face: string; dragSign?: number }

export type PickMode = 'face' | 'edge' | 'dist';

export type PickEvent =
  | { kind: 'face'; partId: string; type: string; face: string; mapResult: FaceMapResult }
  | { kind: 'edge'; partId: string; type: string; faces: [string, string]; candidates: EdgeCandidate[]; sectionParams?: string[]; note?: string; error?: string }
  | { kind: 'dist-pending'; partId: string }
  | { kind: 'dist'; aId: string; bId: string; roleA?: string; roleB?: string; axis: 'x' | 'y'; distanceMm: number };

// 계통색 — scripts/drawing-to-3d/assembly.mjs SERVICE_COL(role) 미러 + 해시 폴백
const ROLE_COL: Record<string, string> = {
  column: '#475569', beam: '#0e7490', girder: '#0e7490', crossbeam: '#5b6472',
  slab: '#94a3b8', joist: '#854d0e', deck: '#a16207', floor: '#d1d5db',
  table: '#0f766e', counter: '#7c3aed', wall: '#78716c', base: '#57534e', frame: '#3f4756',
};
function colorOf(p: ViewerPart): string {
  if (p.role && ROLE_COL[p.role]) return ROLE_COL[p.role];
  const key = p.role ?? p.type ?? 'part';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 35%, 55%)`;
}

type FaceKey = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/** 오브젝트 공간(=파트 로컬) 법선 → 지배축 면 키. */
function dominantFace(n: THREE.Vector3): FaceKey {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ax >= ay && ax >= az) return n.x >= 0 ? '+x' : '-x';
  if (ay >= az) return n.y >= 0 ? '+y' : '-y';
  return n.z >= 0 ? '+z' : '-z';
}

const deg = (v?: number) => ((v ?? 0) * Math.PI) / 180;

const HOVER_EMISSIVE = 0x2a3a55;
const PENDING_EMISSIVE = 0x1d4ed8; // 거리 모드 기준 파트 하이라이트

export default function AssemblyViewer3D({
  parts,
  onPick,
  mode = 'face',
  unit = 'mm',
  height = 260,
}: {
  parts: ViewerPart[];
  onPick?: (pick: PickEvent) => void;
  mode?: PickMode;
  unit?: 'mm' | 'm'; // 치수선 라벨 표시 단위 (좌표·픽킹은 mm 고정)
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const partsRef = useRef(parts);
  partsRef.current = parts;
  const cbRef = useRef(onPick);
  cbRef.current = onPick;
  const modeRef = useRef<PickMode>(mode);
  modeRef.current = mode;
  const unitRef = useRef<'mm' | 'm'>(unit);
  unitRef.current = unit;
  const lastPickRef = useRef<{ partId: string; faces: FaceKey[] } | null>(null);
  const apiRef = useRef<{ setParts: (list: ViewerPart[]) => void; setMode: (m: PickMode) => void; refreshOverlays: () => void } | null>(null);

  useEffect(() => {
    apiRef.current?.setParts(parts);
  }, [parts]);

  useEffect(() => {
    apiRef.current?.setMode(mode);
  }, [mode]);

  // 단위 토글 시 치수선 라벨 재생성 (표시 전용)
  useEffect(() => {
    apiRef.current?.refreshOverlays();
  }, [unit]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // WebGL 불가 환경 — 뷰어만 조용히 생략(빌드/체인 기능은 무관)
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.borderRadius = '8px';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e6);
    camera.up.set(0, 0, 1); // OpenSCAD/mm 규약 — Z up
    camera.position.set(3000, -4000, 2500);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8895a5, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(1, -0.7, 1.4);
    scene.add(dir);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    let group = new THREE.Group();
    scene.add(group);
    let pickables: THREE.Mesh[] = [];
    const holderByPart = new Map<string, { holder: THREE.Group; part: ViewerPart }>();
    let hovered: THREE.Mesh | null = null;
    let overlays: THREE.Object3D[] = []; // 면 하이라이트 + ⑦ 치수선(라인·화살촉·라벨 스프라이트)
    let fitted = false;
    let disposed = false;
    let modeLocal: PickMode = modeRef.current;
    let pendingA: { mesh: THREE.Mesh; partId: string; part: ViewerPart } | null = null;

    const disposeObj = (o: THREE.Object3D) => {
      const spr = o as THREE.Sprite;
      if (spr.isSprite) { // Sprite.geometry는 three 전역 공유 — geometry dispose 금지, 머티리얼·텍스처만
        if (spr.material.map) spr.material.map.dispose();
        spr.material.dispose();
        return;
      }
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    };

    const clearPending = () => {
      if (pendingA) {
        const m = pendingA.mesh;
        pendingA = null;
        (m.material as THREE.MeshLambertMaterial).emissive.setHex(m === hovered ? HOVER_EMISSIVE : 0x000000);
      }
    };

    const clearOverlays = () => {
      for (const ov of overlays) {
        ov.parent?.remove(ov);
        disposeObj(ov);
      }
      overlays = [];
    };

    const makeFacePlane = (part: ViewerPart, face: FaceKey): THREE.Mesh | null => {
      if (!part.aabb) return null;
      const [x0, y0, z0] = part.aabb.min;
      const [x1, y1, z1] = part.aabb.max;
      const dx = Math.max(0.5, x1 - x0), dy = Math.max(0.5, y1 - y0), dz = Math.max(0.5, z1 - z0);
      const EPS = Math.max(0.5, Math.max(dx, dy, dz) * 0.002);
      const pos = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      let geo: THREE.PlaneGeometry;
      switch (face) {
        case '+x': geo = new THREE.PlaneGeometry(dz, dy); geo.rotateY(Math.PI / 2); pos.x = x1 + EPS; break;
        case '-x': geo = new THREE.PlaneGeometry(dz, dy); geo.rotateY(-Math.PI / 2); pos.x = x0 - EPS; break;
        case '+y': geo = new THREE.PlaneGeometry(dx, dz); geo.rotateX(-Math.PI / 2); pos.y = y1 + EPS; break;
        case '-y': geo = new THREE.PlaneGeometry(dx, dz); geo.rotateX(Math.PI / 2); pos.y = y0 - EPS; break;
        case '+z': geo = new THREE.PlaneGeometry(dx, dy); pos.z = z1 + EPS; break;
        default: geo = new THREE.PlaneGeometry(dx, dy); geo.rotateX(Math.PI); pos.z = z0 - EPS; break;
      }
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
      );
      m.position.copy(pos);
      return m;
    };

    // Round5 ③ 표시 단위 — 치수선 라벨만 변환(좌표는 mm 고정)
    const fmtLen = (v: number) => (unitRef.current === 'm' ? `${(v / 1000).toFixed(3)}m` : `${Math.round(v)}mm`);

    /** ⑦ 치수선 — 라인 + 양끝 원뿔 화살촉 + CanvasTexture 스프라이트 라벨. parent 좌표계 기준. */
    const makeDim = (a: THREE.Vector3, b: THREE.Vector3, text: string, parent: THREE.Object3D) => {
      const dirV = new THREE.Vector3().subVectors(b, a);
      const len = dirV.length();
      if (len < 1) return;
      const dirN = dirV.clone().normalize();
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: 0x111827 }),
      );
      parent.add(line); overlays.push(line);
      const coneLen = Math.max(4, len * 0.04), coneR = coneLen * 0.35;
      for (const [tip, d] of [[a, dirN.clone().negate()], [b, dirN]] as Array<[THREE.Vector3, THREE.Vector3]>) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneLen, 10), new THREE.MeshBasicMaterial({ color: 0x111827 }));
        cone.position.copy(tip).addScaledVector(d, -coneLen / 2);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        parent.add(cone); overlays.push(cone);
      }
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(0, 0, 256, 64);
        ctx.strokeStyle = '#94a3b8'; ctx.strokeRect(0, 0, 256, 64);
        ctx.fillStyle = '#111827'; ctx.font = 'bold 30px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 32);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
        const w = Math.max(len * 0.28, coneLen * 6);
        sp.scale.set(w, w / 4, 1);
        sp.position.copy(a).addScaledVector(dirV, 0.5).addScaledVector(new THREE.Vector3(0, 0, 1), Math.max(len * 0.05, coneR * 2));
        parent.add(sp); overlays.push(sp);
      }
    };

    const applyOverlays = (partId: string, faces: FaceKey[]) => {
      clearOverlays();
      const rec = holderByPart.get(partId);
      if (!rec?.part.aabb) return;
      for (const face of faces) {
        const plane = makeFacePlane(rec.part, face);
        if (plane) {
          rec.holder.add(plane);
          overlays.push(plane);
        }
      }
      // ⑦ 면 픽킹(단일 면)일 때: 매핑 파라미터 축 방향의 AABB 전장 치수선
      if (faces.length === 1) {
        const [x0, y0, z0] = rec.part.aabb.min;
        const [x1, y1, z1] = rec.part.aabb.max;
        const off = Math.max(x1 - x0, y1 - y0, z1 - z0, 10) * 0.1;
        const axis = faces[0][1];
        let a: THREE.Vector3, b: THREE.Vector3, ext: number;
        if (axis === 'x') { a = new THREE.Vector3(x0, y1 + off, z1 + off); b = new THREE.Vector3(x1, y1 + off, z1 + off); ext = x1 - x0; }
        else if (axis === 'y') { a = new THREE.Vector3(x1 + off, y0, z1 + off); b = new THREE.Vector3(x1 + off, y1, z1 + off); ext = y1 - y0; }
        else { a = new THREE.Vector3(x1 + off, y1 + off, z0); b = new THREE.Vector3(x1 + off, y1 + off, z1); ext = z1 - z0; }
        makeDim(a, b, fmtLen(ext), rec.holder);
      }
    };

    const buildParts = (list: ViewerPart[]) => {
      overlays = []; // group 폐기와 함께 사라짐
      hovered = null;
      pendingA = null;
      group.traverse(disposeObj);
      scene.remove(group);
      group = new THREE.Group();
      pickables = [];
      holderByPart.clear();

      list.forEach((p, i) => {
        if (!p.aabb?.min || !p.aabb?.max || p.aabb.min.length !== 3 || p.aabb.max.length !== 3) return;
        const partId = p.id ?? `${p.type ?? 'part'}_${i}`;
        const [x0, y0, z0] = p.aabb.min;
        const [x1, y1, z1] = p.aabb.max;
        const dx = Math.max(0.5, x1 - x0), dy = Math.max(0.5, y1 - y0), dz = Math.max(0.5, z1 - z0);
        const geo = new THREE.BoxGeometry(dx, dy, dz);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color(colorOf(p)) }));
        mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        mesh.userData.part = p;
        mesh.userData.partId = partId;
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.35 }),
        );
        edges.position.copy(mesh.position);

        // OpenSCAD 규약: world = T(tx,ty,tz) · R(rx→ry→rz, 월드축 순) · local
        // three 'ZYX' 내재 회전 = 외재 X→Y→Z 와 동일 행렬 (rz=90: x'=tx−y, y'=ty+x 재현)
        const holder = new THREE.Group();
        const at = p.at ?? {};
        holder.position.set(at.tx ?? 0, at.ty ?? 0, at.tz ?? 0);
        holder.rotation.set(deg(at.rx), deg(at.ry), deg(at.rz), 'ZYX');
        holder.add(mesh);
        holder.add(edges);
        group.add(holder);
        pickables.push(mesh);
        holderByPart.set(partId, { holder, part: p });
      });
      scene.add(group);

      const bb = new THREE.Box3().setFromObject(group);
      if (!bb.isEmpty()) {
        const c = bb.getCenter(new THREE.Vector3());
        const s = bb.getSize(new THREE.Vector3());
        const r = Math.max(s.x, s.y, s.z, 100);
        if (!fitted) {
          camera.position.set(c.x + r * 0.9, c.y - r * 1.1, c.z + r * 0.8);
          controls.target.copy(c);
          fitted = true;
        }
        camera.near = Math.max(0.1, r / 200);
        camera.far = r * 40;
        camera.updateProjectionMatrix();
      }
      // 리빌드(파라미터 수정) 후에도 선택 하이라이트 유지 — 스테퍼 연타 UX
      if (lastPickRef.current) applyOverlays(lastPickRef.current.partId, lastPickRef.current.faces);
    };

    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    interface Hit { mesh: THREE.Mesh; part: ViewerPart; partId: string; faceKey: FaceKey; local: THREE.Vector3 }
    const pickAt = (ev: PointerEvent): Hit | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      if (!hit?.face) return null;
      const mesh = hit.object as THREE.Mesh;
      return {
        mesh,
        part: mesh.userData.part as ViewerPart,
        partId: String(mesh.userData.partId),
        faceKey: dominantFace(hit.face.normal), // 오브젝트 공간 = 파트 로컬 (rz 역회전 불필요)
        local: mesh.worldToLocal(hit.point.clone()), // 메시 로컬(박스 중심 원점) 히트점 — 모서리 판정용
      };
    };

    const setHover = (mesh: THREE.Mesh | null) => {
      if (hovered === mesh) return;
      if (hovered && hovered !== pendingA?.mesh) (hovered.material as THREE.MeshLambertMaterial).emissive.setHex(0x000000);
      hovered = mesh;
      if (hovered && hovered !== pendingA?.mesh) (hovered.material as THREE.MeshLambertMaterial).emissive.setHex(HOVER_EMISSIVE);
      renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.buttons) return; // 드래그(궤도 조작) 중엔 호버 갱신 생략
      setHover(pickAt(ev)?.mesh ?? null);
    };

    const fetchFaceMap = async (type: string, face: string): Promise<FaceMapResult> => {
      try {
        const res = await fetch('/api/nexyfab/drawing/face-map/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, face }),
        });
        return (await res.json()) as FaceMapResult;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    };

    /** 모서리 판정 — 히트점에서 가장 가까운 두 면(서로 다른 축): 법선 면 + 타축 최근접 면. */
    const edgeFaces = (part: ViewerPart, normalFace: FaceKey, local: THREE.Vector3): [FaceKey, FaceKey] => {
      const [x0, y0, z0] = part.aabb!.min;
      const [x1, y1, z1] = part.aabb!.max;
      const hx = Math.max(0.5, x1 - x0) / 2, hy = Math.max(0.5, y1 - y0) / 2, hz = Math.max(0.5, z1 - z0) / 2;
      const dists: Array<[FaceKey, number]> = [
        ['+x', Math.abs(hx - local.x)], ['-x', Math.abs(local.x + hx)],
        ['+y', Math.abs(hy - local.y)], ['-y', Math.abs(local.y + hy)],
        ['+z', Math.abs(hz - local.z)], ['-z', Math.abs(local.z + hz)],
      ];
      const axis1 = normalFace[1];
      const second = dists.filter(([f]) => f[1] !== axis1).sort((a, b) => a[1] - b[1])[0][0];
      return [normalFace, second];
    };

    const handleFace = (hit: Hit) => {
      lastPickRef.current = { partId: hit.partId, faces: [hit.faceKey] };
      applyOverlays(hit.partId, [hit.faceKey]);
      const { partId, faceKey } = hit;
      const type = hit.part.type!;
      void (async () => {
        const mapResult = await fetchFaceMap(type, faceKey);
        if (!disposed) cbRef.current?.({ kind: 'face', partId, type, face: faceKey, mapResult });
      })();
    };

    const handleEdge = (hit: Hit) => {
      if (!hit.part.aabb) return;
      const faces = edgeFaces(hit.part, hit.faceKey, hit.local);
      lastPickRef.current = { partId: hit.partId, faces };
      applyOverlays(hit.partId, faces);
      const { partId } = hit;
      const type = hit.part.type!;
      void (async () => {
        const [ra, rb] = await Promise.all([fetchFaceMap(type, faces[0]), fetchFaceMap(type, faces[1])]);
        // face-param-map.mjs mapEdge 미러 — 클라 병합(라우트 추가 금지): 후보 dedup → 없으면 section → 정직 거부
        const candidates: EdgeCandidate[] = [];
        for (const r of [ra, rb]) {
          if (r.ok && r.param && !candidates.some((c) => c.param === r.param)) {
            candidates.push({ param: r.param, face: r.face ?? '', dragSign: r.dragSign });
          }
        }
        let out: PickEvent;
        if (candidates.length) {
          out = { kind: 'edge', partId, type, faces, candidates };
        } else {
          const secs = [ra, rb].filter((r) => r.reason === 'section');
          out = secs.length
            ? { kind: 'edge', partId, type, faces, candidates: [], sectionParams: [...new Set(secs.flatMap((r) => r.sectionParams ?? []))], note: secs[0].note }
            : { kind: 'edge', partId, type, faces, candidates: [], error: ra.error ?? ra.reason ?? rb.error ?? rb.reason ?? 'unmapped' };
        }
        if (!disposed) cbRef.current?.(out);
      })();
    };

    const handleDist = (hit: Hit) => {
      if (!pendingA) {
        pendingA = { mesh: hit.mesh, partId: hit.partId, part: hit.part };
        (hit.mesh.material as THREE.MeshLambertMaterial).emissive.setHex(PENDING_EMISSIVE);
        cbRef.current?.({ kind: 'dist-pending', partId: hit.partId });
        return;
      }
      if (pendingA.partId === hit.partId) { clearPending(); return; }
      const cA = pendingA.mesh.getWorldPosition(new THREE.Vector3());
      const cB = hit.mesh.getWorldPosition(new THREE.Vector3());
      const dx = Math.abs(cB.x - cA.x), dy = Math.abs(cB.y - cA.y);
      const axis: 'x' | 'y' = dx >= dy ? 'x' : 'y';
      const out: PickEvent = {
        kind: 'dist',
        aId: pendingA.partId, bId: hit.partId,
        roleA: pendingA.part.role, roleB: hit.part.role,
        axis, distanceMm: Math.round(axis === 'x' ? dx : dy),
      };
      clearPending();
      clearOverlays();
      lastPickRef.current = null;
      // ⑦ 거리 치수선 — 두 파트 중심을 잇는 라인 + 지배축 간격 라벨 (다음 픽킹/리빌드 시 제거)
      makeDim(cA, cB, fmtLen(out.distanceMm), group);
      cbRef.current?.(out);
    };

    let downPos: { x: number; y: number } | null = null;
    const onDown = (ev: PointerEvent) => { downPos = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      const d = downPos;
      downPos = null;
      if (!d || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) return; // 궤도 드래그는 클릭 아님
      const hit = pickAt(ev);
      if (!hit?.part.type) return;
      // Alt+클릭 = 모서리 픽킹 강제(거리 모드 제외)
      const eff: PickMode = ev.altKey && modeLocal !== 'dist' ? 'edge' : modeLocal;
      if (eff === 'dist') handleDist(hit);
      else if (eff === 'edge') handleEdge(hit);
      else handleFace(hit);
    };

    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const resize = () => {
      const w = el.clientWidth || 300;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    apiRef.current = {
      setParts: buildParts,
      setMode: (m: PickMode) => {
        modeLocal = m;
        clearPending();
        clearOverlays();
        lastPickRef.current = null;
      },
      refreshOverlays: () => {
        if (lastPickRef.current) applyOverlays(lastPickRef.current.partId, lastPickRef.current.faces);
      },
    };
    buildParts(partsRef.current);

    return () => {
      disposed = true;
      apiRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      group.traverse(disposeObj);
      scene.remove(group);
      renderer.dispose();
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
    };
  }, [height]);

  return (
    <div
      ref={wrapRef}
      style={{
        width: '100%', height, marginTop: 6, borderRadius: 8, overflow: 'hidden',
        border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)',
      }}
    />
  );
}
