'use client';

/**
 * ChamferModal — Phase 2.2 standalone modal that lets the user bevel
 * selected edges of the current sketch profile (extruded into a box)
 * with a uniform 45° setback distance.
 *
 * Mirror of FilletModal.tsx; "radius" becomes "distance".
 *
 * Phase 1 limitations:
 *   - Sketch profile must be an axis-aligned rectangle.
 *
 * Test surface (data-testids — all prefixed solver-chamfer-):
 *   solver-chamfer-modal,
 *   solver-chamfer-depth-input,
 *   solver-chamfer-distance-input,
 *   solver-chamfer-edges-radio-{all|top|bottom|vertical},
 *   solver-chamfer-submit, solver-chamfer-cancel,
 *   solver-chamfer-scad-preview, solver-chamfer-png-preview-{idx},
 *   solver-chamfer-stl-viewer, solver-chamfer-error,
 *   solver-chamfer-phase1-warning.
 */

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { ChamferEdgeSelection } from '@/lib/cad/chamferProfile';

const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>3D viewer loading…</div>
  ),
});

export type ChamferLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  phase1Warning: string;
  depth: string;
  distance: string;
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

const dict: Record<ChamferLang, Dict> = {
  ko: {
    modalTitle: '챔퍼 설정',
    phase1Warning: 'Phase 1: 축에 평행한 직사각형 프로파일만 지원합니다.',
    depth: '깊이',
    distance: '거리',
    edges: '대상 엣지',
    edgesAll: '모든 엣지',
    edgesTop: '윗면 엣지',
    edgesBottom: '바닥면 엣지',
    edgesVertical: '수직 엣지',
    submit: '챔퍼 적용',
    cancel: '취소',
    rendering: '렌더링 중...',
    scadHeading: 'SCAD 소스',
    pngHeading: '미리보기',
    stlHeading: '3D 뷰',
    errorPrefix: '오류',
  },
  en: {
    modalTitle: 'Chamfer options',
    phase1Warning: 'Phase 1: only axis-aligned rectangle profiles are supported.',
    depth: 'Depth',
    distance: 'Distance',
    edges: 'Edges',
    edgesAll: 'All edges',
    edgesTop: 'Top edges',
    edgesBottom: 'Bottom edges',
    edgesVertical: 'Vertical edges',
    submit: 'Chamfer',
    cancel: 'Cancel',
    rendering: 'Rendering...',
    scadHeading: 'SCAD source',
    pngHeading: 'Preview',
    stlHeading: '3D view',
    errorPrefix: 'Error',
  },
  ja: {
    modalTitle: '面取り設定',
    phase1Warning: 'Phase 1: 軸並行の矩形プロファイルのみ対応。',
    depth: '深さ',
    distance: '距離',
    edges: '対象エッジ',
    edgesAll: '全エッジ',
    edgesTop: '上面エッジ',
    edgesBottom: '下面エッジ',
    edgesVertical: '垂直エッジ',
    submit: '面取り',
    cancel: 'キャンセル',
    rendering: 'レンダリング中...',
    scadHeading: 'SCADソース',
    pngHeading: 'プレビュー',
    stlHeading: '3Dビュー',
    errorPrefix: 'エラー',
  },
  zh: {
    modalTitle: '倒角选项',
    phase1Warning: 'Phase 1: 仅支持轴对齐矩形轮廓。',
    depth: '深度',
    distance: '距离',
    edges: '边线',
    edgesAll: '全部边',
    edgesTop: '顶面边',
    edgesBottom: '底面边',
    edgesVertical: '垂直边',
    submit: '倒角',
    cancel: '取消',
    rendering: '渲染中...',
    scadHeading: 'SCAD源',
    pngHeading: '预览',
    stlHeading: '3D视图',
    errorPrefix: '错误',
  },
  es: {
    modalTitle: 'Opciones de chaflán',
    phase1Warning: 'Fase 1: solo se admiten perfiles rectangulares alineados con los ejes.',
    depth: 'Profundidad',
    distance: 'Distancia',
    edges: 'Aristas',
    edgesAll: 'Todas las aristas',
    edgesTop: 'Aristas superiores',
    edgesBottom: 'Aristas inferiores',
    edgesVertical: 'Aristas verticales',
    submit: 'Achaflanar',
    cancel: 'Cancelar',
    rendering: 'Renderizando...',
    scadHeading: 'Fuente SCAD',
    pngHeading: 'Vista previa',
    stlHeading: 'Vista 3D',
    errorPrefix: 'Error',
  },
  ar: {
    modalTitle: 'خيارات الشطف',
    phase1Warning: 'المرحلة 1: المستطيلات المحاذية للمحاور فقط مدعومة.',
    depth: 'العمق',
    distance: 'المسافة',
    edges: 'الحواف',
    edgesAll: 'كل الحواف',
    edgesTop: 'الحواف العلوية',
    edgesBottom: 'الحواف السفلية',
    edgesVertical: 'الحواف الرأسية',
    submit: 'شطف',
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

export interface ChamferFetcherRequest {
  sketch: SolverViewState;
  depth: number;
  distance: number;
  edgeSelection: ChamferEdgeSelection;
  includeStl?: boolean;
}

export type ChamferFetcherResponse =
  | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string }
  | { ok: false; code: string; message: string };

export type ChamferFetcher = (req: ChamferFetcherRequest) => Promise<ChamferFetcherResponse>;

const defaultFetcher: ChamferFetcher = async (req) => {
  const res = await fetch('/api/chamfer-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
};

export interface ChamferModalProps {
  lang: ChamferLang;
  sketch: SolverViewState;
  onClose: () => void;
  /** Injectable for tests. Defaults to POST /api/chamfer-render. */
  chamferFetcher?: ChamferFetcher;
}

const EDGE_OPTIONS: ReadonlyArray<{
  value: ChamferEdgeSelection;
  labelKey: keyof Pick<Dict, 'edgesAll' | 'edgesTop' | 'edgesBottom' | 'edgesVertical'>;
}> = [
  { value: 'all', labelKey: 'edgesAll' },
  { value: 'top', labelKey: 'edgesTop' },
  { value: 'bottom', labelKey: 'edgesBottom' },
  { value: 'vertical', labelKey: 'edgesVertical' },
];

export default function ChamferModal({
  lang,
  sketch,
  onClose,
  chamferFetcher = defaultFetcher,
}: ChamferModalProps): React.ReactElement {
  const t = dict[lang];

  const [depth, setDepth] = useState<string>('20');
  const [distance, setDistance] = useState<string>('2');
  const [edgeSelection, setEdgeSelection] = useState<ChamferEdgeSelection>('all');
  const [render, setRender] = useState<RenderState>({ status: 'idle' });

  const onSubmit = useCallback(async () => {
    const d = Number(depth);
    const dist = Number(distance);
    if (!Number.isFinite(d) || d <= 0) {
      setRender({ status: 'error', message: `${t.errorPrefix}: depth must be a positive number` });
      return;
    }
    if (!Number.isFinite(dist) || dist <= 0) {
      setRender({
        status: 'error',
        message: `${t.errorPrefix}: distance must be a positive number`,
      });
      return;
    }
    const touchesTopOrBottom =
      edgeSelection === 'all' || edgeSelection === 'top' || edgeSelection === 'bottom';
    if (touchesTopOrBottom && dist >= d / 3) {
      setRender({
        status: 'error',
        message: `${t.errorPrefix}: distance must be < depth/3 when chamfering top/bottom edges`,
      });
      return;
    }
    setRender({ status: 'loading' });
    try {
      const res = await chamferFetcher({
        sketch,
        depth: d,
        distance: dist,
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
  }, [depth, distance, edgeSelection, sketch, chamferFetcher, t.errorPrefix]);

  return (
    <div
      data-testid="solver-chamfer-modal"
      role="dialog"
      aria-labelledby="solver-chamfer-title"
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
          background: '#fff',
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
        <h3 id="solver-chamfer-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {t.modalTitle}
        </h3>

        <div
          data-testid="solver-chamfer-phase1-warning"
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
            data-testid="solver-chamfer-depth-input"
            step="0.1"
            min="0"
            style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t.distance}
          <input
            type="number"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            data-testid="solver-chamfer-distance-input"
            step="0.1"
            min="0"
            style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
          />
        </label>

        <fieldset
          style={{
            border: '1px solid #e5e7eb',
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
                name="solver-chamfer-edges"
                value={opt.value}
                checked={edgeSelection === opt.value}
                onChange={() => setEdgeSelection(opt.value)}
                data-testid={`solver-chamfer-edges-radio-${opt.value}`}
              />
              {t[opt.labelKey]}
            </label>
          ))}
        </fieldset>

        {render.status === 'loading' && (
          <div style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>{t.rendering}</div>
        )}

        {render.status === 'error' && (
          <div
            data-testid="solver-chamfer-error"
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
                data-testid="solver-chamfer-scad-preview"
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
                        data-testid={`solver-chamfer-png-preview-${idx}`}
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
                <div data-testid="solver-chamfer-stl-viewer">
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
            data-testid="solver-chamfer-cancel"
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
            data-testid="solver-chamfer-submit"
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
