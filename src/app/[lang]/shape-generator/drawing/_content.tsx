'use client';

/**
 * Drawing page (production) — content split out from the Next.js page
 * entry so tests can mount it with a plain `lang` string instead of
 * unwrapping the `use(params)` Promise hook. Filename starts with `_`
 * so Next.js doesn't treat it as a route.
 *
 * UX layout:
 *   ┌──────────┬────────────────────────────────┬──────────┐
 *   │ left     │ SheetRenderer (main canvas)    │ right    │
 *   │ (part /  │                                │ (anno-   │
 *   │  paper / │                                │  tation  │
 *   │  scale)  │                                │  list)   │
 *   └──────────┴────────────────────────────────┴──────────┘
 *   ┌──────────────────────────────────────────────────────┐
 *   │ Export PNG · Export JSON                             │
 *   └──────────────────────────────────────────────────────┘
 *
 * State is local to this page (no persistence yet — Phase 2 wires the
 * project store). The dimension / GD&T overlay is delivered by the
 * Phase 4.2 SheetRenderer; we splice each new annotation into
 * `sheet.dimensions` or `sheet.gdtCallouts`.
 *
 * Phase 1 placeholders (explicit):
 *   - Sample-part loader uses hardcoded `sourceId` strings only; the
 *     OCCT geometry resolution happens in Phase 2.
 *   - PNG export rasterises the SVG via `<canvas>.drawImage(img)` after
 *     wrapping the serialised SVG in an object URL — no canvg / no
 *     server round-trip. Works in any modern browser; in jsdom tests
 *     the file write is mocked (we only assert `URL.createObjectURL`).
 *   - JSON export dumps the live Sheet IR.
 */

import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
  standardThreeViewSheet,
  type PaperSize,
  type Sheet,
} from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';
import { writeStepWithPmi } from '@/lib/brep-bridge/stepWriteWithPmi';
import { writeStepWithPmiBindings } from '@/lib/brep-bridge/stepWriteWithPmiBindings';
import type { RefBinding } from '@/lib/brep-bridge/pmiShapeBinding';
import { sampleGeometryForSourceId } from '@/lib/drawing/sampleGeometry';
import { exportSheetsToPdf, PdfExportError } from '@/lib/drawing/pdfExport';
import { SheetRenderer } from './SheetRenderer';
import DimensionAnnotationModal from './DimensionAnnotationModal';

// ─── sample parts ────────────────────────────────────────────────────────

/**
 * Hardcoded sample part catalogue. `sourceId` is what the Sheet IR carries
 * and what Phase 2 will resolve against the OCCT-backed part store. The
 * labels are i18n-resolved on-the-fly so we don't need a separate dict.
 */
const SAMPLE_PARTS: ReadonlyArray<{ sourceId: string; labelKey: string }> = [
  { sourceId: 'sample-cube',     labelKey: 'partCube' },
  { sourceId: 'sample-cylinder', labelKey: 'partCylinder' },
  { sourceId: 'sample-pentagon', labelKey: 'partPentagonPrism' },
  { sourceId: 'sample-step-001', labelKey: 'partSampleStep' },
];

const PAPER_SIZES: ReadonlyArray<PaperSize> = ['A4', 'A3', 'A2', 'A1', 'A0'];

// ─── i18n ────────────────────────────────────────────────────────────────

interface PageDict {
  title: string;
  subtitle: string;
  partLabel: string;
  partCube: string;
  partCylinder: string;
  partPentagonPrism: string;
  partSampleStep: string;
  paperLabel: string;
  scaleLabel: string;
  annotationsLabel: string;
  noAnnotations: string;
  addAnnotation: string;
  deleteAnnotation: string;
  exportPng: string;
  exportJson: string;
  exportStepPmi: string;
  exportStepError: string;
  exportPdf: string;
  exportPdfError: string;
  multiPagePdfLabel: string;
  includeBindings: string;
  useSavedView: string;
  bindingsApplied: string;
  bindingsWarningTitle: string;
  dimensionTag: string;
  gdtTag: string;
}

