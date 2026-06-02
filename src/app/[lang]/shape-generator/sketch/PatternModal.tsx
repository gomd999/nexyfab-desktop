'use client';

/**
 * PatternModal — Phase 2.4 standalone modal that lets the user pattern
 * the current sketch profile (extruded into a body) along a linear
 * direction or around a circular axis.
 *
 * Architecture:
 *   - Standalone (NOT a wrapper of SolverSketchEditor). Receives the
 *     current sketch state as a prop from the parent
 *     (SolverSketchEditorWithExtrude will open it next to its other modals).
 *   - User picks a tab (Linear | Circular), fills in pattern params + the
 *     child extrude depth (which determines what gets repeated), then
 *     submits.
 *   - Submit POSTs to /api/pattern-render (default fetcher) with a
 *     `kind: 'linear' | 'circular'` discriminator and shows the SCAD
 *     source, PNG previews, and an optional STL viewer.
 *
 * Tab UX:
 *   - Tab switching preserves all shared state (extrude depth + count) so
 *     toggling between linear and circular doesn't blow away user input.
 *   - Per-tab fields (direction/spacing vs axis/angle) keep their own
 *     state so flipping back also restores what the user typed.
 *
 * Test surface (data-testids — all prefixed solver-pattern-):
 *   solver-pattern-modal,
 *   solver-pattern-tab-{linear|circular},
 *   solver-pattern-depth-input,
 *   solver-pattern-count-input,
 *   Linear:    solver-pattern-direction-{x|y|z}-input,
 *              solver-pattern-spacing-input,
 *   Circular:  solver-pattern-axis-origin-{x|y|z}-input,
 *              solver-pattern-axis-direction-{x|y|z}-input,
 *              solver-pattern-total-angle-input,
 *   solver-pattern-submit, solver-pattern-cancel,
 *   solver-pattern-scad-preview, solver-pattern-png-preview-{idx},
 *   solver-pattern-stl-viewer, solver-pattern-error.
 */

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { Vec3D } from '@/lib/cad/pattern';

// StlViewer pulls in Three.js; dynamic-loaded so the sketch editor bundle
// stays small for users who never open the pattern modal.
const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>3D viewer loading…</div>
  ),
});

export type PatternLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  tabLinear: string;
  tabCircular: string;
  depth: string;
  count: string;
  direction: string;
  spacing: string;
  axisOrigin: string;
  axisDirection: string;
  totalAngle: string;
  submit: string;
  cancel: string;
  rendering: string;
  scadHeading: string;
  pngHeading: string;
  stlHeading: string;
  errorPrefix: string;
}

