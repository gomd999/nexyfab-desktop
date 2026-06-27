'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { Model3D } from './Preview3D';

// 3D preview is client-only (WebGL) — lazy-load so it never blocks the page.
const Preview3D = dynamic(() => import('./Preview3D'), { ssr: false, loading: () => <div style={{ color: '#8b949e', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>3D 로딩…</div> });

interface NetResult {
  ok: boolean;
  dims?: { W: number; D: number; H: number; type?: string; roof?: string; gableHeight?: number };
  layers?: { CUT: number; FOLD: number; TAB: number };
  steps?: string[];
  faceCount?: number;
  pieces?: number;
  layerCount?: number;
  overlaps?: number;
  thick?: boolean;
  thickness?: number;
  bytes?: number;
  svg?: string;
  dxf?: string;
  error?: string;
}

/** Parse binary or ASCII STL → flat [x,y,z,…] vertex positions. */
function parseStlPositions(buf: ArrayBuffer): number[] {
  const dv = new DataView(buf);
  const triCount = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (triCount > 0 && 84 + triCount * 50 === buf.byteLength) {
    const pos: number[] = []; let off = 84;
    for (let i = 0; i < triCount; i++) {
      off += 12; // skip normal
      for (let v = 0; v < 3; v++) { pos.push(dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true)); off += 12; }
      off += 2;
    }
    return pos;
  }
  const txt = new TextDecoder().decode(new Uint8Array(buf));
  const pos: number[] = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) pos.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  return pos;
}

const EXAMPLES = [
  '박공지붕 집, 가로 50 세로 35',
  '2층 상가 건물, 가로 40 세로 25',
  '실내 방, 가로 60 세로 45 높이 30',
  '선물 상자, 50 x 50 x 40',
];