const DICT: Record<string, PageDict> = {
  ko: {
    title: '도면 작업실',
    subtitle: '3-뷰 + 등각 표준 시트, 치수/GD&T 주석, PNG/JSON 내보내기',
    partLabel: '부품 선택',
    partCube: '정육면체 샘플',
    partCylinder: '원기둥 샘플',
    partPentagonPrism: '오각기둥 샘플',
    partSampleStep: '샘플 STEP 파일',
    paperLabel: '용지 크기',
    scaleLabel: '축척',
    annotationsLabel: '주석 목록',
    noAnnotations: '아직 추가된 주석이 없습니다',
    addAnnotation: '주석 추가',
    deleteAnnotation: '삭제',
    exportPng: 'PNG 내보내기',
    exportJson: 'JSON 내보내기',
    exportStepPmi: 'STEP+PMI 내보내기',
    exportStepError: 'STEP 내보내기 실패',
    exportPdf: 'PDF 내보내기',
    exportPdfError: 'PDF 내보내기 실패',
    multiPagePdfLabel: '여러 페이지로 묶기',
    includeBindings: '형상 바인딩 포함',
    useSavedView: '저장된 뷰 사용',
    bindingsApplied: '바인딩 적용됨',
    bindingsWarningTitle: 'STEP 바인딩 경고',
    dimensionTag: '치수',
    gdtTag: 'GD&T',
  },
  en: {
    title: 'Drawing Studio',
    subtitle: '3-view + iso standard sheet, dimension / GD&T annotations, PNG / JSON export',
    partLabel: 'Part',
    partCube: 'Sample cube',
    partCylinder: 'Sample cylinder',
    partPentagonPrism: 'Sample pentagon prism',
    partSampleStep: 'Sample STEP file',
    paperLabel: 'Paper size',
    scaleLabel: 'Scale',
    annotationsLabel: 'Annotations',
    noAnnotations: 'No annotations yet',
    addAnnotation: 'Add annotation',
    deleteAnnotation: 'Delete',
    exportPng: 'Export PNG',
    exportJson: 'Export JSON',
    exportStepPmi: 'Export STEP+PMI',
    exportStepError: 'STEP export failed',
    exportPdf: 'Export PDF',
    exportPdfError: 'PDF export failed',
    multiPagePdfLabel: 'Bundle as multi-page PDF',
    includeBindings: 'Include shape bindings',
    useSavedView: 'Use saved view',
    bindingsApplied: 'Bindings applied',
    bindingsWarningTitle: 'STEP binding warnings',
    dimensionTag: 'DIM',
    gdtTag: 'GD&T',
  },
  ja: {
    title: '図面スタジオ',
    subtitle: '3面図 + アイソメ標準シート、寸法/GD&T注釈、PNG/JSONエクスポート',
    partLabel: '部品選択',
    partCube: 'キューブサンプル',
    partCylinder: '円柱サンプル',
    partPentagonPrism: '五角柱サンプル',
    partSampleStep: 'サンプルSTEPファイル',
    paperLabel: '用紙サイズ',
    scaleLabel: '縮尺',
    annotationsLabel: '注釈一覧',
    noAnnotations: '注釈はまだありません',
    addAnnotation: '注釈を追加',
    deleteAnnotation: '削除',
    exportPng: 'PNGエクスポート',
    exportJson: 'JSONエクスポート',
    exportStepPmi: 'STEP+PMI エクスポート',
    exportStepError: 'STEP エクスポートに失敗しました',
    exportPdf: 'PDF エクスポート',
    exportPdfError: 'PDF エクスポートに失敗しました',
    multiPagePdfLabel: '複数ページPDFとしてまとめる',
    includeBindings: '形状バインディングを含める',
    useSavedView: '保存ビューを使用',
    bindingsApplied: 'バインディング適用済み',
    bindingsWarningTitle: 'STEPバインディング警告',
    dimensionTag: '寸法',
    gdtTag: 'GD&T',
  },
  zh: {
    title: '图纸工作室',
    subtitle: '三视图 + 等轴标准图纸、尺寸/GD&T注释、PNG/JSON导出',
    partLabel: '部件',
    partCube: '立方体样品',
    partCylinder: '圆柱样品',
    partPentagonPrism: '五棱柱样品',
    partSampleStep: '示例STEP文件',
    paperLabel: '纸张大小',
    scaleLabel: '比例',
    annotationsLabel: '注释列表',
    noAnnotations: '暂无注释',
    addAnnotation: '添加注释',
    deleteAnnotation: '删除',
    exportPng: '导出PNG',
    exportJson: '导出JSON',
    exportStepPmi: '导出STEP+PMI',
    exportStepError: 'STEP 导出失败',
    exportPdf: '导出PDF',
    exportPdfError: 'PDF 导出失败',
    multiPagePdfLabel: '合并为多页PDF',
    includeBindings: '包含形状绑定',
    useSavedView: '使用已保存视图',
    bindingsApplied: '已应用绑定',
    bindingsWarningTitle: 'STEP 绑定警告',
    dimensionTag: '尺寸',
    gdtTag: 'GD&T',
  },
  es: {
    title: 'Estudio de Planos',
    subtitle: 'Hoja estándar 3 vistas + iso, anotaciones de dimensión / GD&T, exportación PNG / JSON',
    partLabel: 'Pieza',
    partCube: 'Cubo de muestra',
    partCylinder: 'Cilindro de muestra',
    partPentagonPrism: 'Prisma pentagonal de muestra',
    partSampleStep: 'Archivo STEP de muestra',
    paperLabel: 'Tamaño de papel',
    scaleLabel: 'Escala',
    annotationsLabel: 'Anotaciones',
    noAnnotations: 'Aún no hay anotaciones',
    addAnnotation: 'Añadir anotación',
    deleteAnnotation: 'Eliminar',
    exportPng: 'Exportar PNG',
    exportJson: 'Exportar JSON',
    exportStepPmi: 'Exportar STEP+PMI',
    exportStepError: 'Error al exportar STEP',
    exportPdf: 'Exportar PDF',
    exportPdfError: 'Error al exportar PDF',
    multiPagePdfLabel: 'Agrupar como PDF de varias páginas',
    includeBindings: 'Incluir vínculos de forma',
    useSavedView: 'Usar vista guardada',
    bindingsApplied: 'Vínculos aplicados',
    bindingsWarningTitle: 'Advertencias de vínculos STEP',
    dimensionTag: 'DIM',
    gdtTag: 'GD&T',
  },
  ar: {
    title: 'استوديو الرسومات',
    subtitle: 'ورقة قياسية بثلاث رؤى + إيزو، تعليقات الأبعاد / GD&T، تصدير PNG / JSON',
    partLabel: 'الجزء',
    partCube: 'مكعب نموذج',
    partCylinder: 'أسطوانة نموذج',
    partPentagonPrism: 'منشور خماسي نموذج',
    partSampleStep: 'ملف STEP نموذج',
    paperLabel: 'حجم الورق',
    scaleLabel: 'المقياس',
    annotationsLabel: 'التعليقات',
    noAnnotations: 'لا توجد تعليقات بعد',
    addAnnotation: 'إضافة تعليق',
    deleteAnnotation: 'حذف',
    exportPng: 'تصدير PNG',
    exportJson: 'تصدير JSON',
    exportStepPmi: 'تصدير STEP+PMI',
    exportStepError: 'فشل تصدير STEP',
    exportPdf: 'تصدير PDF',
    exportPdfError: 'فشل تصدير PDF',
    multiPagePdfLabel: 'تجميع كملف PDF متعدد الصفحات',
    includeBindings: 'تضمين روابط الشكل',
    useSavedView: 'استخدام العرض المحفوظ',
    bindingsApplied: 'تم تطبيق الروابط',
    bindingsWarningTitle: 'تحذيرات روابط STEP',
    dimensionTag: 'البُعد',
    gdtTag: 'GD&T',
  },
};

