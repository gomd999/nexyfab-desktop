'use client';

/**
 * ShellModal — Phase 2.4 standalone modal that lets the user hollow the
 * current sketch profile into a thin-walled shell, optionally opening the
 * top and/or bottom face.
 *
 * Architecture:
 *   - Standalone (NOT a wrapper of SolverSketchEditor). Receives the
 *     current sketch state as a prop from the parent
 *     (SolverSketchEditorWithExtrude opens it next to its Extrude,
 *     Revolve, Sweep, etc. modals).
 *   - User specifies depth (extrude height) + uniform wall thickness +
 *     two open-face checkboxes (top / bottom).
 *   - Submit POSTs to /api/shell-render (default fetcher) and shows the
 *     SCAD source, PNG previews, and an optional STL viewer.
 *
 * Phase 1 limitations:
 *   - Sketch profile must be an axis-aligned rectangle (4 corners + 4
 *     right angles). Other profiles trigger a clear error from the
 *     pipeline. The Phase 1 warning is shown inline above the form.
 *
 * Test surface (data-testids — all prefixed solver-shell-):
 *   solver-shell-modal,
 *   solver-shell-depth-input,
 *   solver-shell-thickness-input,
 *   solver-shell-open-top-checkbox, solver-shell-open-bottom-checkbox,
 *   solver-shell-submit, solver-shell-cancel,
 *   solver-shell-scad-preview, solver-shell-png-preview-{idx},
 *   solver-shell-stl-viewer, solver-shell-error,
 *   solver-shell-phase1-warning.
 */

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

// StlViewer pulls in Three.js; dynamic-loaded so the sketch editor bundle
// stays small for users who never open the shell modal.
const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>3D viewer loading…</div>
  ),
});

export type ShellLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  phase1Warning: string;
  depth: string;
  thickness: string;
  openTop: string;
  openBottom: string;
  submit: string;
  cancel: string;
  rendering: string;
  scadHeading: string;
  pngHeading: string;
  stlHeading: string;
  errorPrefix: string;
}

