'use client';

/**
 * HoleWizardModal — Phase 2.7 standalone modal that lets the user place
 * standardized holes (simple drilled / counterbore / countersink) at
 * sketch points on top of a parent extrude.
 *
 * Architecture mirrors SweepModal / RevolveModal / LoftModal:
 *   - Standalone (NOT a wrapper of SolverSketchEditor). Receives the
 *     current sketch state as a prop from the parent
 *     (SolverSketchEditorWithExtrude opens it next to its other
 *     feature modals).
 *   - User specifies parent extrude depth + a list of holes. Each hole
 *     references a sketch point id, picks a hole type, then fills in the
 *     bore + type-specific dimensions.
 *   - "Use standard" dropdown (ISO M3..M12 + ANSI UNC) auto-fills the
 *     bore diameter from the tap-drill table.
 *   - Submit POSTs to /api/hole-render (default fetcher) and shows the
 *     SCAD source, PNG previews, and an optional STL viewer.
 *
 * Test surface (data-testids — all prefixed solver-hole-):
 *   solver-hole-modal,
 *   solver-hole-extrude-depth-input,
 *   solver-hole-row-{idx}-point-select,
 *   solver-hole-row-{idx}-type-select,
 *   solver-hole-row-{idx}-diameter-input,
 *   solver-hole-row-{idx}-depth-input,
 *   solver-hole-row-{idx}-cbore-diameter-input,
 *   solver-hole-row-{idx}-cbore-depth-input,
 *   solver-hole-row-{idx}-csink-angle-input,
 *   solver-hole-row-{idx}-csink-depth-input,
 *   solver-hole-row-{idx}-standard-select,
 *   solver-hole-row-{idx}-remove,
 *   solver-hole-add,
 *   solver-hole-submit, solver-hole-cancel,
 *   solver-hole-scad-preview, solver-hole-png-preview-{idx},
 *   solver-hole-stl-viewer, solver-hole-error.
 */

import React, { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import type { HoleRequest } from '@/lib/sketch/holesFromSketch';
import type { HoleType } from '@/lib/cad/holeProfile';
import { TAP_DRILL_SPECS, tapDrillDiameter, type ThreadSpec } from '@/lib/cad/holeProfile';

// StlViewer pulls in Three.js; dynamic-loaded so the sketch editor bundle
// stays small for users who never open the hole wizard.
const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>3D viewer loading…</div>,
});

export type HoleWizardLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  extrudeDepth: string;
  extrudeDepthHint: string;
  holesHeading: string;
  rowLabel: (idx: number) => string;
  pointLabel: string;
  typeLabel: string;
  diameterLabel: string;
  depthLabel: string;
  cboreDiameter: string;
  cboreDepth: string;
  csinkAngle: string;
  csinkDepth: string;
  standardLabel: string;
  standardPlaceholder: string;
  drilled: string;
  counterbore: string;
  countersink: string;
  addHole: string;
  removeHole: string;
  submit: string;
  cancel: string;
  rendering: string;
  scadHeading: string;
  pngHeading: string;
  stlHeading: string;
  errorPrefix: string;
  noPointsHint: string;
}

