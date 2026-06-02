'use client';

/**
 * SolverSketchEditorWithExtrude — Phase 2.A wrapper of SolverSketchEditor
 * adding an "Extrude" button + depth/options modal + SCAD/PNG preview pane.
 *
 * Architecture:
 *   - Wraps the unchanged SolverSketchEditor (Phase 1.3 sibling stays as-is).
 *   - Listens to `onSketchChange` to mirror the current sketch state locally.
 *   - "Extrude" button opens a modal with depth + direction + mode inputs.
 *   - On submit: POST /api/extrude-render → renders to SCAD + PNG → shows preview.
 *
 * Test surface (data-testids):
 *   solver-extrude-button, solver-extrude-modal,
 *   solver-extrude-depth-input, solver-extrude-submit, solver-extrude-cancel,
 *   solver-extrude-scad-preview, solver-extrude-png-preview-{idx},
 *   solver-extrude-error.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import SolverSketchEditor, { type SolverSketchEditorProps } from './SolverSketchEditor';
import RevolveModal, { type RevolveFetcher, type RevolveLang } from './RevolveModal';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { ExtrudeDirection, ExtrudeMode } from '@/lib/cad/extrudeProfile';
import type { AxisLine2D } from '@/lib/cad/revolveProfile';

// StlViewer pulls in Three.js + STLLoader; dynamic-loaded to keep the
// Sketch editor bundle small for users who never click Extrude.
const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>3D viewer loading…</div>,
});

type Lang = NonNullable<SolverSketchEditorProps['lang']>;

interface Dict {
  extrude: string;
  revolve: string;
  modalTitle: string;
  depth: string;
  direction: string;
  mode: string;
  draft: string;
  oneSided: string; twoSided: string; midplane: string;
  add: string; cut: string;
  submit: string; cancel: string;
  rendering: string;
  scadHeading: string;
  pngHeading: string;
  errorPrefix: string;
}

const dict: Record<Lang, Dict> = {
  ko: {
    extrude: '돌출', revolve: '회전', modalTitle: '돌출 설정', depth: '깊이 (mm)', direction: '방향', mode: '연산', draft: '드래프트 각도(°)',
    oneSided: '한 방향', twoSided: '양 방향', midplane: '중심면',
    add: '추가', cut: '제거',
    submit: '돌출', cancel: '취소',
    rendering: '렌더링 중...', scadHeading: 'SCAD 소스', pngHeading: '미리보기',
    errorPrefix: '오류',
  },
  en: {
    extrude: 'Extrude', revolve: 'Revolve', modalTitle: 'Extrude options', depth: 'Depth (mm)', direction: 'Direction', mode: 'Mode', draft: 'Draft angle (°)',
    oneSided: 'One-sided', twoSided: 'Two-sided', midplane: 'Midplane',
    add: 'Add', cut: 'Cut',
    submit: 'Extrude', cancel: 'Cancel',
    rendering: 'Rendering...', scadHeading: 'SCAD source', pngHeading: 'Preview',
    errorPrefix: 'Error',
  },
  ja: {
    extrude: '押し出し', revolve: '回転', modalTitle: '押し出し設定', depth: '深さ (mm)', direction: '方向', mode: '操作', draft: 'ドラフト角度(°)',
    oneSided: '片側', twoSided: '両側', midplane: '中央面',
    add: '追加', cut: '除去',
    submit: '押し出し', cancel: 'キャンセル',
    rendering: 'レンダリング中...', scadHeading: 'SCADソース', pngHeading: 'プレビュー',
    errorPrefix: 'エラー',
  },
  zh: {
    extrude: '拉伸', revolve: '旋转', modalTitle: '拉伸选项', depth: '深度 (mm)', direction: '方向', mode: '模式', draft: '拔模角度(°)',
    oneSided: '单向', twoSided: '双向', midplane: '中面',
    add: '增加', cut: '切除',
    submit: '拉伸', cancel: '取消',
    rendering: '渲染中...', scadHeading: 'SCAD源', pngHeading: '预览',
    errorPrefix: '错误',
  },
  es: {
    extrude: 'Extruir', revolve: 'Revolver', modalTitle: 'Opciones de extrusión', depth: 'Profundidad (mm)', direction: 'Dirección', mode: 'Modo', draft: 'Ángulo de salida(°)',
    oneSided: 'Un lado', twoSided: 'Dos lados', midplane: 'Plano medio',
    add: 'Añadir', cut: 'Cortar',
    submit: 'Extruir', cancel: 'Cancelar',
    rendering: 'Renderizando...', scadHeading: 'Fuente SCAD', pngHeading: 'Vista previa',
    errorPrefix: 'Error',
  },
  ar: {
    extrude: 'بثق', revolve: 'دوران', modalTitle: 'خيارات البثق', depth: 'العمق (مم)', direction: 'الاتجاه', mode: 'الوضع', draft: 'زاوية المسودة(°)',
    oneSided: 'جانب واحد', twoSided: 'جانبان', midplane: 'مستوى متوسط',
    add: 'إضافة', cut: 'قص',
    submit: 'بثق', cancel: 'إلغاء',
    rendering: 'جارٍ التصيير...', scadHeading: 'مصدر SCAD', pngHeading: 'معاينة',
    errorPrefix: 'خطأ',
  },
};

interface RenderResult {
  scad: string;
  pngs: { label: string; base64: string }[];
  /** Binary STL bytes as base64 (Phase 2.A.4 — Three.js viewer). */
  stl?: string;
}

type RenderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: RenderResult }
  | { status: 'error'; message: string };

interface ExtrudeFetcher {
  (req: {
    sketch: SolverViewState;
    depth: number;
    draftDegrees?: number;
    direction: ExtrudeDirection;
    mode: ExtrudeMode;
    includeStl?: boolean;
  }): Promise<
    | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string }
    | { ok: false; code: string; message: string }
  >;
}

const defaultFetcher: ExtrudeFetcher = async (req) => {
  const res = await fetch('/api/extrude-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
};

export interface SolverSketchEditorWithExtrudeProps extends SolverSketchEditorProps {
  /** Injectable fetcher for tests. Defaults to POST /api/extrude-render. */
  extrudeFetcher?: ExtrudeFetcher;
  /** Injectable fetcher for tests. Defaults to POST /api/revolve-render. */
  revolveFetcher?: RevolveFetcher;
  /**
   * Optional axis hint forwarded to the Revolve modal — e.g., a selected
   * line in the sketch. The modal renders a "use this as axis" button.
   */
  revolveAxisHint?: AxisLine2D;
}

export default function SolverSketchEditorWithExtrude(
  props: SolverSketchEditorWithExtrudeProps,
): React.ReactElement {
  const { extrudeFetcher = defaultFetcher, revolveFetcher, revolveAxisHint, ...editorProps } = props;
  const t = dict[(editorProps.lang ?? 'en') as Lang];

  const [sketch, setSketch] = useState<SolverViewState>({ points: [], lines: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [revolveOpen, setRevolveOpen] = useState(false);
  const [depth, setDepth] = useState<string>('10');
  const [direction, setDirection] = useState<ExtrudeDirection>('one_sided');
  const [mode, setMode] = useState<ExtrudeMode>('add');
  const [draftDegrees, setDraftDegrees] = useState<string>('0');
  const [render, setRender] = useState<RenderState>({ status: 'idle' });

  // Keep a stable callback to avoid re-renders inside the wrapped editor.
  const handleSketchChange = useCallback((s: SolverViewState) => {
    setSketch(s);
  }, []);

  // Merge our handler with any user-supplied onSketchChange.
  const composedOnSketchChange = useMemo(() => {
    const userHandler = editorProps.onSketchChange;
    if (!userHandler) return handleSketchChange;
    return (s: SolverViewState) => {
      userHandler(s);
      handleSketchChange(s);
    };
  }, [editorProps.onSketchChange, handleSketchChange]);

  const canExtrude = sketch.points.length >= 3 && sketch.lines.length >= 3;
  const canRevolve = canExtrude;

  const onSubmit = useCallback(async () => {
    const d = Number(depth);
    if (!Number.isFinite(d) || d <= 0) {
      setRender({ status: 'error', message: `${t.errorPrefix}: depth must be > 0` });
      return;
    }
    const draftN = Number(draftDegrees);
    setRender({ status: 'loading' });
    try {
      const res = await extrudeFetcher({
        sketch,
        depth: d,
        draftDegrees: Number.isFinite(draftN) && draftN !== 0 ? draftN : undefined,
        direction,
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
  }, [depth, draftDegrees, direction, mode, sketch, extrudeFetcher, t.errorPrefix]);

  // Reset preview when modal closes.
  useEffect(() => {
    if (!modalOpen) {
      setRender({ status: 'idle' });
    }
  }, [modalOpen]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SolverSketchEditor {...editorProps} onSketchChange={composedOnSketchChange} />

      {/* Operation toolbar */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={!canExtrude}
          onClick={() => setModalOpen(true)}
          data-testid="solver-extrude-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canExtrude ? '#16a34a' : '#e5e7eb',
            color: canExtrude ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canExtrude ? '#15803d' : '#d1d5db'),
            borderRadius: 6,
            cursor: canExtrude ? 'pointer' : 'not-allowed',
          }}
        >
          ⬆ {t.extrude}
        </button>
        <button
          type="button"
          disabled={!canRevolve}
          onClick={() => setRevolveOpen(true)}
          data-testid="solver-revolve-button"
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: canRevolve ? '#0ea5e9' : '#e5e7eb',
            color: canRevolve ? '#fff' : '#9ca3af',
            border: '1px solid ' + (canRevolve ? '#0284c7' : '#d1d5db'),
            borderRadius: 6,
            cursor: canRevolve ? 'pointer' : 'not-allowed',
          }}
        >
          ↻ {t.revolve}
        </button>
      </div>

      {/* Revolve modal (sibling of the Extrude modal) */}
      {revolveOpen && (
        <RevolveModal
          lang={(editorProps.lang ?? 'en') as RevolveLang}
          sketch={sketch}
          axisHint={revolveAxisHint}
          onClose={() => setRevolveOpen(false)}
          revolveFetcher={revolveFetcher}
        />
      )}

      {/* Modal */}
      {modalOpen && (
        <div
          data-testid="solver-extrude-modal"
          role="dialog"
          aria-labelledby="solver-extrude-title"
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div style={{
            background: '#fff',
            padding: 20,
            borderRadius: 8,
            maxWidth: 600,
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <h3 id="solver-extrude-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t.modalTitle}</h3>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.depth}
              <input
                type="number"
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
                data-testid="solver-extrude-depth-input"
                step="0.1"
                min="0.1"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.direction}
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as ExtrudeDirection)}
                data-testid="solver-extrude-direction-select"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              >
                <option value="one_sided">{t.oneSided}</option>
                <option value="two_sided">{t.twoSided}</option>
                <option value="midplane">{t.midplane}</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.mode}
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ExtrudeMode)}
                data-testid="solver-extrude-mode-select"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              >
                <option value="add">{t.add}</option>
                <option value="cut">{t.cut}</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.draft}
              <input
                type="number"
                value={draftDegrees}
                onChange={(e) => setDraftDegrees(e.target.value)}
                data-testid="solver-extrude-draft-input"
                step="1"
                min="-30"
                max="30"
                style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
              />
            </label>

            {render.status === 'loading' && (
              <div style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>
                {t.rendering}
              </div>
            )}

            {render.status === 'error' && (
              <div
                data-testid="solver-extrude-error"
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
                    data-testid="solver-extrude-scad-preview"
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
                            data-testid={`solver-extrude-png-preview-${idx}`}
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
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                data-testid="solver-extrude-cancel"
                style={{ padding: '8px 16px', fontSize: 13, background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={render.status === 'loading'}
                data-testid="solver-extrude-submit"
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: render.status === 'loading' ? '#e5e7eb' : '#16a34a',
                  color: render.status === 'loading' ? '#9ca3af' : '#fff',
                  border: '1px solid #15803d',
                  borderRadius: 4,
                  cursor: render.status === 'loading' ? 'not-allowed' : 'pointer',
                }}
              >
                {t.submit}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