const dict: Record<ShellLang, Dict> = {
  ko: {
    modalTitle: '쉘 설정',
    phase1Warning: 'Phase 1: 축에 평행한 직사각형 프로파일만 지원합니다.',
    depth: '깊이',
    thickness: '벽 두께',
    openTop: '윗면 개방',
    openBottom: '바닥면 개방',
    submit: '쉘 만들기',
    cancel: '취소',
    rendering: '렌더링 중...',
    scadHeading: 'SCAD 소스',
    pngHeading: '미리보기',
    stlHeading: '3D 뷰',
    errorPrefix: '오류',
  },
  en: {
    modalTitle: 'Shell options',
    phase1Warning: 'Phase 1: only axis-aligned rectangle profiles are supported.',
    depth: 'Depth',
    thickness: 'Wall thickness',
    openTop: 'Open top face',
    openBottom: 'Open bottom face',
    submit: 'Shell',
    cancel: 'Cancel',
    rendering: 'Rendering...',
    scadHeading: 'SCAD source',
    pngHeading: 'Preview',
    stlHeading: '3D view',
    errorPrefix: 'Error',
  },
  ja: {
    modalTitle: 'シェル設定',
    phase1Warning: 'Phase 1: 軸並行の矩形プロファイルのみ対応。',
    depth: '深さ',
    thickness: '壁厚',
    openTop: '上面開放',
    openBottom: '下面開放',
    submit: 'シェル',
    cancel: 'キャンセル',
    rendering: 'レンダリング中...',
    scadHeading: 'SCADソース',
    pngHeading: 'プレビュー',
    stlHeading: '3Dビュー',
    errorPrefix: 'エラー',
  },
  zh: {
    modalTitle: '抽壳选项',
    phase1Warning: 'Phase 1: 仅支持轴对齐矩形轮廓。',
    depth: '深度',
    thickness: '壁厚',
    openTop: '开顶面',
    openBottom: '开底面',
    submit: '抽壳',
    cancel: '取消',
    rendering: '渲染中...',
    scadHeading: 'SCAD源',
    pngHeading: '预览',
    stlHeading: '3D视图',
    errorPrefix: '错误',
  },
  es: {
    modalTitle: 'Opciones de vaciado',
    phase1Warning: 'Fase 1: solo se admiten perfiles rectangulares alineados con los ejes.',
    depth: 'Profundidad',
    thickness: 'Grosor de pared',
    openTop: 'Abrir cara superior',
    openBottom: 'Abrir cara inferior',
    submit: 'Vaciar',
    cancel: 'Cancelar',
    rendering: 'Renderizando...',
    scadHeading: 'Fuente SCAD',
    pngHeading: 'Vista previa',
    stlHeading: 'Vista 3D',
    errorPrefix: 'Error',
  },
  ar: {
    modalTitle: 'خيارات القشرة',
    phase1Warning: 'المرحلة 1: المستطيلات المحاذية للمحاور فقط مدعومة.',
    depth: 'العمق',
    thickness: 'سُمك الجدار',
    openTop: 'فتح الوجه العلوي',
    openBottom: 'فتح الوجه السفلي',
    submit: 'تقشير',
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

export interface ShellFetcherRequest {
  sketch: SolverViewState;
  depth: number;
  thickness: number;
  openTop?: boolean;
  openBottom?: boolean;
  includeStl?: boolean;
}

export type ShellFetcherResponse =
  | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string }
  | { ok: false; code: string; message: string };

export type ShellFetcher = (req: ShellFetcherRequest) => Promise<ShellFetcherResponse>;

const defaultFetcher: ShellFetcher = async (req) => {
  const res = await fetch('/api/shell-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
};

export interface ShellModalProps {
  lang: ShellLang;
  sketch: SolverViewState;
  onClose: () => void;
  /** Injectable for tests. Defaults to POST /api/shell-render. */
  shellFetcher?: ShellFetcher;
}

export default function ShellModal({
  lang,
  sketch,
  onClose,
  shellFetcher = defaultFetcher,
}: ShellModalProps): React.ReactElement {
  const t = dict[lang];

  const [depth, setDepth] = useState<string>('20');
  const [thickness, setThickness] = useState<string>('2');
  const [openTop, setOpenTop] = useState<boolean>(true);
  const [openBottom, setOpenBottom] = useState<boolean>(false);
  const [render, setRender] = useState<RenderState>({ status: 'idle' });

  const onSubmit = useCallback(async () => {
    const d = Number(depth);
    const th = Number(thickness);
    if (!Number.isFinite(d) || d <= 0) {
      setRender({ status: 'error', message: `${t.errorPrefix}: depth must be a positive number` });
      return;
    }
    if (!Number.isFinite(th) || th <= 0) {
      setRender({
        status: 'error',
        message: `${t.errorPrefix}: thickness must be a positive number`,
      });
      return;
    }
    if (th >= d / 3) {
      setRender({
        status: 'error',
        message: `${t.errorPrefix}: thickness must be < depth/3`,
      });
      return;
    }
    setRender({ status: 'loading' });
    try {
      const res = await shellFetcher({
        sketch,
        depth: d,
        thickness: th,
        openTop,
        openBottom,
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
  }, [depth, thickness, openTop, openBottom, sketch, shellFetcher, t.errorPrefix]);

  return (
    <div
      data-testid="solver-shell-modal"
      role="dialog"
      aria-labelledby="solver-shell-title"
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
        <h3 id="solver-shell-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {t.modalTitle}
        </h3>

        <div
          data-testid="solver-shell-phase1-warning"
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
            data-testid="solver-shell-depth-input"
            step="0.1"
            min="0"
            style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t.thickness}
          <input
            type="number"
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
            data-testid="solver-shell-thickness-input"
            step="0.1"
            min="0"
            style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={openTop}
            onChange={(e) => setOpenTop(e.target.checked)}
            data-testid="solver-shell-open-top-checkbox"
          />
          {t.openTop}
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={openBottom}
            onChange={(e) => setOpenBottom(e.target.checked)}
            data-testid="solver-shell-open-bottom-checkbox"
          />
          {t.openBottom}
        </label>

        {render.status === 'loading' && (
          <div style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>{t.rendering}</div>
        )}

        {render.status === 'error' && (
          <div
            data-testid="solver-shell-error"
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
                data-testid="solver-shell-scad-preview"
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
                        data-testid={`solver-shell-png-preview-${idx}`}
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
                <div data-testid="solver-shell-stl-viewer">
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
            data-testid="solver-shell-cancel"
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
            data-testid="solver-shell-submit"
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
