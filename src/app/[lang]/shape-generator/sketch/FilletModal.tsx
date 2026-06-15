'use client';

/**
 * FilletModal — Phase 2.2 standalone modal that lets the user round
 * selected edges of the current sketch profile (extruded into a box)
 * with a uniform radius.
 *
 * Architecture:
 *   - Standalone (NOT a wrapper of SolverSketchEditor). Receives the
 *     current sketch state as a prop from the parent.
 *   - User specifies depth (extrude height) + uniform radius + an
 *     edge-selection radio (all / top / bottom / vertical).
 *   - Submit POSTs to /api/fillet-render (default fetcher) and shows
 *     the SCAD source, PNG previews, and an optional STL viewer.
 *
 * Phase 1 limitations:
 *   - Sketch profile must be an axis-aligned rectangle.
 *
 * Test surface (data-testids — all prefixed solver-fillet-):
 *   solver-fillet-modal,
 *   solver-fillet-depth-input,
 *   solver-fillet-radius-input,
 *   solver-fillet-edges-radio-{all|top|bottom|vertical},
 *   solver-fillet-submit, solver-fillet-cancel,
 *   solver-fillet-scad-preview, solver-fillet-png-preview-{idx},
 *   solver-fillet-stl-viewer, solver-fillet-error,
 *   solver-fillet-phase1-warning.
 */

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { FilletEdgeSelection } from '@/lib/cad/filletProfile';

const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ fontSize: 11, color: 'var(--nx-text-2)', padding: 12 }}>3D viewer loading…</div>
  ),
});

export type FilletLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  phase1Warning: string;
  depth: string;
  radius: string;
  edges: string;
  edgesAll: string;
  edgesTop: string;
  edgesBottom: string;
  edgesVertical: string;
  submit: string;
  cancel: string;
  rendering: string;
  scadHeading: string;
  pngHeading: string;
  stlHeading: string;
  errorPrefix: string;
}