const dict: Record<PatternLang, Dict> = {
  ko: {
    modalTitle: '패턴 설정',
    tabLinear: '선형 패턴', tabCircular: '원형 패턴',
    depth: '돌출 깊이', count: '개수',
    direction: '방향', spacing: '간격',
    axisOrigin: '축 원점', axisDirection: '축 방향',
    totalAngle: '전체 각도 (°)',
    submit: '패턴 생성', cancel: '취소',
    rendering: '렌더링 중...', scadHeading: 'SCAD 소스', pngHeading: '미리보기', stlHeading: '3D 뷰',
    errorPrefix: '오류',
  },
  en: {
    modalTitle: 'Pattern options',
    tabLinear: 'Linear', tabCircular: 'Circular',
    depth: 'Extrude depth', count: 'Count',
    direction: 'Direction', spacing: 'Spacing',
    axisOrigin: 'Axis origin', axisDirection: 'Axis direction',
    totalAngle: 'Total angle (°)',
    submit: 'Pattern', cancel: 'Cancel',
    rendering: 'Rendering...', scadHeading: 'SCAD source', pngHeading: 'Preview', stlHeading: '3D view',
    errorPrefix: 'Error',
  },
  ja: {
    modalTitle: 'パターン設定',
    tabLinear: '線形パターン', tabCircular: '円形パターン',
    depth: '押し出し深さ', count: '個数',
    direction: '方向', spacing: '間隔',
    axisOrigin: '軸原点', axisDirection: '軸方向',
    totalAngle: '全角度 (°)',
    submit: 'パターン作成', cancel: 'キャンセル',
    rendering: 'レンダリング中...', scadHeading: 'SCADソース', pngHeading: 'プレビュー', stlHeading: '3Dビュー',
    errorPrefix: 'エラー',
  },
  zh: {
    modalTitle: '阵列选项',
    tabLinear: '线性阵列', tabCircular: '环形阵列',
    depth: '拉伸深度', count: '数量',
    direction: '方向', spacing: '间距',
    axisOrigin: '轴原点', axisDirection: '轴方向',
    totalAngle: '总角度 (°)',
    submit: '阵列', cancel: '取消',
    rendering: '渲染中...', scadHeading: 'SCAD源', pngHeading: '预览', stlHeading: '3D视图',
    errorPrefix: '错误',
  },
  es: {
    modalTitle: 'Opciones de patrón',
    tabLinear: 'Lineal', tabCircular: 'Circular',
    depth: 'Profundidad de extrusión', count: 'Cantidad',
    direction: 'Dirección', spacing: 'Espaciado',
    axisOrigin: 'Origen del eje', axisDirection: 'Dirección del eje',
    totalAngle: 'Ángulo total (°)',
    submit: 'Patrón', cancel: 'Cancelar',
    rendering: 'Renderizando...', scadHeading: 'Fuente SCAD', pngHeading: 'Vista previa', stlHeading: 'Vista 3D',
    errorPrefix: 'Error',
  },
  ar: {
    modalTitle: 'خيارات النمط',
    tabLinear: 'خطي', tabCircular: 'دائري',
    depth: 'عمق البثق', count: 'العدد',
    direction: 'الاتجاه', spacing: 'التباعد',
    axisOrigin: 'أصل المحور', axisDirection: 'اتجاه المحور',
    totalAngle: 'الزاوية الكلية (°)',
    submit: 'نمط', cancel: 'إلغاء',
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

export type PatternKind = 'linear' | 'circular';

export interface LinearPatternFetcherRequest {
  kind: 'linear';
  sketch: SolverViewState;
  child: { depth: number };
  count: number;
  direction: Vec3D;
  spacing: number;
  includeStl?: boolean;
}

export interface CircularPatternFetcherRequest {
  kind: 'circular';
  sketch: SolverViewState;
  child: { depth: number };
  count: number;
  axisOrigin: Vec3D;
  axisDirection: Vec3D;
  totalAngleDegrees: number;
  includeStl?: boolean;
}

export type PatternFetcherRequest =
  | LinearPatternFetcherRequest
  | CircularPatternFetcherRequest;

export type PatternFetcherResponse =
  | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string }
  | { ok: false; code: string; message: string };

export type PatternFetcher = (req: PatternFetcherRequest) => Promise<PatternFetcherResponse>;

const defaultFetcher: PatternFetcher = async (req) => {
  const res = await fetch('/api/pattern-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
};

export interface PatternModalProps {
  lang: PatternLang;
  sketch: SolverViewState;
  onClose: () => void;
  /** Injectable for tests. Defaults to POST /api/pattern-render. */
  patternFetcher?: PatternFetcher;
}

// ─── inline style helpers ─────────────────────────────────────────────────

const numInputStyle: React.CSSProperties = {
  padding: 6,
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
};
const fieldsetStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  border: '1px solid #e5e7eb',
  borderRadius: 4,
  padding: 8,
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 11,
  flex: 1,
};

function Vec3Inputs(props: {
  legend: string;
  x: string; y: string; z: string;
  setX: (v: string) => void;
  setY: (v: string) => void;
  setZ: (v: string) => void;
  testidPrefix: string;
}): React.ReactElement {
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={{ padding: '0 4px', fontSize: 12, fontWeight: 600 }}>{props.legend}</legend>
      <div style={{ display: 'flex', gap: 8 }}>
        <label style={labelStyle}>
          x
          <input
            type="number"
            value={props.x}
            onChange={(e) => props.setX(e.target.value)}
            data-testid={`${props.testidPrefix}-x-input`}
            step="0.1"
            style={numInputStyle}
          />
        </label>
        <label style={labelStyle}>
          y
          <input
            type="number"
            value={props.y}
            onChange={(e) => props.setY(e.target.value)}
            data-testid={`${props.testidPrefix}-y-input`}
            step="0.1"
            style={numInputStyle}
          />
        </label>
        <label style={labelStyle}>
          z
          <input
            type="number"
            value={props.z}
            onChange={(e) => props.setZ(e.target.value)}
            data-testid={`${props.testidPrefix}-z-input`}
            step="0.1"
            style={numInputStyle}
          />
        </label>
      </div>
    </fieldset>
  );
}

