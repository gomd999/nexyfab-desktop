'use client';

/**
 * LoftModal — Phase 2.2 standalone modal that lets the user loft the
 * current sketch profile across two or more parallel z planes.
 *
 * Architecture:
 *   - Standalone (NOT a wrapper of SolverSketchEditor). Receives the
 *     current sketch state as a prop from the parent
 *     (SolverSketchEditorWithExtrude will open it next to the existing
 *     Extrude / Revolve modals — wiring done in a follow-up).
 *   - User specifies 2+ sections by z value; each section's `source`
 *     decides which sketch supplies the loop. Phase 1 only exposes
 *     source='current' (the modal's sketch prop) — see below.
 *   - Submit POSTs to /api/loft-render (default fetcher) and shows the
 *     SCAD source, PNG previews, and an optional STL viewer.
 *
 * ─── PHASE 1 LIMITATION ─────────────────────────────────────────────
 *
 * The IR + serializer in `sweepLoft.ts` support arbitrary sections, but
 * Phase 2.2 requires matching point counts between sections. The minimal
 * useful case this modal exposes today is:
 *
 *   - 2 sections, both source='current' (the modal's `sketch` prop),
 *     at z=0 (top) and z=user_input (bottom).
 *
 * Because both sections reference the same sketch, point counts always
 * match. Phase 2 will add an `external` source picker (a second sketch
 * from the project) once cross-sketch ID matching is wired up.
 *
 * Test surface (data-testids — all prefixed solver-loft-):
 *   solver-loft-modal,
 *   solver-loft-section-{idx}-z-input,
 *   solver-loft-section-{idx}-source-select,
 *   solver-loft-add-section, solver-loft-remove-section-{idx},
 *   solver-loft-mode-select,
 *   solver-loft-submit, solver-loft-cancel,
 *   solver-loft-scad-preview, solver-loft-png-preview-{idx},
 *   solver-loft-stl-viewer, solver-loft-error.
 */

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { SweepLoftMode } from '@/lib/cad/sweepLoft';

// StlViewer pulls in Three.js; dynamic-loaded so the sketch editor bundle
// stays small for users who never open the loft modal.
const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: 'var(--nx-text-2)', padding: 12 }}>3D viewer loading…</div>,
});

export type LoftLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  sectionsHeading: string;
  sectionLabel: (idx: number) => string;
  zLabel: string;
  sourceLabel: string;
  sourceCurrent: string;
  sourceExternal: string;
  addSection: string;
  removeSection: string;
  mode: string;
  add: string; cut: string;
  submit: string; cancel: string;
  rendering: string;
  scadHeading: string;
  pngHeading: string;
  stlHeading: string;
  errorPrefix: string;
  phase1Note: string;
}

