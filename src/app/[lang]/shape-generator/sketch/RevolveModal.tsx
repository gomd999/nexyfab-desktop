'use client';

/**
 * RevolveModal — Phase 2.A standalone modal that lets the user revolve
 * the current sketch profile around an axis line.
 *
 * Architecture:
 *   - Standalone (NOT a wrapper of SolverSketchEditor). Receives the
 *     current sketch state as a prop from the parent
 *     (SolverSketchEditorWithExtrude opens it next to its Extrude modal).
 *   - User specifies the axis as two 2D points (or accepts the `axisHint`
 *     supplied by the parent — typically derived from a selected line).
 *   - Submit POSTs to /api/revolve-render (default fetcher) and shows
 *     the SCAD source, PNG previews, and an optional STL viewer.
 *
 * Test surface (data-testids — all prefixed solver-revolve-):
 *   solver-revolve-modal,
 *   solver-revolve-axis-{a|b}-{x|y}-input,
 *   solver-revolve-use-hint-button (only when axisHint supplied),
 *   solver-revolve-angle-input, solver-revolve-mode-select,
 *   solver-revolve-submit, solver-revolve-cancel,
 *   solver-revolve-scad-preview, solver-revolve-png-preview-{idx},
 *   solver-revolve-error.
 */

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { AxisLine2D, RevolveMode } from '@/lib/cad/revolveProfile';

// StlViewer pulls in Three.js; dynamic-loaded so the sketch editor bundle
// stays small for users who never open the revolve modal.
const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>3D viewer loading…</div>,
});

export type RevolveLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  axisHeading: string;
  axisA: string; axisB: string;
  useHint: string;
  angle: string;
  mode: string;
  add: string; cut: string;
  submit: string; cancel: string;
  rendering: string;
  scadHeading: string;
  pngHeading: string;
  stlHeading: string;
  errorPrefix: string;
}

const dict: Record<RevolveLang, Dict> = {
  ko: {
    modalTitle: '회전 설정', axisHeading: '회전축',
    axisA: '점 A', axisB: '점 B',
    useHint: '선택한 선을 축으로',
    angle: '각도 (°)', mode: '연산',
    add: '추가', cut: '제거',
    submit: '회전', cancel: '취소',
    rendering: '렌더링 중...', scadHeading: 'SCAD 소스', pngHeading: '미리보기', stlHeading: '3D 뷰',
    errorPrefix: '오류',
  },
  en: {
    modalTitle: 'Revolve options', axisHeading: 'Axis',
    axisA: 'Point A', axisB: 'Point B',
    useHint: 'Use selected line as axis',
    angle: 'Angle (°)', mode: 'Mode',
    add: 'Add', cut: 'Cut',
    submit: 'Revolve', cancel: 'Cancel',
    rendering: 'Rendering...', scadHeading: 'SCAD source', pngHeading: 'Preview', stlHeading: '3D view',
    errorPrefix: 'Error',
  },
  ja: {
    modalTitle: '回転設定', axisHeading: '回転軸',
    axisA: '点A', axisB: '点B',
    useHint: '選択した線を軸に',
    angle: '角度 (°)', mode: '操作',
    add: '追加', cut: '除去',
    submit: '回転', cancel: 'キャンセル',
    rendering: 'レンダリング中...', scadHeading: 'SCADソース', pngHeading: 'プレビュー', stlHeading: '3Dビュー',
    errorPrefix: 'エラー',
  },
  zh: {
    modalTitle: '旋转选项', axisHeading: '旋转轴',
    axisA: '点A', axisB: '点B',
    useHint: '将选中线作为轴',
    angle: '角度 (°)', mode: '模式',
    add: '增加', cut: '切除',
    submit: '旋转', cancel: '取消',
    rendering: '渲染中...', scadHeading: 'SCAD源', pngHeading: '预览', stlHeading: '3D视图',
    errorPrefix: '错误',
  },
  es: {
    modalTitle: 'Opciones de revolución', axisHeading: 'Eje',
    axisA: 'Punto A', axisB: 'Punto B',
    useHint: 'Usar línea seleccionada como eje',
    angle: 'Ángulo (°)', mode: 'Modo',
    add: 'Añadir', cut: 'Cortar',
    submit: 'Revolver', cancel: 'Cancelar',
    rendering: 'Renderizando...', scadHeading: 'Fuente SCAD', pngHeading: 'Vista previa', stlHeading: 'Vista 3D',
    errorPrefix: 'Error',
  },
  ar: {
    modalTitle: 'خيارات الدوران', axisHeading: 'المحور',
    axisA: 'النقطة أ', axisB: 'النقطة ب',
    useHint: 'استخدم الخط المحدد كمحور',
    angle: 'الزاوية (°)', mode: 'الوضع',
    add: 'إضافة', cut: 'قص',
    submit: 'دوران', cancel: 'إلغاء',
    rendering: 'جارٍ التصيير...', scadHeading: 'مصدر SCAD', pngHeading: 'معاينة', stlHeading: 'عرض ثلاثي الأبعاد',
    errorPrefix: 'خطأ',
  },
};