const dict: Record<HoleWizardLang, Dict> = {
  ko: {
    modalTitle: '구멍 마법사', extrudeDepth: '본체 두께',
    extrudeDepthHint: '구멍을 뚫을 본체의 압출 깊이 (mm)',
    holesHeading: '구멍 목록',
    rowLabel: (i) => `구멍 ${i + 1}`,
    pointLabel: '스케치 점', typeLabel: '종류',
    diameterLabel: '지름', depthLabel: '깊이',
    cboreDiameter: '카운터보어 지름', cboreDepth: '카운터보어 깊이',
    csinkAngle: '카운터싱크 각도 (°)', csinkDepth: '카운터싱크 깊이',
    standardLabel: '표준 적용', standardPlaceholder: '— 선택 —',
    drilled: '단순 드릴', counterbore: '카운터보어', countersink: '카운터싱크',
    addHole: '구멍 추가', removeHole: '제거',
    submit: '구멍 생성', cancel: '취소',
    rendering: '렌더링 중...', scadHeading: 'SCAD 소스', pngHeading: '미리보기', stlHeading: '3D 뷰',
    errorPrefix: '오류',
    noPointsHint: '먼저 스케치에 점을 추가하세요.',
  },
  en: {
    modalTitle: 'Hole wizard', extrudeDepth: 'Parent thickness',
    extrudeDepthHint: 'Extrude depth of the parent body the holes drill into (mm)',
    holesHeading: 'Holes',
    rowLabel: (i) => `Hole ${i + 1}`,
    pointLabel: 'Sketch point', typeLabel: 'Type',
    diameterLabel: 'Diameter', depthLabel: 'Depth',
    cboreDiameter: 'Counterbore Ø', cboreDepth: 'Counterbore depth',
    csinkAngle: 'Countersink angle (°)', csinkDepth: 'Countersink depth',
    standardLabel: 'Use standard', standardPlaceholder: '— pick —',
    drilled: 'Drilled', counterbore: 'Counterbore', countersink: 'Countersink',
    addHole: 'Add hole', removeHole: 'Remove',
    submit: 'Create holes', cancel: 'Cancel',
    rendering: 'Rendering...', scadHeading: 'SCAD source', pngHeading: 'Preview', stlHeading: '3D view',
    errorPrefix: 'Error',
    noPointsHint: 'Add points to the sketch first.',
  },
  ja: {
    modalTitle: '穴ウィザード', extrudeDepth: '母材厚さ',
    extrudeDepthHint: '穴を開ける母材の押し出し深さ (mm)',
    holesHeading: '穴一覧',
    rowLabel: (i) => `穴 ${i + 1}`,
    pointLabel: 'スケッチ点', typeLabel: '種類',
    diameterLabel: '直径', depthLabel: '深さ',
    cboreDiameter: 'カウンターボア径', cboreDepth: 'カウンターボア深さ',
    csinkAngle: '皿もみ角度 (°)', csinkDepth: '皿もみ深さ',
    standardLabel: '規格を使用', standardPlaceholder: '— 選択 —',
    drilled: '通常穴', counterbore: 'カウンターボア', countersink: '皿もみ',
    addHole: '穴を追加', removeHole: '削除',
    submit: '穴を作成', cancel: 'キャンセル',
    rendering: 'レンダリング中...', scadHeading: 'SCADソース', pngHeading: 'プレビュー', stlHeading: '3Dビュー',
    errorPrefix: 'エラー',
    noPointsHint: 'まずスケッチに点を追加してください。',
  },
  zh: {
    modalTitle: '孔向导', extrudeDepth: '母体厚度',
    extrudeDepthHint: '钻孔母体的拉伸深度 (mm)',
    holesHeading: '孔列表',
    rowLabel: (i) => `孔 ${i + 1}`,
    pointLabel: '草图点', typeLabel: '类型',
    diameterLabel: '直径', depthLabel: '深度',
    cboreDiameter: '沉头孔直径', cboreDepth: '沉头孔深度',
    csinkAngle: '埋头孔角度 (°)', csinkDepth: '埋头孔深度',
    standardLabel: '使用标准', standardPlaceholder: '— 选择 —',
    drilled: '钻孔', counterbore: '沉头孔', countersink: '埋头孔',
    addHole: '添加孔', removeHole: '删除',
    submit: '创建孔', cancel: '取消',
    rendering: '渲染中...', scadHeading: 'SCAD源', pngHeading: '预览', stlHeading: '3D视图',
    errorPrefix: '错误',
    noPointsHint: '请先在草图中添加点。',
  },
  es: {
    modalTitle: 'Asistente de agujeros', extrudeDepth: 'Espesor del cuerpo',
    extrudeDepthHint: 'Profundidad de extrusión del cuerpo donde se perforan los agujeros (mm)',
    holesHeading: 'Agujeros',
    rowLabel: (i) => `Agujero ${i + 1}`,
    pointLabel: 'Punto del croquis', typeLabel: 'Tipo',
    diameterLabel: 'Diámetro', depthLabel: 'Profundidad',
    cboreDiameter: 'Ø Lamado', cboreDepth: 'Prof. lamado',
    csinkAngle: 'Ángulo avellanado (°)', csinkDepth: 'Prof. avellanado',
    standardLabel: 'Usar estándar', standardPlaceholder: '— elegir —',
    drilled: 'Taladrado', counterbore: 'Lamado', countersink: 'Avellanado',
    addHole: 'Añadir agujero', removeHole: 'Eliminar',
    submit: 'Crear agujeros', cancel: 'Cancelar',
    rendering: 'Renderizando...', scadHeading: 'Fuente SCAD', pngHeading: 'Vista previa', stlHeading: 'Vista 3D',
    errorPrefix: 'Error',
    noPointsHint: 'Añade puntos al croquis primero.',
  },
  ar: {
    modalTitle: 'معالج الثقوب', extrudeDepth: 'سمك الجسم',
    extrudeDepthHint: 'عمق بثق الجسم الأم الذي يُحفر فيه الثقب (مم)',
    holesHeading: 'الثقوب',
    rowLabel: (i) => `الثقب ${i + 1}`,
    pointLabel: 'نقطة الرسم', typeLabel: 'النوع',
    diameterLabel: 'القطر', depthLabel: 'العمق',
    cboreDiameter: 'قطر الفتحة المخفية', cboreDepth: 'عمق الفتحة المخفية',
    csinkAngle: 'زاوية الغاطس (°)', csinkDepth: 'عمق الغاطس',
    standardLabel: 'استخدم معيارًا', standardPlaceholder: '— اختر —',
    drilled: 'حفر بسيط', counterbore: 'فتحة مخفية', countersink: 'غاطس',
    addHole: 'إضافة ثقب', removeHole: 'حذف',
    submit: 'إنشاء الثقوب', cancel: 'إلغاء',
    rendering: 'جارٍ التصيير...', scadHeading: 'مصدر SCAD', pngHeading: 'معاينة', stlHeading: 'عرض ثلاثي الأبعاد',
    errorPrefix: 'خطأ',
    noPointsHint: 'أضف نقاطًا إلى الرسم أولاً.',
  },
};