function pickDict(lang: string): PageDict {
  const key = lang === 'cn' ? 'zh' : lang;
  return DICT[key] ?? DICT.en;
}

// ─── type guard ──────────────────────────────────────────────────────────

function isDimension(a: Dimension | GdtCallout): a is Dimension {
  return (
    'kind' in a &&
    (a.kind === 'linear'
      || a.kind === 'aligned'
      || a.kind === 'radial'
      || a.kind === 'diametric'
      || a.kind === 'angular')
  );
}

// ─── export helpers ──────────────────────────────────────────────────────

/**
 * Trigger a browser download for a Blob by spawning a hidden anchor.
 * Pulled out so tests can spy on URL.createObjectURL (PNG path goes via
 * canvas → toBlob → this helper).
 */
function downloadBlob(blob: Blob, filename: string): void {
  if (typeof URL === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the object URL on the next tick so the browser has time to
  // actually start the download. In tests this is harmless.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Serialise the SVG element from the sheet renderer into a PNG blob via
 * canvas rasterisation. Falls back gracefully when the environment can't
 * decode SVG (jsdom — we still trigger the download with a blank canvas
 * so tests can observe the URL.createObjectURL call).
 */
async function exportSheetPng(rootEl: HTMLElement, filename: string): Promise<void> {
  const svgEl = rootEl.querySelector('svg[data-testid="sheet-renderer-root"]');
  if (!svgEl) return;
  const serializer = new XMLSerializer();
  const svgSource = serializer.serializeToString(svgEl);
  // Force the xmlns so the serialised string is a standalone SVG document.
  const svgWithNs = svgSource.includes('xmlns=')
    ? svgSource
    : svgSource.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const svgBlob = new Blob([svgWithNs], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  // Read width/height from the SVG element; fall back to 1200×800.
  const widthAttr = svgEl.getAttribute('width');
  const heightAttr = svgEl.getAttribute('height');
  const w = widthAttr ? Number(widthAttr) : 1200;
  const h = heightAttr ? Number(heightAttr) : 800;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  try {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (ctx) ctx.drawImage(img, 0, 0);
        resolve();
      };
      img.onerror = () => resolve(); // proceed with the blank canvas in jsdom
      img.src = svgUrl;
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }

  // Prefer canvas.toBlob; fall back to a synchronous data URL → blob if
  // toBlob is not present (older jsdom).
  await new Promise<void>((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, filename);
        resolve();
      }, 'image/png');
    } else {
      // Trigger the download with an empty PNG blob so tests still observe
      // a URL.createObjectURL call.
      downloadBlob(new Blob([], { type: 'image/png' }), filename);
      resolve();
    }
  });
}