export default function PapercraftDemoPage() {
  const [prompt, setPrompt] = useState('박공지붕 집, 가로 50 세로 35');
  const [result, setResult] = useState<NetResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [thickness, setThickness] = useState(0); // material thickness mm; 0 = thin paper
  const [model3d, setModel3d] = useState<Model3D | null>(null); // finished-product 3D preview

  const onPickImage = (file: File | null) => {
    if (!file) { setImage(null); setImageName(''); return; }
    const reader = new FileReader();
    reader.onload = () => { setImage(typeof reader.result === 'string' ? reader.result : null); setImageName(file.name || '붙여넣은 이미지'); };
    reader.readAsDataURL(file);
  };

  // Paste an image from the clipboard (Ctrl+V) → use it as the AI input.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const f = items[i].getAsFile();
          if (f) onPickImage(f);
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // AI → arbitrary object: text/image → AI OpenSCAD → mesh → slice → 3D + net.
  // Chains the existing endpoints client-side (each keeps its own gating).
  const onAiGenerate = async () => {
    const text = prompt.trim();
    if (!text && !image) return;
    setLoading(true);
    setResult(null); setModel3d(null);
    try {
      // 1) text/image → AI OpenSCAD (freeform; guest-limited)
      const r1 = await fetch('/api/nexyfab/scad-intent-from-nl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, ...(image ? { image } : {}), freeform: true }),
      });
      const j1 = await r1.json().catch(() => ({})) as { scad?: string; error?: string; code?: string };
      if (!r1.ok || !j1.scad) {
        setResult({ ok: false, error: r1.status === 401 || j1.code === 'GUEST_LIMIT'
          ? 'AI 생성 무료 한도를 다 썼어요 — 로그인하면 계속 만들 수 있어요.'
          : (j1.error || 'AI 3D 생성에 실패했어요. 다른 설명으로 시도해 보세요.') });
        return;
      }
      // 2) OpenSCAD → STL mesh
      const r2 = await fetch('/api/nexyfab/openscad-render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scad: j1.scad, format: 'stl' }),
      });
      const j2 = await r2.json().catch(() => ({})) as { dataBase64?: string; error?: string };
      if (!r2.ok || !j2.dataBase64) { setResult({ ok: false, error: '3D 렌더에 실패했어요.' }); return; }
      const stlBuf = Uint8Array.from(atob(j2.dataBase64), c => c.charCodeAt(0)).buffer;
      const positions = parseStlPositions(stlBuf);
      if (positions.length < 9) { setResult({ ok: false, error: '생성된 3D를 읽지 못했어요.' }); return; }
      setModel3d({ kind: 'mesh', positions });
      // 3) mesh → stacked slice (robust for arbitrary / curved objects)
      const r3 = await fetch('/api/nexyfab/papercraft-slice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, ...(thickness > 0 ? { thickness } : { thickness: 5 }) }),
      });
      setResult(await r3.json());
    } catch {
      setResult({ ok: false, error: 'AI 생성 중 오류가 발생했어요.' });
    } finally { setLoading(false); }
  };

  const generate = async (p?: string) => {
    const text = (p ?? prompt).trim();
    // Allow image-only generation (a photo drives the spec). Text or image required.
    if (!text && !image) return;
    if (p) setPrompt(p);
    setLoading(true);
    try {
      const res = await fetch('/api/nexyfab/papercraft-net', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, ...(image ? { image } : {}), ...(thickness > 0 ? { thickness } : {}) }),
      });
      const j = await res.json() as NetResult;
      setResult(j);
      if (j.ok && j.dims) setModel3d({ kind: 'box', W: j.dims.W, D: j.dims.D, H: j.dims.H, roof: (j.dims.roof as 'flat' | 'gable' | 'open') ?? 'flat', gableH: j.dims.gableHeight });
    } catch {
      setResult({ ok: false, error: '생성에 실패했어요. 다시 시도해 주세요.' });
    } finally {
      setLoading(false);
    }
  };

  // Gap 1: upload an arbitrary 3D model (STL) → generic mesh unfold → net.
  const onPickStl = async (file: File | null) => {
    if (!file) return;
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const positions = parseStlPositions(buf);
      if (positions.length < 9) { setResult({ ok: false, error: 'STL을 읽지 못했어요 (삼각형이 없어요).' }); return; }
      setModel3d({ kind: 'mesh', positions });
      const res = await fetch('/api/nexyfab/papercraft-unfold', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, ...(thickness > 0 ? { thickness } : {}) }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, error: '펼치기에 실패했어요. 다른 모델로 시도해 주세요.' });
    } finally { setLoading(false); }
  };

  // Slice an uploaded 3D model (STL) into stacked foam-board layers — works for
  // curved / high-poly models that can't fold.
  const onPickStlSlice = async (file: File | null) => {
    if (!file) return;
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const positions = parseStlPositions(buf);
      if (positions.length < 9) { setResult({ ok: false, error: 'STL을 읽지 못했어요 (삼각형이 없어요).' }); return; }
      setModel3d({ kind: 'mesh', positions });
      const res = await fetch('/api/nexyfab/papercraft-slice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, ...(thickness > 0 ? { thickness } : { thickness: 5 }) }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, error: '슬라이스에 실패했어요. 다른 모델로 시도해 주세요.' });
    } finally { setLoading(false); }
  };

  const downloadDxf = () => {
    if (!result?.dxf) return;
    const blob = new Blob([result.dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `papercraft-${result.dims?.type ?? 'net'}.dxf`; a.click();
    URL.revokeObjectURL(url);
  };

  // Print/Save-as-PDF an assembly guide: the net drawing + numbered fold/glue
  // steps, in a clean print layout (browser "Save as PDF" yields the manual).
  const printGuide = () => {
    if (!result?.svg || !result.steps) return;
    const d = result.dims;
    const w = window.open('', '_blank');
    if (!w) return;
    const stepsHtml = result.steps.map((s) => `<li>${s}</li>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>조립 가이드</title>
      <style>body{font-family:system-ui,sans-serif;margin:32px;color:#111}h1{font-size:22px;margin:0 0 4px}
      .meta{color:#666;font-size:13px;margin-bottom:20px}.net{border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:20px}
      ol{font-size:15px;line-height:1.9;padding-left:22px}li{margin-bottom:4px}
      .legend{font-size:12px;color:#666;margin-top:8px}@media print{button{display:none}}</style></head>
      <body><h1>종이 키트 조립 가이드</h1>
      <div class="meta">${d ? `치수 ${d.W}×${d.D}×${d.H}mm · ${d.type === 'room' ? '방(개방)' : d.roof === 'gable' ? '박공지붕' : '평지붕'}` : ''}</div>
      <div class="net">${result.svg}</div>
      <div class="legend">빨강=칼선(자르기) · 파랑=접는선(스코어) · 초록=조립 탭(풀칠)</div>
      <h2 style="font-size:16px;margin:18px 0 6px">조립 순서</h2>
      <ol>${stepsHtml}</ol>
      <button onclick="window.print()" style="margin-top:16px;padding:10px 18px;font-size:14px">🖨 인쇄 / PDF로 저장</button>
      </body></html>`);
    w.document.close();
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 20px' }}>
        <p style={{ color: '#388bfd', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px' }}>
          NexyFab · Papercraft
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: '0 0 8px' }}>말 또는 사진으로 건물 → 레이저컷 전개도</h1>
        <p style={{ color: '#8b949e', fontSize: 15, margin: '0 0 28px' }}>
          건물은 「🏠 건물 전개도」, 자동차·동물·캐릭터 등 무엇이든은 「🤖 AI로 만들기」로 — 글·사진(Ctrl+V 붙여넣기 가능)·STL을 넣으면 3D 완성 미리보기 + 2D 도면(칼선·접는선·탭)을 함께 보고 레이저컷 DXF로 내보냅니다.
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void generate(); }}
            placeholder="예: 박공지붕 집, 가로 50 세로 35"
            style={{ flex: '1 1 320px', padding: '12px 14px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 15 }}
          />
          <button
            onClick={() => void generate()}
            disabled={loading}
            title="건물·방·박스 (빠름)"
            style={{ padding: '12px 18px', borderRadius: 8, border: 'none', background: loading ? '#1f2937' : '#2563eb', color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}
          >
            {loading ? '생성 중…' : '🏠 건물 전개도'}
          </button>
          <button
            onClick={() => void onAiGenerate()}
            disabled={loading}
            title="자동차·동물·캐릭터 등 무엇이든 (AI 3D → 적층 슬라이스)"
            style={{ padding: '12px 18px', borderRadius: 8, border: 'none', background: loading ? '#1f2937' : 'linear-gradient(90deg,#7c3aed,#2563eb)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}
          >
            {loading ? 'AI 생성 중… (최대 1분)' : '🤖 AI로 만들기'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#8b949e' }}>재료 두께</span>
          {[{ v: 0, l: '얇은 종이' }, { v: 1, l: '두꺼운 종이' }, { v: 3, l: '우드락 3mm' }, { v: 5, l: '우드락 5mm' }].map(o => (
            <button key={o.v} onClick={() => setThickness(o.v)}
              style={{ padding: '4px 12px', borderRadius: 16, border: `1px solid ${thickness === o.v ? '#2563eb' : '#30363d'}`, background: thickness === o.v ? '#13294d' : '#161b22', color: thickness === o.v ? '#cfe1ff' : '#8b949e', fontSize: 12, cursor: 'pointer' }}>
              {o.l}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {EXAMPLES.map(ex => (
            <button key={ex} onClick={() => void generate(ex)} disabled={loading}
              style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontSize: 13, cursor: 'pointer' }}>
              {ex}
            </button>
          ))}
        </div>

        {/* Photo → paper kit: upload a building/room photo, vision estimates the spec. */}
        <div style={{ border: '1px dashed #30363d', borderRadius: 10, padding: 14, marginBottom: 28, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 14, cursor: 'pointer' }}>
            📷 건물·실내 사진 업로드
            <input type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => onPickImage(e.target.files?.[0] ?? null)} />
          </label>
          {image
            ? <span style={{ fontSize: 13, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" style={{ height: 36, borderRadius: 4, border: '1px solid #30363d' }} />
                {imageName} <button onClick={() => onPickImage(null)} style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 13 }}>✕ 제거</button>
              </span>
            : <span style={{ fontSize: 13, color: '#8b949e' }}>사진을 올리거나 <b>Ctrl+V로 붙여넣기</b> → 「🏠 건물 전개도」(건물 추정) 또는 「🤖 AI로 만들기」(무엇이든 3D)로 사용.</span>}
        </div>

        {/* Gap 1: generic 3D model → mesh unfold. */}
        <div style={{ border: '1px dashed #30363d', borderRadius: 10, padding: 14, marginBottom: 28, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 14, cursor: 'pointer' }}>
            🧊 STL 펼치기
            <input type="file" accept=".stl,model/stl" style={{ display: 'none' }}
              onChange={e => void onPickStl(e.target.files?.[0] ?? null)} />
          </label>
          <label style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 14, cursor: 'pointer' }}>
            🥞 STL 적층 슬라이스
            <input type="file" accept=".stl,model/stl" style={{ display: 'none' }}
              onChange={e => void onPickStlSlice(e.target.files?.[0] ?? null)} />
          </label>
          <span style={{ fontSize: 13, color: '#8b949e' }}>펼치기=저폴리 접기 / 적층 슬라이스=곡면·고폴리 모델을 층으로 잘라 우드락에 쌓기 (두께 선택 반영).</span>
        </div>

        {result && result.ok && result.svg && (
          <div style={{ border: '1px solid #30363d', borderRadius: 12, padding: 20, background: '#161b22' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13, color: '#8b949e' }}>
                {result.dims && <>치수 {result.dims.W}×{result.dims.D}×{result.dims.H}mm · {result.dims.type === 'room' ? '방(개방)' : result.dims.roof === 'gable' ? '박공지붕' : '평지붕'}</>}
                {typeof result.faceCount === 'number' && <>면 {result.faceCount}개</>}
                {typeof result.pieces === 'number' && result.pieces > 1 && <> · 조각 {result.pieces}개</>}
                {typeof result.layerCount === 'number' && <>적층 {result.layerCount}장</>}
                {result.layers && <> · 칼선 {result.layers.CUT} / 접는선 {result.layers.FOLD} / 탭 {result.layers.TAB}</>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={printGuide} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  🖨 조립 가이드 (PDF)
                </button>
                <button onClick={downloadDxf} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #238636', background: '#238636', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  ⬇ DXF 다운로드
                </button>
              </div>
            </div>
            {result.thick && (
              <div style={{ background: '#12243a', border: '1px solid #1a5a8a', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#74b9f0' }}>
                🧱 두꺼운 보드({result.thickness}mm)는 접기 어렵습니다 — 면을 따로 잘라 탭/풀로 조립하거나, 적층(레이어) 방식을 권장합니다. 탭은 두께에 맞춰 넓혔습니다.
              </div>
            )}
            {typeof result.overlaps === 'number' && result.overlaps > 0 && (
              <div style={{ background: '#3a2a12', border: '1px solid #8a6d1a', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#f0c674' }}>
                ⚠ 일부 면이 겹쳐서 펼쳐졌어요 ({result.overlaps}개). 저폴리 모델이 더 깔끔하게 펼쳐집니다 — 겹친 부분은 솔기를 나눠 수동 보정이 필요할 수 있어요.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: model3d ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr', gap: 12 }}>
              {model3d && (
                <div style={{ background: '#0d1117', borderRadius: 8, height: 340, border: '1px solid #30363d', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 8, left: 10, zIndex: 1, fontSize: 11, color: '#8b949e', pointerEvents: 'none' }}>🧊 3D 완성 미리보기 · 드래그로 회전</div>
                  <Preview3D model={model3d} />
                </div>
              )}
              <div style={{ background: '#fff', borderRadius: 8, padding: 16, position: 'relative' }}>
                <div style={{ position: 'absolute', top: 6, left: 10, fontSize: 11, color: '#999', pointerEvents: 'none' }}>📐 2D 도면 (칼선·접는선·탭)</div>
                <div dangerouslySetInnerHTML={{ __html: result.svg }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#8b949e' }}>
              <span><span style={{ color: '#dc2626' }}>━</span> 칼선(Cut)</span>
              <span><span style={{ color: '#2563eb' }}>┄</span> 접는선(Fold)</span>
              <span><span style={{ color: '#16a34a' }}>━</span> 조립 탭(Tab)</span>
            </div>
            {result.steps && result.steps.length > 0 && (
              <div style={{ marginTop: 18, borderTop: '1px solid #30363d', paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 8 }}>📋 조립 순서</div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#c9d1d9', lineHeight: 1.8 }}>
                  {result.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            )}
          </div>
        )}
        {result && !result.ok && (
          <div style={{ color: '#f85149', fontSize: 14 }}>{result.error ?? '생성에 실패했어요.'}</div>
        )}
      </div>
    </div>
  );
}