const dict: Record<LoftLang, Dict> = {
  ko: {
    modalTitle: '로프트 설정', sectionsHeading: '단면 (2개 이상)',
    sectionLabel: (i) => `단면 ${i + 1}`,
    zLabel: 'z 높이', sourceLabel: '소스',
    sourceCurrent: '현재 스케치', sourceExternal: '외부 스케치',
    addSection: '단면 추가', removeSection: '제거',
    mode: '연산', add: '추가', cut: '제거',
    submit: '로프트', cancel: '취소',
    rendering: '렌더링 중...', scadHeading: 'SCAD 소스', pngHeading: '미리보기', stlHeading: '3D 뷰',
    errorPrefix: '오류',
    phase1Note: 'Phase 1: 같은 스케치를 여러 z 위치에 로프트합니다 (외부 스케치는 Phase 2에서 추가).',
  },
  en: {
    modalTitle: 'Loft options', sectionsHeading: 'Sections (2+)',
    sectionLabel: (i) => `Section ${i + 1}`,
    zLabel: 'z height', sourceLabel: 'Source',
    sourceCurrent: 'Current sketch', sourceExternal: 'External sketch',
    addSection: 'Add section', removeSection: 'Remove',
    mode: 'Mode', add: 'Add', cut: 'Cut',
    submit: 'Loft', cancel: 'Cancel',
    rendering: 'Rendering...', scadHeading: 'SCAD source', pngHeading: 'Preview', stlHeading: '3D view',
    errorPrefix: 'Error',
    phase1Note: 'Phase 1: lofts the same sketch across z planes (external sketches arrive in Phase 2).',
  },
  ja: {
    modalTitle: 'ロフト設定', sectionsHeading: '断面 (2つ以上)',
    sectionLabel: (i) => `断面 ${i + 1}`,
    zLabel: 'z 高さ', sourceLabel: 'ソース',
    sourceCurrent: '現在のスケッチ', sourceExternal: '外部スケッチ',
    addSection: '断面を追加', removeSection: '削除',
    mode: '操作', add: '追加', cut: '除去',
    submit: 'ロフト', cancel: 'キャンセル',
    rendering: 'レンダリング中...', scadHeading: 'SCADソース', pngHeading: 'プレビュー', stlHeading: '3Dビュー',
    errorPrefix: 'エラー',
    phase1Note: 'Phase 1: 同じスケッチを複数のz位置でロフトします (外部スケッチはPhase 2)。',
  },
  zh: {
    modalTitle: '放样选项', sectionsHeading: '截面 (2 个以上)',
    sectionLabel: (i) => `截面 ${i + 1}`,
    zLabel: 'z 高度', sourceLabel: '来源',
    sourceCurrent: '当前草图', sourceExternal: '外部草图',
    addSection: '添加截面', removeSection: '移除',
    mode: '模式', add: '增加', cut: '切除',
    submit: '放样', cancel: '取消',
    rendering: '渲染中...', scadHeading: 'SCAD源', pngHeading: '预览', stlHeading: '3D视图',
    errorPrefix: '错误',
    phase1Note: 'Phase 1: 在多个z位置放样同一草图 (外部草图将在Phase 2加入)。',
  },
  es: {
    modalTitle: 'Opciones de loft', sectionsHeading: 'Secciones (2+)',
    sectionLabel: (i) => `Sección ${i + 1}`,
    zLabel: 'altura z', sourceLabel: 'Origen',
    sourceCurrent: 'Boceto actual', sourceExternal: 'Boceto externo',
    addSection: 'Añadir sección', removeSection: 'Eliminar',
    mode: 'Modo', add: 'Añadir', cut: 'Cortar',
    submit: 'Loft', cancel: 'Cancelar',
    rendering: 'Renderizando...', scadHeading: 'Fuente SCAD', pngHeading: 'Vista previa', stlHeading: 'Vista 3D',
    errorPrefix: 'Error',
    phase1Note: 'Phase 1: usa el mismo boceto en varios planos z (los externos llegarán en Phase 2).',
  },
  ar: {
    modalTitle: 'خيارات اللوفت', sectionsHeading: 'المقاطع (2+)',
    sectionLabel: (i) => `المقطع ${i + 1}`,
    zLabel: 'ارتفاع z', sourceLabel: 'المصدر',
    sourceCurrent: 'الرسم الحالي', sourceExternal: 'رسم خارجي',
    addSection: 'إضافة مقطع', removeSection: 'إزالة',
    mode: 'الوضع', add: 'إضافة', cut: 'قص',
    submit: 'لوفت', cancel: 'إلغاء',
    rendering: 'جارٍ التصيير...', scadHeading: 'مصدر SCAD', pngHeading: 'معاينة', stlHeading: 'عرض ثلاثي الأبعاد',
    errorPrefix: 'خطأ',
    phase1Note: 'Phase 1: يلف نفس الرسم عبر مستويات z (الرسوم الخارجية في Phase 2).',
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

export type LoftSectionSource = 'current' | 'external';

export interface LoftFetcherSection {
  /** Phase 1: always the modal's `sketch` prop. */
  sketch: SolverViewState;
  z: number;
}

export interface LoftFetcherRequest {
  sections: LoftFetcherSection[];
  mode: SweepLoftMode;
  includeStl?: boolean;
}

export type LoftFetcherResponse =
  | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string }
  | { ok: false; code: string; message: string };

export type LoftFetcher = (req: LoftFetcherRequest) => Promise<LoftFetcherResponse>;

const defaultFetcher: LoftFetcher = async (req) => {
  const res = await fetch('/api/loft-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
};

interface SectionRow {
  /** Stored as string so the user can type intermediate values like '-' or '.'. */
  z: string;
  source: LoftSectionSource;
}

export interface LoftModalProps {
  lang: LoftLang;
  sketch: SolverViewState;
  onClose: () => void;
  /** Injectable for tests. Defaults to POST /api/loft-render. */
  loftFetcher?: LoftFetcher;
}

export default function LoftModal({
  lang,
  sketch,
  onClose,
  loftFetcher = defaultFetcher,
}: LoftModalProps): React.ReactElement {
  const t = dict[lang];

  // Phase 1 default: 2 sections of the same sketch at z=0 and z=10.
  const [sections, setSections] = useState<SectionRow[]>([
    { z: '0', source: 'current' },
    { z: '10', source: 'current' },
  ]);
  const [mode, setMode] = useState<SweepLoftMode>('add');
  const [render, setRender] = useState<RenderState>({ status: 'idle' });

  const updateSection = useCallback((idx: number, patch: Partial<SectionRow>) => {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }, []);

  const addSection = useCallback(() => {
    setSections((prev) => {
      const lastZ = Number(prev[prev.length - 1]?.z ?? '0');
      const nextZ = Number.isFinite(lastZ) ? lastZ + 10 : 10;
      return [...prev, { z: String(nextZ), source: 'current' }];
    });
  }, []);

  const removeSection = useCallback((idx: number) => {
    setSections((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)));
  }, []);

  const onSubmit = useCallback(async () => {
    if (sections.length < 2) {
      setRender({ status: 'error', message: `${t.errorPrefix}: need at least 2 sections` });
      return;
    }
    const parsed: { z: number; source: LoftSectionSource }[] = [];
    for (let i = 0; i < sections.length; i++) {
      const raw = sections[i]!.z.trim();
      const z = Number(raw);
      if (raw === '' || !Number.isFinite(z)) {
        setRender({ status: 'error', message: `${t.errorPrefix}: section ${i + 1} z must be a number` });
        return;
      }
      parsed.push({ z, source: sections[i]!.source });
    }
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i]!.z <= parsed[i - 1]!.z) {
        setRender({
          status: 'error',
          message: `${t.errorPrefix}: sections must be monotonically ascending in z (section ${i + 1} z=${parsed[i]!.z} ≤ section ${i} z=${parsed[i - 1]!.z})`,
        });
        return;
      }
    }
    setRender({ status: 'loading' });
    try {
      // Phase 1: all sections use the modal's `sketch` prop regardless of
      // source selection. The select is wired but external sketches still
      // resolve to the same `sketch` so the request validates.
      const res = await loftFetcher({
        sections: parsed.map((p) => ({ sketch, z: p.z })),
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
  }, [sections, mode, sketch, loftFetcher, t.errorPrefix]);

  return (
    <div
      data-testid="solver-loft-modal"
      role="dialog"
      aria-labelledby="solver-loft-title"
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
        <h3 id="solver-loft-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t.modalTitle}</h3>

        <div
          data-testid="solver-loft-phase1-note"
          style={{
            fontSize: 11,
            color: 'var(--nx-text-2)',
            background: 'var(--nx-panel-2)',
            border: '1px solid var(--nx-border)',
            borderRadius: 4,
            padding: 8,
          }}
        >
          {t.phase1Note}
        </div>

        <fieldset style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--nx-border)', borderRadius: 4, padding: 8 }}>
          <legend style={{ padding: '0 4px', fontSize: 12, fontWeight: 600 }}>{t.sectionsHeading}</legend>

          {sections.map((s, idx) => (
            <div
              key={idx}
              data-testid={`solver-loft-section-${idx}`}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}
            >
              <span style={{ fontSize: 11, color: 'var(--nx-text-2)', minWidth: 60 }}>{t.sectionLabel(idx)}</span>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: 1 }}>
                {t.zLabel}
                <input
                  type="number"
                  value={s.z}
                  onChange={(e) => updateSection(idx, { z: e.target.value })}
                  data-testid={`solver-loft-section-${idx}-z-input`}
                  step="0.1"
                  style={{ padding: 6, fontSize: 13, border: '1px solid var(--nx-border)', borderRadius: 4 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: 1 }}>
                {t.sourceLabel}
                <select
                  value={s.source}
                  onChange={(e) => updateSection(idx, { source: e.target.value as LoftSectionSource })}
                  data-testid={`solver-loft-section-${idx}-source-select`}
                  style={{ padding: 6, fontSize: 13, border: '1px solid var(--nx-border)', borderRadius: 4 }}
                >
                  <option value="current">{t.sourceCurrent}</option>
                  {/* External is shown but Phase 1 silently uses the current sketch. */}
                  <option value="external" disabled>{t.sourceExternal}</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => removeSection(idx)}
                disabled={sections.length <= 2}
                data-testid={`solver-loft-remove-section-${idx}`}
                style={{
                  padding: '6px 10px',
                  fontSize: 11,
                  background: sections.length <= 2 ? '#f3f4f6' : '#fef2f2',
                  color: sections.length <= 2 ? '#9ca3af' : '#dc2626',
                  border: '1px solid var(--nx-border)',
                  borderRadius: 4,
                  cursor: sections.length <= 2 ? 'not-allowed' : 'pointer',
                }}
              >
                {t.removeSection}
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addSection}
            data-testid="solver-loft-add-section"
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
            {t.addSection}
          </button>
        </fieldset>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t.mode}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as SweepLoftMode)}
            data-testid="solver-loft-mode-select"
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
            data-testid="solver-loft-error"
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
                data-testid="solver-loft-scad-preview"
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
                        data-testid={`solver-loft-png-preview-${idx}`}
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
                <div data-testid="solver-loft-stl-viewer">
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
            data-testid="solver-loft-cancel"
            style={{ padding: '8px 16px', fontSize: 13, background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={render.status === 'loading'}
            data-testid="solver-loft-submit"
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
