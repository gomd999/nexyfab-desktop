'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

const SheetMetal3D = dynamic(() => import('./SheetMetal3D'), { ssr: false });

interface Bend { edge: string; angle: number; height: number; bendAllowance: number; bendDeduction: number; flangeFlat: number }
interface FlatResult {
  ok: boolean;
  fromPrompt?: boolean;
  base?: { W: number; L: number; thickness: number; bendRadius: number; kFactor: number };
  blank?: { width: number; length: number };
  bends?: Bend[];
  bytes?: number;
  svg?: string;
  dxf?: string;
  error?: string;
}

const EXAMPLES = [
  'L 브래킷, 100x60 두께 2, 뒤쪽 30mm 플랜지',
  'U 채널, 80x50 두께 1.5, 양옆 25mm',
  '전장 박스 트레이, 120x80 두께 2, 4면 20mm',
  '2mm 판금, 가로 90 세로 90, 앞 40mm 플랜지',
];

const EDGE_KO: Record<string, string> = { front: '앞', back: '뒤', left: '좌', right: '우' };

export default function SheetMetalDemoPage() {
  const [prompt, setPrompt] = useState('L 브래킷, 100x60 두께 2, 뒤쪽 30mm 플랜지');
  const [result, setResult] = useState<FlatResult | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async (p?: string) => {
    const text = (p ?? prompt).trim();
    if (!text) return;
    if (p) setPrompt(p);
    setLoading(true);
    try {
      const res = await fetch('/api/nexyfab/sheetmetal-flat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, error: '생성에 실패했어요. 다시 시도해 주세요.' });
    } finally {
      setLoading(false);
    }
  };

  const [stepBusy, setStepBusy] = useState(false);

  const downloadDxf = () => {
    if (!result?.dxf) return;
    const blob = new Blob([result.dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'nexyfab-sheetmetal.dxf'; a.click();
    URL.revokeObjectURL(url);
  };

  // Folded 3D B-rep STEP — the part as a real CAD model (re-opens in the modeler
  // / SolidWorks / Fusion, feeds FEA & quoting), not just a flat DXF.
  const fetchStep = async (): Promise<string | null> => {
    if (!result?.base || !result.bends) return null;
    const res = await fetch('/api/nexyfab/sheetmetal-step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width: result.base.W, length: result.base.L, thickness: result.base.thickness, bendRadius: result.base.bendRadius,
        flanges: result.bends.map(b => ({ edge: b.edge, height: b.height, angle: b.angle })),
      }),
    });
    return res.ok ? res.text() : null;
  };

  const downloadStep = async () => {
    if (stepBusy) return;
    setStepBusy(true);
    try {
      const text = await fetchStep();
      if (!text) { alert('STEP 생성에 실패했어요.'); return; }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/step' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'nexyfab-sheetmetal.step'; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('STEP 생성에 실패했어요.'); }
    finally { setStepBusy(false); }
  };

  // One-click handoff: stash the folded STEP and open the modeler, which imports
  // it on load (→ analysable part, FEA / DFM / quote). NOTE: a native-flange
  // handoff (editable flange features) was attempted but the flange feature does
  // not apply cleanly in the programmatic handoff context (works via the Sheet
  // Metal ribbon though) — deferred. The STEP-mesh path is the reliable one.
  // Stash the parametric spec and open the modeler, which rebuilds it as NATIVE
  // editable flange features (height/angle stay editable, Flatten works).
  const openInModeler = () => {
    if (!result?.base || !result.bends) return;
    try {
      sessionStorage.setItem('nexyfab:sheetmetal-handoff-spec', JSON.stringify({
        W: result.base.W, L: result.base.L, T: result.base.thickness, bendRadius: result.base.bendRadius,
        flanges: result.bends.map(b => ({ edge: b.edge, height: b.height, angle: b.angle })),
      }));
      const lang = window.location.pathname.split('/')[1] || 'ko';
      window.location.href = `/${lang}/shape-generator?mode=expert`;
    } catch { alert('모델러 열기에 실패했어요.'); }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '48px 20px' }}>
        <p style={{ color: '#ea580c', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px' }}>
          NexyFab · Sheet Metal
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: '0 0 8px' }}>말로 판금 부품 → 굽힘보정 전개도</h1>
        <p style={{ color: '#8b949e', fontSize: 15, margin: '0 0 28px', lineHeight: 1.6 }}>
          판금 부품을 글로 설명하면 <b style={{ color: '#e6edf3' }}>굽힘보정(K-factor)</b>이 적용된 레이저/펀치용 전개도(칼선·굽힘선)와
          굽힘표를 자동 생성하고 DXF로 내보냅니다. 블랭크 치수는 단순 합이 아니라 <b style={{ color: '#e6edf3' }}>굽힘 공제만큼 보정</b>됩니다.
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void generate(); }}
            placeholder="예: L 브래킷, 100x60 두께 2, 뒤쪽 30mm 플랜지"
            style={{ flex: '1 1 320px', padding: '12px 14px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 15 }}
          />
          <button
            onClick={() => void generate()}
            disabled={loading}
            style={{ padding: '12px 22px', borderRadius: 8, border: 'none', background: loading ? '#1f2937' : '#ea580c', color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}
          >
            {loading ? '생성 중…' : '전개도 생성'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
          {EXAMPLES.map(ex => (
            <button key={ex} onClick={() => void generate(ex)} disabled={loading}
              style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontSize: 13, cursor: 'pointer' }}>
              {ex}
            </button>
          ))}
        </div>

        {result && result.ok && result.svg && (
          <div style={{ border: '1px solid #30363d', borderRadius: 12, padding: 20, background: '#161b22' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13, color: '#8b949e' }}>
                {result.base && <>본체 {result.base.W}×{result.base.L}×{result.base.thickness}mm · R{result.base.bendRadius} · K{result.base.kFactor}</>}
                {result.blank && <> · <b style={{ color: '#e6edf3' }}>블랭크 {result.blank.width}×{result.blank.length}mm</b></>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => void openInModeler()} disabled={stepBusy} title="접힌 부품을 모델러로 — FEA·DFM·견적"
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: stepBusy ? '#1f2937' : '#2563eb', color: '#fff', fontSize: 14, fontWeight: 700, cursor: stepBusy ? 'default' : 'pointer' }}>
                  {stepBusy ? '여는 중…' : '🧊 모델러에서 열기'}
                </button>
                <button onClick={() => void downloadStep()} disabled={stepBusy} title="접힌 3D 부품을 STEP으로 — 모델러/SolidWorks에서 열림"
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ea580c', background: 'transparent', color: '#ea580c', fontSize: 14, fontWeight: 700, cursor: stepBusy ? 'default' : 'pointer' }}>
                  {stepBusy ? '…' : '⬇ 3D STEP'}
                </button>
                <button onClick={downloadDxf} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #238636', background: '#238636', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  ⬇ DXF 전개도
                </button>
              </div>
            </div>
            {result.base && result.bends && result.bends.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#8b949e', marginBottom: 8, letterSpacing: '0.05em' }}>
                  3D 폴드 미리보기 <span style={{ fontWeight: 400, color: '#6e7681' }}>· 드래그하여 회전</span>
                </div>
                <SheetMetal3D base={result.base} bends={result.bends} />
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8b949e', marginBottom: 8, letterSpacing: '0.05em' }}>전개도 (FLAT PATTERN)</div>
            <div style={{ background: '#fff', borderRadius: 8, padding: 16 }} dangerouslySetInnerHTML={{ __html: result.svg }} />
            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#8b949e' }}>
              <span><span style={{ color: '#dc2626' }}>━</span> 칼선(Cut)</span>
              <span><span style={{ color: '#ea580c' }}>┄</span> 굽힘선(Bend)</span>
            </div>

            {result.bends && result.bends.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#8b949e', marginBottom: 8, letterSpacing: '0.05em' }}>굽힘표 (BEND TABLE)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#6e7681', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>플랜지</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>각도</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>높이</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>굽힘여유(BA)</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>굽힘공제(BD)</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>평면부</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.bends.map((bd, i) => (
                      <tr key={i} style={{ color: '#c9d1d9' }}>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>{EDGE_KO[bd.edge] ?? bd.edge}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>{bd.angle}°</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>{bd.height}mm</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d', color: '#ea580c' }}>{bd.bendAllowance}mm</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>{bd.bendDeduction}mm</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>{bd.flangeFlat}mm</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: 11, color: '#6e7681', margin: '10px 0 0', lineHeight: 1.6 }}>
                  BA = (θ·π/180)·(R + K·T) · BD = 2·OSSB − BA · 블랭크 = Σ외형 − ΣBD. 절단 블랭크를 굽히면 설계 외형치수가 됩니다.
                </p>
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
