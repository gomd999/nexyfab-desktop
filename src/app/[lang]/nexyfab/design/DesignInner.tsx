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
      const h = JSON.parse(raw) as { spec?: string; at?: number };
      if (h.spec && Date.now() - (h.at ?? 0) < 10 * 60 * 1000) setPrompt(String(h.spec).slice(0, 2000));
    } catch { /* ignore */ }
     
  }, []);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [gateErrors, setGateErrors] = useState<string[] | null>(null);

  const [intent, setIntent] = useState<ComposeOk['intent'] | null>(null);
  const [scad, setScad] = useState<string | null>(null);
  const [verify, setVerify] = useState<Verify>(null);
  // §2.1 입구 B 도면 체크포인트 — 자유 서술(AI 해석)만 승인 게이트, 프리셋·판독은 스킵(§2.2)
  const [checkpoint, setCheckpoint] = useState<CheckpointData | null>(null);
  const [cpState, setCpState] = useState<'none' | 'pending' | 'approved' | 'skipped'>('none');
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
      // 체크포인트 승인 경로가 아니면(프리셋·판독·어셈블리) '생략'으로 정직 표기(§2.2)
      setCpState((s) => (s === 'approved' ? s : 'skipped'));
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
      setStatus(ko ? 'AI가 설계를 조합하고 검증하는 중…' : 'Composing & verifying the design…');
      try {
        const res = await fetch('/api/nexyfab/drawing/compose/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: desc }),
        });
        const data = (await res.json()) as ComposeResp;
        if (!data.ok) {
          if (data.gateErrors?.length) setGateErrors(data.gateErrors);
          else setError(data.error ?? (ko ? '설계 생성 실패' : 'Design failed'));
          setStatus('');
          return;
        }
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
        setError(e instanceof Error ? e.message : String(e));
        setStatus('');
      } finally {
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
            {/* 결정론 파라메트릭 프리셋(완벽화 Pillar ①) — 해당 분야에서 AI보다 우선 노출 */}
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
            {/* 도메인 어셈블리 템플릿(#6) — RC 골조·파고라·데크·카페. 템플릿 없는 분야는 자동 미노출 */}
            {domain && (
              <AssemblyPresetPanel
                lang={lang}
                domain={domain.slug}
                onApply={async (i, s) => {
                  setError(null); setGateErrors(null); setExportMsg(null);
                  await applyDesign(i, s, null);
                }}
              />
            )}
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-text-3, #6b7684)' }}>
              {domain?.parametric
                ? ko ? '또는 자유 서술로 설계' : 'Or describe freely'
                : ko ? '무엇을 설계할까요?' : 'What do you want to design?'}
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
                {domain ? (ko ? '분야 프리셋' : 'Domain presets') : ko ? '예시' : 'Examples'}
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
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#fdecec', color: '#b42318', fontSize: 12.5 }}>{error}</div>
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
                label: ko ? '③ 역투영 치수 diff(방출 오류)' : '③ Re-projection dim diff',
                status: 'todo',
                note: ko ? '기록 커널 대조 채점기 — 후속(방법론 §8-③)' : 'scorer pending (§8-③)',
              },
              {
                label: ko ? '④ 어셈블리 간섭' : '④ Assembly interference',
                status: 'skip',
                note: ko ? '어셈블리 생성 시 결과 카드에 표시' : 'shown on assembly build card',
              },
              {
                label: ko ? '⑤ vision 비평(토폴로지)' : '⑤ Vision critique',
                status: 'todo',
                note: ko ? '후속 — scad-vision-critique 배선' : 'wiring pending',
              },
            ] as NetItem[])} />
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
              {ko ? '① 생성 탭에서 템플릿을 고르거나 자유 서술로 시작하세요 · ② 검증이 자동으로 따라옵니다 · ③ 계산기 61종·출력(도면·STEP·계산서)은 상단 탭 (드래그=회전 · 휠=줌)' : 'Pick a template or describe freely in Create · verification follows automatically · 61 calculators & outputs in tabs (drag = rotate, wheel = zoom)'}
            </div>
          )}
          {loading && (
            <div style={{ position: 'absolute', top: 12, left: 12, padding: '6px 12px', borderRadius: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12 }}>
              {status || (ko ? '처리 중…' : 'Working…')}
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