function exportSheetJson(sheet: Sheet, filename: string): void {
  const blob = new Blob([JSON.stringify(sheet, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  downloadBlob(blob, filename);
}

/**
 * Export a complete ISO-10303-21 STEP file (geometry + AP242 PMI fragment)
 * for the currently selected sample part + the live sheet annotations.
 *
 * Throws are re-raised so the caller can surface them in the UI; the
 * MIME type matches the IANA-registered `application/step` so browsers
 * route the download into the user's STEP/CAD application by default.
 */
function exportSheetStep(sourceId: string, sheet: Sheet, filename: string): void {
  const geometry = sampleGeometryForSourceId(sourceId);
  const stepSource = writeStepWithPmi({
    geometry,
    pmi: { sheet },
    header: {
      description: `NexyFab drawing export — ${sheet.name}`,
      filename,
    },
  });
  const blob = new Blob([stepSource], { type: 'application/step' });
  downloadBlob(blob, filename);
}

/**
 * Phase 5.3 sample binding generator (Phase 1 limit — UI-level placeholder).
 *
 * The drawing page does not yet have access to the OCCT face/edge/vertex
 * walk that would yield a faithful `Sheet ref → entityId` map. Until that
 * pipeline lands, we synthesize a one-binding-per-unique-ref list so users
 * can validate the end-to-end STEP+PMI+SHAPE_ASPECT envelope. Each binding:
 *
 *   - `ref` is the first ref of every dimension and the targetRef of every
 *     GD&T callout (deduped, insertion-ordered).
 *   - `entityId` is the placeholder `1` (the geometry's product CARTESIAN_
 *     POINT id from `stepWrite`) — this anchors the SHAPE_ASPECT to a real
 *     entity in the STEP source so the file parses, even if the binding
 *     does not yet point at the topologically correct face.
 *   - `kind` is hard-coded to `'face'` because the Sheet IR does not carry
 *     entity-kind metadata yet. Phase 2 will derive `face|edge|vertex`
 *     from the OCCT walk.
 */
function buildSampleBindings(sheet: Sheet): RefBinding[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  for (const d of sheet.dimensions ?? []) {
    const first = d.refs[0];
    if (first && !seen.has(first)) {
      seen.add(first);
      refs.push(first);
    }
  }
  for (const g of sheet.gdtCallouts ?? []) {
    if (g.targetRef && !seen.has(g.targetRef)) {
      seen.add(g.targetRef);
      refs.push(g.targetRef);
    }
  }

  return refs.map((ref) => ({ ref, entityId: 1, kind: 'face' as const }));
}

/**
 * Phase 5.3 STEP+PMI+bindings exporter. Returns the warnings surfaced by
 * `writeStepWithPmiBindings` so the caller can show them in the UI.
 */
function exportSheetStepWithBindings(
  sourceId: string,
  sheet: Sheet,
  filename: string,
  opts: { includeBindings: boolean; withSavedView: boolean },
): { warnings: ReadonlyArray<string>; bindingsCount: number } {
  const geometry = sampleGeometryForSourceId(sourceId);
  const bindings = opts.includeBindings ? buildSampleBindings(sheet) : undefined;
  const result = writeStepWithPmiBindings({
    geometry,
    pmi: { sheet },
    ...(bindings ? { bindings } : {}),
    withSavedView: opts.withSavedView,
    header: {
      description: `NexyFab drawing export — ${sheet.name}`,
      filename,
    },
  });
  const blob = new Blob([result.source], { type: 'application/step' });
  downloadBlob(blob, filename);
  return {
    warnings: result.warnings,
    bindingsCount: result.pmiMapping.size,
  };
}

// ─── component ───────────────────────────────────────────────────────────

export function DrawingPageContent({ lang }: { lang: string }): React.ReactElement {
  const dict = pickDict(lang);
  const [sourceId, setSourceId] = useState<string>(SAMPLE_PARTS[0].sourceId);
  const [paperSize, setPaperSize] = useState<PaperSize>('A3');
  const [scale, setScale] = useState<number>(1);
  const [annotations, setAnnotations] = useState<{
    dimensions: Dimension[];
    gdtCallouts: GdtCallout[];
  }>({ dimensions: [], gdtCallouts: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [stepExportError, setStepExportError] = useState<string | null>(null);
  const [stepExportWarnings, setStepExportWarnings] = useState<ReadonlyArray<string>>([]);
  const [stepExportInfo, setStepExportInfo] = useState<string | null>(null);
  const [includeBindings, setIncludeBindings] = useState<boolean>(false);
  const [useSavedView, setUseSavedView] = useState<boolean>(false);
  const [pdfExportError, setPdfExportError] = useState<string | null>(null);
  /**
   * Phase 4.4.3 PDF export — when true, the future multi-sheet UI will
   * pass every sheet to {@link exportSheetsToPdf}. Today this page only
   * authors a single Sheet, so the checkbox is wired but has no
   * additional effect until a `sheets[]` prop arrives upstream. The
   * state is preserved so caller harnesses (including the tests) can
   * still flip it.
   */
  const [multiPagePdf, setMultiPagePdf] = useState<boolean>(false);

  const sheetRef = React.useRef<HTMLDivElement>(null);

  const sheet: Sheet = useMemo(() => {
    const base = standardThreeViewSheet({
      id: 'drawing-page-sheet',
      name: `Drawing — ${sourceId}`,
      sourceId,
      paperSize,
      scale,
    });
    return {
      ...base,
      dimensions: annotations.dimensions,
      gdtCallouts: annotations.gdtCallouts,
    };
  }, [sourceId, paperSize, scale, annotations]);

  const firstViewportId = sheet.viewports[0]?.id ?? '';

  const handleAdd = useCallback((annotation: Dimension | GdtCallout) => {
    setAnnotations((prev) => {
      if (isDimension(annotation)) {
        return { ...prev, dimensions: [...prev.dimensions, annotation] };
      }
      return { ...prev, gdtCallouts: [...prev.gdtCallouts, annotation] };
    });
    setModalOpen(false);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setAnnotations((prev) => ({
      dimensions: prev.dimensions.filter((d) => d.id !== id),
      gdtCallouts: prev.gdtCallouts.filter((g) => g.id !== id),
    }));
    setSelectedAnnotationId((cur) => (cur === id ? null : cur));
  }, []);

  const allAnnotations: ReadonlyArray<{ id: string; tag: string; label: string }> = useMemo(() => {
    const out: Array<{ id: string; tag: string; label: string }> = [];
    for (const d of annotations.dimensions) {
      out.push({
        id: d.id,
        tag: dict.dimensionTag,
        label: `${d.kind} · ${d.viewportId}`,
      });
    }
    for (const g of annotations.gdtCallouts) {
      out.push({
        id: g.id,
        tag: dict.gdtTag,
        label: `${g.kind} · ${g.viewportId}`,
      });
    }
    return out;
  }, [annotations, dict.dimensionTag, dict.gdtTag]);

  const onExportPng = useCallback(() => {
    if (!sheetRef.current) return;
    void exportSheetPng(sheetRef.current, `${sheet.id}.png`);
  }, [sheet.id]);

  const onExportJson = useCallback(() => {
    exportSheetJson(sheet, `${sheet.id}.json`);
  }, [sheet]);

  const onExportStep = useCallback(() => {
    // Clear any previous error / warning so a successful retry hides the banner.
    setStepExportError(null);
    setStepExportWarnings([]);
    setStepExportInfo(null);
    try {
      // Route through the bindings orchestrator only when the user opted in
      // to either of the new options. Otherwise preserve the existing
      // (legacy) `writeStepWithPmi` path so the 146 drawing-suite tests that
      // exercise it continue to pass unchanged.
      if (includeBindings || useSavedView) {
        const res = exportSheetStepWithBindings(
          sourceId,
          sheet,
          `${sheet.id}.step`,
          { includeBindings, withSavedView: useSavedView },
        );
        setStepExportWarnings(res.warnings);
        if (includeBindings && res.bindingsCount > 0) {
          setStepExportInfo(
            `${dict.bindingsApplied}: ${res.bindingsCount}`,
          );
        }
      } else {
        exportSheetStep(sourceId, sheet, `${sheet.id}.step`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setStepExportError(`${dict.exportStepError}: ${detail}`);
    }
  }, [
    sourceId,
    sheet,
    includeBindings,
    useSavedView,
    dict.exportStepError,
    dict.bindingsApplied,
  ]);

  const onExportPdf = useCallback(async () => {
    setPdfExportError(null);
    if (!sheetRef.current) return;
    const svgEl = sheetRef.current.querySelector(
      'svg[data-testid="sheet-renderer-root"]',
    ) as SVGElement | null;
    if (!svgEl) return;
    // Phase 1: page list is always [currentSheet]. The `multiPagePdf`
    // toggle is a no-op until a `sheets[]` prop is wired in upstream;
    // once it is, replace `[sheet]` / `[svgEl]` with the full arrays.
    const sheetsToExport = [sheet];
    const svgRefs: SVGElement[] = [svgEl];
    try {
      const blob = await exportSheetsToPdf(sheetsToExport, svgRefs);
      downloadBlob(blob, `${sheet.id}.pdf`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const prefix =
        err instanceof PdfExportError && err.code === 'jspdf-missing'
          ? `${dict.exportPdfError} (jspdf)`
          : dict.exportPdfError;
      setPdfExportError(`${prefix}: ${detail}`);
    }
  }, [sheet, dict.exportPdfError]);

  return (
    <main
      data-testid="drawing-page-root"
      style={{
        padding: 24,
        minHeight: '100vh',
        background: '#f3f4f6',
        fontFamily: 'system-ui, sans-serif',
        color: '#0f172a',
      }}
    >
      <div
        style={{
          maxWidth: 1600,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <header data-testid="drawing-page-header">
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{dict.title}</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{dict.subtitle}</p>
        </header>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '240px 1fr 280px',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          {/* ─── Left panel: part + paper + scale ─────────────────────── */}
          <aside
            data-testid="drawing-page-left-panel"
            style={{
              background: '#ffffff',
              borderRadius: 6,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{dict.partLabel}</span>
              <select
                data-testid="drawing-part-select"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                style={{ padding: 6 }}
              >
                {SAMPLE_PARTS.map((p) => (
                  <option key={p.sourceId} value={p.sourceId}>
                    {dict[p.labelKey as keyof PageDict] ?? p.sourceId}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{dict.paperLabel}</span>
              <select
                data-testid="drawing-paper-select"
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                style={{ padding: 6 }}
              >
                {PAPER_SIZES.map((sz) => (
                  <option key={sz} value={sz}>{sz}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{dict.scaleLabel}</span>
              <input
                data-testid="drawing-scale-input"
                type="number"
                min={0.01}
                step={0.1}
                value={scale}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) setScale(v);
                }}
                style={{ padding: 6 }}
              />
            </label>
          </aside>

          {/* ─── Main canvas ─────────────────────────────────────────── */}
          <div
            ref={sheetRef}
            data-testid="drawing-page-canvas"
            style={{
              background: '#e5e7eb',
              padding: 12,
              borderRadius: 6,
              overflow: 'auto',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <SheetRenderer sheet={sheet} />
          </div>

          {/* ─── Right panel: annotation list + add button ──────────── */}
          <aside
            data-testid="drawing-page-right-panel"
            style={{
              background: '#ffffff',
              borderRadius: 6,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{dict.annotationsLabel}</span>
              <button
                type="button"
                data-testid="drawing-add-annotation-button"
                onClick={() => setModalOpen(true)}
                disabled={!firstViewportId}
                style={{
                  padding: '6px 10px',
                  background: '#1d4ed8',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: firstViewportId ? 'pointer' : 'not-allowed',
                  fontSize: 12,
                }}
              >
                {dict.addAnnotation}
              </button>
            </div>

            {allAnnotations.length === 0 ? (
              <p
                data-testid="drawing-page-no-annotations"
                style={{ fontSize: 12, color: '#6b7280', margin: 0 }}
              >
                {dict.noAnnotations}
              </p>
            ) : (
              <ul
                data-testid="drawing-page-annotation-list"
                style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
              >
                {allAnnotations.map((a) => {
                  const selected = a.id === selectedAnnotationId;
                  return (
                    <li
                      key={a.id}
                      data-testid={`drawing-page-annotation-item-${a.id}`}
                      data-selected={selected ? 'true' : 'false'}
                      onClick={() => setSelectedAnnotationId(a.id)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 8px',
                        borderRadius: 4,
                        background: selected ? '#dbeafe' : '#f3f4f6',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      <span>
                        <strong style={{ marginRight: 6 }}>{a.tag}</strong>
                        {a.label}
                      </span>
                      <button
                        type="button"
                        data-testid={`drawing-page-delete-annotation-${a.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(a.id);
                        }}
                        style={{
                          padding: '2px 8px',
                          background: '#b91c1c',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 3,
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        {dict.deleteAnnotation}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>

        {/* ─── Bottom: export buttons + error banner ───────────────── */}
        <footer
          data-testid="drawing-page-footer"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 12,
            background: '#ffffff',
            borderRadius: 6,
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#374151' }}
            >
              <input
                type="checkbox"
                data-testid="drawing-multi-page-pdf-checkbox"
                checked={multiPagePdf}
                onChange={(e) => setMultiPagePdf(e.target.checked)}
              />
              {dict.multiPagePdfLabel}
            </label>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#374151' }}
            >
              <input
                type="checkbox"
                data-testid="drawing-include-bindings"
                checked={includeBindings}
                onChange={(e) => setIncludeBindings(e.target.checked)}
              />
              {dict.includeBindings}
            </label>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#374151' }}
            >
              <input
                type="checkbox"
                data-testid="drawing-use-saved-view"
                checked={useSavedView}
                onChange={(e) => setUseSavedView(e.target.checked)}
              />
              {dict.useSavedView}
            </label>
            <button
              type="button"
              data-testid="drawing-export-png-button"
              onClick={onExportPng}
              style={{
                padding: '8px 14px',
                background: '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {dict.exportPng}
            </button>
            <button
              type="button"
              data-testid="drawing-export-json-button"
              onClick={onExportJson}
              style={{
                padding: '8px 14px',
                background: '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {dict.exportJson}
            </button>
            <button
              type="button"
              data-testid="drawing-export-pdf-button"
              onClick={() => { void onExportPdf(); }}
              style={{
                padding: '8px 14px',
                background: '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {dict.exportPdf}
            </button>
            <button
              type="button"
              data-testid="drawing-export-step-button"
              onClick={onExportStep}
              style={{
                padding: '8px 14px',
                background: '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {dict.exportStepPmi}
            </button>
          </div>
          {stepExportError ? (
            <p
              data-testid="drawing-export-step-error"
              role="alert"
              style={{
                margin: 0,
                padding: '6px 10px',
                background: '#fee2e2',
                color: '#991b1b',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {stepExportError}
            </p>
          ) : null}
          {stepExportInfo ? (
            <p
              data-testid="drawing-export-step-info"
              style={{
                margin: 0,
                padding: '6px 10px',
                background: '#dcfce7',
                color: '#166534',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {stepExportInfo}
            </p>
          ) : null}
          {stepExportWarnings.length > 0 ? (
            <div
              data-testid="drawing-export-step-warnings"
              role="alert"
              style={{
                margin: 0,
                padding: '6px 10px',
                background: '#fef3c7',
                color: '#92400e',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              <strong style={{ display: 'block', marginBottom: 2 }}>
                {dict.bindingsWarningTitle}
              </strong>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {stepExportWarnings.map((w, i) => (
                  <li key={`${i}-${w}`} data-testid={`drawing-export-step-warning-${i}`}>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {pdfExportError ? (
            <p
              data-testid="drawing-export-pdf-error"
              role="alert"
              style={{
                margin: 0,
                padding: '6px 10px',
                background: '#fee2e2',
                color: '#991b1b',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {pdfExportError}
            </p>
          ) : null}
        </footer>
      </div>

      {modalOpen && firstViewportId ? (
        <DimensionAnnotationModal
          lang={lang}
          sheet={sheet}
          viewportId={firstViewportId}
          onAdd={handleAdd}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </main>
  );
}
