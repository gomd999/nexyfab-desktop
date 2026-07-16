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
import DomainVerifyPanel from './DomainVerifyPanel';
import CalcStudioPanel from './CalcStudioPanel';
import StudioChatDock from './StudioChatDock';
import ParametricPresetPanel from './ParametricPresetPanel';
import AssemblyPresetPanel from './AssemblyPresetPanel';
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

const EXAMPLES_KO = [
  '내경 500mm 원통형 물탱크, 높이 800mm, 벽두께 5mm, 바닥에 원뿔형 배출구(45도), 중앙에 지름 25mm 교반축',
  '가로 300 세로 200 두께 12 알루미늄 플레이트, 네 모서리에 지름 8 볼트홀, 중앙에 지름 40 관통',
  'L자 브래킷, 다리 각 80mm, 두께 6, 각 면에 지름 6 홀 2개',
];
const EXAMPLES_EN = [
  'Cylindrical water tank, 500mm inner dia, 800mm tall, 5mm wall, conical drain (45deg) at bottom, 25mm central agitator shaft',
  'Aluminium plate 300 x 200 x 12, 8mm bolt holes at four corners, 40mm through-hole in the middle',
  'L-bracket, 80mm legs, 6mm thick, two 6mm holes per face',
];

export default function DesignInner({ lang, initialDomain, initialTab }: { lang: string; initialDomain?: string | null; initialTab?: string | null }) {
  const ko = isKorean(lang);
  const domain = findDomain(initialDomain);
  const [prompt, setPrompt] = useState('');
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
  // 그물 ④ — 어셈블리 빌드 결과의 간섭 건수(null=어셈블리 아님)
  const [interf, setInterf] = useState<number | null>(null);
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

    // manual orbit
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const o = orbit.current;
      o.theta -= (e.clientX - lx) * 0.01;
      o.phi -= (e.clientY - ly) * 0.01;
      lx = e.clientX;
      ly = e.clientY;
    };
    const onUp = () => { dragging = false; };
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
      setDiffRes(null); // 설계가 바뀌면 이전 듀얼-방출 대조 결과는 무효
      setDiffDraftProfiles(null);
      setVisRes(null); // vision 비평도 무효
      setIntent(intentObj);
      setScad(scadStr);
      setVerify(verifyObj);
      setFeatureCount(Array.isArray(intentObj.features) ? intentObj.features.length : null);
      if (wasmAvailable()) {
        setStatus(ko ? '3D 렌더 중…' : 'Rendering 3D…');
        const r = await renderScadWasm(scadStr);
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

  const run = useCallback(
    async (text: string) => {
      const desc = text.trim();
      if (desc.length < 4) return;
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
        const res = await fetch(isAssembly ? '/api/nexyfab/drawing/assemble/' : '/api/nexyfab/drawing/compose/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: desc }),
          signal: ac.signal,
        });
        const raw = (await res.json()) as ComposeResp & { openscad?: string; composeIntent?: ComposeOk['intent']; interferences?: unknown[] };
        // assemble 응답(openscad/composeIntent)을 compose 형식으로 정규화
        const data: ComposeResp = raw.ok && isAssembly
          ? { ok: true, intent: (raw.composeIntent ?? { name: 'assembly' }) as ComposeOk['intent'], scad: String(raw.openscad ?? ''), rounds: (raw as { rounds?: number }).rounds ?? 1, verify: null }
          : raw;
        if (isAssembly && raw.ok) setInterf(Array.isArray(raw.interferences) ? raw.interferences.length : 0); // 그물 ④
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
    [ko, applyDesign],
  );

  // 체크포인트 승인/취소 — 승인해야 뷰어 적용, 취소하면 프롬프트 수정 재생성 유도
  const approveCheckpoint = useCallback(async () => {
    if (!checkpoint) return;
    const cp = checkpoint;
    setCheckpoint(null);
    setCpState('approved');
    await applyDesign(cp.intent, cp.scad, cp.verify);
  }, [checkpoint, applyDesign]);
  const cancelCheckpoint = useCallback(() => { setCheckpoint(null); setCpState('none'); }, []);

  // §8-③ 역투영 diff v1 — 듀얼-방출 교차검증: 드래프트(뷰어 메시) 실측 vs 기록(OCCT) 실측
  interface DiffCheck { name: string; draft: number; record: number; diff: number; tol: number; pass: boolean }
  interface DimRow { label: string; declared: number; measured: number | null; pos: string; pass: boolean }
  interface DimAudit { rows: DimRow[]; extraFaces: number; note: string }
  type DiffRes = { ok: true; verdict: string; checks: DiffCheck[]; dims?: DimAudit | null; record?: { profiles?: AxisProfile[] }; notes?: string[] } | { ok: false; stage?: string; error?: string };
  const [diffRes, setDiffRes] = useState<DiffRes | null>(null);
  const [diffDraftProfiles, setDiffDraftProfiles] = useState<AxisProfile[] | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const runReprojectDiff = useCallback(async () => {
    const geom = meshRef.current?.geometry;
    if (!intent || !geom) return;
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
        body: JSON.stringify({ intent, draft }),
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
            {/* 채팅-우선(2026-07-16 사용자 결정): 자유 서술이 1순위, 템플릿 갤러리는 아래 */}
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-text-3, #6b7684)' }}>
              {ko ? '무엇을 설계할까요?' : 'What do you want to design?'}
            </label>
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
              {loading ? (status || (ko ? '처리 중…' : 'Working…')) : ko ? '설계 생성 + 검증' : 'Generate + verify'}
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
                : (ko ? EXAMPLES_KO : EXAMPLES_EN).map((ex, i) => (
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
                  ))}
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
                  onBuildInfo={(info) => setInterf(info.interferences)}
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
          <StudioChatDock lang={lang} domainSlug={domain?.slug ?? initialDomain} intentName={intent?.name ?? null} partCount={Array.isArray(intent?.features) ? intent.features.length : null} />
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