interface RenderResult {
  scad: string;
  pngs: { label: string; base64: string }[];
  stl?: string;
}

type RenderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: RenderResult }
  | { status: 'error'; message: string };

export interface RevolveFetcherRequest {
  sketch: SolverViewState;
  axis: AxisLine2D;
  angleDegrees: number;
  mode: RevolveMode;
  includeStl?: boolean;
}

export type RevolveFetcherResponse =
  | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string }
  | { ok: false; code: string; message: string };

export type RevolveFetcher = (req: RevolveFetcherRequest) => Promise<RevolveFetcherResponse>;

const defaultFetcher: RevolveFetcher = async (req) => {
  const res = await fetch('/api/revolve-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
};

export interface RevolveModalProps {
  lang: RevolveLang;
  sketch: SolverViewState;
  /**
   * Optional hint axis from the parent (e.g., a currently selected line in
   * the sketch). When supplied, the "use hint" button populates the inputs.
   */
  axisHint?: AxisLine2D;
  onClose: () => void;
  /** Injectable for tests. Defaults to POST /api/revolve-render. */
  revolveFetcher?: RevolveFetcher;
}

export default function RevolveModal({
  lang,
  sketch,
  axisHint,
  onClose,
  revolveFetcher = defaultFetcher,
}: RevolveModalProps): React.ReactElement {
  const t = dict[lang];

  // Default axis: hint if present, else Y axis (0,0)→(0,10) — a common
  // revolve setup for cup/bottle-style profiles.
  const initial: AxisLine2D = axisHint ?? { a: { x: 0, y: 0 }, b: { x: 0, y: 10 } };
  const [ax, setAx] = useState<string>(String(initial.a.x));
  const [ay, setAy] = useState<string>(String(initial.a.y));
  const [bx, setBx] = useState<string>(String(initial.b.x));
  const [by, setBy] = useState<string>(String(initial.b.y));
  const [angle, setAngle] = useState<string>('360');
  const [mode, setMode] = useState<RevolveMode>('add');
  const [render, setRender] = useState<RenderState>({ status: 'idle' });

  const onUseHint = useCallback(() => {
    if (!axisHint) return;
    setAx(String(axisHint.a.x));
    setAy(String(axisHint.a.y));
    setBx(String(axisHint.b.x));
    setBy(String(axisHint.b.y));
  }, [axisHint]);

  const onSubmit = useCallback(async () => {
    const axN = Number(ax);
    const ayN = Number(ay);
    const bxN = Number(bx);
    const byN = Number(by);
    if (
      !Number.isFinite(axN) || !Number.isFinite(ayN) ||
      !Number.isFinite(bxN) || !Number.isFinite(byN)
    ) {
      setRender({ status: 'error', message: `${t.errorPrefix}: axis coordinates must be numbers` });
      return;
    }
    if (Math.hypot(bxN - axN, byN - ayN) < 1e-9) {
      setRender({ status: 'error', message: `${t.errorPrefix}: axis points are coincident` });
      return;
    }
    const angleN = Number(angle);
    if (!Number.isFinite(angleN) || angleN <= 0 || angleN > 360) {
      setRender({ status: 'error', message: `${t.errorPrefix}: angle must be in (0, 360]` });
      return;
    }
    setRender({ status: 'loading' });
    try {
      const res = await revolveFetcher({
        sketch,
        axis: { a: { x: axN, y: ayN }, b: { x: bxN, y: byN } },
        angleDegrees: angleN,
        mode,
        includeStl: true,
      });
      if (res.ok) {
        setRender({ status: 'ok', result: { scad: res.scad, pngs: res.pngs, stl: res.stl } });
      } else {
        setRender({ status: 'error', message: `${t.errorPrefix}: ${res.message}` });
      }
    } catch (e) {
      setRender({ status: 'error', message: `${t.errorPrefix}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [ax, ay, bx, by, angle, mode, sketch, revolveFetcher, t.errorPrefix]);

  return (
    <div
      data-testid="solver-revolve-modal"
      role="dialog"
      aria-labelledby="solver-revolve-title"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff',
        padding: 20,
        borderRadius: 8,
        maxWidth: 640,
        width: '92%',
        maxHeight: '90vh',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <h3 id="solver-revolve-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t.modalTitle}</h3>

        <fieldset style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #e5e7eb', borderRadius: 4, padding: 8 }}>
          <legend style={{ padding: '0 4px', fontSize: 12, fontWeight: 600 }}>{t.axisHeading}</legend>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: 1 }}>
              {t.axisA} x
              <input
                type="number"
                value={ax}
                onChange={(e) => setAx(e.target.value)}
                data-testid="solver-revolve-axis-a-x-input"
                step="0.1"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: 1 }}>
              {t.axisA} y
              <input
                type="number"
                value={ay}
                onChange={(e) => setAy(e.target.value)}
                data-testid="solver-revolve-axis-a-y-input"
                step="0.1"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: 1 }}>
              {t.axisB} x
              <input
                type="number"
                value={bx}
                onChange={(e) => setBx(e.target.value)}
                data-testid="solver-revolve-axis-b-x-input"
                step="0.1"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: 1 }}>
              {t.axisB} y
              <input
                type="number"
                value={by}
                onChange={(e) => setBy(e.target.value)}
                data-testid="solver-revolve-axis-b-y-input"
                step="0.1"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </label>
          </div>

          {axisHint && (
            <button
              type="button"
              onClick={onUseHint}
              data-testid="solver-revolve-use-hint-button"
              style={{
                padding: '6px 10px',
                fontSize: 12,
                background: '#eff6ff',
                color: '#1d4ed8',
                border: '1px solid #bfdbfe',
                borderRadius: 4,
                cursor: 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              {t.useHint}
            </button>
          )}
        </fieldset>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t.angle}
          <input
            type="range"
            min="1"
            max="360"
            step="1"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            data-testid="solver-revolve-angle-input"
          />
          <div style={{ fontSize: 11, color: '#6b7280' }} data-testid="solver-revolve-angle-readout">
            {angle}°
          </div>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t.mode}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as RevolveMode)}
            data-testid="solver-revolve-mode-select"
            style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
          >
            <option value="add">{t.add}</option>
            <option value="cut">{t.cut}</option>
          </select>
        </label>

        {render.status === 'loading' && (
          <div style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>
            {t.rendering}
          </div>
        )}

        {render.status === 'error' && (
          <div
            data-testid="solver-revolve-error"
            style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, color: '#dc2626', fontSize: 12 }}
          >
            {render.message}
          </div>
        )}

        {render.status === 'ok' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t.scadHeading}</div>
              <pre
                data-testid="solver-revolve-scad-preview"
                style={{
                  padding: 8,
                  background: '#f3f4f6',
                  border: '1px solid #e5e7eb',
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  maxHeight: 200,
                  overflow: 'auto',
                  margin: 0,
                }}
              >
                {render.result.scad}
              </pre>
            </div>
            {render.result.pngs.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t.pngHeading}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {render.result.pngs.map((png, idx) => (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      { }
                      <img
                        data-testid={`solver-revolve-png-preview-${idx}`}
                        src={`data:image/png;base64,${png.base64}`}
                        alt={png.label}
                        style={{ maxWidth: 240, border: '1px solid #d1d5db', borderRadius: 4 }}
                      />
                      <div style={{ fontSize: 10, color: '#6b7280' }}>{png.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {render.result.stl && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t.stlHeading}</div>
                <div data-testid="solver-revolve-stl-viewer">
                  <StlViewer stlBase64={render.result.stl} />
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={onClose}
            data-testid="solver-revolve-cancel"
            style={{ padding: '8px 16px', fontSize: 13, background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={render.status === 'loading'}
            data-testid="solver-revolve-submit"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              background: render.status === 'loading' ? '#e5e7eb' : '#0ea5e9',
              color: render.status === 'loading' ? '#9ca3af' : '#fff',
              border: '1px solid #0284c7',
              borderRadius: 4,
              cursor: render.status === 'loading' ? 'not-allowed' : 'pointer',
            }}
          >
            {t.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
