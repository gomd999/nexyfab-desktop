'use client';

/**
 * SweepModal — Phase 2.2 standalone modal that lets the user sweep the
 * current sketch profile along a 3D polyline path.
 *
 * Architecture:
 *   - Standalone (NOT a wrapper of SolverSketchEditor). Receives the
 *     current sketch state as a prop from the parent
 *     (SolverSketchEditorWithExtrude opens it next to its Extrude and
 *     Revolve modals).
 *   - User specifies the path as an editable list of 3D world points.
 *     At least 2 points are required (default: straight Z extrusion of 50).
 *   - Submit POSTs to /api/sweep-render (default fetcher) and shows the
 *     SCAD source, PNG previews, and an optional STL viewer.
 *
 * Test surface (data-testids — all prefixed solver-sweep-):
 *   solver-sweep-modal,
 *   solver-sweep-path-point-{idx}-{x|y|z}-input,
 *   solver-sweep-path-point-{idx}-remove,
 *   solver-sweep-path-add,
 *   solver-sweep-mode-select,
 *   solver-sweep-submit, solver-sweep-cancel,
 *   solver-sweep-scad-preview, solver-sweep-png-preview-{idx},
 *   solver-sweep-stl-viewer, solver-sweep-error.
 */

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { SweepLoftMode } from '@/lib/cad/sweepLoft';
import type { SweepPathPoint } from '@/lib/sketch/sweepFromSketch';

// StlViewer pulls in Three.js; dynamic-loaded so the sketch editor bundle
// stays small for users who never open the sweep modal.
const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: 'var(--nx-text-2)', padding: 12 }}>3D viewer loading…</div>,
});

export type SweepLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  pathHeading: string;
  pathHint: string;
  pointLabel: (idx: number) => string;
  addPoint: string;
  removePoint: string;
  mode: string;
  add: string; cut: string;
  submit: string; cancel: string;
  rendering: string;
  scadHeading: string;
  pngHeading: string;
  stlHeading: string;
  errorPrefix: string;
}

