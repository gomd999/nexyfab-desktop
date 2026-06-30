'use client';

/**
 * Studio — a ChatGPT/Gemini-style free-form CAD surface.
 *
 * Left rail (StudioSidebar): new design, search, recent-designs history,
 * projects/library links, account. Centre: a clean greeting + rounded input
 * (empty state) that becomes a chat + live 3D viewer + Customizer slider panel
 * once you generate. Keep chatting to refine; tune dimensions with sliders (no
 * AI re-call); export STL or hand off to the expert modeler. Designs persist
 * locally so you can return to and keep iterating on past models.
 */
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import { parseSTL } from '../shape-generator/io/importers';
import { parseCustomizerParams, applyCustomizerValue } from '@/lib/openscad-render/customizerParams';
import { useAuthStore } from '@/hooks/useAuth';
import { useSessionKeepalive } from '@/hooks/useSessionKeepalive';
import StudioSidebar from './StudioSidebar';
import { listDesigns, saveDesign, getDesign, deleteDesign, titleFromMessages, setDesignScope, type StudioDesign, type StudioChatMsg } from './studioDesigns';
import { parseScadColors, isolateColorScad, defaultColorCss } from './scadColors';
import { emitScadFromProgram, type FeatureProgram } from './emitScadFromProgram';
import { CODEGEN_MODELS, DEFAULT_CODEGEN_MODEL } from '@/lib/ai/codegenModels';
import { renderScadWasm, wasmAvailable } from './wasmRender';
import { captureMultiView } from './multiViewCapture';

/** base64-encode STL bytes (for the download button + persistence) in chunks. */
function uint8ToB64(u8: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode(...u8.subarray(i, i + CH));
  return btoa(s);
}

const StudioViewer = dynamic(() => import('./StudioViewer'), { ssr: false });

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
/** Serialize a flat positions[] + triangles[] index to a binary STL buffer
 *  (so a server-converted STEP mesh can feed the same import("model.stl") AI
 *  path as a directly-attached STL). Per-face normals computed from vertices. */
function trianglesToBinaryStl(positions: ArrayLike<number>, triangles: ArrayLike<number>): ArrayBuffer {
  const triCount = Math.floor(triangles.length / 3);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let off = 84;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    dv.setFloat32(off, nx, true); dv.setFloat32(off + 4, ny, true); dv.setFloat32(off + 8, nz, true); off += 12;
    dv.setFloat32(off, ax, true); dv.setFloat32(off + 4, ay, true); dv.setFloat32(off + 8, az, true); off += 12;
    dv.setFloat32(off, bx, true); dv.setFloat32(off + 4, by, true); dv.setFloat32(off + 8, bz, true); off += 12;
    dv.setFloat32(off, cx, true); dv.setFloat32(off + 4, cy, true); dv.setFloat32(off + 8, cz, true); off += 12;
    dv.setUint16(off, 0, true); off += 2;
  }
  return buf;
}

function freshId(): string {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch { /* ignore */ }
  return 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface ChatMsg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  image?: string | null;
  thumb?: string | null;
  status?: 'thinking' | 'done' | 'error';
}
const toPersist = (m: ChatMsg[]): StudioChatMsg[] => m.map(({ role, text, image, thumb, status }) => ({ role, text, image, thumb, status }));

/** Pull the first ERROR line out of an OpenSCAD CLI dump for a short message. */
function shortScadError(raw: string): string {
  const m = raw.match(/ERROR:[^\n]*/);
  const line = (m?.[0] ?? raw.split('\n').find(l => /error|fail/i.test(l)) ?? '').replace(/^ERROR:\s*/, '').trim();
  return line.slice(0, 160);
}

interface RenderResult { ok: boolean; error?: string; raw?: string; auth?: boolean }