interface RenderResult {
  scad: string;
  pngs: { label: string; base64: string }[];
  stl?: string;
  holeCount?: number;
}

type RenderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: RenderResult }
  | { status: 'error'; message: string };

export interface HoleFetcherRequest {
  sketch: SolverViewState;
  extrudeDepth: number;
  holes: ReadonlyArray<HoleRequest>;
  includeStl?: boolean;
}

export type HoleFetcherResponse =
  | { ok: true; scad: string; pngs: { label: string; base64: string }[]; stl?: string; holeCount?: number }
  | { ok: false; code: string; message: string };

export type HoleFetcher = (req: HoleFetcherRequest) => Promise<HoleFetcherResponse>;

const defaultFetcher: HoleFetcher = async (req) => {
  const res = await fetch('/api/hole-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
};

/** Row state in string form so the inputs stay controlled while users type. */
interface HoleRowDraft {
  pointId: string;
  holeType: HoleType;
  diameter: string;
  depth: string;
  counterboreDiameter: string;
  counterboreDepth: string;
  countersinkAngleDegrees: string;
  countersinkDepth: string;
  standard: string; // ThreadSpec | ''
}

function emptyRow(defaultPointId: string): HoleRowDraft {
  return {
    pointId: defaultPointId,
    holeType: 'drilled',
    diameter: '5',
    depth: '10',
    counterboreDiameter: '10',
    counterboreDepth: '4',
    countersinkAngleDegrees: '90',
    countersinkDepth: '3',
    standard: '',
  };
}

export interface HoleWizardModalProps {
  lang: HoleWizardLang;
  sketch: SolverViewState;
  /** Default parent extrude depth (mm). */
  defaultExtrudeDepth?: number;
  onClose: () => void;
  /** Injectable for tests. Defaults to POST /api/hole-render. */
  holeFetcher?: HoleFetcher;
}

export default function HoleWizardModal({
  lang,
  sketch,
  defaultExtrudeDepth = 20,
  onClose,
  holeFetcher = defaultFetcher,
}: HoleWizardModalProps): React.ReactElement {
  const t = dict[lang];

  const availablePointIds = useMemo(
    () => sketch.points.map((p) => p.id),
    [sketch.points],
  );
  const firstPointId = availablePointIds[0] ?? '';

  const [extrudeDepth, setExtrudeDepth] = useState<string>(String(defaultExtrudeDepth));
  const [rows, setRows] = useState<HoleRowDraft[]>(() => [emptyRow(firstPointId)]);
  const [render, setRender] = useState<RenderState>({ status: 'idle' });

  const updateRow = useCallback(
    <K extends keyof HoleRowDraft>(idx: number, field: K, value: HoleRowDraft[K]) => {
      setRows((prev) => {
        const next = prev.map((r) => ({ ...r }));
        const target = next[idx];
        if (!target) return prev;
        target[field] = value;
        return next;
      });
    },
    [],
  );

  const applyStandard = useCallback((idx: number, spec: string) => {
    if (!spec) {
      updateRow(idx, 'standard', '');
      return;
    }
    try {
      const d = tapDrillDiameter(spec as ThreadSpec);
      setRows((prev) => {
        const next = prev.map((r) => ({ ...r }));
        const target = next[idx];
        if (!target) return prev;
        target.standard = spec;
        target.diameter = String(d);
        return next;
      });
    } catch {
      // Unknown spec — leave row alone.
    }
  }, [updateRow]);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, emptyRow(firstPointId)]);
  }, [firstPointId]);

  const removeRow = useCallback((idx: number) => {
    setRows((prev) => {
      if (prev.length <= 1) return prev; // keep at least one row
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const onSubmit = useCallback(async () => {
    const depthNum = Number(extrudeDepth);
    if (!Number.isFinite(depthNum) || depthNum <= 0) {
      setRender({ status: 'error', message: `${t.errorPrefix}: ${t.extrudeDepth} must be positive` });
      return;
    }
    if (rows.length === 0) {
      setRender({ status: 'error', message: `${t.errorPrefix}: at least 1 hole required` });
      return;
    }
    const holes: HoleRequest[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      if (!r.pointId) {
        setRender({ status: 'error', message: `${t.errorPrefix}: ${t.rowLabel(i)} — ${t.pointLabel}` });
        return;
      }
      const dia = Number(r.diameter);
      const dep = Number(r.depth);
      if (!Number.isFinite(dia) || dia <= 0) {
        setRender({ status: 'error', message: `${t.errorPrefix}: ${t.rowLabel(i)} — ${t.diameterLabel}` });
        return;
      }
      if (!Number.isFinite(dep) || dep <= 0) {
        setRender({ status: 'error', message: `${t.errorPrefix}: ${t.rowLabel(i)} — ${t.depthLabel}` });
        return;
      }
      const req: HoleRequest = {
        pointId: r.pointId,
        holeType: r.holeType,
        diameter: dia,
        depth: dep,
      };
      if (r.holeType === 'counterbore') {
        const cbD = Number(r.counterboreDiameter);
        const cbH = Number(r.counterboreDepth);
        if (!Number.isFinite(cbD) || cbD <= dia) {
          setRender({ status: 'error', message: `${t.errorPrefix}: ${t.rowLabel(i)} — ${t.cboreDiameter}` });
          return;
        }
        if (!Number.isFinite(cbH) || cbH <= 0) {
          setRender({ status: 'error', message: `${t.errorPrefix}: ${t.rowLabel(i)} — ${t.cboreDepth}` });
          return;
        }
        req.counterboreDiameter = cbD;
        req.counterboreDepth = cbH;
      }
      if (r.holeType === 'countersink') {
        const ang = Number(r.countersinkAngleDegrees);
        const csH = Number(r.countersinkDepth);
        if (!Number.isFinite(ang) || ang < 82 || ang > 135) {
          setRender({ status: 'error', message: `${t.errorPrefix}: ${t.rowLabel(i)} — ${t.csinkAngle}` });
          return;
        }
        if (!Number.isFinite(csH) || csH <= 0) {
          setRender({ status: 'error', message: `${t.errorPrefix}: ${t.rowLabel(i)} — ${t.csinkDepth}` });
          return;
        }
        req.countersinkAngleDegrees = ang;
        req.countersinkDepth = csH;
      }
      holes.push(req);
    }

    setRender({ status: 'loading' });
    try {
      const res = await holeFetcher({
        sketch,
        extrudeDepth: depthNum,
        holes,
        includeStl: true,
      });
      if (res.ok) {
        setRender({
          status: 'ok',
          result: { scad: res.scad, pngs: res.pngs, stl: res.stl, holeCount: res.holeCount },
        });
      } else {
        setRender({ status: 'error', message: `${t.errorPrefix}: ${res.message}` });
      }
    } catch (e) {
      setRender({ status: 'error', message: `${t.errorPrefix}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [extrudeDepth, rows, sketch, holeFetcher, t]);

  return (
    <div
      data-testid="solver-hole-modal"
      role="dialog"
      aria-labelledby="solver-hole-title"
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
        maxWidth: 760,
        width: '94%',
        maxHeight: '92vh',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <h3 id="solver-hole-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t.modalTitle}</h3>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {t.extrudeDepth}
          <input
            type="number"
            value={extrudeDepth}
            onChange={(e) => setExtrudeDepth(e.target.value)}
            data-testid="solver-hole-extrude-depth-input"
            min={0.01}
            step={0.1}
            style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
          />
          <div style={{ fontSize: 11, color: '#6b7280' }}>{t.extrudeDepthHint}</div>
        </label>

        <fieldset style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #e5e7eb', borderRadius: 4, padding: 8 }}>
          <legend style={{ padding: '0 4px', fontSize: 12, fontWeight: 600 }}>{t.holesHeading}</legend>

          {availablePointIds.length === 0 && (
            <div style={{ fontSize: 11, color: '#dc2626' }}>{t.noPointsHint}</div>
          )}

          {rows.map((row, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 8,
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{t.rowLabel(idx)}</div>
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  disabled={rows.length <= 1}
                  data-testid={`solver-hole-row-${idx}-remove`}
                  aria-label={t.removeHole}
                  style={{
                    padding: '4px 8px',
                    fontSize: 11,
                    background: rows.length <= 1 ? '#f3f4f6' : '#fef2f2',
                    color: rows.length <= 1 ? '#9ca3af' : '#dc2626',
                    border: '1px solid',
                    borderColor: rows.length <= 1 ? '#e5e7eb' : '#fecaca',
                    borderRadius: 4,
                    cursor: rows.length <= 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  − {t.removeHole}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: '1 1 140px' }}>
                  {t.pointLabel}
                  <select
                    value={row.pointId}
                    onChange={(e) => updateRow(idx, 'pointId', e.target.value)}
                    data-testid={`solver-hole-row-${idx}-point-select`}
                    style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
                  >
                    {availablePointIds.length === 0 && (
                      <option value="">(no points)</option>
                    )}
                    {availablePointIds.map((id) => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: '1 1 140px' }}>
                  {t.typeLabel}
                  <select
                    value={row.holeType}
                    onChange={(e) => updateRow(idx, 'holeType', e.target.value as HoleType)}
                    data-testid={`solver-hole-row-${idx}-type-select`}
                    style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
                  >
                    <option value="drilled">{t.drilled}</option>
                    <option value="counterbore">{t.counterbore}</option>
                    <option value="countersink">{t.countersink}</option>
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: '1 1 140px' }}>
                  {t.standardLabel}
                  <select
                    value={row.standard}
                    onChange={(e) => applyStandard(idx, e.target.value)}
                    data-testid={`solver-hole-row-${idx}-standard-select`}
                    style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
                  >
                    <option value="">{t.standardPlaceholder}</option>
                    {TAP_DRILL_SPECS.map((spec) => (
                      <option key={spec} value={spec}>{spec}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: '1 1 140px' }}>
                  {t.diameterLabel}
                  <input
                    type="number"
                    value={row.diameter}
                    onChange={(e) => updateRow(idx, 'diameter', e.target.value)}
                    data-testid={`solver-hole-row-${idx}-diameter-input`}
                    step="0.1"
                    style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: '1 1 140px' }}>
                  {t.depthLabel}
                  <input
                    type="number"
                    value={row.depth}
                    onChange={(e) => updateRow(idx, 'depth', e.target.value)}
                    data-testid={`solver-hole-row-${idx}-depth-input`}
                    step="0.1"
                    style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
                  />
                </label>
              </div>

              {row.holeType === 'counterbore' && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: '1 1 140px' }}>
                    {t.cboreDiameter}
                    <input
                      type="number"
                      value={row.counterboreDiameter}
                      onChange={(e) => updateRow(idx, 'counterboreDiameter', e.target.value)}
                      data-testid={`solver-hole-row-${idx}-cbore-diameter-input`}
                      step="0.1"
                      style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: '1 1 140px' }}>
                    {t.cboreDepth}
                    <input
                      type="number"
                      value={row.counterboreDepth}
                      onChange={(e) => updateRow(idx, 'counterboreDepth', e.target.value)}
                      data-testid={`solver-hole-row-${idx}-cbore-depth-input`}
                      step="0.1"
                      style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
                    />
                  </label>
                </div>
              )}

              {row.holeType === 'countersink' && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: '1 1 140px' }}>
                    {t.csinkAngle}
                    <input
                      type="number"
                      value={row.countersinkAngleDegrees}
                      onChange={(e) => updateRow(idx, 'countersinkAngleDegrees', e.target.value)}
                      data-testid={`solver-hole-row-${idx}-csink-angle-input`}
                      step="0.5"
                      min={82}
                      max={135}
                      style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, flex: '1 1 140px' }}>
                    {t.csinkDepth}
                    <input
                      type="number"
                      value={row.countersinkDepth}
                      onChange={(e) => updateRow(idx, 'countersinkDepth', e.target.value)}
                      data-testid={`solver-hole-row-${idx}-csink-depth-input`}
                      step="0.1"
                      style={{ padding: 6, fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4 }}
                    />
                  </label>
                </div>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addRow}
            data-testid="solver-hole-add"
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
            + {t.addHole}
          </button>
        </fieldset>

        {render.status === 'loading' && (
          <div style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>
            {t.rendering}
          </div>
        )}

        {render.status === 'error' && (
          <div
            data-testid="solver-hole-error"
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
                data-testid="solver-hole-scad-preview"
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
                        data-testid={`solver-hole-png-preview-${idx}`}
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
                <div data-testid="solver-hole-stl-viewer">
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
            data-testid="solver-hole-cancel"
            style={{ padding: '8px 16px', fontSize: 13, background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={render.status === 'loading' || availablePointIds.length === 0}
            data-testid="solver-hole-submit"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              background: render.status === 'loading' || availablePointIds.length === 0 ? '#e5e7eb' : '#0ea5e9',
              color: render.status === 'loading' || availablePointIds.length === 0 ? '#9ca3af' : '#fff',
              border: '1px solid #0284c7',
              borderRadius: 4,
              cursor: render.status === 'loading' || availablePointIds.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {t.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
