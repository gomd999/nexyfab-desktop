'use client';

/**
 * 설계 (Design) — 아이디어 → 설계 → 검증(상시) → 제조 루프를 사이트 안에서 완주.
 *
 * 흐름:
 *   ① 자연어로 설계 설명 → POST /api/nexyfab/drawing/compose (AI 범용 자유조합 →
 *      결정론 게이트/정규화/교정루프 → OpenSCAD + 서버측 manifold 실렌더 검증)
 *   ② 반환된 SCAD를 브라우저 openscad-wasm(renderScadWasm)으로 STL 렌더 → three 뷰어
 *   ③ 상시 검증 패널(별도 클릭 없음): manifold 결함·삼각형수·치수(BBox)·피처수
 *   ④ 내보내기: STEP(진짜 B-rep, /export-step) · HTML 뷰어(/render-html) · 제조 견적 연결
 *
 * 원칙(방법론): LLM은 계획(intent)까지만, 기하·검증은 결정론. 검증 실패 시 형상을
 * 만들지 않고 게이트 오류를 노출 → 잘못된 설계 진행 차단. MCP/CLI와 동일 파이프라인.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import * as THREE from 'three';
import { parseSTL } from '@/app/[lang]/shape-generator/io/importers';
import { renderScadWasm, wasmAvailable } from '@/app/[lang]/studio/wasmRender';
import { isKorean } from '@/lib/i18n/normalize';
import { type DesignSnapshot, type DesignStage, snapshot, stageOf } from '@/lib/designStage';
import { DesignStageBar } from '@/components/nexyfab/DesignStageBar';
import { loc } from '@/lib/i18n/loc';
import { EXAMPLES } from './DesignExamplesDict';
import BriefClarifier from './BriefClarifier';
import DomainVerifyPanel from './DomainVerifyPanel';
import CodeCheckPanel from './CodeCheckPanel';
import CalcStudioPanel from './CalcStudioPanel';
import StudioChatDock from './StudioChatDock';
import ParametricPresetPanel from './ParametricPresetPanel';
import AssemblyPresetPanel from './AssemblyPresetPanel';
import EasyWizard from './EasyWizard';
import DfmPanel from './DfmPanel';
import FabPanel from './FabPanel';
import { findDomain } from './designDomains';
import CheckpointPanel, { type CheckpointData } from './CheckpointPanel';
import VerifyNet, { type NetItem } from './VerifyNet';

type Verify =
  | { manifold?: boolean; triangles?: number; nonManifoldEdges?: number; error?: string }
  | null;

interface ComposeOk {
  ok: true;
  intent: { name?: string; features?: unknown[] };
  scad: string;
  rounds: number;
  verify: Verify;
}
interface ComposeErr {
  ok: false;
  stage?: string;
  intent?: unknown;
  gateErrors?: string[];
  rounds?: number;
  error?: string;
}
type ComposeResp = ComposeOk | ComposeErr;

// OpenSCAD rotate([rx,ry,rz]) 순서(Rx→Ry→Rz)로 벡터 회전 — OBB 프록시 로컬 노멀→CAD 월드(#3)
function rotCadVec(rot: number[], v: number[]): number[] {
  let [x, y, z] = v;
  const rad = Math.PI / 180;
  const [rx, ry, rz] = rot;
  if (rx) { const c = Math.cos(rx * rad), s = Math.sin(rx * rad); const y2 = y * c - z * s, z2 = y * s + z * c; y = y2; z = z2; }
  if (ry) { const c = Math.cos(ry * rad), s = Math.sin(ry * rad); const x2 = x * c + z * s, z2 = -x * s + z * c; x = x2; z = z2; }
  if (rz) { const c = Math.cos(rz * rad), s = Math.sin(rz * rad); const x2 = x * c - y * s, y2 = x * s + y * c; x = x2; y = y2; }
  return [x, y, z];
}

interface Bbox {
  x: number;
  y: number;
  z: number;
}

// §12.4/§13-4 스테이션 실루엣 프로파일 — 서버(to-step.mjs stationProfiles)와 동일 수학.
// 비인덱스 STL(9float=1삼각형) 에지-평면 교차 샘플링(정점 비닝은 긴 삼각형을 놓침).
interface AxisProfile { axis: string; w1: number[]; w2: number[] }
function stationProfilesClient(v: Float32Array, N = 24): AxisProfile[] {
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let a = 0; a < 3; a++) { const x = v[i + a]; if (x < mins[a]) mins[a] = x; if (x > maxs[a]) maxs[a] = x; }
  }
  const out: AxisProfile[] = [];
  for (const [A, U, W] of [[0, 1, 2], [1, 0, 2], [2, 0, 1]] as const) {
    const lo = mins[A], range = (maxs[A] - lo) || 1;
    const minU = new Array<number>(N).fill(Infinity), maxU = new Array<number>(N).fill(-Infinity);
    const minW = new Array<number>(N).fill(Infinity), maxW = new Array<number>(N).fill(-Infinity);
    const edge = (p: number, q: number) => {
      const a0 = v[p + A], a1 = v[q + A];
      const sLo = ((Math.min(a0, a1) - lo) / range) * N - 0.5, sHi = ((Math.max(a0, a1) - lo) / range) * N - 0.5;
      for (let s = Math.max(0, Math.ceil(sLo)); s <= Math.min(N - 1, Math.floor(sHi)); s++) {
        const station = lo + ((s + 0.5) / N) * range;
        const denom = a1 - a0;
        const t = Math.abs(denom) < 1e-12 ? 0 : (station - a0) / denom;
        if (t < -1e-9 || t > 1 + 1e-9) continue;
        const u = v[p + U] + t * (v[q + U] - v[p + U]);
        const w = v[p + W] + t * (v[q + W] - v[p + W]);
        if (u < minU[s]) minU[s] = u; if (u > maxU[s]) maxU[s] = u;
        if (w < minW[s]) minW[s] = w; if (w > maxW[s]) maxW[s] = w;
      }
    };
    for (let i = 0; i + 8 < v.length; i += 9) { edge(i, i + 3); edge(i + 3, i + 6); edge(i + 6, i); }
    out.push({
      axis: 'xyz'[A],
      w1: minU.map((m, s) => (m === Infinity ? 0 : +(maxU[s] - m).toFixed(3))),
      w2: minW.map((m, s) => (m === Infinity ? 0 : +(maxW[s] - m).toFixed(3))),
    });
  }
  return out;
}

// 실루엣 오버레이 차트 — 드래프트(실선 파랑) vs 기록(점선 빨강), 두 수직 폭을 함께
function ProfileChart({ d, r, label }: { d: AxisProfile; r: AxisProfile; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const Wc = c.width, Hc = c.height, PAD = 4;
    ctx.clearRect(0, 0, Wc, Hc);
    const all = [...d.w1, ...d.w2, ...r.w1, ...r.w2];
    const maxV = Math.max(...all, 1);
    const line = (arr: number[], color: string, dash: boolean) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash(dash ? [3, 2] : []);
      ctx.beginPath();
      arr.forEach((vv, i) => {
        const x = PAD + (i / (arr.length - 1)) * (Wc - PAD * 2);
        const y = Hc - PAD - (vv / maxV) * (Hc - PAD * 2);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    line(d.w1, '#3b82f6', false); line(r.w1, '#ef4444', true);
    line(d.w2, '#60a5fa', false); line(r.w2, '#f59e0b', true);
    ctx.setLineDash([]);
  }, [d, r]);
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <canvas ref={ref} width={110} height={64} style={{ width: '100%', border: '1px solid var(--nx-border, #dfe3e8)', borderRadius: 6, background: 'var(--nx-bg, #f8fafc)' }} />
      <div style={{ fontSize: 9, color: 'var(--nx-text-3, #6b7684)' }}>{label}</div>
    </div>
  );
}

// EXAMPLES(6언어 채팅 프롬프트 예시) 정의는 DesignExamplesDict.ts 로 분리 — 이 파일이
// three.js/wasm 렌더러를 끌고 들어와서, 문자열 회귀 테스트가 그 전체를 import하지 않도록.

export default function DesignInner({ lang, initialDomain, initialTab }: { lang: string; initialDomain?: string | null; initialTab?: string | null }) {
  const ko = isKorean(lang);
  const domain = findDomain(initialDomain);
  const [prompt, setPrompt] = useState('');
  // 일반인 진입 위저드(EasyWizard) 개폐 — 결과는 기존 어셈블리 수신 배선으로 합류
  const [easyOpen, setEasyOpen] = useState(false);
  type StudioTab = 'create' | 'verify' | 'calc' | 'output';
  const [tab, setTab] = useState<StudioTab>(initialTab === 'calc' ? 'calc' : 'create');

  // 챗 핸드오프 수신 — 랜딩 챗에서 "Studio →"로 넘어온 사양을 프롬프트에 프리필(1회 소비)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('nf-chat-handoff');
      if (!raw) return;
      sessionStorage.removeItem('nf-chat-handoff');
      const h = JSON.parse(raw) as { spec?: string; at?: number; type?: string };
      if (h.spec && Date.now() - (h.at ?? 0) < 10 * 60 * 1000) {
        setPrompt(String(h.spec).slice(0, 2000));
        handoffTypeRef.current = h.type === 'assembly' ? 'assembly' : null; // 어셈블리 스펙은 assemble 파이프로
      }
    } catch { /* ignore */ }
     
  }, []);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  // DXF 씨앗 수신(§9 Phase 2) — ParametricPresetPanel이 파싱해 이벤트로 넘긴다(사람 검증 전제)
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent).detail; if (typeof d === 'string') setPrompt(d.slice(0, 2000)); };
    window.addEventListener('nf-dxf-seed', on);
    return () => window.removeEventListener('nf-dxf-seed', on);
  }, []);
  // 생성 체감 개선(2026-07-16): 경과 시간·취소 + 어셈블리 스펙은 assemble 파이프로 라우팅
  const [elapsed, setElapsed] = useState(0);
  const runAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { runAbortRef.current?.abort(); }, []); // 언마운트 시 진행 중 생성 중단
  const handoffTypeRef = useRef<'assembly' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null); // PLAN_LIMIT 등 — 업셀 CTA 분기
  const [gateErrors, setGateErrors] = useState<string[] | null>(null);

  const [intent, setIntent] = useState<ComposeOk['intent'] | null>(null);
  const [scad, setScad] = useState<string | null>(null);
  const [verify, setVerify] = useState<Verify>(null);
  // §2.1 입구 B 도면 체크포인트 — 자유 서술(AI 해석)만 승인 게이트, 프리셋·판독은 스킵(§2.2)
  const [checkpoint, setCheckpoint] = useState<CheckpointData | null>(null);
  const [cpState, setCpState] = useState<'none' | 'pending' | 'approved' | 'skipped'>('none');
  // 그물 ④ — 어셈블리 빌드 결과의 간섭 건수(null=어셈블리 아님/단품).
  // 설계가 바뀌면 반드시 무효화 — pendingInterfRef를 applyDesign이 소비하는 구조(감사 3차).
  const [interf, setInterf] = useState<number | null>(null);
  const pendingInterfRef = useRef<number | null>(null);
  // 지지 체인(부유) — 위시빌더 260717 그물 제품 배선: 어셈블리 빌드 시 supportCheck 결과
  const [floatN, setFloatN] = useState<number | null>(null);
  const pendingFloatRef = useRef<number | null>(null);
  // 요청 정합(intent-match, 260717) — "시킨 것과 다른 걸 만든다" 노출: 불일치 목록
  type IntentMatch = { matched: number; mismatched: number; unverifiable: number; results: Array<{ verdict: string; note: string; text: string }>; assumptions?: string[]; repair?: { attempted: boolean; adopted: boolean; before: number; after: number } };
  const [intentM, setIntentM] = useState<IntentMatch | null>(null);
  /**
   * ★설계 단계(260803) — **초안 → 상세 → 제작**. 채팅형이지만 **순서가 보여야** 한다.
   *
   * 종전에는 단계가 문구로만 있었다. 생성이 끝나면 바로 결과가 뜨고, 「확정」에 해당하는
   * 동작(패키지 발행)은 버튼 하나였다. 사용자에게는 **「묻고선 이미 해버렸다」**로 보이고,
   * 확정본이 따로 남지 않아 다음 수정이 그것을 덮어썼다.
   *
   * ⚠ 단계는 **결과에서 판정**한다(사용자가 고르지 않는다). 추정 치수(assumptions)가
   *   남아 있으면 게이트를 통과해도 **초안**이다 — 그걸 상세라 부르면 추정을 확정으로 판다.
   * ⚠ 확정하면 **그 시점 결과를 깊은 복사로** 잡아 둔다. 참조만 들면 다음 수정이 확정본을
   *   조용히 바꾼다.
   */
  const [confirmedSnap, setConfirmedSnap] = useState<DesignSnapshot<Record<string, unknown>> | null>(null);
  const designStage: DesignStage = stageOf({
    designOk: interf === null ? null : interf === 0 && (floatN ?? 0) === 0,
    gateErrors: gateErrors ?? [],
    assumptions: intentM?.assumptions ?? [],
    confirmed: confirmedSnap != null,
  });
  const pendingIntentRef = useRef<IntentMatch | null>(null);
  const pendingAssemblyRef = useRef<Record<string, unknown> | null>(null); // 설계 패키지용(어셈블리 경로만)
  const [lastAssembly, setLastAssembly] = useState<Record<string, unknown> | null>(null);
  // 🎯 P2 픽킹(260719): 뷰어 부품 클릭=선택 → 프롬프트=그 부품만 수정(edit-part) ·
  // 선택 부품 면 드래그=푸시풀(face-drag, 결정론). 월드 AABB 프록시는 assemble/edit 응답 parts.
  type PartAabb = { id: string; aabb: { min: number[]; max: number[] }; obb?: { local: { min: number[]; max: number[] }; at: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number } } };
  const pendingPartsRef = useRef<PartAabb[] | null>(null);
  const [lastPartsAabb, setLastPartsAabb] = useState<PartAabb[] | null>(null);
  const [pickedPart, setPickedPart] = useState<string | null>(null);
  const [pickedNormal, setPickedNormal] = useState<number[] | null>(null); // CAD 좌표계
  const [pickedMulti, setPickedMulti] = useState<string[]>([]); // #5 다중 선택(ctrl+클릭)
  const [dimInput, setDimInput] = useState(''); // #2 치수 직접 입력(mm)
  const [filletInput, setFilletInput] = useState(''); // #7 부품 필렛 r(mm)
  const [moveInput, setMoveInput] = useState(''); // #6 그룹 이동 "dx,dy,dz"
  // #1 언두 — 편집 직전 스냅샷 스택(≤10, 클라 로컬 복원: 서버 불필요)
  type EditSnap = { assembly: Record<string, unknown> | null; partsAabb: PartAabb[] | null; scad: string | null; intent: unknown; interf: number | null; floatN: number | null };
  const editHistRef = useRef<EditSnap[]>([]);
  const [histN, setHistN] = useState(0);
  // #1 LOD(1차 골격→2차 상세) — assemble 응답 draft(철물·자유곡면 제외 골격) 우선 표시
  const pendingDraftRef = useRef<{ openscad: string; parts: PartAabb[] } | null>(null);
  const fullLodRef = useRef<{ scad: string; parts: PartAabb[] | null } | null>(null);
  const [lodLevel, setLodLevel] = useState<0 | 1 | 2>(0); // 0=LOD 없음, 1=골격 표시 중, 2=상세
  const pickGroupRef = useRef<THREE.Group | null>(null);
  const pickSelRef = useRef<{ select: (id: string | null) => void }>({ select: () => { /* init 전 */ } });
  const pickCbRef = useRef<(id: string | null, normalCad: number[] | null, additive?: boolean) => void>(() => { /* init 전 */ });
  const faceDragCbRef = useRef<(id: string, normalCad: number[], deltaMm: number) => void>(() => { /* init 전 */ });
  const [pkgBusy, setPkgBusy] = useState(false);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [featureCount, setFeatureCount] = useState<number | null>(null);

  const [exporting, setExporting] = useState<'' | 'step' | 'html'>('');
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  // --- three viewer ---
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const orbit = useRef({ theta: Math.PI * 0.25, phi: Math.PI * 0.35, radius: 600, target: new THREE.Vector3() });

  // Init the scene once.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121a2e); // 다크 톤 통일(패널과 일체감)
    const camera = new THREE.PerspectiveCamera(40, mount.clientWidth / mount.clientHeight, 1, 1e5);

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1, 1.6, 1.1);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-1, 0.4, -0.8);
    scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.55));

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;

    const applyCam = () => {
      const o = orbit.current;
      const sp = Math.max(0.05, Math.min(Math.PI - 0.05, o.phi));
      camera.position.set(
        o.target.x + o.radius * Math.sin(sp) * Math.cos(o.theta),
        o.target.y + o.radius * Math.cos(sp),
        o.target.z + o.radius * Math.sin(sp) * Math.sin(o.theta),
      );
      camera.lookAt(o.target);
    };

    let raf = 0;
    const loop = () => {
      applyCam();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    // 🎯 픽킹 인프라(P2): 부품 AABB 프록시 그룹 + 선택 하이라이트 + 면 푸시풀 드래그
    const pickGroup = new THREE.Group();
    scene.add(pickGroup);
    pickGroupRef.current = pickGroup;
    let hl: THREE.LineSegments | null = null;
    let selCur: string | null = null;
    const select = (id: string | null) => {
      selCur = id;
      if (hl) { scene.remove(hl); hl.geometry.dispose(); (hl.material as THREE.Material).dispose(); hl = null; }
      const box = pickGroup.children.find((c) => c.userData.pid === id) as THREE.Mesh | undefined;
      if (box) {
        hl = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry as THREE.BoxGeometry), new THREE.LineBasicMaterial({ color: 0x3b82f6 }));
        hl.position.copy(box.position);
        hl.quaternion.copy(box.quaternion); // OBB(#3)
        scene.add(hl);
      }
    };
    pickSelRef.current = { select };
    const ray = new THREE.Raycaster();
    const castAt = (cx: number, cy: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) return null;
      ray.setFromCamera(new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1), camera);
      return ray.intersectObjects(pickGroup.children, false)[0] ?? null;
    };
    const dfTip = document.createElement('div');
    dfTip.style.cssText = 'position:absolute;display:none;pointer-events:none;z-index:5;background:rgba(15,23,42,.9);color:#fff;font-size:11px;padding:3px 8px;border-radius:6px;font-weight:700';
    mount.style.position = 'relative';
    mount.appendChild(dfTip);
    // three(Y-up) 노멀 → CAD(Z-up): (nx, ny, nz) → (nx, -nz, ny)
    const toCadN = (n: THREE.Vector3) => [n.x, -n.z, n.y];

    // manual orbit + 픽/푸시풀
    let dragging = false;
    let lx = 0;
    let ly = 0;
    let dx0 = 0, dy0 = 0;
    let df: { id: string; nCad: number[]; axis: number; sign: number; dir2: [number, number]; mmPerPx: number; delta: number } | null = null;
    // #6 모바일: 핀치 줌(포인터 2개 — 궤도·푸시풀 억제)
    renderer.domElement.style.touchAction = 'none';
    const ptrs = new Map<number, [number, number]>();
    let pinch0: number | null = null, pinchR0 = orbit.current.radius;
    const pDist = () => { const v = [...ptrs.values()]; return Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]); };
    const onDown = (e: PointerEvent) => {
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) { dragging = false; df = null; dfTip.style.display = 'none'; pinch0 = pDist(); pinchR0 = orbit.current.radius; return; }
      dragging = true;
      lx = e.clientX; ly = e.clientY; dx0 = e.clientX; dy0 = e.clientY;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      df = null;
      if (!selCur || !pickGroup.children.length) return;
      const hit = castAt(e.clientX, e.clientY);
      if (!hit || String(hit.object.userData.pid) !== selCur || !hit.face) return;
      const nL = hit.face.normal.clone(); // 프록시 로컬(OBB=CAD 로컬)
      const n = nL.clone().applyQuaternion(hit.object.quaternion); // three 월드(화면 투영)
      const axis = Math.abs(nL.x) > 0.5 ? 0 : Math.abs(nL.y) > 0.5 ? 1 : 2;
      const sign = [nL.x, nL.y, nL.z][axis] > 0 ? 1 : -1;
      const s0 = hit.point.clone().project(camera), s1 = hit.point.clone().add(n.clone().multiplyScalar(100)).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      const v2: [number, number] = [(s1.x - s0.x) * rect.width / 2, -(s1.y - s0.y) * rect.height / 2];
      const L2 = Math.hypot(v2[0], v2[1]);
      if (L2 < 2) return; // 화면과 수직 — 궤도 유지
      const rotD = hit.object.userData.rot as number[] | null;
      const nCad = rotD ? rotCadVec(rotD, [nL.x, nL.y, nL.z]) : toCadN(n); // 서버=CAD 월드
      df = { id: selCur, nCad, axis, sign, dir2: [v2[0] / L2, v2[1] / L2], mmPerPx: 100 / L2, delta: 0 };
    };
    const onMove = (e: PointerEvent) => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2 && pinch0) {
        const d2 = pDist();
        if (d2 > 8) orbit.current.radius = Math.max(20, Math.min(50000, pinchR0 * (pinch0 / d2)));
        return;
      }
      if (!dragging) return;
      if (df) {
        // #4 드래그 스냅 — 5mm 그리드(정확값은 치수 입력/대화 지시)
        df.delta = Math.round((((e.clientX - dx0) * df.dir2[0] + (e.clientY - dy0) * df.dir2[1]) * df.mmPerPx) / 5) * 5;
        if (hl) {
          const box = pickGroup.children.find((c) => c.userData.pid === df!.id) as THREE.Mesh | undefined;
          if (box) {
            const bp = (box.geometry as THREE.BoxGeometry).parameters;
            const dims = [bp.width, bp.height, bp.depth];
            hl.scale.setComponent(df.axis, Math.max(0.05, (dims[df.axis] + df.delta) / dims[df.axis]));
            hl.position.copy(box.position);
            const eAx = new THREE.Vector3(df.axis === 0 ? 1 : 0, df.axis === 1 ? 1 : 0, df.axis === 2 ? 1 : 0).applyQuaternion(box.quaternion);
            hl.position.addScaledVector(eAx, (df.sign * df.delta) / 2); // 회전 부품=로컬 축 월드 방향
          }
        }
        const rect = renderer.domElement.getBoundingClientRect();
        dfTip.style.display = 'block';
        dfTip.style.left = `${e.clientX - rect.left + 14}px`;
        dfTip.style.top = `${e.clientY - rect.top - 10}px`;
        dfTip.textContent = `${df.delta >= 0 ? '+' : ''}${Math.round(df.delta)}mm`;
        return;
      }
      const o = orbit.current;
      o.theta -= (e.clientX - lx) * 0.01;
      o.phi -= (e.clientY - ly) * 0.01;
      lx = e.clientX;
      ly = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      ptrs.delete(e.pointerId);
      if (pinch0 !== null) { if (ptrs.size < 2) pinch0 = null; return; } // 핀치 종료 — 클릭 오발동 방지
      dragging = false;
      dfTip.style.display = 'none';
      if (df) {
        const { id, nCad, delta } = df;
        df = null;
        if (hl) hl.scale.set(1, 1, 1);
        if (Math.abs(delta) >= 2) { faceDragCbRef.current(id, nCad, Math.round(delta)); return; }
        select(selCur);
        return;
      }
      if (!pickGroup.children.length) return;
      if (Math.hypot(e.clientX - dx0, e.clientY - dy0) > 6) return; // 드래그≠클릭
      const hit = castAt(e.clientX, e.clientY);
      const id = hit ? String(hit.object.userData.pid ?? '') || null : null;
      select(id);
      const rotU = hit?.object.userData.rot as number[] | null | undefined;
      pickCbRef.current(
        id,
        hit?.face ? (rotU ? rotCadVec(rotU, [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z]) : toCadN(hit.face.normal)) : null,
        e.ctrlKey || e.metaKey,
      );
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbit.current.radius = Math.max(20, Math.min(50000, orbit.current.radius * (1 + Math.sign(e.deltaY) * 0.12)));
    };
    const el = renderer.domElement;
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);

  // 🎯 부품 프록시 재구축(P2) — CAD Z-up → three Y-up: (x,y,z)→(x, z, −y)
  useEffect(() => {
    const g = pickGroupRef.current;
    if (!g) return;
    while (g.children.length) {
      const c = g.children.pop() as THREE.Mesh;
      c.geometry?.dispose?.();
      (c.material as THREE.Material)?.dispose?.();
    }
    const qC = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); // CAD Z-up→three Y-up
    for (const p of lastPartsAabb ?? []) {
      let m: THREE.Mesh;
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      if (p.obb) {
        // #3 OBB: 회전 부품=로컬 박스+부품 회전(CAD Rx→Ry→Rz)을 three 로 변환해 적용
        const lm = p.obb.local.min, lx2 = p.obb.local.max;
        m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, lx2[0] - lm[0]), Math.max(1, lx2[1] - lm[1]), Math.max(1, lx2[2] - lm[2])), mat);
        const { tx, ty, tz, rx, ry, rz } = p.obb.at;
        const Rcad = new THREE.Matrix4().makeRotationZ((rz * Math.PI) / 180)
          .multiply(new THREE.Matrix4().makeRotationY((ry * Math.PI) / 180))
          .multiply(new THREE.Matrix4().makeRotationX((rx * Math.PI) / 180));
        const qCad = new THREE.Quaternion().setFromRotationMatrix(Rcad);
        m.quaternion.copy(qC).multiply(qCad);
        const lc = new THREE.Vector3((lm[0] + lx2[0]) / 2, (lm[1] + lx2[1]) / 2, (lm[2] + lx2[2]) / 2).applyMatrix4(Rcad);
        const wc = [tx + lc.x, ty + lc.y, tz + lc.z];
        m.position.set(wc[0], wc[2], -wc[1]);
        m.userData.rot = [rx, ry, rz];
      } else {
        const mn = p.aabb.min, mx = p.aabb.max;
        m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, mx[0] - mn[0]), Math.max(1, mx[2] - mn[2]), Math.max(1, mx[1] - mn[1])), mat);
        m.position.set((mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2, -(mn[1] + mx[1]) / 2);
        m.userData.rot = null;
      }
      m.userData.pid = p.id;
      g.add(m);
    }
    pickSelRef.current.select(null);
  }, [lastPartsAabb]);

  // Swap the mesh geometry (CAD Z-up → three Y-up via -90° X rotation).
  const showGeometry = useCallback((geom: THREE.BufferGeometry) => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
      meshRef.current = null;
    }
    geom.computeVertexNormals();
    geom.rotateX(-Math.PI / 2); // Z-up → Y-up
    geom.computeBoundingBox();
    const bb = geom.boundingBox!;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bb.getSize(size);
    bb.getCenter(center);
    // report dims in original CAD axes: after -90°X, three-Y is CAD-Z.
    setBbox({ x: +size.x.toFixed(1), y: +size.z.toFixed(1), z: +size.y.toFixed(1) });

    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.85, roughness: 0.38 }),
    );
    scene.add(mesh);
    meshRef.current = mesh;

    const o = orbit.current;
    o.target.copy(center);
    o.radius = Math.max(size.x, size.y, size.z) * 2.2 + 40;
  }, []);

  // 설계 결과(compose 또는 결정론 프리셋) → 상태 반영 + 브라우저 렌더. 공통 경로.
  // 실사 컨셉 렌더링(Gemini image-to-image) — 뷰어 캔버스 PNG를 기하 기준으로 전달 (⑤)
  const [vizBusy, setVizBusy] = useState(false);
  const [vizImg, setVizImg] = useState<string | null>(null);
  const [vizErr, setVizErr] = useState<string | null>(null);
  const runVisualize = useCallback(async () => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;
    setVizBusy(true); setVizErr(null);
    try {
      const png = canvas.toDataURL('image/png'); // preserveDrawingBuffer:true
      const res = await fetch('/api/nexyfab/drawing/visualize/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePng: png, domain: domain?.slug ?? 'mech' }),
      });
      const j = (await res.json()) as { ok?: boolean; imageBase64?: string; error?: string };
      if (!res.ok || !j.ok || !j.imageBase64) throw new Error(j.error ?? (ko ? '렌더링 실패' : 'render failed'));
      setVizImg(j.imageBase64);
    } catch (e) {
      setVizErr((ko ? '실사 렌더링 실패: ' : 'AI render failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setVizBusy(false);
    }
  }, [domain, ko]);

  const applyDesign = useCallback(
    async (intentObj: ComposeOk['intent'], scadStr: string, verifyObj: Verify) => {
      // 체크포인트 승인 경로가 아니면(프리셋·판독·어셈블리) '생략'으로 정직 표기(§2.2).
      // pending 체크포인트 카드도 정리 — 남겨두면 옛 intent로 재승인해 방금 형상을 덮어쓴다.
      setCheckpoint(null);
      setCpState((s) => (s === 'approved' ? s : 'skipped'));
      setInterf(pendingInterfRef.current); // 새 설계의 간섭(어셈블리) 또는 null(단품) — 잔존 방지
      pendingInterfRef.current = null;
      setFloatN(pendingFloatRef.current); // 부유(지지 체인) — 동일 소비 구조
      pendingFloatRef.current = null;
      setIntentM(pendingIntentRef.current); // 요청 정합 — 동일 소비 구조
      pendingIntentRef.current = null;
      setLastAssembly(pendingAssemblyRef.current); // 어셈블리면 패키지 생성 가능, 단품이면 null
      // #1 LOD: draft(골격)가 있으면 1차 먼저 — 전체 scad/parts 는 fullLodRef 에 보관(승인 후 전환)
      const draftLod = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (draftLod) {
        fullLodRef.current = { scad: scadStr, parts: pendingPartsRef.current };
        setLastPartsAabb(draftLod.parts);
        setLodLevel(1);
      } else {
        fullLodRef.current = null;
        setLastPartsAabb(pendingPartsRef.current); // 🎯 픽킹 프록시 — 단품이면 null(픽킹 없음)
        setLodLevel(0);
      }
      pendingPartsRef.current = null;
      setPickedPart(null); setPickedNormal(null); setPickedMulti([]);
      pendingAssemblyRef.current = null;
      setDiffRes(null); // 설계가 바뀌면 이전 듀얼-방출 대조 결과는 무효
      setDiffDraftProfiles(null);
      setVisRes(null); // vision 비평도 무효
      setFeaRes(null); // 간이 FEA 결과도 무효
      setIntent(intentObj);
      setScad(scadStr);
      setVerify(verifyObj);
      setFeatureCount(Array.isArray(intentObj.features) ? intentObj.features.length : null);
      if (wasmAvailable()) {
        setStatus(ko ? '3D 렌더 중…' : 'Rendering 3D…');
        const r = await renderScadWasm(draftLod ? draftLod.openscad : scadStr); // #1 골격 우선 표시
        if (r.ok && r.data) {
          const buf = r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) as ArrayBuffer;
          showGeometry(parseSTL(buf));
        } else {
          setError((ko ? '브라우저 렌더 실패: ' : 'Client render failed: ') + (r.error ?? ''));
        }
      } else {
        setError(ko ? '이 브라우저에서 3D 렌더러를 쓸 수 없습니다.' : '3D renderer unavailable in this browser.');
      }
      setStatus('');
    },
    [ko, showGeometry],
  );

  // 🎯 edit-part/face-drag 응답 적용(P2) — 검증 상태 갱신 + 재렌더(대상 외 부품 불변은 서버 보장)
  const applyEditResp = useCallback(async (j: Record<string, unknown>) => {
    // #1 언두 스냅샷(적용 직전 상태) — 스택 ≤10
    editHistRef.current.push({ assembly: lastAssembly, partsAabb: lastPartsAabb, scad, intent, interf, floatN });
    if (editHistRef.current.length > 10) editHistRef.current.shift();
    setHistN(editHistRef.current.length);
    setLastAssembly((j.assembly as Record<string, unknown>) ?? null);
    setLastPartsAabb(Array.isArray(j.parts) ? (j.parts as { id: string; aabb: { min: number[]; max: number[] } }[]) : null);
    setInterf(Array.isArray(j.interferences) ? (j.interferences as unknown[]).length : null);
    setFloatN(Array.isArray(j.floating) ? (j.floating as unknown[]).length : null);
    setDiffRes(null); setDiffDraftProfiles(null); setVisRes(null); setFeaRes(null); // 설계 변경 — 검증 무효화
    if (j.composeIntent && typeof j.composeIntent === 'object') {
      setIntent(j.composeIntent as ComposeOk['intent']);
      setFeatureCount(Array.isArray((j.composeIntent as { features?: unknown[] }).features) ? (j.composeIntent as { features: unknown[] }).features.length : null);
      // #4 수정 후 검증그물 자동 재실행 — 역투영 diff(결정론·저비용). 선언은 아래(이벤트 시점 호출=안전)
      try { void runReprojectDiff(j.composeIntent as ComposeOk['intent']); } catch { /* diff 실패는 편집을 막지 않음 */ }
    }
    setLodLevel(2); // 편집=상세 단계 작업으로 승격
    if (typeof j.openscad === 'string') {
      setScad(j.openscad);
      if (wasmAvailable()) {
        const r = await renderScadWasm(j.openscad);
        if (r.ok && r.data) {
          const buf = r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) as ArrayBuffer;
          showGeometry(parseSTL(buf));
        }
      }
    }
   
  }, [showGeometry, lastAssembly, lastPartsAabb, scad, intent, interf, floatN]);

  // #1 LOD 2차 전환 — 보관해둔 전체 scad/parts 로컬 렌더(서버 불필요)
  const applyLod2 = useCallback(async () => {
    const full = fullLodRef.current;
    if (!full) return;
    setLodLevel(2);
    setLastPartsAabb(full.parts);
    if (wasmAvailable()) {
      const r = await renderScadWasm(full.scad);
      if (r.ok && r.data) {
        const buf = r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) as ArrayBuffer;
        showGeometry(parseSTL(buf));
      }
    }
  }, [showGeometry]);

  // #2 저장↔편집 봉합(260719): 편집 결과(assembly+REV+scad+intent)를 프로젝트로 저장/복원
  const [projList, setProjList] = useState<Array<{ id: string; name: string }> | null>(null);
  const saveProject = useCallback(async () => {
    if (!lastAssembly) return;
    const name = `${String((lastAssembly as { name?: string }).name ?? '어셈블리').slice(0, 60)} (편집)`;
    try {
      const res = await fetch('/api/nexyfab/drawing/projects/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain: domain?.slug ?? 'mech', snapshot: { kind: 'assembly-edit', assembly: lastAssembly, partsAabb: lastPartsAabb, scad, intent } }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || j.ok === false) { setError(res.status === 401 ? (ko ? '로그인 후 저장할 수 있어요' : 'Sign in to save') : String(j.error ?? 'save')); return; }
      setStatus(ko ? '프로젝트 저장됨 ✓ (REV 이력 포함)' : 'Saved ✓');
      setTimeout(() => setStatus(''), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [lastAssembly, lastPartsAabb, scad, intent, domain, ko]);
  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch('/api/nexyfab/drawing/projects/');
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; projects?: Array<{ id: string; name: string }> };
      if (r.ok && Array.isArray(j.projects)) setProjList(j.projects.map((p) => ({ id: p.id, name: p.name })));
      else if (r.status === 401) setError(ko ? '로그인 필요(서버 저장은 계정 기능)' : 'Sign in required');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [ko]);
  const loadProject = useCallback(async (id: string) => {
    try {
      const r = await fetch('/api/nexyfab/drawing/projects/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loadId: id }),
      });
      const j = (await r.json().catch(() => ({}))) as { snapshot?: { kind?: string; assembly?: Record<string, unknown>; partsAabb?: PartAabb[]; scad?: string; intent?: unknown } };
      const snap = j.snapshot;
      if (!r.ok || !snap || snap.kind !== 'assembly-edit') { setError(ko ? '이 항목은 편집 스냅샷이 아니에요(프리셋 저장분은 해당 패널에서)' : 'Not an edit snapshot'); return; }
      setLastAssembly(snap.assembly ?? null);
      setLastPartsAabb(snap.partsAabb ?? null);
      if (snap.intent) setIntent(snap.intent as ComposeOk['intent']);
      editHistRef.current = []; setHistN(0);
      setPickedPart(null); setPickedNormal(null); setPickedMulti([]);
      setDiffRes(null); setDiffDraftProfiles(null); setVisRes(null); setFeaRes(null);
      if (typeof snap.scad === 'string' && wasmAvailable()) {
        setScad(snap.scad);
        const rr = await renderScadWasm(snap.scad);
        if (rr.ok && rr.data) {
          const buf = rr.data.buffer.slice(rr.data.byteOffset, rr.data.byteOffset + rr.data.byteLength) as ArrayBuffer;
          showGeometry(parseSTL(buf));
        }
      }
      setStatus(ko ? '편집 스냅샷 복원됨 — 픽킹·수정 이어서 가능' : 'Restored');
      setTimeout(() => setStatus(''), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [showGeometry, ko]);

  // #1 언두 — 마지막 편집 직전 상태로 복원(클라 로컬)
  const undoEdit = useCallback(async () => {
    const snap = editHistRef.current.pop();
    setHistN(editHistRef.current.length);
    if (!snap) return;
    setLastAssembly(snap.assembly);
    setLastPartsAabb(snap.partsAabb);
    setInterf(snap.interf);
    setFloatN(snap.floatN);
    if (snap.intent) { setIntent(snap.intent as ComposeOk['intent']); }
    setDiffRes(null); setDiffDraftProfiles(null); setVisRes(null); setFeaRes(null);
    if (snap.scad) {
      setScad(snap.scad);
      if (wasmAvailable()) {
        const r = await renderScadWasm(snap.scad);
        if (r.ok && r.data) {
          const buf = r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) as ArrayBuffer;
          showGeometry(parseSTL(buf));
        }
      }
    }
  }, [showGeometry]);

  // #5/#7 부품 일괄 연산(결정론) — 복제/삭제/필렛
  const partOpRun = useCallback(async (op: string, ids: string[], opts?: Record<string, unknown>) => {
    if (!lastAssembly || !ids.length) return;
    setStatus(ko ? `${op} 적용 중…` : `Applying ${op}…`);
    setError(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/part-op/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly: lastAssembly, op, partIds: ids, opts: opts ?? {} }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !j.ok) { setError(String((j as { error?: string }).error ?? op)); return; }
      await applyEditResp(j);
      if (op === 'delete') { setPickedPart(null); setPickedNormal(null); setPickedMulti([]); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus('');
    }
  }, [lastAssembly, applyEditResp, ko]);

  // #2 치수 직접 입력 — 선택 면 치수를 목표값으로(결정론 face-drag targetMm)
  const applyDimInput = useCallback(async () => {
    const v = parseFloat(dimInput);
    if (!Number.isFinite(v) || v <= 0 || !pickedPart || !pickedNormal || !lastAssembly) return;
    setStatus(ko ? '치수 적용 중…' : 'Applying dimension…');
    setError(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/face-drag/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly: lastAssembly, partId: pickedPart, normal: pickedNormal, targetMm: v }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !j.ok) { setError(String((j as { error?: string }).error ?? 'dim')); return; }
      await applyEditResp(j);
      setDimInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus('');
    }
  }, [dimInput, pickedPart, pickedNormal, lastAssembly, applyEditResp, ko]);

  const editPartRun = useCallback(async (instruction: string) => {
    if (!pickedPart || !lastAssembly) return;
    setLoading(true); setError(null);
    setStatus(ko ? `🎯 ${pickedPart} 만 수정하는 중…` : `Editing only ${pickedPart}…`);
    try {
      const res = await fetch('/api/nexyfab/drawing/edit-part/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly: lastAssembly, partId: pickedPart, instruction, ...(pickedNormal ? { face: { normal: pickedNormal } } : {}) }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !j.ok) { setError(String((j as { error?: string }).error ?? 'edit failed')); return; }
      await applyEditResp(j);
      setPrompt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false); setStatus('');
    }
  }, [pickedPart, pickedNormal, lastAssembly, applyEditResp, ko]);

  const onFaceDragStudio = useCallback(async (partId: string, normalCad: number[], deltaMm: number) => {
    if (!lastAssembly) return;
    setStatus(ko ? '푸시풀 적용 중…' : 'Applying push-pull…');
    setError(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/face-drag/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly: lastAssembly, partId, normal: normalCad, deltaMm }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !j.ok) { setError(String((j as { error?: string }).error ?? 'face-drag')); return; }
      await applyEditResp(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus('');
    }
  }, [lastAssembly, applyEditResp, ko]);
  useEffect(() => { faceDragCbRef.current = (id, n, d) => { void onFaceDragStudio(id, n, d); }; }, [onFaceDragStudio]);
  useEffect(() => {
    pickCbRef.current = (id, n, additive) => {
      if (additive && id) {
        setPickedMulti((prev) => (prev.includes(id) ? prev.filter((q) => q !== id) : [...prev, id]));
        setPickedPart(id); setPickedNormal(n);
      } else {
        setPickedMulti(id ? [id] : []);
        setPickedPart(id); setPickedNormal(n);
      }
    };
  }, []);
  // 선택 부품이 어셈블리에서 사라지면 자동 해제
  useEffect(() => {
    if (pickedPart && !lastPartsAabb?.some((p) => p.id === pickedPart)) { setPickedPart(null); setPickedNormal(null); }
  }, [lastPartsAabb, pickedPart]);

  const run = useCallback(
    async (text: string) => {
      const desc = text.trim();
      if (desc.length < 4) return;
      // 🎯 선택 부품이 있으면 프롬프트=그 부품만 수정(edit-part)
      if (pickedPart && lastAssembly) { void editPartRun(desc); return; }
      setLoading(true);
      setError(null);
      setGateErrors(null);
      setExportMsg(null);
      setCheckpoint(null); // 이전 pending 체크포인트는 새 생성 시작 시 무효
      lastPromptRef.current = desc; // vision 비평의 판정 기준(요청한 물건)으로 사용
      // 어셈블리 스펙 감지 — 챗 핸드오프 type 우선, 없으면 휴리스틱(부품@좌표 나열 패턴).
      // 어셈블리를 단품 파이프(compose)에 밀면 왕복·교정이 길어져 "멈춘 듯" 보인다.
      // 감사 2026-07-16: 콤마·키워드 휴리스틱은 상세 단품을 오라우팅 — 핸드오프 type 또는
      // 부품@(좌표) 패턴 2회 이상(진짜 배치 나열)일 때만 어셈블리로.
      const isAssembly = handoffTypeRef.current === 'assembly'
        || ((desc.match(/@\(/g)?.length ?? 0) >= 2);
      handoffTypeRef.current = null; // 1회 소비
      setStatus(isAssembly
        ? (ko ? 'AI가 부품을 분해·배치하고 간섭을 검사하는 중… (최대 3라운드)' : 'Decomposing parts & checking interference… (≤3 rounds)')
        : (ko ? 'AI가 설계를 조합하고 검증하는 중…' : 'Composing & verifying the design…'));
      runAbortRef.current?.abort(); // 동시 run 방지(감사) — 이전 요청·타이머는 해당 finally가 정리
      const ac = new AbortController();
      runAbortRef.current = ac;
      setElapsed(0);
      const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
      let timedOut = false;
      const killer = setTimeout(() => { timedOut = true; ac.abort(); }, 120_000); // §13-2 상한 타임아웃 v1
      try {
        /**
         * ★진행 스트림(260803) — **지금 무슨 작업 중인지**를 단계로 받는다.
         *
         * 종전에는 「AI가 부품을 분해·배치하고 간섭을 검사하는 중…」 한 문장이 20~60초 동안
         * 그대로 떠 있었다. 사용자는 **멈춘 것과 도는 것을 구별할 수 없다.**
         * 어셈블리 경로만 SSE 를 쓴다(compose 는 아직 단계 계측이 없다 — 없는 걸 있는 척하지 않는다).
         * ⚠ 스트림이 안 되면 **조용히 기존 JSON 으로 되돌아간다** — 진행 표시를 얻으려고
         *   생성 자체를 잃지 않는다(필렛 실패 폴백과 같은 규율).
         */
        const res = await fetch(isAssembly ? '/api/nexyfab/drawing/assemble/' : '/api/nexyfab/drawing/compose/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: desc, ...(isAssembly ? { stream: true } : {}) }),
          signal: ac.signal,
        });
        type RawResp = ComposeResp & { openscad?: string; composeIntent?: ComposeOk['intent']; interferences?: unknown[] };
        let streamed: RawResp | null = null;
        if (isAssembly && (res.headers.get('content-type') ?? '').includes('text/event-stream') && res.body) {
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            // SSE 프레임은 빈 줄로 끊긴다. 마지막 조각은 다음 청크와 이어 붙인다.
            const frames = buf.split('\n\n');
            buf = frames.pop() ?? '';
            for (const f of frames) {
              const line = f.split('\n').find((l) => l.startsWith('data: '));
              if (!line) continue;
              let ev: { stage?: string; pct?: number; ko?: string; en?: string; detail?: string; result?: unknown };
              try { ev = JSON.parse(line.slice(6)); } catch { continue; }
              if (ev.stage === 'done') { streamed = ev.result as RawResp; continue; }
              if (ev.stage === 'error') continue; // 아래 폴백이 받는다
              const label = (ko ? ev.ko : ev.en) ?? '';
              setStatus(`${label}${ev.detail && ko ? ` — ${ev.detail}` : ''}${typeof ev.pct === 'number' ? ` (${ev.pct}%)` : ''}`);
            }
          }
        }
        // ⚠ 스트림이 결과를 못 줬으면 **기존 JSON 으로 되돌아간다** — 진행 표시를 얻으려고
        //   생성 자체를 잃지 않는다(필렛 실패 폴백과 같은 규율).
        const raw: RawResp = streamed
          ?? ((await res.json().catch(() => ({ ok: false, error: '응답을 읽지 못했습니다.' }))) as RawResp);
        // assemble 응답(openscad/composeIntent)을 compose 형식으로 정규화
        const data: ComposeResp = raw.ok && isAssembly
          ? { ok: true, intent: (raw.composeIntent ?? { name: 'assembly' }) as ComposeOk['intent'], scad: String(raw.openscad ?? ''), rounds: (raw as { rounds?: number }).rounds ?? 1, verify: null }
          : raw;
        if (isAssembly && raw.ok) {
          pendingInterfRef.current = Array.isArray(raw.interferences) ? raw.interferences.length : 0; // 그물 ④
          const sup = (raw as { support?: { floating?: string[] } }).support;
          pendingFloatRef.current = Array.isArray(sup?.floating) ? sup.floating.length : null; // 그물 ④b 지지
          pendingIntentRef.current = ((raw as { intentMatch?: IntentMatch | null }).intentMatch) ?? null; // 그물 ⑦ 요청 정합
          pendingAssemblyRef.current = (raw as { assembly?: Record<string, unknown> }).assembly ?? null;
          pendingPartsRef.current = Array.isArray((raw as { parts?: unknown[] }).parts)
            ? ((raw as { parts?: unknown[] }).parts as { id: string; aabb: { min: number[]; max: number[] } }[])
            : null; // 🎯 픽킹 프록시(월드 AABB)
          pendingDraftRef.current = ((raw as { draft?: { openscad: string; parts: unknown[] } }).draft ?? null) as { openscad: string; parts: { id: string; aabb: { min: number[]; max: number[] } }[] } | null; // #1 1차 골격
        }
        if (!data.ok) {
          setErrCode((raw as { code?: string }).code ?? null);
          if (data.gateErrors?.length) setGateErrors(data.gateErrors);
          else setError(data.error ?? (ko ? '설계 생성 실패' : 'Design failed'));
          setStatus('');
          return;
        }
        if (!data.scad) { setError(ko ? '형상이 비어 있습니다.' : 'Empty geometry.'); setStatus(''); return; }
        // §2.1 도면 체크포인트 — 드래프트를 빌드해 3뷰+치수를 먼저 승인받는다(뷰어 적용은 승인 후)
        if (wasmAvailable()) {
          setStatus(ko ? '체크포인트 도면 생성 중…' : 'Building checkpoint views…');
          const r = await renderScadWasm(data.scad);
          if (r.ok && r.data) {
            const buf = r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) as ArrayBuffer;
            const geom = parseSTL(buf);
            geom.computeBoundingBox();
            const bb = geom.boundingBox;
            const pos = geom.getAttribute('position');
            if (bb && pos) {
              setCheckpoint({
                intent: data.intent, scad: data.scad, verify: data.verify,
                positions: pos.array as Float32Array,
                bbox: { x: +(bb.max.x - bb.min.x).toFixed(1), y: +(bb.max.y - bb.min.y).toFixed(1), z: +(bb.max.z - bb.min.z).toFixed(1) },
              });
              setCpState('pending');
              setStatus('');
              return;
            }
          }
        }
        await applyDesign(data.intent, data.scad, data.verify); // WASM 불가 폴백 — 체크포인트 생략
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') {
          setStatus('');
          if (timedOut) setError(ko ? '시간 초과(120초) — 스펙을 더 작게 나누거나 부품 수를 줄여 다시 시도하세요.' : 'Timed out (120s) — try a smaller spec.');
        } else {
          setError(e instanceof Error ? e.message : String(e));
          setStatus('');
        }
      } finally {
        clearInterval(timer);
        clearTimeout(killer);
        runAbortRef.current = null;
        setLoading(false);
      }
    },
    [ko, applyDesign, pickedPart, lastAssembly, editPartRun],
  );

  // 체크포인트 승인/취소 — 승인해야 뷰어 적용, 취소하면 프롬프트 수정 재생성 유도
  const approveCheckpoint = useCallback(async () => {
    if (!checkpoint) return;
    const cp = checkpoint;
    setCheckpoint(null);
    setCpState('approved');
    await applyDesign(cp.intent, cp.scad, cp.verify);
    void runReprojectDiff(cp.intent); // W(2026-07-16): 승인 직후 듀얼-방출 대조 자동 실행
  // runReprojectDiff는 아래에서 선언(호출은 이벤트 시점이라 안전) — deps 포함 시 TDZ
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpoint, applyDesign]);
  const cancelCheckpoint = useCallback(() => { setCheckpoint(null); setCpState('none'); }, []);

  // §8-③ 역투영 diff v1 — 듀얼-방출 교차검증: 드래프트(뷰어 메시) 실측 vs 기록(OCCT) 실측
  interface DiffCheck { name: string; draft: number; record: number; diff: number; tol: number; pass: boolean }
  interface DimRow { label: string; declared: number; measured: number | null; pos: string; pass: boolean }
  interface DimAudit { rows: DimRow[]; extraFaces: number; note: string }
  type Manufacturability = { lumps: number | null; floating: boolean; fuseDropped: number; note: string };
  type DiffRes = { ok: true; verdict: string; checks: DiffCheck[]; dims?: DimAudit | null; record?: { profiles?: AxisProfile[] }; manufacturability?: Manufacturability; notes?: string[] } | { ok: false; stage?: string; error?: string };
  const [diffRes, setDiffRes] = useState<DiffRes | null>(null);
  const [diffDraftProfiles, setDiffDraftProfiles] = useState<AxisProfile[] | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const runReprojectDiff = useCallback(async (intentArg?: ComposeOk['intent']) => {
    const it = intentArg ?? intent;
    const geom = meshRef.current?.geometry;
    if (!it || !geom) return;
    setDiffBusy(true);
    setDiffRes(null);
    try {
      // 드래프트 실측 — 기록 커널과 같은 수학(부호 사면체 합)으로 재어 공정 비교
      const pos = geom.getAttribute('position');
      const a = pos.array as Float32Array;
      geom.computeBoundingBox();
      const bb = geom.boundingBox;
      if (!bb) throw new Error('no bbox');
      let vol6 = 0;
      for (let i = 0; i + 8 < a.length; i += 9) {
        vol6 += a[i] * (a[i + 4] * a[i + 8] - a[i + 5] * a[i + 7])
          + a[i + 1] * (a[i + 5] * a[i + 6] - a[i + 3] * a[i + 8])
          + a[i + 2] * (a[i + 3] * a[i + 7] - a[i + 4] * a[i + 6]);
      }
      const profiles = stationProfilesClient(a);
      setDiffDraftProfiles(profiles);
      const draft = {
        bbox: { x: +(bb.max.x - bb.min.x).toFixed(3), y: +(bb.max.y - bb.min.y).toFixed(3), z: +(bb.max.z - bb.min.z).toFixed(3) },
        volume: +Math.abs(vol6 / 6).toFixed(1),
        profiles,
      };
      const res = await fetch('/api/nexyfab/drawing/reproject-diff/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: it, draft }),
      });
      setDiffRes((await res.json()) as DiffRes);
    } catch (e) {
      setDiffRes({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setDiffBusy(false);
    }
  }, [intent]);

  // §7 그물 ⑤ vision 비평 — 렌더 스크린샷을 Gemini가 "요청한 물건으로 보이는가"로 판정.
  // 교정 SCAD는 적용하지 않는다(정직: intent와 어긋난 기하 주입 금지 — 수정은 재생성으로).
  const [visRes, setVisRes] = useState<{ faithful: boolean; issues: string[] } | { error: string } | null>(null);
  const [visBusy, setVisBusy] = useState(false);
  // 그물 ⑥ 간이 FEA(29축 V) — 하중은 사용자 명시 입력(날조 금지)
  interface FeaRes { ok: true; method: string; maxStressMPa: number; safetyFactor: number | null; maxDispMm: number | null; material: string; yieldMPa: number; refined?: unknown; reportHtml?: string; note?: string }
  const [feaRes, setFeaRes] = useState<FeaRes | { ok: false; error: string } | null>(null);
  const [feaBusy, setFeaBusy] = useState(false);
  const [feaLoad, setFeaLoad] = useState('');
  const [feaMat, setFeaMat] = useState('steel');
  const runFeaQuick = useCallback(async () => {
    const loadKg = Number(feaLoad);
    if (!scad || !Number.isFinite(loadKg) || loadKg <= 0) return;
    setFeaBusy(true);
    setFeaRes(null);
    try {
      const r = await fetch('/api/nexyfab/drawing/fea-quick/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scad, materialKey: feaMat, loadKg }),
      });
      setFeaRes((await r.json()) as FeaRes | { ok: false; error: string });
    } catch (e) {
      setFeaRes({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setFeaBusy(false);
    }
  }, [scad, feaLoad, feaMat]);
  // P0-b(260719b) 정밀 검증 — A1 라운드트립+B1 의심쌍 메시 부울 온디맨드(어셈블리 경로)
  interface PrecRes {
    ok: boolean; error?: string; gateErrors?: string[];
    roundtrip?: { verdict?: string; volume?: { predictedMm3: number; measuredMm3: number; errMm3: number; bandMm3: number }; error?: string } | null;
    interferenceRefine?: { interferences: unknown[]; demoted: unknown[]; laps?: unknown[]; checked: number; error?: string } | null;
    interferences?: unknown[]; designOk?: boolean | null;
  }
  const [precRes, setPrecRes] = useState<PrecRes | null>(null);
  const [precBusy, setPrecBusy] = useState(false);
  const runPrecision = useCallback(async () => {
    if (!lastAssembly) return;
    setPrecBusy(true);
    setPrecRes(null);
    try {
      const r = await fetch('/api/nexyfab/drawing/verify-precision/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly: lastAssembly }),
      });
      setPrecRes((await r.json()) as PrecRes);
    } catch (e) {
      setPrecRes({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPrecBusy(false);
    }
  }, [lastAssembly]);
  const lastPromptRef = useRef<string>('');
  const runVisionCritique = useCallback(async () => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas || !scad) return;
    setVisBusy(true);
    setVisRes(null);
    try {
      const subject = lastPromptRef.current.trim() || intent?.name || 'the design';
      const res = await fetch('/api/nexyfab/scad-vision-critique/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: canvas.toDataURL('image/png'), prompt: subject, scad }),
      });
      const j = (await res.json()) as { faithful?: boolean; issues?: string[] };
      setVisRes({ faithful: j.faithful !== false, issues: Array.isArray(j.issues) ? j.issues : [] });
    } catch (e) {
      setVisRes({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setVisBusy(false);
    }
  }, [scad, intent]);

  const download = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // 설계 패키지 zip(챗 카드와 동일 계약) — 어셈블리 경로에서만(단품은 STEP/HTML로 충분)
  const downloadPackage = useCallback(async () => {
    if (!lastAssembly) return;
    setPkgBusy(true);
    setExportMsg(null);
    /**
     * ★확정(260803) — 제작물을 내려받는 순간이 **확정 시점**이다.
     * 그 시점의 어셈블리를 **깊은 복사로** 잡아 둔다. 참조만 들면 다음 수정이 확정본을
     * 조용히 바꿔, 사용자는 「내가 확정한 것이 무엇인지」를 잃는다.
     * ⚠ 실패해도 스냅샷은 남긴다 — 「무엇으로 시도했는지」가 실패 분석의 출발점이다.
     */
    setConfirmedSnap(snapshot(ko ? '제작 확정' : 'Confirmed for manufacturing', 'make', lastAssembly, Date.now()));
    try {
      const r = await fetch('/api/nexyfab/drawing/package/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly: lastAssembly }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; zipBase64?: string; error?: string };
      if (!r.ok || !j.ok || typeof j.zipBase64 !== 'string') throw new Error(j.error ?? '패키지 생성 실패');
      const bin = atob(j.zipBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'design_package.zip'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setExportMsg(ko ? '설계 패키지(zip) 내려받음 — GA·2D·구조·BOQ·Dossier 포함' : 'Design package downloaded');
    } catch (e) {
      setExportMsg((ko ? '패키지 실패: ' : 'Package failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPkgBusy(false);
    }
  }, [lastAssembly, ko]);

  const exportStep = useCallback(async () => {
    if (!intent) return;
    setExporting('step');
    setExportMsg(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/export-step/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent }),
      });
      const data = (await res.json()) as { ok: boolean; step?: string; entities?: number; error?: string };
      if (data.ok && data.step) {
        download(`${intent.name ?? 'design'}.step`, data.step, 'application/step');
        setExportMsg((ko ? 'STEP 내보냄 · 엔티티 ' : 'STEP exported · ') + (data.entities ?? '?') + (ko ? '개' : ' entities'));
      } else {
        setExportMsg((ko ? 'STEP 실패: ' : 'STEP failed: ') + (data.error ?? ''));
      }
    } catch (e) {
      setExportMsg((ko ? 'STEP 실패: ' : 'STEP failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting('');
    }
  }, [intent, ko]);

  const exportHtml = useCallback(async () => {
    if (!intent) return;
    setExporting('html');
    setExportMsg(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/render-html/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, title: intent.name ?? 'NexyFab 3D' }),
      });
      const data = (await res.json()) as { ok: boolean; html?: string; error?: string };
      if (data.ok && data.html) {
        download(`${intent.name ?? 'design'}.html`, data.html, 'text/html');
        setExportMsg(ko ? '자립형 HTML 뷰어 내보냄' : 'Self-contained HTML viewer exported');
      } else {
        setExportMsg((ko ? 'HTML 실패: ' : 'HTML failed: ') + (data.error ?? ''));
      }
    } catch (e) {
      setExportMsg((ko ? 'HTML 실패: ' : 'HTML failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting('');
    }
  }, [intent, ko]);

  const manifoldOk = verify && verify.manifold === true && !verify.error;
  const verifyFailed = verify && (verify.error || verify.manifold === false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--nx-bg, #f4f6f8)', color: 'var(--nx-text, #1a2230)' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--nx-border, #dfe3e8)' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>
          {domain ? <span style={{ marginRight: 6 }}>{domain.icon}</span> : null}
          {domain ? (ko ? domain.labelKo : domain.labelEn) : ko ? '설계' : 'Design'}
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
            {domain ? (ko ? domain.descKo : domain.descEn) : (
              (() => {
                const stage = verify ? 2 : intent ? 1 : 0;
                const steps = ko ? ['아이디어', '설계', '검증(상시)', '제조'] : ['idea', 'design', 'verify', 'manufacture'];
                return steps.map((st, i) => (
                  <span key={st} style={{ color: i === stage ? 'var(--nx-accent, #2563eb)' : undefined, fontWeight: i === stage ? 800 : 600 }}>
                    {st}{i < steps.length - 1 ? ' → ' : ''}
                  </span>
                ));
              })()
            )}
            {verify && !('error' in (verify as object)) && (
              <span style={{ marginLeft: 10, padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                background: (verify as { manifold?: boolean }).manifold ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.15)',
                color: (verify as { manifold?: boolean }).manifold ? '#16a34a' : '#dc2626' }}>
                {(verify as { manifold?: boolean }).manifold ? (ko ? '검증 통과' : 'VERIFIED') : (ko ? '검증 실패' : 'FAILED')}
              </span>
            )}
          </span>
        </h1>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left: prompt + verify + export */}
        <div style={{ width: 380, minWidth: 380, borderRight: '1px solid var(--nx-border, #dfe3e8)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          {/* 작업 4탭 — 세로 스택 해체: 생성 | 검증 | 계산기 | 출력 */}
          <div style={{ display: 'flex', gap: 4, padding: '10px 12px 0', position: 'sticky', top: 0, zIndex: 5, background: 'var(--nx-bg, #fff)' }}>
            {([['create', ko ? '생성' : 'Create'], ['verify', ko ? '검증' : 'Verify'], ['calc', ko ? '계산기' : 'Calc'], ['output', ko ? '출력' : 'Output']] as [StudioTab, string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                style={{ flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid ' + (tab === k ? 'var(--nx-accent, #2563eb)' : 'var(--nx-border, #dfe3e8)'),
                  background: tab === k ? 'var(--nx-accent, #2563eb)' : 'transparent', color: tab === k ? '#fff' : 'inherit' }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ padding: 16, display: tab === 'create' ? undefined : 'none' }}>
            {/* 일반인 진입 — 전문 용어 없이 3~4단계 질문으로 템플릿+치수까지(EasyWizard) */}
            <button
              type="button"
              onClick={() => setEasyOpen(true)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', marginBottom: 12, padding: '11px 13px',
                borderRadius: 9, border: '1px solid var(--nx-accent, #2563eb)',
                background: 'var(--nx-accent-soft, rgba(37,99,235,0.10))', color: 'var(--nx-text, #1a2230)', cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--nx-accent, #2563eb)' }}>
                {ko ? '🙋 처음이신가요? 쉬운 설계로 시작' : '🙋 New here? Start with Easy design'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)', marginTop: 3 }}>
                {ko ? '"마당에 6×3m 데크" 처럼 말하면 됩니다 — 질문 3~4개로 만들어 드립니다.' : 'Say it plainly, e.g. "a 6×3 m deck in the yard" — 3~4 questions and it is built.'}
              </div>
            </button>
            <EasyWizard
              lang={lang}
              open={easyOpen}
              onClose={() => setEasyOpen(false)}
              onApply={async (i, s) => {
                setError(null); setGateErrors(null); setExportMsg(null);
                await applyDesign(i, s, null);
              }}
              onBuildInfo={(info) => { pendingInterfRef.current = info.interferences; pendingFloatRef.current = info.floating ?? null; pendingAssemblyRef.current = info.assembly ?? null; }}
            />
            {/* 기계 세부분야 칩 — 가설·랙은 사이드바에서 기계로 흡수(2026-07-16 IA) */}
            {(domain?.slug === 'mech' || domain?.slug === 'rack') && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {([['mech', ko ? '기계·장비·판금' : 'Machinery/sheet'], ['rack', ko ? '가설·랙·경량철골' : 'Rack/light steel']] as [string, string][]).map(([s, label]) => (
                  <a key={s} href={`/${lang}/nexyfab/design/?domain=${s}`}
                    style={{ padding: '5px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, textDecoration: 'none',
                      border: '1px solid ' + (domain.slug === s ? 'var(--nx-accent, #2563eb)' : 'var(--nx-border, #dfe3e8)'),
                      background: domain.slug === s ? 'var(--nx-accent-soft, rgba(37,99,235,0.12))' : 'transparent',
                      color: domain.slug === s ? 'var(--nx-accent, #2563eb)' : 'var(--nx-text-2, #46505e)' }}>
                    {label}
                  </a>
                ))}
              </div>
            )}
            {/* 토목 세부분야 칩 — 교량 노출(2026-07-16 검증 배터리: 백엔드 완비·UI 미노출 해소) */}
            {(domain?.slug === 'civil' || domain?.slug === 'bridge') && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {([['civil', ko ? '토목 소구조물' : 'Civil structures'], ['bridge', ko ? '교량 (거더교)' : 'Bridge (girder)']] as [string, string][]).map(([s, label]) => (
                  <a key={s} href={`/${lang}/nexyfab/design/?domain=${s}`}
                    style={{ padding: '5px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, textDecoration: 'none',
                      border: '1px solid ' + (domain.slug === s ? 'var(--nx-accent, #2563eb)' : 'var(--nx-border, #dfe3e8)'),
                      background: domain.slug === s ? 'var(--nx-accent-soft, rgba(37,99,235,0.12))' : 'transparent',
                      color: domain.slug === s ? 'var(--nx-accent, #2563eb)' : 'var(--nx-text-2, #46505e)' }}>
                    {label}
                  </a>
                ))}
              </div>
            )}
            {/* 채팅-우선(2026-07-16 사용자 결정): 자유 서술이 1순위, 템플릿 갤러리는 아래 */}
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-text-3, #6b7684)' }}>
              {ko ? '무엇을 설계할까요?' : 'What do you want to design?'}
            </label>
            {pickedPart && (
              <div style={{
                marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999,
                border: '1px solid var(--nx-accent, #2563eb)', background: 'rgba(37,99,235,0.08)', fontSize: 12, fontWeight: 700,
              }}>
                🎯 {pickedPart}{pickedNormal ? ` · ${'xyz'[Math.abs(pickedNormal[0]) > 0.5 ? 0 : Math.abs(pickedNormal[1]) > 0.5 ? 1 : 2]}${(pickedNormal[Math.abs(pickedNormal[0]) > 0.5 ? 0 : Math.abs(pickedNormal[1]) > 0.5 ? 1 : 2] > 0 ? '+' : '−')}` : ''}
                <span style={{ fontWeight: 400, color: 'var(--nx-text-3, #6b7684)' }}>{ko ? '— 아래 서술이 이 부품만 수정 · 면 드래그=푸시풀' : '— prompt edits only this part · drag face = push-pull'}</span>
                <button type="button" onClick={() => { setPickedPart(null); setPickedNormal(null); setPickedMulti([]); pickSelRef.current.select(null); }} aria-label="clear"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nx-text-3, #6b7684)', fontSize: 12, padding: 0 }}>✕</button>
              </div>
            )}
            {/* #1 LOD: 1차 골격 표시 중 → 2차 상세 전환 */}
            {lodLevel === 1 && (
              <button type="button" onClick={() => void applyLod2()} style={{
                marginTop: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--nx-accent, #2563eb)',
                background: 'rgba(37,99,235,0.1)', color: 'var(--nx-accent, #2563eb)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                🧩 {ko ? `2차 상세 적용 (+${Math.max(0, (fullLodRef.current?.parts?.length ?? 0) - (lastPartsAabb?.length ?? 0))}부품 — 현재는 1차 골격)` : `Apply detail LOD (+${Math.max(0, (fullLodRef.current?.parts?.length ?? 0) - (lastPartsAabb?.length ?? 0))} parts)`}
              </button>
            )}
            {/* 🎯 편집 툴바(#1·#2·#5·#7) — 결정론 연산(AI 없음) + 교체(AI 지시 자동생성) + 저장/복원 */}
            {(pickedPart || histN > 0 || lastAssembly) && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 11.5 }}>
                {histN > 0 && (
                  <button type="button" onClick={() => void undoEdit()} style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}>
                    ↩ {ko ? '되돌리기' : 'Undo'} ({histN})
                  </button>
                )}
                {lastAssembly && (
                  <button type="button" onClick={() => void saveProject()} title={ko ? '편집 결과+REV 이력 서버 저장(로그인)' : 'Save edits+REV'}
                    style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', cursor: 'pointer' }}>💾 {ko ? '저장' : 'Save'}</button>
                )}
                {projList === null ? (
                  <button type="button" onClick={() => void loadProjects()} style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', cursor: 'pointer' }}>📂 {ko ? '불러오기' : 'Load'}</button>
                ) : (
                  <select defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) void loadProject(v); }}
                    style={{ padding: '4px 7px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', fontSize: 11.5, maxWidth: 180 }}>
                    <option value="">{ko ? `📂 프로젝트 ${projList.length}개…` : `📂 ${projList.length} projects…`}</option>
                    {projList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                {pickedPart && (
                  <>
                    {pickedMulti.length > 1 && <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>{ko ? `다중 ${pickedMulti.length}개(Ctrl+클릭)` : `${pickedMulti.length} selected`}</span>}
                    <button type="button" disabled={loading} onClick={() => void partOpRun('duplicate', pickedMulti.length ? pickedMulti : [pickedPart])}
                      style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', cursor: 'pointer' }}>⧉ {ko ? '복제' : 'Dup'}</button>
                    <button type="button" disabled={loading} onClick={() => void partOpRun('delete', pickedMulti.length ? pickedMulti : [pickedPart])}
                      style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(239,68,68,.5)', background: 'var(--nx-panel, #fff)', color: '#ef4444', cursor: 'pointer' }}>🗑 {ko ? '삭제' : 'Del'}</button>
                    {pickedNormal && (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <input value={dimInput} onChange={(e) => setDimInput(e.target.value)} placeholder={ko ? '면 치수(mm)' : 'dim(mm)'} inputMode="decimal"
                          style={{ width: 78, padding: '4px 7px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', fontSize: 11.5 }} />
                        <button type="button" disabled={loading || !parseFloat(dimInput)} onClick={() => void applyDimInput()}
                          style={{ padding: '4px 9px', borderRadius: 7, border: 'none', background: 'var(--nx-accent, #2563eb)', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>{ko ? '치수 적용' : 'Set'}</button>
                      </span>
                    )}
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <input value={filletInput} onChange={(e) => setFilletInput(e.target.value)} placeholder={ko ? '필렛 r' : 'fillet r'} inputMode="decimal"
                        style={{ width: 58, padding: '4px 7px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', fontSize: 11.5 }} />
                      <button type="button" disabled={loading || !parseFloat(filletInput)} title={ko ? 'STEP(B-rep)에만 반영 — 표시 뷰어는 무필렛(명시)' : 'STEP only'}
                        onClick={() => { const r = parseFloat(filletInput); if (r > 0) { void partOpRun('fillet', pickedMulti.length ? pickedMulti : [pickedPart], { r }); setFilletInput(''); } }}
                        style={{ padding: '4px 9px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', cursor: 'pointer' }}>◜ {ko ? '필렛' : 'Fillet'}</button>
                    </span>
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <input value={moveInput} onChange={(e) => setMoveInput(e.target.value)} placeholder={ko ? '이동 dx,dy,dz' : 'move dx,dy,dz'}
                        style={{ width: 96, padding: '4px 7px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', fontSize: 11.5 }} />
                      <button type="button" disabled={loading} onClick={() => {
                        const m2 = moveInput.split(',').map((q) => parseFloat(q.trim()));
                        if (m2.length === 3 && m2.every(Number.isFinite) && m2.some((q) => q !== 0)) { void partOpRun('translate', pickedMulti.length ? pickedMulti : [pickedPart!], { dx: m2[0], dy: m2[1], dz: m2[2] }); setMoveInput(''); }
                      }}
                        style={{ padding: '4px 9px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', cursor: 'pointer' }}>⇢ {ko ? '이동' : 'Move'}</button>
                    </span>
                    <select defaultValue="" disabled={loading} onChange={(e) => { const t2 = e.target.value; e.target.value = ''; if (t2) void editPartRun(ko ? `이 부품을 type '${t2}' 로 교체해줘. 전체 외형 치수는 유지하고 params 는 새 타입의 전체 파라미터로.` : `Replace this part with type '${t2}', keep overall envelope, output full params for the new type.`); }}
                      style={{ padding: '4px 7px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', fontSize: 11.5 }}>
                      <option value="">{ko ? '⇄ 교체…' : '⇄ Replace…'}</option>
                      {['box', 'cylinder', 'tube', 'rect_tube', 'h_section', 'c_channel', 'angle', 'flange'].map((t2) => <option key={t2} value={t2}>{t2}</option>)}
                    </select>
                  </>
                )}
              </div>
            )}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={ko ? '예: 내경 500mm 원통형 물탱크, 높이 800mm…' : 'e.g. a 500mm cylindrical water tank, 800mm tall…'}
              rows={5}
              style={{
                width: '100%', marginTop: 6, padding: 10, borderRadius: 8, resize: 'vertical',
                border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)',
                color: 'inherit', fontSize: 13, lineHeight: 1.5, boxSizing: 'border-box',
              }}
            />
            {/* 명료화 pre-pass: 대충 쓴 한 줄 → 질문/구조화 브리프(확정·가정·확인필요). 형상은 안 만들고 프롬프트만 다듬음 */}
            <BriefClarifier lang={lang} rawText={prompt} onUseRefined={(t) => setPrompt(t)} />
            <button
              type="button"
              disabled={loading || prompt.trim().length < 4}
              onClick={() => run(prompt)}
              style={{
                width: '100%', marginTop: 8, padding: '10px 14px', borderRadius: 8, border: 'none',
                background: loading || prompt.trim().length < 4 ? 'var(--nx-text-3, #9aa4b0)' : 'var(--nx-accent, #2563eb)',
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? (status || (ko ? '처리 중…' : 'Working…')) : pickedPart ? (ko ? `🎯 ${pickedPart} 수정` : `🎯 Edit ${pickedPart}`) : ko ? '설계 생성 + 검증' : 'Generate + verify'}
            </button>

            {/* §2.1 도면 체크포인트 — 자유 서술 결과는 승인 후에만 뷰어 적용 */}
            {checkpoint && (
              <CheckpointPanel data={checkpoint} ko={ko} onApprove={approveCheckpoint} onCancel={cancelCheckpoint} />
            )}

            {/* 분야 프리셋(갤러리) 또는 일반 예시 */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--nx-text-3, #6b7684)', marginBottom: 4 }}>
                {domain ? (ko ? '분야 예시 — 누르면 바로 생성' : 'Domain examples — click to generate') : ko ? '예시' : 'Examples'}
              </div>
              {domain
                ? domain.presets.map((p, i) => {
                    const txt = ko ? p.promptKo : p.promptEn;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={loading}
                        onClick={() => { setPrompt(txt); run(txt); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', marginBottom: 4, padding: '7px 9px',
                          borderRadius: 6, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)',
                          color: 'var(--nx-text-2, #46505e)', fontSize: 11.5, lineHeight: 1.4, cursor: loading ? 'default' : 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: 700, color: 'var(--nx-text, #1a2230)', marginBottom: 2 }}>{ko ? p.titleKo : p.titleEn}</div>
                        <div style={{ fontSize: 10.5 }}>{txt}</div>
                      </button>
                    );
                  })
                : EXAMPLES.map((exSpec, i) => {
                    const ex = loc(lang, exSpec);
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={loading}
                        onClick={() => { setPrompt(ex); run(ex); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', marginBottom: 4, padding: '6px 8px',
                          borderRadius: 6, border: '1px solid var(--nx-border, #dfe3e8)', background: 'transparent',
                          color: 'var(--nx-text-2, #46505e)', fontSize: 11.5, lineHeight: 1.4, cursor: loading ? 'default' : 'pointer',
                        }}
                      >
                        {ex}
                      </button>
                    );
                  })}
            </div>

            {/* 템플릿 갤러리 — 채팅 아래(카드 클릭=즉시 생성은 유지) */}
            <div style={{ marginTop: 12 }}>
              {domain?.parametric && (
                <ParametricPresetPanel
                  lang={lang}
                  domain={domain.slug}
                  onApply={async (i, s, v) => {
                    setError(null); setGateErrors(null); setExportMsg(null);
                    await applyDesign(i, s, v ?? null);
                  }}
                />
              )}
              {domain && (
                <AssemblyPresetPanel
                  lang={lang}
                  domain={domain.slug}
                  onApply={async (i, s) => {
                    setError(null); setGateErrors(null); setExportMsg(null);
                    await applyDesign(i, s, null);
                  }}
                  onBuildInfo={(info) => { pendingInterfRef.current = info.interferences; pendingFloatRef.current = info.floating ?? null; pendingAssemblyRef.current = info.assembly ?? null; }}
                />
              )}
            </div>

            {/* 기계 전문 도구 — 구 사이드바 '도구' 섹션의 새 집(2026-07-16 IA) */}
            {(domain?.slug === 'mech' || domain?.slug === 'rack') && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--nx-text-3, #6b7684)', marginBottom: 4 }}>{ko ? '기계 전문 도구' : 'Pro tools'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {([
                    ['✨', ko ? '자유형 Studio' : 'Free-form Studio', `/${lang}/studio`],
                    ['🛠️', ko ? '전문가형 CAD' : 'Expert CAD', `/${lang}/shape-generator?mode=expert`],
                    ['📐', ko ? '종이·레이저컷' : 'Papercraft', `/${lang}/papercraft`],
                    ['🔩', ko ? '부품 라이브러리' : 'Part Library', `/${lang}/nexyfab/cots`],
                  ] as [string, string, string][]).map(([ic, label, href]) => (
                    <a key={href} href={href}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 10px', borderRadius: 8, textDecoration: 'none',
                        border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)',
                        color: 'var(--nx-text, #1a2230)', fontSize: 11.5, fontWeight: 700 }}>
                      <span aria-hidden style={{ fontSize: 14 }}>{ic}</span>{label}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#fdecec', color: '#b42318', fontSize: 12.5 }}>
                {error}
                {errCode === 'PLAN_LIMIT' && (
                  <a href={`/${lang}/pricing/`} style={{ display: 'inline-block', marginLeft: 8, fontWeight: 800, color: 'var(--nx-accent, #2563eb)' }}>{ko ? 'Pro 보기 →' : 'See Pro →'}</a>
                )}
              </div>
            )}
            {gateErrors && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#fff4e5', color: '#a15c00', fontSize: 12.5 }}>
                <b>{ko ? '검증 실패 — 형상을 만들지 않았습니다' : 'Verification failed — no geometry produced'}</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                  {gateErrors.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
            )}
          </div>

          {/* Always-on verification panel */}
          <div style={{ padding: '0 16px 16px', display: tab === 'verify' ? undefined : 'none', paddingTop: tab === 'verify' ? 16 : 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.02em', marginBottom: 6 }}>
              {ko ? '검증 (상시)' : 'Verification (always-on)'}
            </div>
            {/* §7 검증 그물 — 통과·실패·미실행 상시 노출(은폐 없음) */}
            <VerifyNet ko={ko} items={([
              {
                label: ko ? '① 도면 체크포인트(의도 오류)' : '① Drawing checkpoint (intent errors)',
                status: cpState === 'approved' ? 'pass' : cpState === 'pending' ? 'todo' : cpState === 'skipped' ? 'skip' : 'todo',
                note: cpState === 'approved' ? (ko ? '승인됨' : 'approved')
                  : cpState === 'skipped' ? (ko ? '생략 — 결정론 프리셋/판독 확인카드 경로' : 'skipped — deterministic path')
                  : cpState === 'pending' ? (ko ? '승인 대기' : 'awaiting approval') : (ko ? '자유 서술 생성 시 활성' : 'runs on free-text'),
              },
              {
                label: ko ? '② manifold/watertight(기하 결함)' : '② Manifold/watertight',
                status: verify ? (verify.error ? 'fail' : verify.manifold ? 'pass' : 'fail') : 'todo',
                note: verify?.triangles ? `${verify.triangles} tri` : undefined,
              },
              {
                label: ko ? '③ 역투영 diff(방출 오류 — 듀얼-방출 대조)' : '③ Re-projection diff (dual-emission)',
                status: diffRes ? (diffRes.ok ? (diffRes.verdict === 'PASS' ? 'pass' : 'fail') : 'skip') : 'todo',
                note: diffRes
                  ? (diffRes.ok ? (ko ? `외형+부피+단면 프로파일 — ${diffRes.verdict}` : `extents+volume+sections — ${diffRes.verdict}`) : (diffRes.stage === 'unsupported' ? (ko ? '기록 커널 미지원 형상' : 'unsupported by record kernel') : (ko ? '실행 실패' : 'run failed')))
                  : (ko ? '아래 버튼으로 실행 (외형·부피·단면 실루엣)' : 'run below (extents · volume · sections)'),
              },
              {
                label: ko ? '④ 어셈블리 간섭' : '④ Assembly interference',
                status: interf === null ? 'skip' : interf === 0 ? 'pass' : 'fail',
                note: interf === null ? (ko ? '어셈블리 빌드 시 활성' : 'runs on assembly build') : interf === 0 ? (ko ? '간섭 없음' : 'no clash') : (ko ? `간섭 ${interf}건` : `${interf} clashes`),
              },
              {
                label: ko ? '④b 지지 체인(부유 — 연결≠지지)' : '④b Support chain (floating)',
                status: floatN === null ? 'skip' : floatN === 0 ? 'pass' : 'fail',
                note: floatN === null ? (ko ? '어셈블리 빌드 시 활성' : 'runs on assembly build') : floatN === 0 ? (ko ? '부유 없음' : 'none floating') : (ko ? `부유 ${floatN}건 — 설치 불가 신호` : `${floatN} floating parts`),
              },
              {
                label: ko ? '⑦ 요청 정합(요구 추출→형상 실측 대조)' : '⑦ Intent match (claims vs built)',
                status: intentM === null ? 'skip' : intentM.mismatched > 0 ? 'fail' : intentM.matched > 0 ? 'pass' : 'skip',
                note: intentM === null
                  ? (ko ? '챗 어셈블리 생성 시 활성' : 'runs on chat assembly')
                  : intentM.mismatched > 0
                    ? (ko ? `불일치 ${intentM.mismatched}건: ` : `${intentM.mismatched} mismatch: `) + intentM.results.filter((q) => q.verdict === 'MISMATCH').slice(0, 2).map((q) => `"${q.text}" — ${q.note}`).join(' · ')
                      + (intentM.repair?.attempted ? (ko ? ` · 자동 교정 시도(${intentM.repair.before}→${intentM.repair.after}건${intentM.repair.adopted ? ', 채택' : ', 원본 유지'})` : ` · auto-repair ${intentM.repair.before}→${intentM.repair.after}`) : '')
                    : (ko ? `일치 ${intentM.matched}` : `${intentM.matched} matched`) + (intentM.unverifiable ? (ko ? ` · 검증불가 ${intentM.unverifiable}(정직 표기)` : ` · ${intentM.unverifiable} unverifiable`) : '')
                      + (intentM.repair?.adopted ? (ko ? ` · 자동 교정 채택(불일치 ${intentM.repair.before}→${intentM.repair.after})` : ` · auto-repaired ${intentM.repair.before}→${intentM.repair.after}`) : '')
                      + (intentM.assumptions?.length ? (ko ? ` · AI 가정 ${intentM.assumptions.length}건(자가보고): ${intentM.assumptions.slice(0, 2).join(' / ')}` : ` · ${intentM.assumptions.length} AI assumptions`) : ''),
              },
              {
                label: ko ? '⑥ 간이 FEA(응력·SF — 스크리닝)' : '⑥ Quick FEA (screening)',
                status: feaRes ? (feaRes.ok ? ((feaRes.safetyFactor ?? 0) >= 1 ? 'pass' : 'fail') : 'skip') : 'todo',
                note: feaRes
                  ? (feaRes.ok ? `SF ${feaRes.safetyFactor ?? '—'} · ${feaRes.maxStressMPa}MPa/${feaRes.yieldMPa}MPa` : (ko ? '실행 실패' : 'failed'))
                  : (ko ? '아래에서 하중 입력 후 실행(비법정)' : 'enter load below'),
              },
              {
                label: ko ? '⑤ vision 비평(토폴로지 블런더)' : '⑤ Vision critique',
                status: visRes ? ('error' in visRes ? 'skip' : visRes.faithful ? 'pass' : 'fail') : 'todo',
                note: visRes
                  ? ('error' in visRes ? (ko ? '실행 실패' : 'run failed') : visRes.faithful ? (ko ? '요청 형상으로 판독됨' : 'reads as requested') : (ko ? `문제 ${visRes.issues.length}건` : `${visRes.issues.length} issues`))
                  : (ko ? '아래 버튼으로 실행' : 'run below'),
              },
            ] as NetItem[])} />
            {/* §8-③ 역투영 diff v1 실행 — 드래프트(뷰어 메시) vs 기록(OCCT) 듀얼-방출 대조 */}
            {intent && (
              <div style={{ marginBottom: 12 }}>
                <button type="button" onClick={() => void runReprojectDiff()} disabled={diffBusy}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: diffBusy ? 'wait' : 'pointer',
                    border: '1px solid var(--nx-accent, #2563eb)', background: 'transparent', color: 'var(--nx-accent, #2563eb)' }}>
                  {diffBusy ? (ko ? '기록 커널(OCCT) 빌드·대조 중…' : 'Building record kernel & comparing…') : ko ? '⇄ 역투영 diff 실행 — 드래프트 vs 기록 커널' : '⇄ Run re-projection diff (draft vs record)'}
                </button>
                {diffRes && !diffRes.ok && (
                  <div style={{ marginTop: 6, fontSize: 11, color: diffRes.stage === 'unsupported' ? '#b45309' : '#991b1b' }}>{diffRes.error}</div>
                )}
                {diffRes?.ok && (
                  <div style={{ marginTop: 6, padding: 9, borderRadius: 8, border: `1px solid ${diffRes.verdict === 'PASS' ? 'rgba(22,163,74,0.4)' : 'rgba(220,38,38,0.4)'}`, background: 'var(--nx-panel, #fff)' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: diffRes.verdict === 'PASS' ? '#16a34a' : '#dc2626' }}>
                      {diffRes.verdict === 'PASS' ? '✓' : '✗'} {ko ? '듀얼-방출 대조 ' : 'Dual-emission '} {diffRes.verdict}
                    </div>
                    {diffRes.manufacturability && (diffRes.manufacturability.floating || diffRes.manufacturability.fuseDropped > 0) && (
                      <div style={{ marginTop: 3, fontSize: 10, color: '#b45309' }}>
                        ⚠ {diffRes.manufacturability.floating ? diffRes.manufacturability.note : ''}
                        {diffRes.manufacturability.fuseDropped > 0
                          ? (ko ? ` · B-rep 융합 제외 ${diffRes.manufacturability.fuseDropped}건(정직 고지)` : ` · ${diffRes.manufacturability.fuseDropped} features dropped in B-rep fuse`)
                          : ''}
                      </div>
                    )}
                    <table style={{ width: '100%', marginTop: 5, borderCollapse: 'collapse', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                      <thead>
                        <tr style={{ color: 'var(--nx-text-3, #6b7684)' }}>
                          {[ko ? '항목' : 'Item', ko ? '드래프트' : 'Draft', ko ? '기록(OCCT)' : 'Record', 'Δ', ko ? '허용' : 'Tol', ''].map((h) => (
                            <th key={h} style={{ textAlign: 'left', padding: '2px 4px', borderBottom: '1px solid var(--nx-border, #dfe3e8)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {diffRes.checks.map((c) => (
                          <tr key={c.name}>
                            <td style={{ padding: '2px 4px', fontWeight: 600 }}>{c.name}</td>
                            <td style={{ padding: '2px 4px' }}>{c.draft}</td>
                            <td style={{ padding: '2px 4px' }}>{c.record}</td>
                            <td style={{ padding: '2px 4px' }}>{c.diff}</td>
                            <td style={{ padding: '2px 4px', color: 'var(--nx-text-3, #6b7684)' }}>≤{c.tol}</td>
                            <td style={{ padding: '2px 4px', fontWeight: 800, color: c.pass ? '#16a34a' : '#dc2626' }}>{c.pass ? '✓' : '✗'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* 치수 전수 대조(exact) — 선언 회전체 치수 ↔ B-rep 면 실측(±0.01mm) */}
                    {diffRes.dims && diffRes.dims.rows.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800 }}>{ko ? '치수 전수 대조 (선언 ↔ B-rep 실측)' : 'Full dimension audit (declared ↔ B-rep)'}</div>
                        <table style={{ width: '100%', marginTop: 3, borderCollapse: 'collapse', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                          <tbody>
                            {diffRes.dims.rows.map((r, ri) => (
                              <tr key={ri}>
                                <td style={{ padding: '2px 4px', fontWeight: 600 }}>{r.label}</td>
                                <td style={{ padding: '2px 4px' }}>{r.declared}</td>
                                <td style={{ padding: '2px 4px' }}>{r.measured ?? '—'}</td>
                                <td style={{ padding: '2px 4px', color: 'var(--nx-text-3, #6b7684)' }}>{r.pos}</td>
                                <td style={{ padding: '2px 4px', fontWeight: 800, color: r.pass ? '#16a34a' : '#dc2626' }}>{r.pass ? '✓' : '✗'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ marginTop: 2, fontSize: 8.5, color: 'var(--nx-text-3, #6b7684)', lineHeight: 1.5 }}>
                          {diffRes.dims.note}{diffRes.dims.extraFaces > 0 ? (ko ? ` · 선언 외 회전체 면 ${diffRes.dims.extraFaces}개(불리언 파생)` : ` · ${diffRes.dims.extraFaces} extra faces`) : ''}
                        </div>
                      </div>
                    )}

                    {/* 실루엣 오버레이(§13-4 래스터 트랙) — 파랑 실선=드래프트 · 빨강/주황 점선=기록 */}
                    {diffDraftProfiles && diffRes.record?.profiles && (
                      <>
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          {[0, 1, 2].map((ai) => (
                            diffDraftProfiles[ai] && diffRes.record?.profiles?.[ai]
                              ? <ProfileChart key={ai} d={diffDraftProfiles[ai]} r={diffRes.record.profiles[ai]} label={(ko ? '축 ' : 'axis ') + 'XYZ'[ai]} />
                              : null
                          ))}
                        </div>
                        <div style={{ marginTop: 2, fontSize: 8.5, color: 'var(--nx-text-3, #6b7684)' }}>
                          {ko ? '실루엣 오버레이: 실선=드래프트 · 점선=기록(OCCT) — 겹치면 정합' : 'Silhouette overlay: solid=draft · dashed=record'}
                        </div>
                      </>
                    )}
                    {diffRes.notes?.[1] && <div style={{ marginTop: 4, fontSize: 9, color: 'var(--nx-text-3, #6b7684)', lineHeight: 1.5 }}>{diffRes.notes[1]}</div>}
                  </div>
                )}

                {/* §7 그물 ⑤ vision 비평 — 판정·문제 나열만, 교정 기하는 주입하지 않음(재생성 유도) */}
                <button type="button" onClick={() => void runVisionCritique()} disabled={visBusy}
                  style={{ width: '100%', marginTop: 6, padding: '8px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: visBusy ? 'wait' : 'pointer',
                    border: '1px solid var(--nx-border, #dfe3e8)', background: 'transparent', color: 'inherit' }}>
                  {visBusy ? (ko ? '👁 vision이 렌더를 판독 중…' : '👁 Vision reading the render…') : ko ? '👁 vision 비평 실행 — 요청한 물건으로 보이는가' : '👁 Run vision critique'}
                </button>
                {visRes && 'error' in visRes && <div style={{ marginTop: 4, fontSize: 11, color: '#991b1b' }}>{visRes.error}</div>}
                {visRes && !('error' in visRes) && (
                  <div style={{ marginTop: 6, padding: 9, borderRadius: 8, border: `1px solid ${visRes.faithful ? 'rgba(22,163,74,0.4)' : 'rgba(220,38,38,0.4)'}`, background: 'var(--nx-panel, #fff)' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: visRes.faithful ? '#16a34a' : '#dc2626' }}>
                      {visRes.faithful ? (ko ? '✓ 요청한 형상으로 판독됨' : '✓ Reads as requested') : (ko ? '✗ 토폴로지 문제 발견' : '✗ Topology issues found')}
                    </div>
                    {!visRes.faithful && visRes.issues.length > 0 && (
                      <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 10.5, lineHeight: 1.6 }}>
                        {visRes.issues.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    )}
                    {!visRes.faithful && (
                      <div style={{ marginTop: 4, fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>
                        {ko ? '교정은 프롬프트를 고쳐 재생성하세요 — 검증 없는 기하 주입은 하지 않습니다(intent-STEP 정합 유지).' : 'Fix by revising the prompt — no unverified geometry injection.'}
                      </div>
                    )}
                  </div>
                )}

                {/* 그물 ⑥ 간이 FEA — 하중(kg) 명시 입력 후 실행(TET10 스크리닝, SF<2면 자동 정밀 재해석) */}
                <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
                  <input value={feaLoad} onChange={(e) => setFeaLoad(e.target.value)} inputMode="decimal"
                    placeholder={ko ? '상면 하중 kg (필수)' : 'top load kg'}
                    style={{ flex: 1, padding: '7px 9px', borderRadius: 7, fontSize: 11.5, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit' }} />
                  <select value={feaMat} onChange={(e) => setFeaMat(e.target.value)}
                    style={{ padding: '7px 8px', borderRadius: 7, fontSize: 11.5, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit' }}>
                    {[['steel', ko ? '강(SS275)' : 'Steel'], ['STS304', 'STS304'], ['aluminum', 'AL6061'], ['concrete', ko ? '콘크리트' : 'Concrete'], ['timber', ko ? '목재' : 'Timber']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <button type="button" onClick={() => void runFeaQuick()} disabled={feaBusy || !Number(feaLoad)}
                    style={{ padding: '0 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--nx-accent, #2563eb)', background: 'transparent', color: 'var(--nx-accent, #2563eb)', opacity: feaBusy || !Number(feaLoad) ? 0.5 : 1 }}>
                    {feaBusy ? '…' : ko ? '🧮 FEA' : '🧮 FEA'}
                  </button>
                </div>
                {feaRes && !feaRes.ok && <div style={{ marginTop: 4, fontSize: 11, color: '#991b1b' }}>{feaRes.error}</div>}
                {feaRes?.ok && (
                  <div style={{ marginTop: 6, padding: 9, borderRadius: 8, border: `1px solid ${(feaRes.safetyFactor ?? 0) >= 1 ? 'rgba(22,163,74,0.4)' : 'rgba(220,38,38,0.4)'}`, background: 'var(--nx-panel, #fff)', fontSize: 11, lineHeight: 1.7 }}>
                    <b style={{ color: (feaRes.safetyFactor ?? 0) >= 1 ? '#16a34a' : '#dc2626' }}>
                      {(feaRes.safetyFactor ?? 0) >= 1 ? '✓' : '✗'} SF {feaRes.safetyFactor ?? '—'}
                    </b>
                    {' · '}max {feaRes.maxStressMPa} MPa / {ko ? '기준' : 'yield'} {feaRes.yieldMPa} MPa · {feaRes.material}
                    {feaRes.maxDispMm != null && <> · {ko ? '최대 변위' : 'max disp'} {feaRes.maxDispMm} mm</>}
                    {feaRes.refined ? <span style={{ color: 'var(--nx-accent, #2563eb)' }}> · {ko ? '정밀 재해석 수행됨' : 'refined'}</span> : null}
                    <div style={{ marginTop: 3, fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>{feaRes.note}</div>
                    {feaRes.reportHtml && (
                      <button type="button"
                        onClick={() => { const w = window.open('', '_blank'); if (w && feaRes.reportHtml) { w.document.write(feaRes.reportHtml); w.document.close(); } }}
                        style={{ marginTop: 5, padding: '4px 11px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--nx-border, #dfe3e8)', background: 'transparent', color: 'inherit' }}>
                        📄 {ko ? '리포트 열기(A4)' : 'Open report'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* P0-b(260719b) 정밀 검증 — 어셈블리 경로: A1 라운드트립+B1 메시 부울 온디맨드 */}
            {lastAssembly && (
              <div style={{ marginBottom: 12 }}>
                <button type="button" onClick={() => void runPrecision()} disabled={precBusy}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: precBusy ? 'wait' : 'pointer',
                    border: '1px solid var(--nx-accent, #2563eb)', background: 'transparent', color: 'var(--nx-accent, #2563eb)' }}>
                  {precBusy ? (ko ? 'STEP 재임포트 실측·메시 부울 대조 중…' : 'Round-trip & mesh boolean check…') : ko ? '🔬 정밀 검증 — A1 라운드트립 + B1 메시 부울' : '🔬 Precision verify — A1 round-trip + B1 mesh boolean'}
                </button>
                {precRes && !precRes.ok && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#991b1b' }}>{precRes.error ?? (precRes.gateErrors ?? []).join('; ')}</div>
                )}
                {precRes?.ok && (
                  <div style={{ marginTop: 6, padding: 9, borderRadius: 8, border: `1px solid ${precRes.roundtrip?.verdict === 'PASS' ? 'rgba(22,163,74,0.4)' : 'rgba(220,38,38,0.4)'}`, background: 'var(--nx-panel, #fff)', fontSize: 11, lineHeight: 1.7 }}>
                    <div style={{ fontWeight: 800, color: precRes.roundtrip?.verdict === 'PASS' ? '#16a34a' : '#dc2626' }}>
                      {precRes.roundtrip?.verdict === 'PASS' ? '✓' : '✗'} A1 {ko ? '라운드트립' : 'round-trip'} {precRes.roundtrip?.verdict ?? (precRes.roundtrip?.error ? (ko ? '실행 실패' : 'failed') : '—')}
                      {precRes.roundtrip?.volume && <span style={{ fontWeight: 400 }}> · {ko ? '부피 오차' : 'vol err'} {precRes.roundtrip.volume.errMm3}mm³ (≤{precRes.roundtrip.volume.bandMm3})</span>}
                    </div>
                    {precRes.interferenceRefine && !precRes.interferenceRefine.error && (
                      <div style={{ marginTop: 3 }}>
                        B1 {ko ? '메시 부울' : 'mesh boolean'}: {ko ? '확정' : 'confirmed'} <b style={{ color: precRes.interferenceRefine.interferences.length ? '#dc2626' : '#16a34a' }}>{precRes.interferenceRefine.interferences.length}</b>
                        {' · '}{ko ? '과탐 해제' : 'demoted'} {precRes.interferenceRefine.demoted.length}
                        {(precRes.interferenceRefine.laps ?? []).length > 0 && <> · {ko ? '절점 랩' : 'laps'} {(precRes.interferenceRefine.laps ?? []).length}</>}
                        {' '}({precRes.interferenceRefine.checked} {ko ? '쌍 검사' : 'pairs'})
                      </div>
                    )}
                    {!precRes.interferenceRefine && (precRes.interferences ?? []).length === 0 && (
                      <div style={{ marginTop: 3, color: 'var(--nx-text-3, #6b7684)' }}>{ko ? 'AABB 간섭 0 — B1 생략(검사 대상 없음)' : 'No AABB clashes — B1 skipped'}</div>
                    )}
                    <div style={{ marginTop: 3, fontSize: 9, color: 'var(--nx-text-3, #6b7684)' }}>
                      {ko ? 'A1=STEP 재임포트 실측↔폐형 예측(밴드 명시) · B1=의심쌍 한정(전수 아님)' : 'A1=STEP re-import vs closed-form · B1=suspect pairs only'}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!verify && !bbox ? (
              <div style={{ fontSize: 12, color: 'var(--nx-text-3, #6b7684)' }}>
                {ko ? '설계를 생성하면 manifold·치수 검증이 자동으로 표시됩니다.' : 'Generate a design to see manifold & dimension checks.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <VerifyRow
                  label={ko ? 'Manifold (닫힌 솔리드)' : 'Manifold (watertight)'}
                  ok={!!manifoldOk}
                  bad={!!verifyFailed}
                  value={
                    verify?.error
                      ? verify.error
                      : manifoldOk
                        ? (ko ? '결함 0' : '0 defects')
                        : verify?.nonManifoldEdges != null
                          ? (ko ? `비-manifold 엣지 ${verify.nonManifoldEdges}` : `${verify.nonManifoldEdges} non-manifold edges`)
                          : '—'
                  }
                />
                {verify?.triangles != null && (
                  <VerifyRow label={ko ? '메시 삼각형' : 'Mesh triangles'} value={verify.triangles.toLocaleString()} neutral />
                )}
                {bbox && (
                  <VerifyRow
                    label={ko ? '치수 (BBox, mm)' : 'Dimensions (BBox, mm)'}
                    value={`${bbox.x} × ${bbox.y} × ${bbox.z}`}
                    neutral
                  />
                )}
                {featureCount != null && (
                  <VerifyRow label={ko ? '피처 수' : 'Features'} value={String(featureCount)} neutral />
                )}
              </div>
            )}
          </div>

          {/* 제조성(DFM) 상시 — 기계·판금(파라메트릭) 분야 */}
          <div style={{ display: tab === 'verify' ? undefined : 'none' }}>{intent && domain?.parametric && <DfmPanel intent={intent} lang={lang} />}</div>

          {/* 제조(판재 레이저 명세·예상비용·DXF)(⑤) — 기계·판금 분야 */}
          <div style={{ display: tab === 'output' ? undefined : 'none' }}>{intent && domain?.parametric && <FabPanel intent={intent} name={intent.name} lang={lang} />}</div>

          {/* 분야 검증(②) — 형상 + 분야 계산기(상시 게이트 위에 얹는 분야층) */}
          <div style={{ display: tab === 'verify' ? undefined : 'none' }}>{intent && <DomainVerifyPanel intent={intent} lang={lang} defaultDomain={domain?.verifyDomain ?? undefined} />}</div>

          {/* 코드체크·감리(결정론) — 실제 법령 조항 인용. 학습모델 감리와 차별화 */}
          <div style={{ display: tab === 'verify' ? undefined : 'none' }}><CodeCheckPanel lang={lang} /></div>

          {/* 계산기 스튜디오 — 전 38종 스키마 자동 폼 + 계산서 출력(형상 없이도 사용 가능) */}
          <div style={{ display: tab === 'calc' ? undefined : 'none', padding: tab === 'calc' ? '16px 12px' : 0 }}><CalcStudioPanel lang={lang} /></div>

          {/* Export + manufacture */}
          {intent && (
            <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--nx-border, #dfe3e8)', paddingTop: 14, display: tab === 'output' ? undefined : 'none' }}>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{ko ? '내보내기 · 제조' : 'Export · Manufacture'}</div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-3, #6b7684)', marginBottom: 6, lineHeight: 1.5 }}>
                {ko ? '뷰어 = 드래프트 프리뷰 · STEP = 기록 커널(OCCT B-rep) 정밀 형상 — 기하 핸드오프 없이 같은 intent에서 재방출' : 'Viewer = draft preview · STEP = record kernel (OCCT B-rep), re-emitted from the same intent'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {lastAssembly && (
                  <button type="button" onClick={() => void downloadPackage()} disabled={pkgBusy} style={exportBtn}>
                    {pkgBusy ? '…' : ko ? '📦 설계 패키지' : '📦 Design package'}
                  </button>
                )}
                <button type="button" onClick={exportStep} disabled={exporting !== ''} style={exportBtn}>
                  {exporting === 'step' ? '…' : ko ? 'STEP (B-rep)' : 'STEP (B-rep)'}
                </button>
                <button type="button" onClick={exportHtml} disabled={exporting !== ''} style={exportBtn}>
                  {exporting === 'html' ? '…' : ko ? 'HTML 뷰어' : 'HTML viewer'}
                </button>
                <button
                  type="button"
                  onClick={() => scad && download(`${intent.name ?? 'design'}.scad`, scad, 'text/plain')}
                  style={exportBtn}
                >
                  OpenSCAD
                </button>
              </div>
              <Link
                href={`/${lang}/nexyfab/rfq`}
                style={{
                  display: 'block', marginTop: 10, padding: '10px 14px', borderRadius: 8, textAlign: 'center',
                  background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none',
                }}
              >
                {ko ? '제조 견적 요청 →' : 'Request a manufacturing quote →'}
              </Link>
              {exportMsg && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--nx-text-2, #46505e)' }}>{exportMsg}</div>}
            </div>
          )}
        </div>

        {/* Right: 3D viewer */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <StudioChatDock lang={lang} domainSlug={domain?.slug ?? initialDomain} intentName={intent?.name ?? null} partCount={Array.isArray(intent?.features) ? intent.features.length : null} pickedPart={pickedPart} onPartEdit={editPartRun} />
          <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
          {/* §6.2 드래프트/기록 분리 — 뷰어는 드래프트임을 정직 표기 */}
          {scad && (
            <div style={{ position: 'absolute', bottom: 12, left: 12, padding: '4px 10px', borderRadius: 999, background: 'rgba(0,0,0,0.55)', color: '#cbd5e1', fontSize: 10.5, pointerEvents: 'none' }}>
              {ko ? '드래프트 프리뷰(브라우저 렌더) · 정밀 형상 = 출력 탭 STEP(OCCT)' : 'Draft preview · precise geometry = STEP (OCCT) in Output'}
            </div>
          )}
          {!scad && !loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--nx-text-3, #6b7684)', fontSize: 13, pointerEvents: 'none' }}>
              {ko ? '① 생성 탭에서 자유 서술이나 템플릿으로 시작하세요 · ② 검증이 자동으로 따라옵니다 · ③ 계산기·출력(도면·STEP·계산서)은 상단 탭 (드래그=회전 · 휠=줌)' : 'Describe freely or pick a template in Create · verification follows automatically · calculators & outputs in tabs (drag = rotate, wheel = zoom)'}
            </div>
          )}
          {/**
            * ★단계 바(260803) — **생성이 끝나도 계속 보인다.**
            * 진행 중에만 뜨는 표시는 「지금 어디까지 왔는지」를 못 알려 준다. 결과를 보는
            * 내내 「이건 아직 초안이다 / 확정본이다」가 화면에 남아 있어야, 사용자가
            * 「묻고선 알아서 진행했다」고 느끼지 않는다.
            */}
          {scad && (
            <div style={{ position: 'absolute', top: 12, right: 12, maxWidth: 340, padding: '8px 12px', borderRadius: 10, background: 'rgba(3,7,18,0.82)', border: '1px solid rgba(148,163,184,0.25)', backdropFilter: 'blur(6px)' }}>
              <DesignStageBar stage={designStage} lang={lang} />
              {confirmedSnap && (
                <div style={{ marginTop: 6, fontSize: 10.5, color: '#7dd3fc', lineHeight: 1.5 }}>
                  {ko ? '확정본 기준으로 출력합니다' : 'Outputs use the confirmed version'}
                  {' · '}
                  {new Date(confirmedSnap.at).toLocaleTimeString()}
                </div>
              )}
            </div>
          )}
          {loading && (
            <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 12 }}>
              <span>{status || (ko ? '처리 중…' : 'Working…')}</span>
              <span style={{ color: '#93c5fd', fontVariantNumeric: 'tabular-nums' }}>{elapsed}s</span>
              {runAbortRef.current && (
                <button type="button" onClick={() => runAbortRef.current?.abort()}
                  style={{ padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(239,68,68,0.6)', background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>
                  {ko ? '취소' : 'Cancel'}
                </button>
              )}
            </div>
          )}
          {/* 실사 컨셉 렌더링(Gemini) — 현재 뷰 캔버스 PNG를 기하 기준으로 image-to-image */}
          {scad && (
            <button
              type="button"
              disabled={vizBusy}
              onClick={runVisualize}
              style={{
                position: 'absolute', top: 12, right: 12, padding: '8px 14px', borderRadius: 8, border: 'none',
                background: vizBusy ? 'rgba(0,0,0,0.5)' : 'linear-gradient(135deg,#7c3aed,#2563eb)', color: '#fff',
                fontSize: 12.5, fontWeight: 700, cursor: vizBusy ? 'wait' : 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,.25)',
              }}
            >
              {vizBusy ? (ko ? '🎨 렌더링 중…' : '🎨 Rendering…') : ko ? '🎨 실사 컨셉 (AI)' : '🎨 Photoreal concept (AI)'}
            </button>
          )}
          {vizErr && (
            <div style={{ position: 'absolute', top: 56, right: 12, maxWidth: 320, padding: '8px 12px', borderRadius: 8, background: 'rgba(153,27,27,.92)', color: '#fff', fontSize: 11.5 }}>
              {vizErr}
            </div>
          )}
          {vizImg && (
            <div style={{ position: 'absolute', inset: 12, borderRadius: 10, background: 'rgba(15,23,42,.96)', display: 'flex', flexDirection: 'column', padding: 12, zIndex: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <b style={{ color: '#fff', fontSize: 13 }}>{ko ? '🎨 실사 컨셉' : '🎨 Photoreal concept'}</b>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a href={`data:image/png;base64,${vizImg}`} download="concept_render.png" style={{ padding: '5px 12px', borderRadius: 6, background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
                    {ko ? '다운로드' : 'Download'}
                  </a>
                  <button type="button" onClick={() => setVizImg(null)} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#334155', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
                    {ko ? '닫기' : 'Close'}
                  </button>
                </div>
              </div>
              { }
              <img src={`data:image/png;base64,${vizImg}`} alt="AI concept render" style={{ flex: 1, minHeight: 0, objectFit: 'contain', borderRadius: 8 }} />
              <div style={{ marginTop: 8, fontSize: 11, color: '#fbbf24' }}>
                ⚠ {ko ? '컨셉 이미지(비검증) — 기하는 3D 렌더 기준, 재질·조명·환경은 AI 제안. 치수·형상 근거로 사용 금지.' : 'Concept image (unverified) — geometry from the 3D render; materials/lighting are AI suggestions. Not for dimensional reference.'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const exportBtn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'var(--nx-text, #1a2230)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
};

function VerifyRow({ label, value, ok, bad, neutral }: { label: string; value: string; ok?: boolean; bad?: boolean; neutral?: boolean }) {
  const dot = neutral ? '#9aa4b0' : ok ? '#12b76a' : bad ? '#f04438' : '#9aa4b0';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--nx-text-2, #46505e)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flex: '0 0 8px' }} />
        {label}
      </span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
