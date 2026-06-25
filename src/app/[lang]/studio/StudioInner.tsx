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
import StudioSidebar from './StudioSidebar';
import { listDesigns, saveDesign, getDesign, deleteDesign, titleFromMessages, type StudioDesign, type StudioChatMsg } from './studioDesigns';
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
                className={`w-full text-left px-3 py-2 hover:st-hover ${m.id === modelId ? 'bg-emerald-600/15' : ''}`}>
                <div className="text-[13px] font-semibold st-text flex items-center gap-1.5">{m.label}{m.id === modelId && <span className="text-emerald-400 text-[11px]">✓</span>}</div>
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

export default function StudioInner({ onExpert, initialPrecise = false }: { onExpert?: () => void; initialPrecise?: boolean } = {}) {
  const params = useParams();
  const router = useRouter();
  const lang = (Array.isArray(params?.lang) ? params.lang[0] : params?.lang) ?? 'en';
  const isKo = lang === 'ko' || lang === 'kr';
  const T = (ko: string, en: string) => (isKo ? ko : en);
  const userName = useAuthStore(s => s.user?.name ?? s.user?.email ?? null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const [coloredObject, setColoredObject] = useState<THREE.Object3D | null>(null); // per-color group (CADAM-style)
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
  useEffect(() => { currentIdRef.current = freshId(); setCurrentId(currentIdRef.current); refreshDesigns(); }, [refreshDesigns]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const setAiMsg = useCallback((id: number, text: string, status: ChatMsg['status']) => {
    setMessages(m => m.map(x => (x.id === id ? { ...x, text, status } : x)));
  }, []);

  const renderScad = useCallback(async (src: string): Promise<RenderResult> => {
    // Client-side WASM render first — no server load, no auth gate, no byte cap.
    // Attached-STL models still use the server (it injects the user's model.stl).
    if (!importStlRef.current && wasmAvailable()) {
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
      res = await fetch('/api/nexyfab/openscad-render', {
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
    const useWasm = !importStlRef.current && wasmAvailable();
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
        const res = await fetch('/api/nexyfab/openscad-render', {
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
      const cg = r.tok == null ? { css: defaultColorCss(), alpha: 1 } : colors.find(c => c.token === r.tok);
      const css = cg?.css ?? defaultColorCss();
      const alpha = cg?.alpha ?? 1;
      r.geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(css), metalness: 0.1, roughness: 0.6, transparent: alpha < 1, opacity: alpha });
      group.add(new THREE.Mesh(r.geo, mat));
    }
    if (group.children.length === 0) { setColoredObject(null); return; }
    const box = new THREE.Box3().setFromObject(group);
    const ctr = new THREE.Vector3();
    box.getCenter(ctr);
    group.position.sub(ctr);
    setColoredObject(group);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && !image) || busy) return;
    const sentImage = image;
    const sentImageName = imageName;
    const refineFromScad = !!scad && !sentImage;
    const userMsg: ChatMsg = { id: nextId(), role: 'user', text: text || T('(이미지)', '(image)'), image: sentImage };
    const aiId = nextId();
    setMessages(m => [...m, userMsg, { id: aiId, role: 'assistant', text: sentImage ? T('이미지 분석 중…', 'Reading the image…') : precise ? T('정밀 피처 설계 중…', 'Planning precise features…') : T('설계 중…', 'Designing…'), status: 'thinking' }]);
    setInput(''); setImage(null); setImageName(null); setBusy(true);

    // ── PRECISE (expert) path: NL → exact feature program → solid ───────────
    if (precise && !sentImage) {
      try {
        const res = await fetch('/api/nexyfab/cad-feature-program', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ prompt: text, modelId, ...(programRef.current ? { previousProgram: programRef.current } : {}) }),
        });
        const data = await res.json().catch(() => ({})) as { part?: string; features?: unknown[]; error?: string };
        if (!res.ok || !Array.isArray(data.features) || data.features.length === 0) {
          setAiMsg(aiId, T('정밀 부품 설계에 실패했어요. 치수를 포함해 다시 설명해 주세요 (예: 100×80×10 플레이트, 중앙 30mm 구멍, M5 4개 PCD60).', 'Could not plan the part — describe it with dimensions (e.g. a 100×80×10 plate, 30mm centre hole, 4× M5 on PCD60).'), 'error');
          return;
        }
        const program = { part: data.part, features: data.features } as FeatureProgram;
        programRef.current = program;
        const code = emitScadFromProgram(program);
        setAiMsg(aiId, T('렌더링…', 'Rendering…'), 'thinking');
        setScad(code); setColoredObject(null); setMobileTab('3d'); setGenCount(c => c + 1);
        const r = await renderScad(code);
        if (!r.ok) {
          setAiMsg(aiId, r.auth
            ? T('3D 미리보기·STL은 무료 로그인이 필요합니다.', '3D preview & STL need a free login.')
            : T('렌더링하지 못했어요. 치수를 조금 바꿔 다시 시도해 주세요.', 'Could not render — try adjusting the dimensions and retry.'), 'error');
          return;
        }
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
      } catch (e) {
        setAiMsg(aiId, (e instanceof Error ? e.message : String(e)), 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const body = sentImage
        ? { prompt: text, image: sentImage, freeform: true, modelId }
        : refineFromScad
          ? { prompt: text, freeform: true, previousScad: scad, modelId }
          : { prompt: text, freeform: true, modelId };
      const res = await fetch('/api/nexyfab/scad-intent-from-nl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
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
      if (!res.ok) throw new Error((data as { reason?: string; error?: string }).reason ?? (data as { error?: string }).error ?? `server ${res.status}`);
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
      for (let attempt = 1; !r.ok && r.raw && attempt <= 2; attempt++) {
        setAiMsg(aiId, T('코드 오류를 자동 수정 중…', 'Auto-fixing a code error…'), 'thinking');
        const escalate = attempt >= 2;
        const tooLarge = /too large/i.test(r.raw) || /too large/i.test(r.error ?? '');
        // Code errors (BOSL2 geometry assertions etc.) rarely survive a generic
        // "fix this" pass — the model just reproduces the bug. A from-scratch
        // PLAIN-OpenSCAD rewrite reliably renders, so go straight to it.
        const fixPrompt = tooLarge
          ? `The rendered mesh is too large to return. Shrink the triangle count: set $fn=${escalate ? 20 : 28}, simplify or drop the most detailed cosmetic features, and avoid minkowski() and very large hull() chains. Return the COMPLETE program keeping the same overall shape and the Customizer parameters/groups.`
          : `The program failed to render in OpenSCAD with this error:\n${r.raw.slice(0, 800)}\nFix ONLY what caused the error and return the COMPLETE corrected program. The usual cause is a BOSL2 call (cuboid/cyl/rounding=/attach/anchor/edges) — replace just those with the plain-OpenSCAD equivalent (cube/cylinder/translate/difference/hull), keeping the SAME rounding/fillet intent where easy. CRITICAL: keep EVERY part, its position, size, proportions and the overall design intact — do NOT simplify the model, do NOT turn it into a plain box, do NOT remove parts. Keep the Customizer parameter variables, comments and groups.${escalate ? ' If a part still fails, approximate that one part with a simple primitive but keep all the other parts and the layout.' : ''}`;
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
                setAiMsg(aiId, T(`AI가 형상을 보고 개선 중… (${iter}/${MAX})`, `Looking at the render & refining… (${iter}/${MAX})`), 'thinking');
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

  // Route a picked/dropped/pasted file to the right handler.
  const onPickFile = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (file.type.startsWith('image/')) onPickImage(file);
    else if (/\.stl$/i.test(file.name) || /stl/i.test(file.type)) onPickStl(file);
  }, [onPickImage, onPickStl]);

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
            if (text.includes('ISO-10303-21')) { save(text); return; }
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };
  const dragProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (!dragOver) setDragOver(true); },
    onDragLeave: (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); onPickFile(e.dataTransfer?.files?.[0]); },
  };

  const ImagePill = () => image ? (
    <span className="flex items-center gap-1.5 text-[11px] text-emerald-200/90 bg-emerald-900/30 rounded px-1.5 py-1">
      <img src={image} alt="" className="w-7 h-7 object-cover rounded" />
      <span className="truncate max-w-[120px]">{imageName}</span>
      <button onClick={() => { setImage(null); setImageName(null); }} className="st-text-2 hover:opacity-70">✕</button>
    </span>
  ) : null;

  const renderParam = (p: (typeof customizer)[number]) => {
    const label = p.description || p.name;
    if (p.kind === 'bool') return (
      <label key={p.name} className="flex items-center gap-2 text-[11px] st-text-2">
        <input type="checkbox" checked={p.value as boolean} onChange={e => onCustomizer(p.name, e.target.checked)} className="accent-emerald-500" />
        <span className="truncate" title={p.name}>{label}</span>
      </label>
    );
    if (p.kind === 'slider') { const v = p.value as number; return (
      <div key={p.name} className="flex flex-col gap-0.5">
        <div className="flex justify-between text-[11px] st-text-2"><span className="truncate" title={p.name}>{label}</span><span className="tabular-nums st-text">{(p.step ?? 1) < 1 ? v.toFixed(1) : Math.round(v)}</span></div>
        <input type="range" min={p.min} max={p.max} step={p.step} value={v} onChange={e => onCustomizer(p.name, parseFloat(e.target.value))} className="w-full accent-emerald-500" />
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
      {customizer.length === 0 && <div className="text-[11px] st-text-3">{T('조절 가능한 치수가 여기 나타납니다.', 'Adjustable dimensions appear here.')}</div>}
      {grouped.map((g, gi) => (
        <div key={g.name ?? `g${gi}`} className="flex flex-col gap-2">
          {g.name && <div className="text-[10px] uppercase tracking-wide text-emerald-400/70 font-semibold border-b st-bd pb-1">{g.name}</div>}
          {g.params.map(renderParam)}
        </div>
      ))}
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
          {dragOver && <div className="absolute inset-0 z-10 flex items-center justify-center bg-emerald-900/20 text-emerald-300 text-lg font-semibold pointer-events-none">📷 {T('사진을 놓으세요', 'Drop the photo')}</div>}

          {/* Mode toggle + model picker */}
          <div className="flex items-center gap-2 mb-5 flex-wrap justify-center">
            <div className="flex items-center gap-1 st-panel-2 border st-bd rounded-full p-1 text-[12px]">
              <button onClick={() => setPrecise(false)} className={`px-3 py-1 rounded-full font-semibold ${!precise ? 'bg-emerald-600 text-white' : 'st-text-2'}`}>✨ {T('자유형', 'Free-form')}</button>
              <button onClick={() => setPrecise(true)} className={`px-3 py-1 rounded-full font-semibold ${precise ? 'bg-indigo-600 text-white' : 'st-text-2'}`}>📐 {T('정밀', 'Precise')}</button>
            </div>
            <ModelPicker modelId={modelId} onPick={pickModel} isKo={isKo} />
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-center">{greeting}</h1>
          <p className="st-text-2 text-sm mb-6 text-center">{precise
            ? T('치수를 넣어 설명하면 정확한 치수의 부품을 만듭니다 (구멍·면취·필렛·패턴).', 'Describe it with dimensions for an exact part — holes, chamfers, fillets, patterns.')
            : T('말로 설명하거나 사진을 올리면 조절 가능한 3D 모델이 됩니다.', 'Describe it — or drop a photo — to get an adjustable 3D model.')}</p>

          <div className="w-full max-w-2xl st-panel-2 border st-bd rounded-2xl p-3 focus-within:border-emerald-500/60 shadow-xl">
            {image && <div className="mb-2"><ImagePill /></div>}
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown}
              placeholder={T('예: 바퀴 4개 달린 장난감 자동차…  (사진은 끌어다 놓거나 Ctrl+V 붙여넣기)', 'e.g. a toy car with four wheels…  (drag or paste a photo with Ctrl+V)')}
              rows={2} autoFocus className="w-full bg-transparent text-base resize-none focus:outline-none px-1" />
            <div className="flex items-center justify-between mt-2">
              <label className="flex items-center gap-1.5 text-[12px] text-emerald-300 hover:text-emerald-200 cursor-pointer border border-emerald-800/60 hover:border-emerald-600 rounded-lg px-2.5 py-1.5">
                <input type="file" accept="image/*,.stl,model/stl" className="hidden" onChange={e => onPickFile(e.target.files?.[0])} />
                📷 {T('사진·STL 올리기', 'Upload photo / STL')}
              </label>
              <button onClick={() => void send()} disabled={busy || (!input.trim() && !image)} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg px-5 py-1.5 text-sm font-semibold">
                {busy ? T('생성 중…', 'Working…') : T('생성하기', 'Generate')}
              </button>
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
    <button onClick={() => setMobileTab(id)} className={`flex-1 py-2 text-[12px] font-semibold ${mobileTab === id ? 'text-emerald-400 border-t-2 border-emerald-400 -mt-px' : 'st-text-3'}`}>{label}</button>
  );
  return (
    <div className={`flex h-dvh w-full st-bg ${dragOver ? 'ring-2 ring-emerald-500 ring-inset' : ''}`} {...dragProps}>
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
                <div className={`rounded-xl px-3 py-2 text-[12px] whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-emerald-700/40 border border-emerald-700/40' : m.status === 'error' ? 'bg-red-900/30 border border-red-800/40 text-red-200' : 'st-panel-2 border st-bd'}`}>
                  {m.image && <img src={m.image} alt="" className="w-full max-h-32 object-contain rounded mb-1.5 bg-black/30" />}
                  {m.status === 'thinking' ? <span className="inline-flex items-center gap-1.5 text-emerald-300"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />{m.text}</span> : m.text}
                  {m.thumb && <img src={m.thumb} alt="" className="w-full max-h-28 object-contain rounded mt-1.5 bg-black/20 cursor-pointer" onClick={() => setMobileTab('3d')} title={T('3D 보기', 'View in 3D')} />}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="border-t st-bd p-2.5 flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex items-center gap-0.5 st-panel-2 border st-bd rounded-full p-0.5 text-[11px]">
                <button onClick={() => setPrecise(false)} className={`px-2 py-0.5 rounded-full font-semibold ${!precise ? 'bg-emerald-600 text-white' : 'st-text-2'}`}>✨ {T('자유형', 'Free')}</button>
                <button onClick={() => setPrecise(true)} className={`px-2 py-0.5 rounded-full font-semibold ${precise ? 'bg-indigo-600 text-white' : 'st-text-2'}`}>📐 {T('정밀', 'Precise')}</button>
              </div>
              <ModelPicker modelId={modelId} onPick={pickModel} isKo={isKo} compact />
            </div>
            {image && <ImagePill />}
            <div className="flex items-end gap-1.5 st-panel-2 border st-bd rounded-xl px-2 py-1.5 focus-within:border-emerald-500/60">
              <label className="cursor-pointer text-base shrink-0 leading-none" title={T('사진 첨부', 'Attach photo')}>
                <input type="file" accept="image/*,.stl,model/stl" className="hidden" onChange={e => onPickFile(e.target.files?.[0])} />📎
              </label>
              <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown}
                placeholder={T('계속 수정해보세요 (예: 더 높게)…', 'Keep iterating (e.g. make it taller)…')} rows={1}
                className="flex-1 bg-transparent text-sm resize-none focus:outline-none max-h-28 py-0.5" />
              <button onClick={() => void send()} disabled={busy || (!input.trim() && !image)} className="shrink-0 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg w-7 h-7 flex items-center justify-center" title={T('보내기', 'Send')}>↑</button>
            </div>
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
              <div className="text-emerald-300 text-sm">🔒 {T('3D 미리보기·STL은 로그인이 필요합니다', '3D preview & STL need a (free) login')}</div>
              <a href={`/${lang}/login`} className="bg-emerald-600 hover:bg-emerald-500 text-white rounded px-4 py-1.5 text-xs font-semibold">{T('무료 로그인', 'Free login')}</a>
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
              <div className="w-9 h-9 border-2 border-emerald-500/25 border-t-emerald-400 rounded-full animate-spin" />
              <span className="text-emerald-300 text-sm">{geometry ? T('업데이트 중…', 'Updating…') : T('생성 중…', 'Working…')}</span>
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