/** Compact model picker (CADAM-style) — choose which AI generates the model. */
function ModelPicker({ modelId, onPick, isKo, compact }: { modelId: string; onPick: (id: string) => void; isKo: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const cur = CODEGEN_MODELS.find(m => m.id === modelId) ?? CODEGEN_MODELS[0];
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className={`flex items-center gap-1 st-panel-2 border st-bd rounded-full ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-[7px] text-[12px]'} st-text-2 hover:st-text font-medium`} title={isKo ? 'AI 모델 선택' : 'Choose AI model'}>
        <span>🧠 {cur.label}</span><span className="opacity-60">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 mt-1 right-0 w-60 st-panel border st-bd rounded-xl shadow-2xl overflow-hidden py-1">
            {CODEGEN_MODELS.map(m => (
              <button key={m.id} onClick={() => { onPick(m.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 hover:st-hover ${m.id === modelId ? 'bg-blue-600/15' : ''}`}>
                <div className="text-[13px] font-semibold st-text flex items-center gap-1.5">{m.label}{m.id === modelId && <span className="text-blue-400 text-[11px]">✓</span>}</div>
                {m.note && <div className="text-[11px] st-text-3">{m.note}</div>}
              </button>
            ))}
            <div className="px-3 pt-1.5 pb-1 text-[10px] st-text-3 border-t st-bd mt-1">{isKo ? '미설정 모델은 자동으로 대체됩니다.' : 'Unconfigured models fall back automatically.'}</div>
          </div>
        </>
      )}
    </div>
  );
}

/** Extract the largest explicit dimension (mm) a user asked for, for scale
 *  auto-correction. Reads "A×B×C", "N mm", and "⌀N / diameter N" patterns. */
function parseTargetLargestMm(prompt: string): number | null {
  const nums: number[] = [];
  const axb = prompt.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (axb) nums.push(+axb[1]!, +axb[2]!, +axb[3]!);
  for (const m of prompt.matchAll(/(\d+(?:\.\d+)?)\s*mm\b/gi)) nums.push(+m[1]!);
  for (const m of prompt.matchAll(/(?:⌀|dia(?:meter)?\.?\s*)(\d+(?:\.\d+)?)/gi)) nums.push(+m[1]!);
  const valid = nums.filter(n => n >= 3 && n <= 2000);
  return valid.length ? Math.max(...valid) : null;
}

export default function StudioInner({ onExpert, initialPrecise = false }: { onExpert?: () => void; initialPrecise?: boolean } = {}) {
  const params = useParams();
  const router = useRouter();
  const lang = (Array.isArray(params?.lang) ? params.lang[0] : params?.lang) ?? 'en';
  const isKo = lang === 'ko' || lang === 'kr';
  const T = (ko: string, en: string) => (isKo ? ko : en);
  const userName = useAuthStore(s => s.user?.name ?? s.user?.email ?? null);
  const userId = useAuthStore(s => s.user?.id ?? null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  useSessionKeepalive(); // keep the 15-min access token fresh during long sessions
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | '3d' | 'params'>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => { try { const s = localStorage.getItem('nexyfab-theme'); if (s === 'light' || s === 'dark') setTheme(s); } catch { /* ignore */ } }, []);
  useEffect(() => { try { document.documentElement.dataset.theme = theme; } catch { /* ignore */ } }, [theme]);
  const toggleTheme = useCallback(() => setTheme(p => { const n = p === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('nexyfab-theme', n); } catch { /* ignore */ } return n; }), []);

  const [scad, setScad] = useState('');
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [coloredObject, setColoredObject] = useState<THREE.Object3D | null>(null); // per-color group (CADAM-style)
  const [modelSize, setModelSize] = useState<{ x: number; y: number; z: number } | null>(null);
  // Dimension verification: the ACTUAL rendered bounding box (mm), so the user
  // can confirm it matches the requested size.
  useEffect(() => {
    const box = new THREE.Box3();
    if (geometry) {
      geometry.computeBoundingBox();
      if (geometry.boundingBox) box.copy(geometry.boundingBox); else { setModelSize(null); return; }
    } else if (coloredObject) {
      box.setFromObject(coloredObject);
    } else { setModelSize(null); return; }
    const s = new THREE.Vector3();
    box.getSize(s);
    setModelSize(Number.isFinite(s.x) && s.x > 0 ? { x: s.x, y: s.y, z: s.z } : null);
  }, [geometry, coloredObject]);
  const lastTargetRef = useRef<number | null>(null); // requested largest dim (mm) of the current fresh model
  const autoFixedRef = useRef(false);                // one-shot guard for dimension auto-correct
  const [stlB64, setStlB64] = useState<string | null>(null);
  const [genCount, setGenCount] = useState(0);
  const colorReqRef = useRef(0); // guards against stale colored renders

  const [designs, setDesigns] = useState<StudioDesign[]>([]);
  const [currentId, setCurrentId] = useState<string>('');
  const currentIdRef = useRef<string>('');
  const lastThumbRef = useRef<string | null>(null);
  const importStlRef = useRef<string | null>(null); // base64 of an attached STL the SCAD imports
  const lastGeoRef = useRef<THREE.BufferGeometry | null>(null); // newest rendered mesh (for multi-view capture)
  const [precise, setPrecise] = useState(initialPrecise); // expert: NL → exact B-rep feature program
  const programRef = useRef<FeatureProgram | null>(null); // last precise feature program (for refine)
  const [modelId, setModelId] = useState(DEFAULT_CODEGEN_MODEL); // user-picked codegen model
  useEffect(() => { try { const m = localStorage.getItem('nexyfab:studio-model'); if (m && CODEGEN_MODELS.some(x => x.id === m)) setModelId(m); } catch { /* ignore */ } }, []);
  const pickModel = useCallback((id: string) => { setModelId(id); try { localStorage.setItem('nexyfab:studio-model', id); } catch { /* ignore */ } }, []);

  const idRef = useRef(0);
  const nextId = () => ++idRef.current;
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const customizer = useMemo(() => (scad ? parseCustomizerParams(scad) : []), [scad]);
  const grouped = useMemo(() => {
    const out: { name: string | null; params: typeof customizer }[] = [];
    for (const p of customizer) {
      const key = p.group ?? null;
      const g = out.find(x => x.name === key);
      if (g) g.params.push(p); else out.push({ name: key, params: [p] });
    }
    return out;
  }, [customizer]);
  const isEmpty = messages.length === 0 && !scad;

  const refreshDesigns = useCallback(() => setDesigns(listDesigns()), []);
  // Scope recent designs per account (or guest) so a shared browser never shows
  // one user's designs under another account. Re-runs on login/logout.
  useEffect(() => { setDesignScope(userId); refreshDesigns(); }, [userId, refreshDesigns]);
  useEffect(() => { currentIdRef.current = freshId(); setCurrentId(currentIdRef.current); refreshDesigns(); }, [refreshDesigns]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const setAiMsg = useCallback((id: number, text: string, status: ChatMsg['status']) => {
    setMessages(m => m.map(x => (x.id === id ? { ...x, text, status } : x)));
  }, []);

  const renderScad = useCallback(async (src: string): Promise<RenderResult> => {
    // Client-side WASM render first — no server load, no auth gate, no byte cap.
    // Attached-STL models still use the server (it injects the user's model.stl).
    // text() needs a font the client WASM build lacks → render on the server.
    if (!importStlRef.current && wasmAvailable() && !/\btext\s*\(/i.test(src)) {
      const w = await renderScadWasm(src);
      if (w.ok && w.data) {
        const geo = parseSTL(w.data.slice().buffer);
        geo.computeBoundingBox();
        const c = new THREE.Vector3();
        geo.boundingBox?.getCenter(c);
        geo.translate(-c.x, -c.y, -c.z);
        lastGeoRef.current = geo;
        setGeometry(geo);
        setNeedLogin(false);
        setStlB64(uint8ToB64(w.data));
        return { ok: true };
      }
      // WASM failed → fall through to the server (also yields a real error
      // string the caller can feed to the self-repair loop).
    }
    let res: Response;
    try {
      res = await fetch('/api/nexyfab/openscad-render/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ scad: src, format: 'stl', ...(importStlRef.current ? { importStl: importStlRef.current } : {}) }),
      });
    } catch { return { ok: false, error: T('네트워크 오류', 'network error') }; }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { setNeedLogin(true); return { ok: false, auth: true }; }
    if (!res.ok) { const raw = String((data as { error?: string }).error ?? `render ${res.status}`); return { ok: false, error: shortScadError(raw), raw }; }
    setNeedLogin(false);
    const b64 = (data as { dataBase64?: string }).dataBase64;
    if (!b64) return { ok: false, error: T('렌더 결과가 비었습니다', 'empty render result') };
    const geo = parseSTL(b64ToArrayBuffer(b64));
    geo.computeBoundingBox();
    const c = new THREE.Vector3();
    geo.boundingBox?.getCenter(c);
    geo.translate(-c.x, -c.y, -c.z);
    lastGeoRef.current = geo;
    setGeometry(geo);
    setStlB64(b64);
    return { ok: true };
  }, [isKo]);

  // CADAM-style colour: render each color() group separately (STL is monochrome)
  // and assemble a coloured THREE.Group. Progressive — runs after the fast
  // monochrome render. Skipped for attached STLs (no color()).
  const renderColored = useCallback(async (src: string) => {
    if (importStlRef.current) { setColoredObject(null); return; }
    const colors = parseScadColors(src);
    if (colors.length === 0) { setColoredObject(null); return; } // nothing to colour
    const myReq = ++colorReqRef.current;
    // Render every colour group (a detailed car has ~8: body, cabin, windows,
    // wheels, hubcaps, lights, spoiler) so no part is silently dropped. Client
    // WASM has no shared-service to flood, so all colours render through the
    // worker pool; only fall back to the server when WASM is unavailable.
    const tokens: (string | null)[] = colors.map(c => c.token).slice(0, 24);
    tokens.push(null); // uncoloured remainder → default colour
    const useWasm = !importStlRef.current && wasmAvailable() && !/\btext\s*\(/i.test(src);
    const renderOne = async (tok: string | null) => {
      const iso = isolateColorScad(src, tok);
      try {
        if (useWasm) {
          const w = await renderScadWasm(iso);
          if (w.ok && w.data) {
            const g = parseSTL(w.data.slice().buffer);
            if (!g.attributes.position || g.attributes.position.count === 0) return null;
            return { tok, geo: g };
          }
          if (wasmAvailable()) return null; // genuine empty/error for this colour
        }
        const res = await fetch('/api/nexyfab/openscad-render/', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ scad: iso, format: 'stl' }),
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        const b64 = (data as { dataBase64?: string }).dataBase64;
        if (!b64) return null;
        const g = parseSTL(b64ToArrayBuffer(b64));
        if (!g.attributes.position || g.attributes.position.count === 0) return null;
        return { tok, geo: g };
      } catch { return null; }
    };
    // Concurrency-limited pool (max 4 in flight) over all colour tokens.
    const results: ({ tok: string | null; geo: THREE.BufferGeometry } | null)[] = new Array(tokens.length).fill(null);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, tokens.length) }, async () => {
      while (next < tokens.length) {
        const idx = next++;
        results[idx] = await renderOne(tokens[idx]!);
        if (myReq !== colorReqRef.current) return; // abort early if superseded
      }
    }));
    if (myReq !== colorReqRef.current) return; // a newer render superseded us
    const group = new THREE.Group();
    for (const r of results) {
      if (!r) continue;
      const cg = r.tok == null ? { css: defaultColorCss() } : colors.find(c => c.token === r.tok);
      const css = cg?.css ?? defaultColorCss();
      r.geo.computeVertexNormals();
      // Render parts opaque — a fab/CAD viewer should show solid bodies; honouring
      // AI-emitted colour alpha made overlapping parts confusingly see-through.
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(css), metalness: 0.1, roughness: 0.6 });
      group.add(new THREE.Mesh(r.geo, mat));
    }
    if (group.children.length === 0) { setColoredObject(null); return; }
    const box = new THREE.Box3().setFromObject(group);
    const ctr = new THREE.Vector3();
    box.getCenter(ctr);
    group.position.sub(ctr);
    setColoredObject(group);
  }, []);

  const send = useCallback(async (override?: string) => {
    const text = (typeof override === 'string' ? override : input).trim();
    if ((!text && !image) || busy) return;
    const sentImage = image;
    const sentImageName = imageName;
    const refineFromScad = !!scad && !sentImage;
    // Set when Precise fails and we fall through to free-form, so the fallback
    // generates fresh (not "refine" the half-built precise code).
    let preciseFellBack = false;
    // Track the requested largest dimension on a FRESH typed request, so the
    // render can auto-correct the scale once if it comes out the wrong size.
    if (!refineFromScad && typeof override !== 'string') {
      lastTargetRef.current = parseTargetLargestMm(text);
      autoFixedRef.current = false;
    }
    const userMsg: ChatMsg = { id: nextId(), role: 'user', text: text || T('(이미지)', '(image)'), image: sentImage };
    const aiId = nextId();
    setMessages(m => [...m, userMsg, { id: aiId, role: 'assistant', text: sentImage ? T('이미지 분석 중…', 'Reading the image…') : precise ? T('정밀 피처 설계 중…', 'Planning precise features…') : T('설계 중…', 'Designing…'), status: 'thinking' }]);
    setInput(''); setImage(null); setImageName(null); setBusy(true);

    // ── PRECISE (expert) path: NL → exact feature program → solid ───────────
    // On any failure (unsupported features / render error / exception) we DON'T
    // dead-end — we fall through to the free-form path so the user still gets a
    // model. This makes "OpenSCAD-style" requests work even if sent in Precise.
    if (precise && !sentImage) {
      let preciseOk = false;
      try {
        const res = await fetch('/api/nexyfab/cad-feature-program', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ prompt: text, modelId, ...(programRef.current ? { previousProgram: programRef.current } : {}) }),
        });
        const data = await res.json().catch(() => ({})) as { part?: string; features?: unknown[]; error?: string };
        if (res.ok && Array.isArray(data.features) && data.features.length > 0) {
          const program = { part: data.part, features: data.features } as FeatureProgram;
          programRef.current = program;
          const code = emitScadFromProgram(program);
          setAiMsg(aiId, T('렌더링…', 'Rendering…'), 'thinking');
          setScad(code); setColoredObject(null); setMobileTab('3d'); setGenCount(c => c + 1);
          const r = await renderScad(code);
          if (r.ok) {
            preciseOk = true;
            setAiMsg(aiId, T('완성! 정확한 치수로 만들었어요. 우측 슬라이더로 조정하거나, 계속 말해서 수정하세요 (예: 구멍 8mm로, 리브 더 높게).', 'Done! Built to exact dimensions. Tune with the sliders, or keep chatting (e.g. holes to 8mm, taller ribs).'), 'done');
            setTimeout(() => {
              const canvas = document.querySelector('[data-studio-canvas] canvas') as HTMLCanvasElement | null;
              let thumb: string | null = null;
              try { const t = canvas?.toDataURL?.('image/png'); if (t && t.length > 1000) thumb = t; } catch { /* hidden */ }
              if (thumb) lastThumbRef.current = thumb;
              setMessages(prev => {
                const updated = thumb ? prev.map(x => (x.id === aiId ? { ...x, thumb } : x)) : prev;
                saveDesign({ id: currentIdRef.current, title: titleFromMessages(toPersist(updated)), scad: code, messages: toPersist(updated), thumb: thumb ?? lastThumbRef.current, updatedAt: Date.now() });
                refreshDesigns();
                return updated;
              });
            }, 700);
          }
        }
      } catch (e) {
        console.warn('[precise] failed, falling back to free-form:', e);
      }
      if (preciseOk) { setBusy(false); return; }
      // Precise couldn't build it → fall through to free-form below (fresh, not refine).
      preciseFellBack = true;
      programRef.current = null;
      setAiMsg(aiId, T('정밀로 안 되어 자유형으로 전환합니다…', 'Precise didn\'t fit — switching to free-form…'), 'thinking');
    }
    try {
      const body = sentImage
        ? { prompt: text, image: sentImage, freeform: true, modelId }
        : (refineFromScad && !preciseFellBack)
          ? { prompt: text, freeform: true, previousScad: scad, modelId }
          : { prompt: text, freeform: true, modelId };
      // Codegen (DeepSeek Reasoner) occasionally times out / 5xx's / returns no
      // code — retry once. Deterministic gate/vision responses never improve on
      // retry, so break out for those.
      let res: Response | null = null;
      let data: { code?: string; scad?: string; reason?: string; error?: string } = {};
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch('/api/nexyfab/scad-intent-from-nl', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify(body),
          });
          data = await res.json().catch(() => ({}));
        } catch { res = null; data = {}; }
        const c = data.code;
        if (c === 'GUEST_LIMIT' || c === 'VISION_BUSY' || c === 'VISION_FAILED') break;
        if (res?.ok && data.scad) break; // success
        if (attempt === 0) setAiMsg(aiId, T('생성 재시도 중…', 'Retrying…'), 'thinking');
      }
      if ((data as { code?: string }).code === 'GUEST_LIMIT') {
        setNeedLogin(true);
        setAiMsg(aiId, T('무료 설계 1개를 사용했어요. 무료 로그인하면 계속할 수 있습니다.', 'You used your 1 free design. Log in (free) to keep going.'), 'error');
        return;
      }
      if ((data as { code?: string }).code === 'VISION_BUSY') {
        // Keep the photo + prompt so the user can just hit send again.
        if (sentImage) { setImage(sentImage); setImageName(sentImageName); }
        if (text) setInput(text);
        setAiMsg(aiId, T('이미지 분석이 잠시 혼잡해요. 사진은 그대로 두었으니 다시 보내보세요.', 'Image analysis is busy — your photo is kept, just send again.'), 'error');
        return;
      }
      if ((data as { code?: string }).code === 'VISION_FAILED') {
        setAiMsg(aiId, T('이미지를 이해하지 못했어요. 다른 사진으로 시도하거나 글로 설명해 주세요.', 'Could not read the image — try another photo or describe it in words.'), 'error');
        return;
      }
      if (!res?.ok) throw new Error((data as { reason?: string; error?: string }).reason ?? (data as { error?: string }).error ?? `server ${res?.status ?? 'error'}`);
      let code: string = (data as { scad?: string }).scad ?? '';
      if (!code) throw new Error(T('코드 생성 실패', 'no code returned'));
      setAiMsg(aiId, T('렌더링…', 'Rendering…'), 'thinking');
      setScad(code);
      setColoredObject(null); // show monochrome first; colour pass follows
      setMobileTab('3d');
      setGenCount(c => c + 1);
      let r = await renderScad(code);
      // Self-repair: if the generated code fails to render, feed the OpenSCAD
      // error back to the model and retry (repair:true skips the guest gate
      // since it's fixing an already-counted design). The last attempt escalates
      // to "rewrite with PLAIN OpenSCAD, no BOSL2" — far less error-prone — so a
      // stubborn BOSL2 bug still resolves into a renderable model.
      for (let attempt = 1; !r.ok && r.raw && attempt <= 3; attempt++) {
        setAiMsg(aiId, T('코드 오류를 자동 수정 중…', 'Auto-fixing a code error…'), 'thinking');
        // Final attempt = full PLAIN-OpenSCAD rewrite (no BOSL2). Plain primitives
        // almost never error, so this resolves stubborn BOSL2 bugs (rounding-fit
        // asserts, bad gear()/attach signatures, syntax) that targeted fixes repeat.
        const escalate = attempt >= 3;
        const tooLarge = /too large/i.test(r.raw) || /too large/i.test(r.error ?? '');
        const fixPrompt = tooLarge
          ? `The rendered mesh is too large to return. Shrink the triangle count: set $fn=${attempt >= 2 ? 20 : 28}, simplify or drop the most detailed cosmetic features, and avoid minkowski() and very large hull() chains. Return the COMPLETE program keeping the same overall shape and the Customizer parameters/groups.`
          : escalate
            ? `The program keeps failing to render in OpenSCAD:\n${r.raw.slice(0, 600)}\nRewrite the ENTIRE model using ONLY PLAIN OpenSCAD — cube, cylinder, sphere, polyhedron, translate, rotate, scale, mirror, hull, minkowski, difference, union, intersection, for. Do NOT use BOSL2 at all: no \`include <BOSL2/...>\`, no cuboid/cyl/rounding=/chamfer=/attach/anchor/edges/gear. Keep EVERY part with its position, size, proportions and the overall design, plus the Customizer parameter variables, comments and groups. Approximate any rounded/chamfered edge with a plain shape — a sharp model that RENDERS is the goal.`
            : `The program failed to render in OpenSCAD with this error:\n${r.raw.slice(0, 800)}\nFix ONLY what caused the error and return the COMPLETE corrected program. The usual cause is a BOSL2 call (cuboid/cyl/rounding=/attach/anchor/edges) — replace just those with the plain-OpenSCAD equivalent (cube/cylinder/translate/difference/hull), keeping the SAME rounding/fillet intent where easy. CRITICAL: keep EVERY part, its position, size, proportions and the overall design intact — do NOT simplify the model, do NOT turn it into a plain box, do NOT remove parts. Keep the Customizer parameter variables, comments and groups.`;
        try {
          const fixRes = await fetch('/api/nexyfab/scad-intent-from-nl', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            // Repairs go to DeepSeek regardless of the picked model — it reliably
            // emits valid OpenSCAD, whereas a model that just produced a broken
            // program (e.g. rounding>size, syntax errors) tends to repeat it.
            body: JSON.stringify({ prompt: fixPrompt, freeform: true, previousScad: code, repair: true, modelId: 'deepseek-reasoner' }),
          });
          const fixData = await fixRes.json().catch(() => ({}));
          const fixed = (fixData as { scad?: string }).scad;
          if (!fixed || !fixed.trim() || fixed === code) break;
          code = fixed; setScad(fixed); setGenCount(c => c + 1);
          r = await renderScad(fixed);
        } catch { break; }
      }
      if (!r.ok) {
        setAiMsg(aiId, r.auth
          ? T('3D 미리보기·STL은 무료 로그인이 필요합니다.', '3D preview & STL need a free login.')
          : T('생성한 모델을 렌더링하지 못했어요. 다시 시도하거나 조금 다르게 설명해 주세요.', 'Could not render the model — please try again or describe it a little differently.'), 'error');
        return;
      }
      const DONE = T('완성! 우측 슬라이더로 치수를 조정하거나, 계속 말해서 수정하세요.', 'Done! Tune dimensions on the right, or keep chatting to refine.');
      setAiMsg(aiId, DONE, 'done');
      void renderColored(code); // CADAM-style colours (progressive)
      // Thumbnail + persist + (on a fresh text generation) a visual self-critique.
      setTimeout(() => {
        const grab = (): string | null => {
          const canvas = document.querySelector('[data-studio-canvas] canvas') as HTMLCanvasElement | null;
          try { const t = canvas?.toDataURL?.('image/png'); if (t && t.length > 1000) return t; } catch { /* hidden/tainted */ }
          return null;
        };
        const persist = (scadSrc: string, th: string | null) => setMessages(prev => {
          const updated = th ? prev.map(x => (x.id === aiId ? { ...x, thumb: th } : x)) : prev;
          // STL-based designs carry MB of imported mesh that can't go in
          // localStorage — keep them in-session only, don't save to Recent.
          if (!importStlRef.current) {
            saveDesign({ id: currentIdRef.current, title: titleFromMessages(toPersist(updated)), scad: scadSrc, messages: toPersist(updated), thumb: th ?? lastThumbRef.current, updatedAt: Date.now() });
            refreshDesigns();
          }
          return updated;
        });
        const thumb = grab();
        if (thumb) lastThumbRef.current = thumb;
        persist(code, thumb);

        // CADAM-style agentic refine loop: the model LOOKS at its own render,
        // fixes the geometry, re-renders, and looks again — a few rounds until
        // the shape reads as the requested object. Affordable now that every
        // render is in-browser (WASM). Runs for fresh text AND photo
        // generations (photo path: the reviewer also gets the reference photo,
        // which is exactly where raw codegen tends to scatter the parts).
        if (thumb && !refineFromScad && (text || sentImage)) {
          void (async () => {
            let curScad = code;
            let refined = false;
            const MAX = 2; // most gains land in round 1–2; cap latency (each round = a vision + codegen pass)
            // 4-angle composite (iso/front/side/top) so the reviewer catches
            // faults a single angle hides; fall back to the live iso canvas.
            const sheet = () => (lastGeoRef.current ? captureMultiView(lastGeoRef.current) : null) ?? grab();
            let curView = sheet();
            try {
              for (let iter = 1; iter <= MAX; iter++) {
                if (!curView) break;
                // Stay 'done' (not 'thinking') so the model reads as READY and
                // stays interactive — the refinement is a visible background
                // bonus, not a blocking wait.
                setAiMsg(aiId, T(`완성! 형상을 더 다듬는 중… (${iter}/${MAX})`, `Done! Polishing the shape… (${iter}/${MAX})`), 'done');
                const cr = await fetch('/api/nexyfab/scad-vision-critique', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                  body: JSON.stringify({ image: curView, prompt: text || (sentImage ? 'the object in the reference photo' : ''), scad: curScad, multiview: true, ...(sentImage ? { refImage: sentImage } : {}) }),
                }).then(r => r.json()).catch(() => null) as { scad?: string | null } | null;
                if (!cr?.scad) break; // reviewer says it's faithful — stop
                const rr = await renderScad(cr.scad);
                if (!rr.ok) break;    // the fix didn't render — keep the last good one
                curScad = cr.scad; refined = true;
                // Update the mesh in place but DON'T bump fitKey — re-fitting
                // the camera every refine round makes the viewport jump/shake.
                setScad(curScad);
                // capture the NEW render so the next round inspects the fix
                await new Promise(res => setTimeout(res, 650));
                curView = sheet();
                const t2 = grab(); if (t2) lastThumbRef.current = t2;
              }
            } catch { /* keep whatever rendered last */ }
            const curThumb = lastThumbRef.current ?? thumb;
            setScad(curScad);
            void renderColored(curScad);
            setAiMsg(aiId, refined
              ? T('완성! 렌더를 보며 형상을 다듬었어요. 슬라이더로 조정하거나 계속 말해서 수정하세요.', 'Done! Refined the shape by looking at the render. Tune with sliders or keep chatting.')
              : DONE, 'done');
            setTimeout(() => { const tf = grab(); if (tf) lastThumbRef.current = tf; persist(curScad, tf ?? curThumb); }, 600);
          })();
        }
      }, 700);
    } catch (e) {
      setAiMsg(aiId, (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setBusy(false);
    }
  }, [input, image, busy, scad, precise, modelId, renderScad, renderColored, setAiMsg, refreshDesigns, isKo]);

  // ── Prompt expansion: rewrite a short request into a precise OpenSCAD brief ──
  // the user can review/edit before sending. Best for mechanical parts; flags
  // organic shapes (→ image-to-mesh) in the returned brief.
  const enhanceInput = useCallback(async () => {
    const text = input.trim();
    if (!text || enhancing || busy) return;
    setEnhancing(true);
    try {
      const res = await fetch('/api/nexyfab/enhance-prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ prompt: text, lang }),
      });
      const data = await res.json().catch(() => ({})) as { enhanced?: string };
      if (res.ok && data.enhanced) setInput(data.enhanced);
    } catch { /* keep the original text on failure */ } finally {
      setEnhancing(false);
    }
  }, [input, enhancing, busy, lang]);

  // ── Receive a part handed back FROM the expert modeler (Studio ⇄ Expert) ─────
  // SCAD resumes parametrically; an STL loads as an import("model.stl") base the
  // AI can keep refining. Runs once on mount.
  const expertReturnHandled = useRef(false);
  useEffect(() => {
    if (expertReturnHandled.current) return;
    let scadIn: string | null = null, stlIn: string | null = null;
    try {
      scadIn = sessionStorage.getItem('nexyfab:expert-to-studio-scad');
      stlIn = sessionStorage.getItem('nexyfab:expert-to-studio-stl');
      if (scadIn) sessionStorage.removeItem('nexyfab:expert-to-studio-scad');
      if (stlIn) sessionStorage.removeItem('nexyfab:expert-to-studio-stl');
    } catch { return; }
    if (!scadIn && !stlIn) return;
    expertReturnHandled.current = true;
    void (async () => {
      if (scadIn) {
        currentIdRef.current = freshId(); setCurrentId(currentIdRef.current); lastThumbRef.current = null;
        setMessages([{ id: nextId(), role: 'assistant', text: T('전문가형에서 가져왔어요. 계속 AI로 수정하세요 (예: 구멍 8mm, 2배 크게).', 'Brought in from the expert modeler — keep editing with AI (e.g. holes to 8mm, 2× bigger).'), status: 'done' }]);
        setScad(scadIn); setMobileTab('3d'); setSidebarOpen(false); setGenCount(g => g + 1);
        await renderScad(scadIn);
        return;
      }
      if (stlIn) {
        try {
          const bin = atob(stlIn); const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const geo = parseSTL(bytes.buffer); geo.computeBoundingBox();
          const c = new THREE.Vector3(); geo.boundingBox?.getCenter(c); geo.translate(-c.x, -c.y, -c.z);
          importStlRef.current = stlIn;
          currentIdRef.current = freshId(); setCurrentId(currentIdRef.current); lastThumbRef.current = null;
          setMessages([{ id: nextId(), role: 'assistant', text: T('전문가형 모델을 가져왔어요. 무엇을 바꿀까요? (예: 가운데 10mm 구멍, 2배 크게)', 'Brought in the expert model. What should I change? (e.g. a 10mm centre hole, 2× bigger)'), status: 'done' }]);
          setScad('import("model.stl");'); setGeometry(geo); setColoredObject(null); setStlB64(stlIn); setMobileTab('3d'); setSidebarOpen(false); setGenCount(g => g + 1);
        } catch { /* invalid STL — ignore */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dimension auto-correct (single-shot): if a fresh model's largest dimension is
  // off from what the user explicitly asked for, uniformly rescale it once.
  useEffect(() => {
    if (!modelSize || busy || autoFixedRef.current) return;
    const target = lastTargetRef.current;
    if (!target) return;
    const largest = Math.max(modelSize.x, modelSize.y, modelSize.z);
    if (largest <= 0) return;
    if (Math.abs(largest - target) / target > 0.15) {
      autoFixedRef.current = true;
      void send(`The overall size is off: the model's largest dimension is about ${largest.toFixed(0)} mm but it should be ${target} mm. Uniformly scale the whole model so its largest dimension is exactly ${target} mm, keeping all proportions, features and parameters consistent.`);
    }
  }, [modelSize, busy, send]);

  const onCustomizer = useCallback((name: string, value: number | boolean | string) => {
    setColoredObject(null); // drop to fast monochrome while dragging
    setScad(prev => {
      const next = applyCustomizerValue(prev, name, value);
      if (renderTimer.current) clearTimeout(renderTimer.current);
      renderTimer.current = setTimeout(() => {
        void renderScad(next).catch(() => {});
        // re-colour a bit later, after the user has stopped dragging
        if (colorTimer.current) clearTimeout(colorTimer.current);
        colorTimer.current = setTimeout(() => { void renderColored(next); }, 900);
      }, 350);
      return next;
    });
  }, [renderScad, renderColored]);

  const onPickImage = useCallback((file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 6 * 1024 * 1024) return;
    const r = new FileReader();
    r.onload = () => { setImage(typeof r.result === 'string' ? r.result : null); setImageName(file.name || 'pasted.png'); };
    r.readAsDataURL(file);
  }, []);

  // Attach an .stl: parse + show it immediately, set it as the base the SCAD
  // imports, and start a fresh design the user can then modify by chatting.
  const onPickStl = useCallback((file: File) => {
    if (file.size > 20 * 1024 * 1024) return;
    const r = new FileReader();
    r.onload = () => {
      const buf = r.result as ArrayBuffer;
      try {
        const geo = parseSTL(buf);
        geo.computeBoundingBox();
        const c = new THREE.Vector3();
        geo.boundingBox?.getCenter(c);
        geo.translate(-c.x, -c.y, -c.z);
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
        const b64 = btoa(bin);
        importStlRef.current = b64;
        currentIdRef.current = freshId(); setCurrentId(currentIdRef.current);
        lastThumbRef.current = null;
        setMessages([{ id: nextId(), role: 'assistant', text: T('STL을 불러왔어요. 무엇을 바꿀까요? (예: 가운데 10mm 구멍 뚫기, 2배 크게, 바닥 평평하게)', 'Loaded your STL. What should I change? (e.g. a 10mm hole through the center, 2× bigger, flatten the base)'), status: 'done' }]);
        setScad('import("model.stl");');
        setGeometry(geo); setColoredObject(null); setStlB64(b64); setGenCount(g => g + 1);
        setNeedLogin(false); setInput(''); setImage(null); setImageName(null); setMobileTab('3d'); setSidebarOpen(false);
      } catch { /* not a valid STL */ }
    };
    r.readAsArrayBuffer(file);
  }, [isKo]);

  // Attach a .step/.stp: convert to a mesh on the server (replicad), serialize
  // to STL, then route through the same import("model.stl") base as onPickStl so
  // the AI can edit it by chat ("a 10mm hole", "2× bigger", …) just like an STL.
  const onPickStep = useCallback((file: File) => {
    if (file.size > 25 * 1024 * 1024) return;
    const r = new FileReader();
    r.onload = async () => {
      const stepText = r.result as string;
      setMessages([{ id: nextId(), role: 'assistant', text: T('STEP을 변환하는 중…', 'Converting your STEP…'), status: 'thinking' }]);
      try {
        const res = await fetch('/api/nexyfab/brep/step-import-replicad/', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepText }),
        });
        const data = await res.json().catch(() => ({})) as { positions?: number[]; triangles?: number[]; error?: string };
        if (!res.ok || !data.positions?.length || !data.triangles?.length) {
          throw new Error(data.error || T('STEP을 불러오지 못했어요.', 'Could not import that STEP.'));
        }
        // Center about the origin (matches onPickStl) before serializing, so the
        // displayed mesh and the OpenSCAD import("model.stl") agree.
        const pos = Float32Array.from(data.positions);
        let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (let i = 0; i < pos.length; i += 3) {
          mnx = Math.min(mnx, pos[i]); mxx = Math.max(mxx, pos[i]);
          mny = Math.min(mny, pos[i + 1]); mxy = Math.max(mxy, pos[i + 1]);
          mnz = Math.min(mnz, pos[i + 2]); mxz = Math.max(mxz, pos[i + 2]);
        }
        const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
        for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 1] -= cy; pos[i + 2] -= cz; }

        const stlBuf = trianglesToBinaryStl(pos, data.triangles);
        const bytes = new Uint8Array(stlBuf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
        const b64 = btoa(bin);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(data.triangles);
        geo.computeVertexNormals();

        importStlRef.current = b64;
        currentIdRef.current = freshId(); setCurrentId(currentIdRef.current);
        lastThumbRef.current = null;
        setMessages([{ id: nextId(), role: 'assistant', text: T('STEP을 불러왔어요. 무엇을 바꿀까요? (예: 가운데 10mm 구멍, 2배 크게, 바닥 평평하게)', 'Loaded your STEP. What should I change? (e.g. a 10mm hole through the center, 2× bigger, flatten the base)'), status: 'done' }]);
        setScad('import("model.stl");');
        setGeometry(geo); setColoredObject(null); setStlB64(b64); setGenCount(g => g + 1);
        setNeedLogin(false); setInput(''); setImage(null); setImageName(null); setMobileTab('3d'); setSidebarOpen(false);
      } catch (e) {
        setMessages([{ id: nextId(), role: 'assistant', text: e instanceof Error ? e.message : T('STEP 변환 실패', 'STEP conversion failed'), status: 'error' }]);
      }
    };
    r.readAsText(file);
  }, [isKo]);

  // Route a picked/dropped/pasted file to the right handler.
  const onPickFile = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (file.type.startsWith('image/')) onPickImage(file);
    else if (/\.stl$/i.test(file.name) || /stl/i.test(file.type)) onPickStl(file);
    else if (/\.(step|stp)$/i.test(file.name) || /step/i.test(file.type)) onPickStep(file);
  }, [onPickImage, onPickStl, onPickStep]);

  // Paste an image straight from the clipboard (Ctrl/Cmd+V) anywhere in Studio.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) { onPickImage(f); e.preventDefault(); }
          return;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPickImage]);

  const exportStl = useCallback(() => {
    if (!stlB64) return;
    const blob = new Blob([b64ToArrayBuffer(stlB64)], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'studio-model.stl'; a.click();
    URL.revokeObjectURL(url);
  }, [stlB64]);

  // STEP export — the manufacturing handoff. Precise models build a TRUE
  // analytic B-rep (planar + cylindrical faces, re-opens cleanly in
  // SolidWorks/Fusion); free-form falls back to a tessellated AP203 STEP.
  const [stepBusy, setStepBusy] = useState(false);
  const exportStep = useCallback(async () => {
    if (!geometry || stepBusy) return;
    setStepBusy(true);
    const save = (text: string) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/step' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'nexyfab-part.step'; a.click();
      URL.revokeObjectURL(url);
    };
    try {
      // Precise: analytic B-rep STEP from the feature program (replicad/OCCT).
      if (programRef.current) {
        try {
          const res = await fetch('/api/nexyfab/cad-feature-step', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify(programRef.current),
          });
          if (res.ok) {
            const text = await res.text();
            if (text.includes('ISO-10303-21')) {
              save(text);
              // Surface any approximation rather than letting it ship silently.
              const skipped = res.headers.get('X-Skipped');
              const clamped = res.headers.get('X-Clamped');
              const notes: string[] = [];
              if (skipped && skipped !== 'none') notes.push(T(`미반영 피처: ${skipped}`, `Features not applied: ${skipped}`));
              if (clamped && clamped !== 'none') notes.push(T(`치수 조정: ${clamped}`, `Clamped: ${clamped}`));
              if (notes.length) alert(T('STEP를 내보냈어요.\n', 'STEP exported.\n') + notes.join('\n'));
              return;
            }
          }
          // analytic build failed → fall through to the mesh STEP
        } catch { /* fall through */ }
      }
      // Free-form (or analytic failed): tessellated solid → AP203 STEP.
      const pos = geometry.getAttribute('position');
      if (!pos) return;
      const positions = Array.from(pos.array as Float32Array);
      const idx = geometry.getIndex();
      const triangles = idx ? Array.from(idx.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
      const res = await fetch('/api/nexyfab/brep/step-export-from-stl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ positions, triangles, fileName: 'nexyfab-part.step' }),
      });
      if (res.status === 401) { alert(T('STEP 내보내기는 무료 로그인이 필요합니다.', 'STEP export needs a (free) login.')); return; }
      if (!res.ok) { alert(T('STEP 내보내기에 실패했어요.', 'STEP export failed.')); return; }
      save(await res.text());
    } catch { alert(T('STEP 내보내기에 실패했어요.', 'STEP export failed.')); }
    finally { setStepBusy(false); }
  }, [geometry, stepBusy, isKo]);

  const newDesign = useCallback(() => {
    currentIdRef.current = freshId(); setCurrentId(currentIdRef.current);
    lastThumbRef.current = null; importStlRef.current = null; programRef.current = null; colorReqRef.current++;
    setMessages([]); setScad(''); setGeometry(null); setColoredObject(null); setStlB64(null); setNeedLogin(false); setInput(''); setSidebarOpen(false);
  }, []);

  const loadDesign = useCallback((id: string) => {
    const d = getDesign(id);
    if (!d) return;
    currentIdRef.current = id; setCurrentId(id);
    lastThumbRef.current = d.thumb ?? null; importStlRef.current = null;
    setMessages(d.messages.map(m => ({ id: nextId(), ...m })));
    setScad(d.scad);
    setColoredObject(null);
    setNeedLogin(false); setSidebarOpen(false);
    setGenCount(c => c + 1);
    void renderScad(d.scad).then(() => renderColored(d.scad)).catch(() => {});
  }, [renderScad, renderColored]);

  const removeDesign = useCallback((id: string) => {
    deleteDesign(id); refreshDesigns();
    if (id === currentIdRef.current) newDesign();
  }, [refreshDesigns, newDesign]);

  const handoff = useCallback(() => {
    if (scad) { try { sessionStorage.setItem('nexyfab:studio-handoff-scad', scad); } catch { /* ignore */ } }
    // Hand over the ALREADY-RENDERED STL so the modeler imports it directly,
    // without re-rendering on the server (which a guest can't — it 401s). Large
    // meshes may overflow sessionStorage; that's fine, the modeler falls back to
    // rendering the SCAD.
    try {
      if (stlB64 && !importStlRef.current) sessionStorage.setItem('nexyfab:studio-handoff-stl', stlB64);
      else sessionStorage.removeItem('nexyfab:studio-handoff-stl');
    } catch { try { sessionStorage.removeItem('nexyfab:studio-handoff-stl'); } catch { /* ignore */ } }
    // Precise designs also carry their structured feature program so the modeler
    // can rebuild an EDITABLE feature tree (not just an imported solid).
    try {
      if (programRef.current) sessionStorage.setItem('nexyfab:studio-handoff-program', JSON.stringify(programRef.current));
      else sessionStorage.removeItem('nexyfab:studio-handoff-program');
    } catch { /* ignore */ }
    if (onExpert) onExpert();
    else router.push(`/${lang}/shape-generator?mode=expert`);
  }, [scad, stlB64, lang, router, onExpert]);

  // Manufacturing quote handoff — hand the rendered STL to the instant-quote
  // page, which extracts volume/dimensions from the file (same path as a manual
  // upload). Closes the design → quote funnel without a re-upload step.
  const quoteHandoff = useCallback(() => {
    if (!stlB64) return;
    try { sessionStorage.setItem('nexyfab:studio-quote-stl', stlB64); } catch { return; }
    router.push(`/${lang}/quick-quote?from=studio`);
  }, [stlB64, lang, router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };
  const dragProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (!dragOver) setDragOver(true); },
    onDragLeave: (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); onPickFile(e.dataTransfer?.files?.[0]); },
  };

  const ImagePill = () => image ? (
    <span className="flex items-center gap-1.5 text-[11px] text-blue-200/90 bg-blue-900/30 rounded px-1.5 py-1">
      <img src={image} alt="" className="w-7 h-7 object-cover rounded" />
      <span className="truncate max-w-[120px]">{imageName}</span>
      <button onClick={() => { setImage(null); setImageName(null); }} className="st-text-2 hover:opacity-70">✕</button>
    </span>
  ) : null;

  const renderParam = (p: (typeof customizer)[number]) => {
    const label = p.description || p.name;
    if (p.kind === 'bool') return (
      <label key={p.name} className="flex items-center gap-2 text-[11px] st-text-2">
        <input type="checkbox" checked={p.value as boolean} onChange={e => onCustomizer(p.name, e.target.checked)} className="accent-blue-500" />
        <span className="truncate" title={p.name}>{label}</span>
      </label>
    );
    if (p.kind === 'slider') { const v = p.value as number; return (
      <div key={p.name} className="flex flex-col gap-0.5">
        <div className="flex justify-between text-[11px] st-text-2"><span className="truncate" title={p.name}>{label}</span><span className="tabular-nums st-text">{(p.step ?? 1) < 1 ? v.toFixed(1) : Math.round(v)}{p.unit && <span className="st-text-3 ml-0.5">{p.unit}</span>}</span></div>
        <input type="range" min={p.min} max={p.max} step={p.step} value={v} onChange={e => onCustomizer(p.name, parseFloat(e.target.value))} className="w-full accent-blue-500" />
      </div>
    ); }
    if (p.kind === 'dropdown') return (
      <label key={p.name} className="flex items-center gap-2 text-[11px] st-text-2">
        <span className="w-24 truncate" title={p.name}>{label}</span>
        <select value={String(p.value)} onChange={e => onCustomizer(p.name, typeof p.value === 'number' ? parseFloat(e.target.value) : e.target.value)} className="flex-1 st-panel-2 border st-bd rounded px-1 py-0.5">
          {(p.options ?? []).map(o => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
        </select>
      </label>
    );
    return (
      <label key={p.name} className="flex items-center gap-2 text-[11px] st-text-2">
        <span className="w-24 truncate" title={p.name}>{label}</span>
        <input type="text" value={String(p.value)} onChange={e => onCustomizer(p.name, e.target.value)} className="flex-1 st-panel-2 border st-bd rounded px-1 py-0.5 font-mono" />
      </label>
    );
  };

  const ParamsBody = () => (
    <div className="flex-1 overflow-auto p-3 flex flex-col gap-3">
      {modelSize && (
        <div className="flex items-center gap-1.5 text-[11px] st-text-3 pb-0.5" title={T('실제 렌더된 크기 (요청 치수와 비교용)', 'Actual rendered size (compare with the requested dimensions)')}>
          <span>📐</span>
          <span className="tabular-nums st-text-2">{modelSize.x.toFixed(1)} × {modelSize.y.toFixed(1)} × {modelSize.z.toFixed(1)} mm</span>
        </div>
      )}
      {customizer.length === 0 && <div className="text-[11px] st-text-3">{T('조절 가능한 치수가 여기 나타납니다.', 'Adjustable dimensions appear here.')}</div>}
      {grouped.map((g, gi) => {
        const isCol = !!g.name && collapsedGroups.has(g.name);
        return (
        <div key={g.name ?? `g${gi}`} className="flex flex-col gap-2">
          {g.name && (
            <button
              type="button"
              onClick={() => setCollapsedGroups(s => { const n = new Set(s); if (n.has(g.name!)) n.delete(g.name!); else n.add(g.name!); return n; })}
              className="flex items-center justify-between text-[10px] uppercase tracking-wide text-blue-400/70 font-semibold border-b st-bd pb-1 hover:text-blue-300 transition-colors"
            >
              <span>{g.name}</span>
              <span className="st-text-3">{isCol ? '▸' : '▾'}</span>
            </button>
          )}
          {!isCol && g.params.map(renderParam)}
        </div>
        );
      })}
      {scad && (
        <div className="flex flex-col gap-1.5 pt-2 mt-1 border-t st-bd">
          <div className="px-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] st-text-3">{T('빠른 보정', 'Quick fixes')}</div>
          <div className="flex flex-wrap gap-1">
            {([
              { label: T('⬇ 바닥 평탄화', '⬇ Flatten base'), run: () => send('Flatten the bottom so the whole model sits flat on the build plate at z=0.') },
              { label: T('🫙 속 비우기', '🫙 Hollow'), run: () => { const w = window.prompt(T('벽 두께 (mm)', 'Wall thickness (mm)'), '2'); const n = Number(w); if (n > 0) void send(`Hollow it into a shell with ${n}mm walls, keeping the outer shape.`); } },
              { label: T('🕳 마운팅 홀', '🕳 Mount holes'), run: () => send('Add 4 M3 mounting holes near the base corners as a parametric pattern.') },
              { label: T('🔵 모서리 둥글게', '🔵 Round edges'), run: () => send('Round the sharp outer edges with a small fillet (small enough to render).') },
              { label: T('⟋ 모따기', '⟋ Chamfer'), run: () => send('Chamfer the sharp outer edges with a small 45° chamfer (keep it well under half the smallest dimension so it renders).') },
              { label: T('🔤 텍스트 각인', '🔤 Engrave text'), run: () => { const t = window.prompt(T('각인할 텍스트', 'Text to engrave'), 'NXF'); const s = (t || '').trim().replace(/"/g, ''); if (s) void send(`Engrave the text "${s}" recessed about 1mm into the top face, sized to fit and centered.`); } },
              { label: T('⤢ 2배', '⤢ 2× size'), run: () => send('Make the whole model twice as large, keeping proportions.') },
              { label: T('⤡ 절반', '⤡ Half'), run: () => send('Make the whole model half the size, keeping proportions.') },
            ]).map((a, i) => (
              <button key={i} type="button" disabled={busy} onClick={() => { void a.run(); }}
                className="text-[11px] px-2 py-1 rounded-md st-panel-2 border st-bd st-hover disabled:opacity-40 transition-colors">
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const examples = precise ? [
    T('120×80×8 브래킷, 중앙 40mm 구멍, M6 4개 PCD60', 'a 120×80×8 bracket, 40mm centre hole, 4× M6 on PCD60'),
    T('100×100×10 마운팅 플레이트, 모서리에 M5 구멍 4개', 'a 100×100×10 mounting plate with 4× M5 corner holes'),
    T('지름 60 두께 6 플랜지, 중앙 25mm 구멍, C2 면취', 'a Ø60×6 flange, 25mm bore, C2 chamfer'),
    T('50×50×30 박스, 벽두께 3, 윗면 열림', 'a 50×50×30 box, 3mm walls, open top'),
  ] : [
    T('바퀴 4개 달린 장난감 자동차', 'a toy car with four wheels'),
    T('M8 나사용 L자 브래킷', 'an L-bracket for M8 screws'),
    T('손잡이 있는 머그컵', 'a mug with a handle'),
    T('기어 24개 스퍼기어', 'a 24-tooth spur gear'),
  ];
  const greetingBase = precise
    ? (isKo ? '님, 어떤 정밀 부품을 만들까요?' : ', what precise part shall we build?')
    : (isKo ? '님, 무엇을 만들까요?' : ', what should we build?');
  const greeting = userName ? `${userName.split('@')[0]}${greetingBase}` : (precise ? T('어떤 정밀 부품을 만들까요?', 'What precise part shall we build?') : T('무엇을 만들까요?', 'What should we build?'));

  const sidebar = (
    <StudioSidebar
      lang={lang} isKo={isKo} designs={designs} currentId={currentId} userName={userName}
      open={sidebarOpen} onClose={() => setSidebarOpen(false)} theme={theme} onToggleTheme={toggleTheme}
      onNew={newDesign} onLoad={loadDesign} onDelete={removeDesign} onExpert={handoff}
    />
  );

  // ── Empty hero ─────────────────────────────────────────────────────────────
  if (isEmpty) {
    return (
      <div className="flex h-dvh w-full st-bg" {...dragProps}>
        {sidebar}
        <div className="flex-1 min-w-0 relative flex flex-col items-center justify-center px-6 st-hero-bg">
          <button onClick={() => setSidebarOpen(true)} className="md:hidden absolute top-3 left-3 st-text-2 text-xl" aria-label="menu">☰</button>
          <a href={`/${lang}`} className="absolute top-4 right-5 text-[12px] st-text-3 hover:st-text-2">{T('홈', 'Home')}</a>
          {dragOver && <div className="absolute inset-0 z-10 flex items-center justify-center bg-blue-900/20 text-blue-300 text-lg font-semibold pointer-events-none">📷 {T('사진을 놓으세요', 'Drop the photo')}</div>}

          {/* Mode toggle + model picker */}
          <div className="flex items-center gap-2 mb-5 flex-wrap justify-center">
            <div className="flex items-center gap-1 st-panel-2 border st-bd rounded-full p-1 text-[12px]">
              <button onClick={() => setPrecise(false)} className={`px-3 py-1 rounded-full font-semibold ${!precise ? 'bg-blue-600 text-white' : 'st-text-2'}`}>✨ {T('자유형', 'Free-form')}</button>
              <button onClick={() => setPrecise(true)} className={`px-3 py-1 rounded-full font-semibold ${precise ? 'bg-indigo-600 text-white' : 'st-text-2'}`}>📐 {T('정밀', 'Precise')}</button>
            </div>
            <ModelPicker modelId={modelId} onPick={pickModel} isKo={isKo} />
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-center">{greeting}</h1>
          <p className="st-text-2 text-sm mb-6 text-center">{precise
            ? T('치수를 넣어 설명하면 정확한 치수의 부품을 만듭니다 (구멍·면취·필렛·패턴).', 'Describe it with dimensions for an exact part — holes, chamfers, fillets, patterns.')
            : T('말로 설명하거나 사진을 올리면 조절 가능한 3D 모델이 됩니다.', 'Describe it — or drop a photo — to get an adjustable 3D model.')}</p>

          <div className="w-full max-w-2xl st-panel-2 border st-bd rounded-2xl p-3 focus-within:border-blue-500/60 shadow-xl">
            {image && <div className="mb-2"><ImagePill /></div>}
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown}
              placeholder={T('예: 바퀴 4개 달린 장난감 자동차…  (사진은 끌어다 놓거나 Ctrl+V 붙여넣기)', 'e.g. a toy car with four wheels…  (drag or paste a photo with Ctrl+V)')}
              rows={2} autoFocus className="w-full bg-transparent text-base resize-none focus:outline-none px-1" />
            <div className="flex items-center justify-between mt-2">
              <label className="flex items-center gap-1.5 text-[12px] text-blue-300 hover:text-blue-200 cursor-pointer border border-blue-800/60 hover:border-blue-600 rounded-lg px-2.5 py-1.5">
                <input type="file" accept="image/*,.stl,model/stl,.step,.stp,model/step" className="hidden" onChange={e => onPickFile(e.target.files?.[0])} />
                📷 {T('사진·STL 올리기', 'Upload photo / STL')}
              </label>
              <div className="flex items-center gap-2">
                <button onClick={() => void enhanceInput()} disabled={!input.trim() || enhancing || busy} className="text-[12px] border st-bd st-hover disabled:opacity-40 rounded-lg px-2.5 py-1.5" title={T('OpenSCAD용 정밀 프롬프트로 다듬기', 'Refine into a precise OpenSCAD brief')}>
                  {enhancing ? T('다듬는 중…', 'Refining…') : T('✨ 다듬기', '✨ Refine')}
                </button>
                <button onClick={() => void send()} disabled={busy || (!input.trim() && !image)} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg px-5 py-1.5 text-sm font-semibold">
                  {busy ? T('생성 중…', 'Working…') : T('생성하기', 'Generate')}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4 justify-center max-w-2xl">
            {examples.map((ex, i) => (
              <button key={i} onClick={() => setInput(ex)} className="text-[12px] border st-chip rounded-full px-3 py-1">{ex}</button>
            ))}
          </div>

          <div className="mt-10 flex gap-8 sm:gap-12 text-center">
            {[['💬', T('1. 설명 / 사진', '1. Describe / photo')], ['🧊', T('2. 3D 자동 생성', '2. Auto 3D model')], ['🎚️', T('3. 슬라이더로 조정', '3. Tune with sliders')]].map(([icon, label], i) => (
              <div key={i} className="flex flex-col items-center gap-1.5 st-text-2">
                <span className="text-2xl">{icon}</span>
                <span className="text-[12px] font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Active workspace (sidebar + chat + 3D + params) ────────────────────────
  const tabBtn = (id: typeof mobileTab, label: string) => (
    <button onClick={() => setMobileTab(id)} className={`flex-1 py-2 text-[12px] font-semibold ${mobileTab === id ? 'text-blue-400 border-t-2 border-blue-400 -mt-px' : 'st-text-3'}`}>{label}</button>
  );
  return (
    <div className={`flex h-dvh w-full st-bg ${dragOver ? 'ring-2 ring-blue-500 ring-inset' : ''}`} {...dragProps}>
      {sidebar}
      <div className="flex-1 min-w-0 flex flex-col md:flex-row">
        {/* Chat */}
        <aside className={`${mobileTab === 'chat' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-[320px] flex-1 md:flex-none min-h-0 border-r st-bd`}>
          <div className="flex items-center gap-2 px-3 py-2 border-b st-bd shrink-0">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden st-text-2 text-lg" aria-label="menu">☰</button>
            <span className="text-[13px] st-text-2 truncate flex-1">{designs.find(d => d.id === currentId)?.title ?? T('새 디자인', 'New design')}</span>
            <button onClick={newDesign} className="text-[11px] st-text-2 hover:opacity-70" title={T('새로', 'New')}>+ {T('새로', 'New')}</button>
          </div>
          <div className="flex-1 overflow-auto p-3 flex flex-col gap-3 min-h-0">
            {messages.map(m => (
              <div key={m.id} className={m.role === 'user' ? 'self-end max-w-[88%]' : 'self-start max-w-[92%]'}>
                <div className={`rounded-xl px-3 py-2 text-[12px] whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-blue-700/40 border border-blue-700/40' : m.status === 'error' ? 'bg-red-900/30 border border-red-800/40 text-red-200' : 'st-panel-2 border st-bd'}`}>
                  {m.image && <img src={m.image} alt="" className="w-full max-h-32 object-contain rounded mb-1.5 bg-black/30" />}
                  {m.status === 'thinking' ? <span className="inline-flex items-center gap-1.5 text-blue-300"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />{m.text}</span> : m.text}
                  {m.thumb && <img src={m.thumb} alt="" className="w-full max-h-28 object-contain rounded mt-1.5 bg-black/20 cursor-pointer" onClick={() => setMobileTab('3d')} title={T('3D 보기', 'View in 3D')} />}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="border-t st-bd p-2.5 flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex items-center gap-0.5 st-panel-2 border st-bd rounded-full p-0.5 text-[11px]">
                <button onClick={() => setPrecise(false)} className={`px-2 py-0.5 rounded-full font-semibold ${!precise ? 'bg-blue-600 text-white' : 'st-text-2'}`}>✨ {T('자유형', 'Free')}</button>
                <button onClick={() => setPrecise(true)} className={`px-2 py-0.5 rounded-full font-semibold ${precise ? 'bg-indigo-600 text-white' : 'st-text-2'}`}>📐 {T('정밀', 'Precise')}</button>
              </div>
              <ModelPicker modelId={modelId} onPick={pickModel} isKo={isKo} compact />
            </div>
            {image && <ImagePill />}
            {scad && !image && (
              // One-click refine chips — continue the design by clicking instead of
              // typing. Each sends a complete refine prompt (send() refines when a
              // model already exists). Mirrors the in-chat example hints.
              <div className="flex flex-wrap gap-1.5">
                {[
                  { ic: '🕳', ko: '구멍', en: 'Hole', pKo: '가운데에 지름 10mm 구멍을 관통으로 뚫어줘', pEn: 'Drill a 10mm hole straight through the center' },
                  { ic: '⬆', ko: '2배 크게', en: '2× bigger', pKo: '전체를 2배 크게 만들어줘', pEn: 'Make the whole thing 2× bigger' },
                  { ic: '🧱', ko: '벽 두껍게', en: 'Thicker walls', pKo: '벽을 3mm로 더 두껍게 해줘', pEn: 'Make the walls thicker (3mm)' },
                  { ic: '◝', ko: '모서리 둥글게', en: 'Round edges', pKo: '바깥 모서리를 3mm 둥글게 해줘', pEn: 'Round the outer edges by 3mm' },
                  { ic: '▭', ko: '바닥 평평', en: 'Flat base', pKo: '바닥을 평평하게 해줘', pEn: 'Flatten the base' },
                  { ic: '🔩', ko: '마운팅 홀', en: 'Mount holes', pKo: '네 모서리에 지름 4mm 마운팅 구멍을 추가해줘', pEn: 'Add 4mm mounting holes at the four corners' },
                ].map((c, i) => (
                  <button
                    key={i}
                    disabled={busy}
                    onClick={() => void send(T(c.pKo, c.pEn))}
                    className="text-[11px] border st-chip rounded-full px-2.5 py-1 disabled:opacity-40"
                    title={T(c.pKo, c.pEn)}
                  >
                    {c.ic} {T(c.ko, c.en)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5 st-panel-2 border st-bd rounded-xl px-2 py-1.5 focus-within:border-blue-500/60">
              <label className="cursor-pointer text-base shrink-0 leading-none" title={T('사진 첨부', 'Attach photo')}>
                <input type="file" accept="image/*,.stl,model/stl,.step,.stp,model/step" className="hidden" onChange={e => onPickFile(e.target.files?.[0])} />📎
              </label>
              <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown}
                placeholder={T('계속 수정해보세요 (예: 더 높게)…', 'Keep iterating (e.g. make it taller)…')} rows={1}
                className="flex-1 bg-transparent text-sm resize-none focus:outline-none max-h-28 py-0.5" />
              <button onClick={() => void enhanceInput()} disabled={!input.trim() || enhancing || busy} className="shrink-0 text-[11px] px-2 h-7 rounded-lg border st-bd st-hover disabled:opacity-40" title={T('OpenSCAD용 정밀 프롬프트로 다듬기', 'Refine into a precise OpenSCAD brief')}>{enhancing ? '…' : T('✨ 다듬기', '✨ Refine')}</button>
              <button onClick={() => void send()} disabled={busy || (!input.trim() && !image)} className="shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg w-7 h-7 flex items-center justify-center" title={T('보내기', 'Send')}>↑</button>
            </div>
            <button onClick={quoteHandoff} disabled={!stlB64} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded py-2 text-[12px] font-bold" title={T('이 부품으로 제조 견적받기', 'Get a manufacturing quote for this part')}>{T('💵 견적받기', '💵 Get a quote')}</button>
            <div className="flex gap-2">
              <button onClick={exportStl} disabled={!stlB64} className="flex-1 border st-bd st-hover disabled:opacity-40 rounded py-1.5 text-[11px]">⬇ STL</button>
              <button onClick={() => void exportStep()} disabled={!geometry || stepBusy} className="flex-1 border st-bd st-hover disabled:opacity-40 rounded py-1.5 text-[11px]" title={precise ? T('제조용 analytic STEP (CAD 호환)', 'Analytic STEP for manufacturing (CAD interchange)') : T('제조용 STEP (테셀레이션, CAD 호환)', 'STEP for manufacturing (tessellated, CAD interchange)')}>{stepBusy ? '…' : '⬇ STEP'}</button>
              <button onClick={handoff} className="flex-1 bg-indigo-600 hover:bg-indigo-500 rounded py-1.5 text-[11px] font-semibold" title={T('전문가형 모델러', 'Expert modeler')}>{T('전문가형 →', 'Expert →')}</button>
            </div>
          </div>
        </aside>

        {/* 3D */}
        <main data-studio-canvas className={`${mobileTab === '3d' ? 'block' : 'hidden'} md:block flex-1 relative min-h-0`}>
          <StudioViewer geometry={geometry} object={coloredObject} fitKey={genCount} theme={theme} />
          {needLogin && !geometry && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="text-blue-300 text-sm">🔒 {T('3D 미리보기·STL은 로그인이 필요합니다', '3D preview & STL need a (free) login')}</div>
              <a href={`/login?next=${encodeURIComponent(`/${lang}/studio`)}`} className="bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-1.5 text-xs font-semibold">{T('무료 로그인', 'Free login')}</a>
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
              <div className="w-9 h-9 border-2 border-blue-500/25 border-t-blue-400 rounded-full animate-spin" />
              <span className="text-blue-300 text-sm">{geometry ? T('업데이트 중…', 'Updating…') : T('생성 중…', 'Working…')}</span>
            </div>
          )}
        </main>

        {/* Parameters */}
        <aside className={`${mobileTab === 'params' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-[280px] flex-1 md:flex-none min-h-0 border-l st-bd`}>
          <div className="px-3 py-2 border-b st-bd flex items-center justify-between shrink-0">
            <span className="text-sm font-semibold">{T('파라미터', 'Parameters')}</span>
            <span className="text-[11px] st-text-3">{customizer.length}</span>
          </div>
          <ParamsBody />
        </aside>

        {/* Mobile tab bar */}
        <nav className="md:hidden shrink-0 flex border-t st-bd st-panel">
          {tabBtn('chat', `💬 ${T('채팅', 'Chat')}`)}
          {tabBtn('3d', `🧊 3D`)}
          {tabBtn('params', `🎚️ ${T('치수', 'Tune')}${customizer.length ? ` (${customizer.length})` : ''}`)}
        </nav>
      </div>
    </div>
  );
}