export default function PatternModal({
  lang,
  sketch,
  onClose,
  patternFetcher = defaultFetcher,
}: PatternModalProps): React.ReactElement {
  const t = dict[lang];

  // Tab state.
  const [kind, setKind] = useState<PatternKind>('linear');

  // Shared inputs (preserved across tab switches).
  const [depth, setDepth] = useState<string>('5');
  const [count, setCount] = useState<string>('4');

  // Linear-only inputs (preserved when switching to circular and back).
  const [dirX, setDirX] = useState<string>('1');
  const [dirY, setDirY] = useState<string>('0');
  const [dirZ, setDirZ] = useState<string>('0');
  const [spacing, setSpacing] = useState<string>('10');

  // Circular-only inputs (preserved when switching to linear and back).
  const [axOx, setAxOx] = useState<string>('0');
  const [axOy, setAxOy] = useState<string>('0');
  const [axOz, setAxOz] = useState<string>('0');
  const [axDx, setAxDx] = useState<string>('0');
  const [axDy, setAxDy] = useState<string>('0');
  const [axDz, setAxDz] = useState<string>('1');
  const [totalAngle, setTotalAngle] = useState<string>('360');

  const [render, setRender] = useState<RenderState>({ status: 'idle' });

  const onSubmit = useCallback(async () => {
    // Shared validation.
    const depthN = Number(depth);
    if (!Number.isFinite(depthN) || depthN <= 0) {
      setRender({ status: 'error', message: `${t.errorPrefix}: depth must be a positive number` });
      return;
    }
    const countN = Number(count);
    if (!Number.isFinite(countN) || !Number.isInteger(countN) || countN < 1 || countN > 100) {
      setRender({
        status: 'error',
        message: `${t.errorPrefix}: count must be an integer in [1, 100]`,
      });
      return;
    }

    let req: PatternFetcherRequest;
    if (kind === 'linear') {
      const dxN = Number(dirX);
      const dyN = Number(dirY);
      const dzN = Number(dirZ);
      if (!Number.isFinite(dxN) || !Number.isFinite(dyN) || !Number.isFinite(dzN)) {
        setRender({ status: 'error', message: `${t.errorPrefix}: direction must be numbers` });
        return;
      }
      if (Math.hypot(dxN, dyN, dzN) < 1e-9) {
        setRender({ status: 'error', message: `${t.errorPrefix}: direction is zero-length` });
        return;
      }
      const spacingN = Number(spacing);
      if (!Number.isFinite(spacingN) || spacingN <= 0) {
        setRender({ status: 'error', message: `${t.errorPrefix}: spacing must be positive` });
        return;
      }
      req = {
        kind: 'linear',
        sketch,
        child: { depth: depthN },
        count: countN,
        direction: { x: dxN, y: dyN, z: dzN },
        spacing: spacingN,
        includeStl: true,
      };
    } else {
      if (countN < 2) {
        setRender({ status: 'error', message: `${t.errorPrefix}: circular count must be ≥ 2` });
        return;
      }
      const oxN = Number(axOx);
      const oyN = Number(axOy);
      const ozN = Number(axOz);
      const dxN = Number(axDx);
      const dyN = Number(axDy);
      const dzN = Number(axDz);
      if (
        !Number.isFinite(oxN) || !Number.isFinite(oyN) || !Number.isFinite(ozN) ||
        !Number.isFinite(dxN) || !Number.isFinite(dyN) || !Number.isFinite(dzN)
      ) {
        setRender({ status: 'error', message: `${t.errorPrefix}: axis values must be numbers` });
        return;
      }
      if (Math.hypot(dxN, dyN, dzN) < 1e-9) {
        setRender({ status: 'error', message: `${t.errorPrefix}: axis direction is zero-length` });
        return;
      }
      const angleN = Number(totalAngle);
      if (!Number.isFinite(angleN) || angleN <= 0 || angleN > 360) {
        setRender({
          status: 'error',
          message: `${t.errorPrefix}: total angle must be in (0, 360]`,
        });
        return;
      }
      req = {
        kind: 'circular',
        sketch,
        child: { depth: depthN },
        count: countN,
        axisOrigin: { x: oxN, y: oyN, z: ozN },
        axisDirection: { x: dxN, y: dyN, z: dzN },
        totalAngleDegrees: angleN,
        includeStl: true,
      };
    }

    setRender({ status: 'loading' });
    try {
      const res = await patternFetcher(req);
      if (res.ok) {
        setRender({
          status: 'ok',
          result: { scad: res.scad, pngs: res.pngs, stl: res.stl },
        });
      } else {
        setRender({ status: 'error', message: `${t.errorPrefix}: ${res.message}` });
      }
    } catch (e) {
      setRender({
        status: 'error',
        message: `${t.errorPrefix}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }, [
    kind, depth, count,
    dirX, dirY, dirZ, spacing,
    axOx, axOy, axOz, axDx, axDy, axDz, totalAngle,
    sketch, patternFetcher, t.errorPrefix,
  ]);

  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    background: active ? '#0ea5e9' : '#fff',
    color: active ? '#fff' : '#374151',
    border: '1px solid ' + (active ? '#0284c7' : '#d1d5db'),
    borderRadius: 4,
    cursor: 'pointer',
  });

  return (
    <div
      data-testid="solver-pattern-modal"
      role="dialog"
      aria-labelledby="solver-pattern-title"
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
        <h3 id="solver-pattern-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {t.modalTitle}
        </h3>

        {/* Tabs */}
        <div role="tablist" style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'linear'}
            data-testid="solver-pattern-tab-linear"
            onClick={() => setKind('linear')}
            style={tabButtonStyle(kind === 'linear')}
          >
            {t.tabLinear}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'circular'}
            data-testid="solver-pattern-tab-circular"
            onClick={() => setKind('circular')}
            style={tabButtonStyle(kind === 'circular')}
          >
            {t.tabCircular}
          </button>
        </div>

        {/* Shared fields */}
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ ...labelStyle, fontSize: 12 }}>
            {t.depth}
            <input
              type="number"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              data-testid="solver-pattern-depth-input"
              step="0.1"
              min="0"
              style={numInputStyle}
            />
          </label>
          <label style={{ ...labelStyle, fontSize: 12 }}>
            {t.count}
            <input
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              data-testid="solver-pattern-count-input"
              step="1"
              min="1"
              max="100"
              style={numInputStyle}
            />
          </label>
        </div>

        {/* Per-tab fields */}
        {kind === 'linear' ? (
          <>
            <Vec3Inputs
              legend={t.direction}
              x={dirX} y={dirY} z={dirZ}
              setX={setDirX} setY={setDirY} setZ={setDirZ}
              testidPrefix="solver-pattern-direction"
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.spacing}
              <input
                type="number"
                value={spacing}
                onChange={(e) => setSpacing(e.target.value)}
                data-testid="solver-pattern-spacing-input"
                step="0.1"
                min="0"
                style={numInputStyle}
              />
            </label>
          </>
        ) : (
          <>
            <Vec3Inputs
              legend={t.axisOrigin}
              x={axOx} y={axOy} z={axOz}
              setX={setAxOx} setY={setAxOy} setZ={setAxOz}
              testidPrefix="solver-pattern-axis-origin"
            />
            <Vec3Inputs
              legend={t.axisDirection}
              x={axDx} y={axDy} z={axDz}
              setX={setAxDx} setY={setAxDy} setZ={setAxDz}
              testidPrefix="solver-pattern-axis-direction"
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.totalAngle}
              <input
                type="number"
                value={totalAngle}
                onChange={(e) => setTotalAngle(e.target.value)}
                data-testid="solver-pattern-total-angle-input"
                step="1"
                min="0"
                max="360"
                style={numInputStyle}
              />
            </label>
          </>
        )}

        {render.status === 'loading' && (
          <div style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>
            {t.rendering}
          </div>
        )}

        {render.status === 'error' && (
          <div
            data-testid="solver-pattern-error"
            style={{
              padding: 12,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              color: '#dc2626',
              fontSize: 12,
            }}
          >
            {render.message}
          </div>
        )}

        {render.status === 'ok' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t.scadHeading}</div>
              <pre
                data-testid="solver-pattern-scad-preview"
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
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      { }
                      <img
                        data-testid={`solver-pattern-png-preview-${idx}`}
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
                <div data-testid="solver-pattern-stl-viewer">
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
            data-testid="solver-pattern-cancel"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={render.status === 'loading'}
            data-testid="solver-pattern-submit"
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