const dict: Record<FilletLang, Dict> = {
  ko: {
    modalTitle: '필렛 설정',
    phase1Warning: 'Phase 1: 축에 평행한 직사각형 프로파일만 지원합니다.',
    depth: '깊이',
    radius: '반경',
    edges: '대상 엣지',
    edgesAll: '모든 엣지',
    edgesTop: '윗면 엣지',
    edgesBottom: '바닥면 엣지',
    edgesVertical: '수직 엣지',
    submit: '필렛 적용',
    cancel: '취소',
    rendering: '렌더링 중...',
    scadHeading: 'SCAD 소스',
    pngHeading: '미리보기',
    stlHeading: '3D 뷰',
    errorPrefix: '오류',
  },
  en: {
    modalTitle: 'Fillet options',
    phase1Warning: 'Phase 1: only axis-aligned rectangle profiles are supported.',
    depth: 'Depth',
    radius: 'Radius',
    edges: 'Edges',
    edgesAll: 'All edges',
    edgesTop: 'Top edges',
    edgesBottom: 'Bottom edges',
    edgesVertical: 'Vertical edges',
    submit: 'Fillet',
    cancel: 'Cancel',
    rendering: 'Rendering...',
    scadHeading: 'SCAD source',
    pngHeading: 'Preview',
    stlHeading: '3D view',
    errorPrefix: 'Error',
  },
  ja: {
    modalTitle: 'フィレット設定',
    phase1Warning: 'Phase 1: 軸並行の矩形プロファイルのみ対応。',
    depth: '深さ',
    radius: '半径',
    edges: '対象エッジ',
    edgesAll: '全エッジ',
    edgesTop: '上面エッジ',
    edgesBottom: '下面エッジ',
    edgesVertical: '垂直エッジ',
    submit: 'フィレット',
    cancel: 'キャンセル',
    rendering: 'レンダリング中...',
    scadHeading: 'SCADソース',
    pngHeading: 'プレビュー',
    stlHeading: '3Dビュー',
    errorPrefix: 'エラー',
  },
  zh: {
    modalTitle: '圆角选项',
    phase1Warning: 'Phase 1: 仅支持轴对齐矩形轮廓。',
    depth: '深度',
    radius: '半径',
    edges: '边线',
    edgesAll: '全部边',
    edgesTop: '顶面边',
    edgesBottom: '底面边',
    edgesVertical: '垂直边',
    submit: '圆角',
    cancel: '取消',
    rendering: '渲染中...',
    scadHeading: 'SCAD源',
    pngHeading: '预览',
    stlHeading: '3D视图',
    errorPrefix: '错误',
  },
  es: {
    modalTitle: 'Opciones de redondeo',
    phase1Warning: 'Fase 1: solo se admiten perfiles rectangulares alineados con los ejes.',
    depth: 'Profundidad',
    radius: 'Radio',
    edges: 'Aristas',
    edgesAll: 'Todas las aristas',
    edgesTop: 'Aristas superiores',
    edgesBottom: 'Aristas inferiores',
    edgesVertical: 'Aristas verticales',
    submit: 'Redondear',
    cancel: 'Cancelar',
    rendering: 'Renderizando...',
    scadHeading: 'Fuente SCAD',
    pngHeading: 'Vista previa',
    stlHeading: 'Vista 3D',
    errorPrefix: 'Error',
  },
  ar: {
    modalTitle: 'خيارات التدوير',
    phase1Warning: 'المرحلة 1: المستطيلات المحاذية للمحاور فقط مدعومة.',
    depth: 'العمق',
    radius: 'نصف القطر',
    edges: 'الحواف',
    edgesAll: 'كل الحواف',
    edgesTop: 'الحواف العلوية',
    edgesBottom: 'الحواف السفلية',
    edgesVertical: 'الحواف الرأسية',
    submit: 'تدوير',
    cancel: 'إلغاء',
    rendering: 'جارٍ التصيير...',
    scadHeading: 'مصدر SCAD',
    pngHeading: 'معاينة',
    stlHeading: 'عرض ثلاثي الأبعاد',
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

export interface FilletFetcherRequest {
  sketch: SolverViewState;
  depth: number;
  radius: number;
  edgeSelection: FilletEdgeSelection;
  includeStl?: boolean;
}

export type FilletFetcherResponse =
  | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string }
  | { ok: false; code: string; message: string };

export type FilletFetcher = (req: FilletFetcherRequest) => Promise<FilletFetcherResponse>;

const defaultFetcher: FilletFetcher = async (req) => {
  const res = await fetch('/api/fillet-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
};

export interface FilletModalProps {
  lang: FilletLang;
  sketch: SolverViewState;
  onClose: () => void;
  /** Injectable for tests. Defaults to POST /api/fillet-render. */
  filletFetcher?: FilletFetcher;
}

const EDGE_OPTIONS: ReadonlyArray<{
  value: FilletEdgeSelection;
  labelKey: keyof Pick<Dict, 'edgesAll' | 'edgesTop' | 'edgesBottom' | 'edgesVertical'>;
}> = [
  { value: 'all', labelKey: 'edgesAll' },
  { value: 'top', labelKey: 'edgesTop' },
  { value: 'bottom', labelKey: 'edgesBottom' },
  { value: 'vertical', labelKey: 'edgesVertical' },
];

export default function FilletModal({
  lang,
  sketch,
  onClose,
  filletFetcher = defaultFetcher,
}: FilletModalProps): React.ReactElement {
  const t = dict[lang];

  const [depth, setDepth] = useState<string>('20');
  const [radius, setRadius] = useState<string>('2');
  const [edgeSelection, setEdgeSelection] = useState<FilletEdgeSelection>('all');
  const [render, setRender] = useState<RenderState>({ status: 'idle' });

  const onSubmit = useCallback(async () => {
    const d = Number(depth);
    const r = Number(radius);
    if (!Number.isFinite(d) || d <= 0) {
      setRender({ status: 'error', message: `${t.errorPrefix}: depth must be a positive number` });
      return;
    }
    if (!Number.isFinite(r) || r <= 0) {
      setRender({
        status: 'error',
        message: `${t.errorPrefix}: radius must be a positive number`,
      });
      return;
    }
    const touchesTopOrBottom =
      edgeSelection === 'all' || edgeSelection === 'top' || edgeSelection === 'bottom';
    if (touchesTopOrBottom && r >= d / 3) {
      setRender({
        status: 'error',
        message: `${t.errorPrefix}: radius must be < depth/3 when filleting top/bottom edges`,
      });
      return;
    }
    setRender({ status: 'loading' });
    try {
      const res = await filletFetcher({
        sketch,
        depth: d,
        radius: r,
        edgeSelection,
        includeStl: true,
      });
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
  }, [depth, radius, edgeSelection, sketch, filletFetcher, t.errorPrefix]);

  return (
    <div
      data-testid="solver-fillet-modal"
      role="dialog"
      aria-labelledby="solver-fillet-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--nx-panel)',
          padding: 20,
          borderRadius: 8,
          maxWidth: 560,
          width: '92%',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 id="solver-fillet-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {t.modalTitle}
        </h3>

        <div
          data-testid="solver-fillet-phase1-warning"
          style={{
            padding: 8,
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            borderRadius: 4,
            color: '#92400e',
            fontSize: 11,
          }}
        >
          {t.phase1Warning}
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t.depth}
          <input
            type="number"
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            data-testid="solver-fillet-depth-input"
            step="0.1"
            min="0"
            style={{ padding: 6, fontSize: 13, border: '1px solid var(--nx-border)', borderRadius: 4 }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t.radius}
          <input
            type="number"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            data-testid="solver-fillet-radius-input"
            step="0.1"
            min="0"
            style={{ padding: 6, fontSize: 13, border: '1px solid var(--nx-border)', borderRadius: 4 }}
          />
        </label>

        <fieldset
          style={{
            border: '1px solid var(--nx-border)',
            borderRadius: 4,
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 12,
          }}
        >
          <legend style={{ padding: '0 4px', fontSize: 12 }}>{t.edges}</legend>
          {EDGE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="solver-fillet-edges"
                value={opt.value}
                checked={edgeSelection === opt.value}
                onChange={() => setEdgeSelection(opt.value)}
                data-testid={`solver-fillet-edges-radio-${opt.value}`}
              />
              {t[opt.labelKey]}
            </label>
          ))}
        </fieldset>

        {render.status === 'loading' && (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--nx-text-2)' }}>{t.rendering}</div>
        )}

        {render.status === 'error' && (
          <div
            data-testid="solver-fillet-error"
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
                data-testid="solver-fillet-scad-preview"
                style={{
                  padding: 8,
                  background: 'var(--nx-panel-2)',
                  border: '1px solid var(--nx-border)',
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
                        data-testid={`solver-fillet-png-preview-${idx}`}
                        src={`data:image/png;base64,${png.base64}`}
                        alt={png.label}
                        style={{ maxWidth: 240, border: '1px solid var(--nx-border)', borderRadius: 4 }}
                      />
                      <div style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>{png.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {render.result.stl && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t.stlHeading}</div>
                <div data-testid="solver-fillet-stl-viewer">
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
            data-testid="solver-fillet-cancel"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              background: 'var(--nx-panel)',
              border: '1px solid var(--nx-border)',
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
            data-testid="solver-fillet-submit"
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
