'use client';

import { useState } from 'react';

interface NetResult {
  ok: boolean;
  dims?: { W: number; D: number; H: number; type?: string; roof?: string };
  layers?: { CUT: number; FOLD: number; TAB: number };
  bytes?: number;
  svg?: string;
  dxf?: string;
  error?: string;
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

  const onPickImage = (file: File | null) => {
    if (!file) { setImage(null); setImageName(''); return; }
    const reader = new FileReader();
    reader.onload = () => { setImage(typeof reader.result === 'string' ? reader.result : null); setImageName(file.name); };
    reader.readAsDataURL(file);
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
        body: JSON.stringify({ prompt: text, ...(image ? { image } : {}) }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, error: '생성에 실패했어요. 다시 시도해 주세요.' });
    } finally {
      setLoading(false);
    }
  };

  const downloadDxf = () => {
    if (!result?.dxf) return;
    const blob = new Blob([result.dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `papercraft-${result.dims?.type ?? 'net'}.dxf`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 20px' }}>
        <p style={{ color: '#388bfd', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px' }}>
          NexyFab · Papercraft
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: '0 0 8px' }}>말 또는 사진으로 건물 → 레이저컷 전개도</h1>
        <p style={{ color: '#8b949e', fontSize: 15, margin: '0 0 28px' }}>
          건물·방을 글로 설명하거나 사진을 올리면 종이/하드보드지 키트용 전개도(칼선·접는선·탭)를 자동 생성하고 DXF로 내보냅니다.
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
            style={{ padding: '12px 22px', borderRadius: 8, border: 'none', background: loading ? '#1f2937' : '#2563eb', color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}
          >
            {loading ? '생성 중…' : '전개도 생성'}
          </button>
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
                <img src={image} alt="" style={{ height: 36, borderRadius: 4, border: '1px solid #30363d' }} />
                {imageName} <button onClick={() => onPickImage(null)} style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 13 }}>✕ 제거</button>
              </span>
            : <span style={{ fontSize: 13, color: '#8b949e' }}>사진을 올리면 AI가 치수·지붕·형태를 추정해 전개도를 만듭니다 (글 설명은 선택).</span>}
        </div>

        {result && result.ok && result.svg && (
          <div style={{ border: '1px solid #30363d', borderRadius: 12, padding: 20, background: '#161b22' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13, color: '#8b949e' }}>
                {result.dims && <>치수 {result.dims.W}×{result.dims.D}×{result.dims.H}mm · {result.dims.type === 'room' ? '방(개방)' : result.dims.roof === 'gable' ? '박공지붕' : '평지붕'}</>}
                {result.layers && <> · 칼선 {result.layers.CUT} / 접는선 {result.layers.FOLD} / 탭 {result.layers.TAB}</>}
              </div>
              <button onClick={downloadDxf} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #238636', background: '#238636', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                ⬇ DXF 다운로드
              </button>
            </div>
            <div style={{ background: '#fff', borderRadius: 8, padding: 16 }} dangerouslySetInnerHTML={{ __html: result.svg }} />
            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#8b949e' }}>
              <span><span style={{ color: '#dc2626' }}>━</span> 칼선(Cut)</span>
              <span><span style={{ color: '#2563eb' }}>┄</span> 접는선(Fold)</span>
              <span><span style={{ color: '#16a34a' }}>━</span> 조립 탭(Tab)</span>
            </div>
          </div>
        )}
        {result && !result.ok && (
          <div style={{ color: '#f85149', fontSize: 14 }}>{result.error ?? '생성에 실패했어요.'}</div>
        )}
      </div>
    </div>
  );
}