const dict: Record<SweepLang, Dict> = {
  ko: {
    modalTitle: '스윕 설정', pathHeading: '경로',
    pathHint: '프로파일을 따라갈 3D 점 (최소 2개)',
    pointLabel: (i) => `점 ${i + 1}`,
    addPoint: '점 추가', removePoint: '제거',
    mode: '연산',
    add: '추가', cut: '제거',
    submit: '스윕', cancel: '취소',
    rendering: '렌더링 중...', scadHeading: 'SCAD 소스', pngHeading: '미리보기', stlHeading: '3D 뷰',
    errorPrefix: '오류',
  },
  en: {
    modalTitle: 'Sweep options', pathHeading: 'Path',
    pathHint: '3D points the profile follows (min 2)',
    pointLabel: (i) => `Point ${i + 1}`,
    addPoint: 'Add point', removePoint: 'Remove',
    mode: 'Mode',
    add: 'Add', cut: 'Cut',
    submit: 'Sweep', cancel: 'Cancel',
    rendering: 'Rendering...', scadHeading: 'SCAD source', pngHeading: 'Preview', stlHeading: '3D view',
    errorPrefix: 'Error',
  },
  ja: {
    modalTitle: 'スイープ設定', pathHeading: 'パス',
    pathHint: 'プロファイルが追従する3D点(最小2)',
    pointLabel: (i) => `点 ${i + 1}`,
    addPoint: '点を追加', removePoint: '削除',
    mode: '操作',
    add: '追加', cut: '除去',
    submit: 'スイープ', cancel: 'キャンセル',
    rendering: 'レンダリング中...', scadHeading: 'SCADソース', pngHeading: 'プレビュー', stlHeading: '3Dビュー',
    errorPrefix: 'エラー',
  },
  zh: {
    modalTitle: '扫掠选项', pathHeading: '路径',
    pathHint: '轮廓沿其扫掠的3D点(至少2个)',
    pointLabel: (i) => `点 ${i + 1}`,
    addPoint: '添加点', removePoint: '删除',
    mode: '模式',
    add: '增加', cut: '切除',
    submit: '扫掠', cancel: '取消',
    rendering: '渲染中...', scadHeading: 'SCAD源', pngHeading: '预览', stlHeading: '3D视图',
    errorPrefix: '错误',
  },
  es: {
    modalTitle: 'Opciones de barrido', pathHeading: 'Trayecto',
    pathHint: 'Puntos 3D que sigue el perfil (mín 2)',
    pointLabel: (i) => `Punto ${i + 1}`,
    addPoint: 'Añadir punto', removePoint: 'Eliminar',
    mode: 'Modo',
    add: 'Añadir', cut: 'Cortar',
    submit: 'Barrido', cancel: 'Cancelar',
    rendering: 'Renderizando...', scadHeading: 'Fuente SCAD', pngHeading: 'Vista previa', stlHeading: 'Vista 3D',
    errorPrefix: 'Error',
  },
  ar: {
    modalTitle: 'خيارات الكنس', pathHeading: 'المسار',
    pathHint: 'نقاط ثلاثية الأبعاد يتبعها الملف الجانبي (الحد الأدنى 2)',
    pointLabel: (i) => `النقطة ${i + 1}`,
    addPoint: 'إضافة نقطة', removePoint: 'حذف',
    mode: 'الوضع',
    add: 'إضافة', cut: 'قص',
    submit: 'كنس', cancel: 'إلغاء',
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

export interface SweepFetcherRequest {
  sketch: SolverViewState;
  path: ReadonlyArray<SweepPathPoint>;
  mode: SweepLoftMode;
  includeStl?: boolean;
}

export type SweepFetcherResponse =
  | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string }
  | { ok: false; code: string; message: string };

export type SweepFetcher = (req: SweepFetcherRequest) => Promise<SweepFetcherResponse>;

const defaultFetcher: SweepFetcher = async (req) => {
  const res = await fetch('/api/sweep-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
};

/** Path point in string form so inputs stay controlled while users type. */
interface PathPointDraft {
  x: string;
  y: string;
  z: string;
}

const DEFAULT_DRAFT_PATH: PathPointDraft[] = [
  { x: '0', y: '0', z: '0' },
  { x: '0', y: '0', z: '50' },
];

export interface SweepModalProps {
  lang: SweepLang;
  sketch: SolverViewState;
  onClose: () => void;
  /** Injectable for tests. Defaults to POST /api/sweep-render. */
  sweepFetcher?: SweepFetcher;
}

export default function SweepModal({
  lang,
  sketch,
  onClose,
  sweepFetcher = defaultFetcher,
}: SweepModalProps): React.ReactElement {
  const t = dict[lang];

  const [path, setPath] = useState<PathPointDraft[]>(() =>
    DEFAULT_DRAFT_PATH.map((p) => ({ ...p })),
  );
  const [mode, setMode] = useState<SweepLoftMode>('add');
  const [render, setRender] = useState<RenderState>({ status: 'idle' });

  const updatePoint = useCallback((idx: number, field: keyof PathPointDraft, value: string) => {
    setPath((prev) => {
      const next = prev.map((p) => ({ ...p }));
      const target = next[idx];
      if (!target) return prev;
      target[field] = value;
      return next;
    });
  }, []);

  const addPoint = useCallback(() => {
    setPath((prev) => {
      // Seed the new point as a small Z-extension of the last one so the
      // path stays non-degenerate by default.
      const last = prev[prev.length - 1] ?? { x: '0', y: '0', z: '0' };
      const lz = Number(last.z);
      const nextZ = Number.isFinite(lz) ? lz + 50 : 50;
      return [...prev, { x: last.x, y: last.y, z: String(nextZ) }];
    });
  }, []);

  const removePoint = useCallback((idx: number) => {
    setPath((prev) => {
      if (prev.length <= 2) return prev; // enforce min 2 points
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const onSubmit = useCallback(async () => {
    if (path.length < 2) {
      setRender({ status: 'error', message: `${t.errorPrefix}: path must have at least 2 points` });
      return;
    }
    const parsed: SweepPathPoint[] = [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!;
      const x = Number(p.x);
      const y = Number(p.y);
      const z = Number(p.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        setRender({ status: 'error', message: `${t.errorPrefix}: point ${i + 1} coordinates must be numbers` });
        return;
      }
      parsed.push({ x, y, z });
    }
    for (let i = 1; i < parsed.length; i++) {
      const a = parsed[i - 1]!;
      const b = parsed[i]!;
      if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 1e-9) {
        setRender({ status: 'error', message: `${t.errorPrefix}: path segment ${i}→${i + 1} is zero-length` });
        return;
      }
    }
    setRender({ status: 'loading' });
    try {
      const res = await sweepFetcher({
        sketch,
        path: parsed,
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
  }, [path, mode, sketch, sweepFetcher, t.errorPrefix]);

  return (
    <div
      data-testid="solver-sweep-modal"
      role="dialog"
      aria-labelledby="solver-sweep-title"
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
        background: 'var(--nx-panel)',
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
        <h3 id="solver-sweep-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t.modalTitle}</h3>

        <fieldset style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--nx-border)', borderRadius: 4, padding: 8 }}>
          <legend style={{ padding: '0 4px', fontSize: 12, fontWeight: 600 }}>{t.pathHeading}</legend>
          <div style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{t.pathHint}</div>

          {path.map((pt, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ fontSize: 11, color: 'var(--nx-text-2)', minWidth: 48, paddingBottom: 6 }}>
                {t.pointLabel(idx)}
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: 1 }}>
                x
                <input
                  type="number"
                  value={pt.x}
                  onChange={(e) => updatePoint(idx, 'x', e.target.value)}
                  data-testid={`solver-sweep-path-point-${idx}-x-input`}
                  step="0.1"
                  style={{ padding: 6, fontSize: 13, border: '1px solid var(--nx-border)', borderRadius: 4 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: 1 }}>
                y
                <input
                  type="number"
                  value={pt.y}
                  onChange={(e) => updatePoint(idx, 'y', e.target.value)}
                  data-testid={`solver-sweep-path-point-${idx}-y-input`}
                  step="0.1"
                  style={{ padding: 6, fontSize: 13, border: '1px solid var(--nx-border)', borderRadius: 4 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: 1 }}>
                z
                <input
                  type="number"
                  value={pt.z}
                  onChange={(e) => updatePoint(idx, 'z', e.target.value)}
                  data-testid={`solver-sweep-path-point-${idx}-z-input`}
                  step="0.1"
                  style={{ padding: 6, fontSize: 13, border: '1px solid var(--nx-border)', borderRadius: 4 }}
                />
              </label>
              <button
                type="button"
                onClick={() => removePoint(idx)}
                disabled={path.length <= 2}
                data-testid={`solver-sweep-path-point-${idx}-remove`}
                aria-label={t.removePoint}
                style={{
                  padding: '6px 8px',
                  fontSize: 11,
                  background: path.length <= 2 ? '#f3f4f6' : '#fef2f2',
                  color: path.length <= 2 ? '#9ca3af' : '#dc2626',
                  border: '1px solid',
                  borderColor: path.length <= 2 ? '#e5e7eb' : '#fecaca',
                  borderRadius: 4,
                  cursor: path.length <= 2 ? 'not-allowed' : 'pointer',
                  alignSelf: 'flex-end',
                }}
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addPoint}
            data-testid="solver-sweep-path-add"
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
            + {t.addPoint}
          </button>
        </fieldset>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t.mode}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as SweepLoftMode)}
            data-testid="solver-sweep-mode-select"
            style={{ padding: 6, fontSize: 13, border: '1px solid var(--nx-border)', borderRadius: 4 }}
          >
            <option value="add">{t.add}</option>
            <option value="cut">{t.cut}</option>
          </select>
        </label>

        {render.status === 'loading' && (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--nx-text-2)' }}>
            {t.rendering}
          </div>
        )}

        {render.status === 'error' && (
          <div
            data-testid="solver-sweep-error"
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
                data-testid="solver-sweep-scad-preview"
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
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      { }
                      <img
                        data-testid={`solver-sweep-png-preview-${idx}`}
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
                <div data-testid="solver-sweep-stl-viewer">
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
            data-testid="solver-sweep-cancel"
            style={{ padding: '8px 16px', fontSize: 13, background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={render.status === 'loading'}
            data-testid="solver-sweep-submit"
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
