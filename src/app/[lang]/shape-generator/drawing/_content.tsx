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
  paperDimensions,
  type PaperSize,
  type Sheet,
} from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';
import { writeStepWithPmi } from '@/lib/brep-bridge/stepWriteWithPmi';
import { writeStepWithPmiBindings } from '@/lib/brep-bridge/stepWriteWithPmiBindings';
import {
  writeStepWithPmiOcctBindings,
  type HybridBindingMode,
} from '@/lib/brep-bridge/stepWriteWithPmiOcctBindings';
import type { OcctPmiBinding, OcctShapeMeta } from '@/lib/brep-bridge/pmiOcctBinding';
import type { RefBinding } from '@/lib/brep-bridge/pmiShapeBinding';
import { sampleGeometryForSourceId } from '@/lib/drawing/sampleGeometry';
import { exportSheetsToPdf, PdfExportError } from '@/lib/drawing/pdfExport';
import { exportSheetsToPdfVector, VectorPdfError } from '@/lib/drawing/svg2pdfBridge';
import { exportLargeSheetToPdf, LargePdfError } from '@/lib/drawing/pdfExportLarge';
import {
  getSampleAssembly,
  SAMPLE_ASSEMBLY_NAMES,
  type SampleAssemblyName,
} from '@/lib/assembly/sampleAssemblies';
import {
  writeAssemblyWithPmi,
  type AssemblyPmiResult,
} from '@/lib/brep-bridge/stepWriteAssemblyWithPmi';
import type { AssemblyPart } from '@/lib/brep-bridge/stepWrite';
import type { PartInstance } from '@/lib/assembly/assemblyState';
import { SheetRenderer } from './SheetRenderer';
import DimensionAnnotationModal from './DimensionAnnotationModal';
import { SheetSnapIndicator } from './SheetSnapIndicator';
import { findSheetSnapTarget, type SheetSnapTarget } from '@/lib/drawing/sheetSnap';

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
  assemblyMode: string;
  addSheet: string;
  exportAssemblyStep: string;
  partListLabel: string;
  noSheetAdded: string;
  assemblySamplePickerLabel: string;
  assemblyResultLabel: string;
  assemblyWarningsTitle: string;
  assemblyExportError: string;
  editSheet: string;
  removeSheet: string;
  addAllSheets: string;
  clearAllSheets: string;
  confirmRemoveSheet: string;
  confirmClearAllSheets: string;
  closeEditor: string;
  exportAssemblyPdf: string;
  assemblyPdfSuccess: string;
  assemblyPdfError: string;
  assemblyPdfNoSheets: string;
  pdfFormat: string;
  formatRaster: string;
  formatVector: string;
  fallbackToRaster: string;
  exportedAsRaster: string;
  exportedAsVector: string;
  /** Phase 4.4.3 Phase 3 — large-paper resolution radio + pipeline banner labels. */
  pdfResolution: string;
  resStandard: string;
  resHigh: string;
  resPrint: string;
  pipelineVectorPdf: string;
  pipelineTiledRasterPdf: string;
  pipelineSingleRaster: string;
  enableSnap: string;
  snapHint: string;
  /** Phase 5.3.5 OCCT-direct hybrid mode UI. */
  hybridMode: string;
  shapeAspectOnly: string;
  occtDirect: string;
  bothMode: string;
  includeOcctBindings: string;
  occtBindingsInputLabel: string;
  occtBindingsPlaceholder: string;
  occtBindingsParseError: string;
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
    assemblyMode: '조립체 모드',
    addSheet: '시트 추가',
    exportAssemblyStep: '조립체 STEP+PMI 내보내기',
    partListLabel: '부품 목록',
    noSheetAdded: '시트 없음',
    assemblySamplePickerLabel: '조립체 샘플',
    assemblyResultLabel: '조립체 내보내기 결과',
    assemblyWarningsTitle: '조립체 경고',
    assemblyExportError: '조립체 STEP 내보내기 실패',
    editSheet: '시트 편집',
    removeSheet: '시트 삭제',
    addAllSheets: '모든 부품에 시트 추가',
    clearAllSheets: '모든 시트 제거',
    confirmRemoveSheet: '이 시트를 삭제하시겠습니까?',
    confirmClearAllSheets: '모든 부품의 시트를 제거하시겠습니까?',
    closeEditor: '닫기',
    exportAssemblyPdf: '조립체 PDF 내보내기',
    assemblyPdfSuccess: '페이지 PDF를 내보냈습니다',
    assemblyPdfError: '조립체 PDF 내보내기 실패',
    assemblyPdfNoSheets: '내보낼 시트가 없습니다',
    pdfFormat: 'PDF 형식',
    formatRaster: '래스터 (PNG 임베드)',
    formatVector: '벡터 (선택 가능 텍스트)',
    fallbackToRaster: '벡터 PDF 사용 불가 — 래스터로 대체',
    exportedAsRaster: '래스터 PDF로 내보냈습니다',
    exportedAsVector: '벡터 PDF로 내보냈습니다',
    pdfResolution: '해상도',
    resStandard: '표준 (4 px/mm)',
    resHigh: '고해상도 (8 px/mm)',
    resPrint: '인쇄 (12 px/mm)',
    pipelineVectorPdf: '벡터 PDF',
    pipelineTiledRasterPdf: '타일 래스터 PDF',
    pipelineSingleRaster: '단일 래스터',
    enableSnap: '스냅 사용',
    snapHint: '커서를 뷰포트 모서리/중점/중심 또는 그리드에 근접시키면 스냅됩니다',
    hybridMode: '바인딩 모드',
    shapeAspectOnly: 'SHAPE_ASPECT (Phase 1)',
    occtDirect: 'OCCT 직접 (Phase 2)',
    bothMode: '양쪽 (호환성 최대)',
    includeOcctBindings: 'OCCT 바인딩 포함',
    occtBindingsInputLabel: 'OCCT 바인딩 (JSON 배열)',
    occtBindingsPlaceholder: '[{"pmiRefId":"e1","faceRef":{"faceIdx":0}}]',
    occtBindingsParseError: 'OCCT 바인딩 입력 파싱 실패',
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
    assemblyMode: 'Assembly mode',
    addSheet: 'Add sheet',
    exportAssemblyStep: 'Export assembly STEP+PMI',
    partListLabel: 'Parts',
    noSheetAdded: 'No sheet',
    assemblySamplePickerLabel: 'Assembly sample',
    assemblyResultLabel: 'Assembly export result',
    assemblyWarningsTitle: 'Assembly warnings',
    assemblyExportError: 'Assembly STEP export failed',
    editSheet: 'Edit sheet',
    removeSheet: 'Remove sheet',
    addAllSheets: 'Add sheets for all parts',
    clearAllSheets: 'Clear all sheets',
    confirmRemoveSheet: 'Remove this sheet?',
    confirmClearAllSheets: 'Remove sheets for all parts?',
    closeEditor: 'Close',
    exportAssemblyPdf: 'Export assembly PDF',
    assemblyPdfSuccess: 'Exported {n}-page PDF',
    assemblyPdfError: 'Assembly PDF export failed',
    assemblyPdfNoSheets: 'No sheets to export',
    pdfFormat: 'PDF format',
    formatRaster: 'Raster (PNG embed)',
    formatVector: 'Vector (selectable text)',
    fallbackToRaster: 'Vector PDF unavailable — falling back to raster',
    exportedAsRaster: 'Exported as raster PDF',
    exportedAsVector: 'Exported as vector PDF',
    pdfResolution: 'Resolution',
    resStandard: 'Standard (4 px/mm)',
    resHigh: 'High (8 px/mm)',
    resPrint: 'Print (12 px/mm)',
    pipelineVectorPdf: 'Vector PDF',
    pipelineTiledRasterPdf: 'Tiled raster PDF',
    pipelineSingleRaster: 'Single raster',
    enableSnap: 'Enable snap',
    snapHint: 'Hover near a viewport corner / midpoint / center, or a grid node, to snap the cursor.',
    hybridMode: 'Binding mode',
    shapeAspectOnly: 'SHAPE_ASPECT (Phase 1)',
    occtDirect: 'OCCT direct (Phase 2)',
    bothMode: 'Both (max compatibility)',
    includeOcctBindings: 'Include OCCT bindings',
    occtBindingsInputLabel: 'OCCT bindings (JSON array)',
    occtBindingsPlaceholder: '[{"pmiRefId":"e1","faceRef":{"faceIdx":0}}]',
    occtBindingsParseError: 'Failed to parse OCCT bindings input',
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
    assemblyMode: 'アセンブリモード',
    addSheet: 'シート追加',
    exportAssemblyStep: 'アセンブリ STEP+PMI エクスポート',
    partListLabel: '部品一覧',
    noSheetAdded: 'シートなし',
    assemblySamplePickerLabel: 'アセンブリサンプル',
    assemblyResultLabel: 'アセンブリ エクスポート結果',
    assemblyWarningsTitle: 'アセンブリ警告',
    assemblyExportError: 'アセンブリ STEP エクスポートに失敗しました',
    editSheet: 'シート編集',
    removeSheet: 'シート削除',
    addAllSheets: 'すべての部品にシート追加',
    clearAllSheets: 'すべてのシートを削除',
    confirmRemoveSheet: 'このシートを削除しますか？',
    confirmClearAllSheets: 'すべての部品のシートを削除しますか？',
    closeEditor: '閉じる',
    exportAssemblyPdf: 'アセンブリ PDF エクスポート',
    assemblyPdfSuccess: 'ページPDFをエクスポートしました',
    assemblyPdfError: 'アセンブリ PDF エクスポートに失敗しました',
    assemblyPdfNoSheets: 'エクスポートするシートがありません',
    pdfFormat: 'PDF 形式',
    formatRaster: 'ラスター (PNG埋め込み)',
    formatVector: 'ベクター (選択可能テキスト)',
    fallbackToRaster: 'ベクターPDF利用不可 — ラスターで代替',
    exportedAsRaster: 'ラスター PDF としてエクスポートしました',
    exportedAsVector: 'ベクター PDF としてエクスポートしました',
    pdfResolution: '解像度',
    resStandard: '標準 (4 px/mm)',
    resHigh: '高解像度 (8 px/mm)',
    resPrint: '印刷 (12 px/mm)',
    pipelineVectorPdf: 'ベクター PDF',
    pipelineTiledRasterPdf: 'タイル ラスター PDF',
    pipelineSingleRaster: 'シングル ラスター',
    enableSnap: 'スナップを有効化',
    snapHint: 'カーソルをビューポートの角・中点・中心またはグリッドに近づけるとスナップします',
    hybridMode: 'バインディングモード',
    shapeAspectOnly: 'SHAPE_ASPECT (Phase 1)',
    occtDirect: 'OCCT 直接 (Phase 2)',
    bothMode: '両方 (最大互換性)',
    includeOcctBindings: 'OCCT バインディングを含める',
    occtBindingsInputLabel: 'OCCT バインディング (JSON 配列)',
    occtBindingsPlaceholder: '[{"pmiRefId":"e1","faceRef":{"faceIdx":0}}]',
    occtBindingsParseError: 'OCCT バインディング入力の解析に失敗しました',
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
    assemblyMode: '装配模式',
    addSheet: '添加图纸',
    exportAssemblyStep: '导出装配 STEP+PMI',
    partListLabel: '零件列表',
    noSheetAdded: '无图纸',
    assemblySamplePickerLabel: '装配示例',
    assemblyResultLabel: '装配导出结果',
    assemblyWarningsTitle: '装配警告',
    assemblyExportError: '装配 STEP 导出失败',
    editSheet: '编辑图纸',
    removeSheet: '删除图纸',
    addAllSheets: '为所有零件添加图纸',
    clearAllSheets: '清除所有图纸',
    confirmRemoveSheet: '是否删除该图纸？',
    confirmClearAllSheets: '是否删除所有零件的图纸？',
    closeEditor: '关闭',
    exportAssemblyPdf: '导出装配PDF',
    assemblyPdfSuccess: '已导出 {n} 页 PDF',
    assemblyPdfError: '装配 PDF 导出失败',
    assemblyPdfNoSheets: '没有可导出的图纸',
    pdfFormat: 'PDF 格式',
    formatRaster: '光栅 (PNG 嵌入)',
    formatVector: '矢量 (可选文本)',
    fallbackToRaster: '矢量 PDF 不可用 — 回退到光栅',
    exportedAsRaster: '已导出为光栅 PDF',
    exportedAsVector: '已导出为矢量 PDF',
    pdfResolution: '分辨率',
    resStandard: '标准 (4 px/mm)',
    resHigh: '高 (8 px/mm)',
    resPrint: '打印 (12 px/mm)',
    pipelineVectorPdf: '矢量 PDF',
    pipelineTiledRasterPdf: '平铺光栅 PDF',
    pipelineSingleRaster: '单一光栅',
    enableSnap: '启用捕捉',
    snapHint: '将光标靠近视口角点/中点/中心或网格节点即可捕捉',
    hybridMode: '绑定模式',
    shapeAspectOnly: 'SHAPE_ASPECT (Phase 1)',
    occtDirect: 'OCCT 直接 (Phase 2)',
    bothMode: '两者 (最大兼容性)',
    includeOcctBindings: '包含 OCCT 绑定',
    occtBindingsInputLabel: 'OCCT 绑定 (JSON 数组)',
    occtBindingsPlaceholder: '[{"pmiRefId":"e1","faceRef":{"faceIdx":0}}]',
    occtBindingsParseError: 'OCCT 绑定输入解析失败',
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
    assemblyMode: 'Modo ensamblaje',
    addSheet: 'Añadir hoja',
    exportAssemblyStep: 'Exportar STEP+PMI de ensamblaje',
    partListLabel: 'Piezas',
    noSheetAdded: 'Sin hoja',
    assemblySamplePickerLabel: 'Ensamblaje de muestra',
    assemblyResultLabel: 'Resultado de exportación de ensamblaje',
    assemblyWarningsTitle: 'Advertencias de ensamblaje',
    assemblyExportError: 'Error al exportar STEP de ensamblaje',
    editSheet: 'Editar hoja',
    removeSheet: 'Eliminar hoja',
    addAllSheets: 'Añadir hojas para todas las piezas',
    clearAllSheets: 'Eliminar todas las hojas',
    confirmRemoveSheet: '¿Eliminar esta hoja?',
    confirmClearAllSheets: '¿Eliminar las hojas de todas las piezas?',
    closeEditor: 'Cerrar',
    exportAssemblyPdf: 'Exportar PDF de ensamblaje',
    assemblyPdfSuccess: 'PDF de {n} páginas exportado',
    assemblyPdfError: 'Error al exportar PDF de ensamblaje',
    assemblyPdfNoSheets: 'No hay hojas para exportar',
    pdfFormat: 'Formato PDF',
    formatRaster: 'Ráster (PNG incrustado)',
    formatVector: 'Vector (texto seleccionable)',
    fallbackToRaster: 'PDF vectorial no disponible — recurriendo a ráster',
    exportedAsRaster: 'Exportado como PDF ráster',
    exportedAsVector: 'Exportado como PDF vectorial',
    pdfResolution: 'Resolución',
    resStandard: 'Estándar (4 px/mm)',
    resHigh: 'Alta (8 px/mm)',
    resPrint: 'Impresión (12 px/mm)',
    pipelineVectorPdf: 'PDF vectorial',
    pipelineTiledRasterPdf: 'PDF ráster en mosaico',
    pipelineSingleRaster: 'Ráster único',
    enableSnap: 'Activar ajuste',
    snapHint: 'Acerca el cursor a una esquina / punto medio / centro de viewport o nodo de cuadrícula para ajustar.',
    hybridMode: 'Modo de vínculo',
    shapeAspectOnly: 'SHAPE_ASPECT (Fase 1)',
    occtDirect: 'OCCT directo (Fase 2)',
    bothMode: 'Ambos (máxima compatibilidad)',
    includeOcctBindings: 'Incluir vínculos OCCT',
    occtBindingsInputLabel: 'Vínculos OCCT (matriz JSON)',
    occtBindingsPlaceholder: '[{"pmiRefId":"e1","faceRef":{"faceIdx":0}}]',
    occtBindingsParseError: 'Error al analizar los vínculos OCCT',
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
    assemblyMode: 'وضع التجميع',
    addSheet: 'إضافة ورقة',
    exportAssemblyStep: 'تصدير تجميع STEP+PMI',
    partListLabel: 'الأجزاء',
    noSheetAdded: 'لا توجد ورقة',
    assemblySamplePickerLabel: 'تجميع نموذج',
    assemblyResultLabel: 'نتيجة تصدير التجميع',
    assemblyWarningsTitle: 'تحذيرات التجميع',
    assemblyExportError: 'فشل تصدير STEP للتجميع',
    editSheet: 'تحرير الورقة',
    removeSheet: 'إزالة الورقة',
    addAllSheets: 'إضافة أوراق لجميع الأجزاء',
    clearAllSheets: 'مسح جميع الأوراق',
    confirmRemoveSheet: 'هل تريد إزالة هذه الورقة؟',
    confirmClearAllSheets: 'هل تريد إزالة أوراق جميع الأجزاء؟',
    closeEditor: 'إغلاق',
    exportAssemblyPdf: 'تصدير PDF التجميع',
    assemblyPdfSuccess: 'تم تصدير PDF بـ {n} صفحات',
    assemblyPdfError: 'فشل تصدير PDF التجميع',
    assemblyPdfNoSheets: 'لا توجد أوراق للتصدير',
    pdfFormat: 'تنسيق PDF',
    formatRaster: 'نقطي (تضمين PNG)',
    formatVector: 'متجه (نص قابل للتحديد)',
    fallbackToRaster: 'PDF المتجه غير متاح — الرجوع إلى النقطي',
    exportedAsRaster: 'تم التصدير كـ PDF نقطي',
    exportedAsVector: 'تم التصدير كـ PDF متجه',
    pdfResolution: 'الدقة',
    resStandard: 'قياسي (4 px/mm)',
    resHigh: 'عالية (8 px/mm)',
    resPrint: 'طباعة (12 px/mm)',
    pipelineVectorPdf: 'PDF متجه',
    pipelineTiledRasterPdf: 'PDF نقطي مبلط',
    pipelineSingleRaster: 'نقطي واحد',
    enableSnap: 'تمكين الالتقاط',
    snapHint: 'مرّر المؤشر بالقرب من زاوية/منتصف/مركز إطار العرض أو عقدة الشبكة للالتقاط.',
    hybridMode: 'وضع الربط',
    shapeAspectOnly: 'SHAPE_ASPECT (المرحلة 1)',
    occtDirect: 'OCCT مباشر (المرحلة 2)',
    bothMode: 'كلاهما (أقصى توافق)',
    includeOcctBindings: 'تضمين روابط OCCT',
    occtBindingsInputLabel: 'روابط OCCT (مصفوفة JSON)',
    occtBindingsPlaceholder: '[{"pmiRefId":"e1","faceRef":{"faceIdx":0}}]',
    occtBindingsParseError: 'فشل تحليل إدخال روابط OCCT',
  },
};

function pickDict(lang: string): PageDict {
  const key = lang === 'cn' ? 'zh' : lang;
  return DICT[key] ?? DICT.en;
}

// ─── routing helpers (Phase 4.4.3 Phase 3) ───────────────────────────────

/**
 * Decide whether a sheet's paper format needs the large-paper export
 * pipeline ({@link exportLargeSheetToPdf}) rather than the simple
 * single-tile raster path in {@link exportSheetsToPdf}.
 *
 *   - A4 / A3      → false (legacy raster path; smallest file, fastest)
 *   - A2 / A1 / A0 → true  (routes through pdfExportLarge's choosePipeline,
 *                           which auto-tiles for A1/A0 and prefers vector
 *                           when svg2pdf.js is available)
 *   - 'custom'     → true when the custom paper has either dimension above
 *                    the A2 short-edge (420 mm); below that the legacy
 *                    raster path handles it without tiling. Falls through
 *                    to `false` when the custom paper is missing (defensive
 *                    — the sheet builder always sets one for size='custom').
 *
 * Pure function so future tests / call sites can lock in the table without
 * mounting the component.
 */
function isLargePaper(
  paperSize: PaperSize,
  custom: { width: number; height: number } | undefined,
): boolean {
  if (paperSize === 'A2' || paperSize === 'A1' || paperSize === 'A0') return true;
  if (paperSize === 'custom') {
    if (!custom) return false;
    const longest = Math.max(custom.width, custom.height);
    return longest > 420; // A2 short edge — beyond this the simple raster
    //                       path produces multi-MB pages with visible
    //                       resampling, so route through pdfExportLarge.
  }
  return false;
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

// ─── Phase 5.3.5 OCCT-direct helpers ─────────────────────────────────────

/**
 * Sample 6-face metadata for the box-like sample parts (cube / step-001).
 * Mirrors `OcctShapeMeta` — index `i` is the STEP `#N` id of the i-th
 * ADVANCED_FACE in `TopExp_Explorer(TopAbs_FACE)` order. Phase 1 placeholder:
 * the ids `[1..6]` are not actual entity ids of the box writer's output but
 * they satisfy the contract (length 6, integers ≥ 1) so the binder's
 * lookup table is valid. When a real OCCT walk lands the table is replaced;
 * for the UI the contract is what matters: callers can index `faceIdx`
 * into `[0..5]` without `out of range` throws.
 */
function buildSampleShapeMeta(): OcctShapeMeta {
  return { faceEntityIds: [1, 2, 3, 4, 5, 6] };
}

/**
 * Parse the textarea content into an `OcctPmiBinding[]`. Accepts strict
 * JSON (object or array form) — empty / whitespace string returns an empty
 * array (treated as "no bindings"). Throws with a human-readable message
 * on invalid JSON or shape mismatch so the caller can surface it in the
 * UI banner.
 *
 * Accepted shapes:
 *   - `[{"pmiRefId":"e1","faceRef":{"faceIdx":0}},...]`           (array)
 *   - `{"pmiRefId":"e1","faceRef":{"faceIdx":0}}`                 (single)
 *
 * Field validation:
 *   - `pmiRefId` must be a non-empty string
 *   - `faceRef` must be an object with `faceIdx` (non-negative int) and
 *     optional `entityId` (positive int)
 */
function parseOcctBindingsInput(raw: string): OcctPmiBinding[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid JSON: ${detail}`);
  }
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const out: OcctPmiBinding[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (typeof it !== 'object' || it === null) {
      throw new Error(`entry #${i} is not an object`);
    }
    const obj = it as { pmiRefId?: unknown; faceRef?: unknown };
    if (typeof obj.pmiRefId !== 'string' || obj.pmiRefId.length === 0) {
      throw new Error(`entry #${i}: pmiRefId must be a non-empty string`);
    }
    if (typeof obj.faceRef !== 'object' || obj.faceRef === null) {
      throw new Error(`entry #${i}: faceRef must be an object`);
    }
    const fr = obj.faceRef as { faceIdx?: unknown; entityId?: unknown };
    if (
      typeof fr.faceIdx !== 'number'
      || !Number.isInteger(fr.faceIdx)
      || fr.faceIdx < 0
    ) {
      throw new Error(`entry #${i}: faceRef.faceIdx must be a non-negative integer`);
    }
    const binding: OcctPmiBinding = {
      pmiRefId: obj.pmiRefId,
      faceRef:
        typeof fr.entityId === 'number'
          ? { faceIdx: fr.faceIdx, entityId: fr.entityId }
          : { faceIdx: fr.faceIdx },
    };
    out.push(binding);
  }
  return out;
}

/**
 * Phase 5.3.5 STEP+PMI+OCCT-direct exporter. Routes through the
 * {@link writeStepWithPmiOcctBindings} orchestrator so the caller can
 * pick 'occt' (Phase 2 only), 'shape_aspect' (Phase 1 only — equivalent
 * to NNN) or 'both' (Phase 1 + Phase 2 in-place). Returns the merged
 * mapping count + warnings for the inline banners.
 *
 * The Phase-1 fallback bindings (from {@link buildSampleBindings}) are
 * forwarded as `shapeAspectBindings` when the mode is `'shape_aspect'`
 * or `'both'` AND `includeBindings` is on. The OCCT-direct bindings come
 * from the parsed textarea content; the sample shape-meta is always
 * supplied (the orchestrator only consults it when a binding lacks
 * `entityId`).
 */
function exportSheetStepWithOcctBindings(
  sourceId: string,
  sheet: Sheet,
  filename: string,
  opts: {
    hybridMode: HybridBindingMode;
    occtBindings: ReadonlyArray<OcctPmiBinding>;
    includeShapeAspectBindings: boolean;
    withSavedView: boolean;
  },
): { warnings: ReadonlyArray<string>; bindingsCount: number } {
  const geometry = sampleGeometryForSourceId(sourceId);
  const saBindings = opts.includeShapeAspectBindings
    ? buildSampleBindings(sheet)
    : undefined;
  const result = writeStepWithPmiOcctBindings({
    geometry,
    pmi: { sheet },
    hybridMode: opts.hybridMode,
    occtBindings: opts.occtBindings,
    shapeMeta: buildSampleShapeMeta(),
    ...(saBindings ? { shapeAspectBindings: saBindings } : {}),
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

// ─── assembly helpers (Phase 5.3) ────────────────────────────────────────

/**
 * Phase 5.3 sample-assembly → AssemblyPart conversion.
 *
 * The assembly UI loads {@link getSampleAssembly} which produces PartInstances
 * whose FeatureTree is a single 30 mm cube centred on the part's local
 * origin (loop spans [-15,-15] → [15,15], depth 30 in +Z). The drawing-page
 * STEP writer accepts only `AssemblyPart` records, so we walk every
 * PartInstance and emit its world-space axis-aligned bbox (Phase 1 limit:
 * orientation is dropped — only `position` participates).
 *
 * Returns a freshly allocated array so the caller can mutate it without
 * disturbing the cached sample.
 */
function partInstanceToAssemblyPart(p: PartInstance): AssemblyPart {
  // Cube feature is centred at the part local origin: x/y span [-15, +15],
  // z span [0, +30] (one_sided +Z extrude, depth 30).
  const px = p.position.x;
  const py = p.position.y;
  const pz = p.position.z;
  return {
    kind: 'box',
    id: p.id,
    name: p.name,
    x0: px - 15,
    y0: py - 15,
    z0: pz,
    x1: px + 15,
    y1: py + 15,
    z1: pz + 30,
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
  /**
   * Phase 5.3.5 OCCT-direct hybrid mode selector. Default 'shape_aspect'
   * preserves NNN behaviour byte-for-byte — the existing footer route
   * (`exportSheetStepWithBindings`) is engaged whenever this stays at
   * 'shape_aspect' AND no OCCT bindings are supplied, so the 195
   * pre-existing drawing-suite tests keep passing untouched.
   *
   * Selecting 'occt' or 'both' switches the export handler to the
   * Phase-2 orchestrator ({@link writeStepWithPmiOcctBindings}), which
   * supports OCCT-direct face anchors AND, in 'both' mode, the Phase-1
   * SHAPE_ASPECT side-channel alongside.
   */
  const [hybridMode, setHybridMode] = useState<HybridBindingMode>('shape_aspect');
  /**
   * Phase 5.3.5 toggle: when 'occt' or 'both' is active, this opts the
   * user into supplying explicit OCCT bindings via the textarea below.
   * When off, the orchestrator runs with `occtBindings: []`, which
   * (per its spec) collapses to the equivalent of the underlying PMI
   * writer for `mode='occt'` and to NNN for `mode='shape_aspect'`.
   */
  const [includeOcctBindings, setIncludeOcctBindings] = useState<boolean>(false);
  /** Raw textarea content for the OCCT bindings JSON. Parsed at export time. */
  const [occtBindingsInput, setOcctBindingsInput] = useState<string>('');
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
  /**
   * Phase 4.4.3 Phase 2 — user-selected PDF pipeline. Default 'raster'
   * preserves back-compat with the 195 existing drawing-suite tests
   * (none of which know about the vector path). When 'vector', the
   * single-part and assembly export handlers route to
   * {@link exportSheetsToPdfVector}. On VectorPdfError(svg2pdf-missing|
   * jspdf-missing) the handler automatically retries with the raster
   * pipeline and surfaces a "fallback to raster" notice — chosen over
   * a manual retry button because the failure is purely about an
   * unbundled optional dep, which the user can't action.
   */
  const [pdfFormat, setPdfFormat] = useState<'raster' | 'vector'>('raster');
  /**
   * Phase 4.4.3 Phase 3 — large-paper PDF resolution preset. Only consulted
   * when paper ≥ A2 and the export routes through
   * {@link exportLargeSheetToPdf}; A4/A3 keep the legacy 2 px/mm raster
   * density baked into {@link exportSheetsToPdf}. Default 'standard' keeps
   * file sizes screen-review-friendly (~100 dpi) — operators who need
   * plotter-grade output bump to 'print' (12 px/mm ≈ 300 dpi).
   */
  const [pdfResolution, setPdfResolution] = useState<'standard' | 'high' | 'print'>(
    'standard',
  );
  /**
   * Banner shown on success: identifies which pipeline produced the PDF,
   * so users know whether their text will be selectable. Cleared at the
   * start of every fresh export attempt.
   */
  const [pdfExportInfo, setPdfExportInfo] = useState<string | null>(null);

  // ─── Phase 4.7 cursor snap state ───────────────────────────────────────
  /**
   * Whether the sheet-snap pass runs on mousemove. Default off so the
   * 195 existing drawing-suite tests don't see the new DOM. Users opt
   * in via the `drawing-snap-toggle` checkbox before placing a
   * dimension / GD&T — turning it on triggers the indicator to show
   * the nearest snap target (corner / midpoint / center / grid).
   */
  const [snapEnabled, setSnapEnabled] = useState<boolean>(false);
  /** Latest snap target from findSheetSnapTarget (null when nothing in range). */
  const [snapTarget, setSnapTarget] = useState<SheetSnapTarget | null>(null);
  /** Screen-space pixel position of the current snap (passed to the indicator). */
  const [snapScreenPos, setSnapScreenPos] = useState<{ x: number; y: number } | null>(null);

  // ─── Phase 5.3 assembly mode state ────────────────────────────────────
  const [assemblyMode, setAssemblyMode] = useState<boolean>(false);
  const [sampleName, setSampleName] = useState<SampleAssemblyName>(
    SAMPLE_ASSEMBLY_NAMES[0],
  );
  /** Per-part sheets keyed by partId. Empty by default. */
  const [partSheets, setPartSheets] = useState<Record<string, Sheet>>({});
  /** The selected part whose sheet is shown in the centre canvas. */
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  /**
   * Inline-editor target: when set, the corresponding part row expands an
   * inline panel exposing paper-size + scale controls. Only one part is
   * editable at a time — clicking another part's "Edit sheet" replaces the
   * target. Setting back to null collapses the panel.
   */
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  /** Result + warnings from the most recent writeAssemblyWithPmi call. */
  const [assemblyExport, setAssemblyExport] = useState<{
    ranges: AssemblyPmiResult['ranges'];
    warnings: ReadonlyArray<string>;
    bindingsCount: number;
  } | null>(null);
  const [assemblyExportError, setAssemblyExportError] = useState<string | null>(null);
  /**
   * Phase 5.4 multi-sheet PDF export — message shown on success ("Exported
   * N-page PDF"). Set to null when no recent export, or while a fresh
   * export is in progress.
   */
  const [assemblyPdfInfo, setAssemblyPdfInfo] = useState<string | null>(null);
  const [assemblyPdfError, setAssemblyPdfError] = useState<string | null>(null);

  const sheetRef = React.useRef<HTMLDivElement>(null);
  /**
   * Hidden DOM region that mounts every per-part `SheetRenderer` in
   * assembly mode (display:none for non-selected parts). The Export PDF
   * handler walks this region with `querySelector` to collect one
   * `SVGElement` per partSheet — alignment with `Object.values(partSheets)`
   * is guaranteed because we wrap each renderer in a `div` keyed by
   * `data-part-id` and iterate sheets in the same order we render them.
   *
   * Why not mount inline? The centre canvas only shows the *selected* part;
   * an unselected SheetRenderer would otherwise not be in the DOM, which
   * would force a per-sheet React re-render race during PDF capture. A
   * dedicated hidden container side-steps that.
   */
  const hiddenSheetsRef = React.useRef<HTMLDivElement>(null);

  /**
   * Memoised sample assembly. Recomputed only when the user picks a new
   * preset — partSheets edits don't re-run getSampleAssembly so the part
   * list stays stable.
   */
  const sampleAssembly = useMemo(() => {
    return getSampleAssembly(sampleName);
  }, [sampleName]);

  // Reset per-part sheets + selected part whenever the sample changes.
  // Wrapped in useMemo above so this effect tracks the sample identity.
  React.useEffect(() => {
    setPartSheets({});
    setSelectedPartId(null);
    setEditingPartId(null);
    setAssemblyExport(null);
    setAssemblyExportError(null);
    setAssemblyPdfInfo(null);
    setAssemblyPdfError(null);
  }, [sampleName]);

  const handleAddSheetForPart = useCallback((partId: string, partName: string) => {
    setPartSheets((prev) => {
      if (prev[partId]) return prev; // already has a sheet
      const newSheet = standardThreeViewSheet({
        id: `assembly-sheet-${partId}`,
        name: `Drawing — ${partName}`,
        sourceId: partId,
        paperSize: 'A3',
        scale: 1,
      });
      return { ...prev, [partId]: newSheet };
    });
    // Auto-select the first part to gain a sheet.
    setSelectedPartId((cur) => cur ?? partId);
  }, []);

  /**
   * Rebuild the sheet for a single part with new paper size / scale. We call
   * {@link standardThreeViewSheet} again so the viewport layout reflows for
   * the new paper dimensions — keeping the per-part name (already encoded
   * into the sheet id) stable across edits.
   */
  const handleEditSheet = useCallback(
    (partId: string, partName: string, nextPaper: PaperSize, nextScale: number) => {
      setPartSheets((prev) => {
        const existing = prev[partId];
        if (!existing) return prev;
        const updated = standardThreeViewSheet({
          id: existing.id,
          name: existing.name.startsWith('Drawing — ')
            ? existing.name
            : `Drawing — ${partName}`,
          sourceId: partId,
          paperSize: nextPaper,
          scale: nextScale,
        });
        return { ...prev, [partId]: updated };
      });
    },
    [],
  );

  /**
   * Remove a single part's sheet. Confirms first so a stray click doesn't
   * silently discard annotation work. If the removed part is the currently
   * selected preview part, we clear the selection so the centre canvas
   * falls back to the "no sheet" placeholder.
   */
  const handleRemoveSheet = useCallback((partId: string) => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const ok = window.confirm(pickDict(lang).confirmRemoveSheet);
      if (!ok) return;
    }
    setPartSheets((prev) => {
      if (!prev[partId]) return prev;
      // Object-rest spread is the idiomatic way to drop a single key from a
      // record without mutating the source.
      const next: Record<string, Sheet> = { ...prev };
      delete next[partId];
      return next;
    });
    setSelectedPartId((cur) => (cur === partId ? null : cur));
    setEditingPartId((cur) => (cur === partId ? null : cur));
  }, [lang]);

  /**
   * Bulk: add a sheet to every part that doesn't already have one. We never
   * overwrite — operators who want to reset a sheet should use Clear-all
   * first, then re-add. Auto-selects the first part to gain a sheet when
   * nothing was selected.
   */
  const handleAddAllSheets = useCallback(() => {
    const parts = sampleAssembly.state.parts;
    if (parts.length === 0) return;
    setPartSheets((prev) => {
      const next: Record<string, Sheet> = { ...prev };
      for (const p of parts) {
        if (next[p.id]) continue;
        next[p.id] = standardThreeViewSheet({
          id: `assembly-sheet-${p.id}`,
          name: `Drawing — ${p.name}`,
          sourceId: p.id,
          paperSize: 'A3',
          scale: 1,
        });
      }
      return next;
    });
    setSelectedPartId((cur) => cur ?? parts[0].id);
  }, [sampleAssembly]);

  /**
   * Bulk: clear all part sheets after confirming. The selected preview part
   * + the inline editor target both reset so the UI returns to its "no
   * sheets" baseline.
   */
  const handleClearAllSheets = useCallback(() => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const ok = window.confirm(pickDict(lang).confirmClearAllSheets);
      if (!ok) return;
    }
    setPartSheets({});
    setSelectedPartId(null);
    setEditingPartId(null);
  }, [lang]);

  const onExportAssemblyStep = useCallback(() => {
    setAssemblyExportError(null);
    setAssemblyExport(null);
    try {
      const parts: AssemblyPart[] = sampleAssembly.state.parts.map(
        partInstanceToAssemblyPart,
      );
      const result = writeAssemblyWithPmi({
        geometry: {
          kind: 'assembly',
          assemblyName: sampleName,
          parts,
        },
        partSheets,
        header: {
          description: `NexyFab assembly export — ${sampleName}`,
          filename: `${sampleName}.step`,
        },
      });
      let bindingsCount = 0;
      for (const m of result.pmiMappingByPart.values()) {
        bindingsCount += m.size;
      }
      setAssemblyExport({
        ranges: result.ranges,
        warnings: result.warnings,
        bindingsCount,
      });
      const blob = new Blob([result.source], { type: 'application/step' });
      downloadBlob(blob, `${sampleName}.step`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setAssemblyExportError(`${dict.assemblyExportError}: ${detail}`);
    }
  }, [sampleAssembly, sampleName, partSheets, dict.assemblyExportError]);

  /**
   * Phase 5.4 multi-sheet PDF export — bundles every part sheet that has
   * a corresponding hidden `SheetRenderer` SVG mount into a single
   * multi-page PDF via {@link exportSheetsToPdf}.
   *
   * SVG ref collection algorithm:
   *   1. Iterate `Object.entries(partSheets)` in insertion order.
   *   2. For each (partId, sheet), look up the matching hidden wrapper
   *      via `[data-part-id="<id>"]` inside `hiddenSheetsRef`.
   *   3. Query the SVG element under that wrapper. If absent (race or
   *      missing renderer) skip the pair entirely — `exportSheetsToPdf`
   *      enforces `sheets.length === svgRefs.length` so we must keep
   *      arrays paired.
   *   4. Pass the paired arrays straight through. If nothing remains,
   *      surface the "no sheets to export" info banner.
   */
  const onExportAssemblyPdf = useCallback(async () => {
    setAssemblyPdfError(null);
    setAssemblyPdfInfo(null);

    const entries = Object.entries(partSheets);
    if (entries.length === 0) {
      setAssemblyPdfInfo(dict.assemblyPdfNoSheets);
      return;
    }

    const sheetsToExport: Sheet[] = [];
    const svgRefs: SVGElement[] = [];
    const root = hiddenSheetsRef.current;
    if (root) {
      for (const [partId, partSheet] of entries) {
        const wrapper = root.querySelector(`[data-part-id="${partId}"]`);
        const svg = wrapper?.querySelector(
          'svg[data-testid="sheet-renderer-root"]',
        ) as SVGElement | null;
        if (svg) {
          sheetsToExport.push(partSheet);
          svgRefs.push(svg);
        }
      }
    }

    if (sheetsToExport.length === 0) {
      setAssemblyPdfInfo(dict.assemblyPdfNoSheets);
      return;
    }

    /**
     * Phase 4.4.3 Phase 3 — pipeline tagging for assemblies:
     *
     * The multi-page raster path (`exportSheetsToPdf`) bundles every sheet
     * into a single PDF regardless of paper size. When any sheet in the
     * bundle is A2+ we surface "Tiled raster PDF" in the banner so the
     * user knows large pages were rasterised at the multi-page exporter's
     * built-in 2 px/mm density. (True per-page tiling — pdfExportLarge's
     * multi-tile branch — is only available for single-sheet exports
     * today; expanding pdfExportLarge to multi-page is tracked under
     * Phase 4.4.4.)
     */
    const anyLargePaper = sheetsToExport.some((s) =>
      isLargePaper(s.paperSize, s.customPaper),
    );
    const rasterPipelineTag = anyLargePaper
      ? dict.pipelineTiledRasterPdf
      : dict.pipelineSingleRaster;

    /**
     * Raster path — used as the default pipeline AND as the automatic
     * fallback when the user picked 'vector' but the svg2pdf / jspdf
     * optional dep failed to load. Mirrors the single-part handler.
     */
    const runRaster = async (fellBack: boolean): Promise<void> => {
      try {
        const blob = await exportSheetsToPdf(sheetsToExport, svgRefs);
        downloadBlob(blob, `${sampleName}.pdf`);
        const successMsg = dict.assemblyPdfSuccess.replace(
          '{n}',
          String(sheetsToExport.length),
        );
        const base = fellBack ? dict.fallbackToRaster : dict.exportedAsRaster;
        setAssemblyPdfInfo(`${successMsg} — ${base} — ${rasterPipelineTag}`);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const prefix =
          err instanceof PdfExportError && err.code === 'jspdf-missing'
            ? `${dict.assemblyPdfError} (jspdf)`
            : dict.assemblyPdfError;
        setAssemblyPdfError(`${prefix}: ${detail}`);
      }
    };

    if (pdfFormat === 'vector') {
      try {
        const blob = await exportSheetsToPdfVector(sheetsToExport, svgRefs);
        downloadBlob(blob, `${sampleName}.pdf`);
        const successMsg = dict.assemblyPdfSuccess.replace(
          '{n}',
          String(sheetsToExport.length),
        );
        setAssemblyPdfInfo(
          `${successMsg} — ${dict.exportedAsVector} — ${dict.pipelineVectorPdf}`,
        );
      } catch (err) {
        if (
          err instanceof VectorPdfError
          && (err.code === 'svg2pdf-missing' || err.code === 'jspdf-missing')
        ) {
          await runRaster(true);
          return;
        }
        const detail = err instanceof Error ? err.message : String(err);
        setAssemblyPdfError(`${dict.assemblyPdfError}: ${detail}`);
      }
      return;
    }

    await runRaster(false);
  }, [
    partSheets,
    sampleName,
    pdfFormat,
    dict.assemblyPdfError,
    dict.assemblyPdfSuccess,
    dict.assemblyPdfNoSheets,
    dict.exportedAsRaster,
    dict.exportedAsVector,
    dict.fallbackToRaster,
    dict.pipelineVectorPdf,
    dict.pipelineTiledRasterPdf,
    dict.pipelineSingleRaster,
  ]);

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

  /**
   * Mouse-move handler for the single-part canvas. When snap is enabled
   * we project the cursor's screen-px position back into sheet mm using
   * the SheetRenderer's viewBox + bounding rect, then call
   * findSheetSnapTarget. The returned target (or null) drives the
   * SheetSnapIndicator and is stored alongside the screen-px position
   * for absolute marker placement. When snap is disabled we keep the
   * handler a no-op so the host can still attach it without churn.
   */
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!snapEnabled) return;
      const svgEl = (e.currentTarget.querySelector(
        'svg[data-testid="sheet-renderer-root"]',
      ) as SVGSVGElement | null);
      if (!svgEl) return;
      const rect = svgEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dim = paperDimensions(sheet.paperSize, sheet.customPaper);
      // SVG viewBox is `0 0 width(mm) height(mm)` with top-left origin;
      // Sheet IR uses bottom-left mm so the y-axis is flipped here.
      const xMm = ((e.clientX - rect.left) / rect.width) * dim.width;
      const yMmTop = ((e.clientY - rect.top) / rect.height) * dim.height;
      const yMm = dim.height - yMmTop;
      const target = findSheetSnapTarget({ x: xMm, y: yMm }, sheet);
      setSnapTarget(target);
      if (target) {
        // Convert the snap's sheet-mm pos back to screen px so the
        // indicator can be absolutely positioned over the canvas.
        const snapXPx = rect.left + (target.pos.x / dim.width) * rect.width;
        const snapYPx = rect.top + ((dim.height - target.pos.y) / dim.height) * rect.height;
        setSnapScreenPos({
          x: snapXPx - rect.left,
          y: snapYPx - rect.top,
        });
      } else {
        setSnapScreenPos(null);
      }
    },
    [snapEnabled, sheet],
  );

  const handleCanvasMouseLeave = useCallback(() => {
    setSnapTarget(null);
    setSnapScreenPos(null);
  }, []);

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
      /**
       * Phase 5.3.5 routing matrix:
       *   - hybridMode='shape_aspect' (default) AND not includeOcctBindings
       *     → preserve the existing NNN/legacy routes. This is the
       *       back-compat path that the 195 drawing-suite tests exercise.
       *   - hybridMode='occt' OR 'both' OR includeOcctBindings on
       *     → route through {@link writeStepWithPmiOcctBindings}. The
       *       textarea is parsed here; a parse failure is surfaced via the
       *       inline error banner (NO blob download in that case).
       *
       * The OCCT bindings array is empty when `includeOcctBindings` is
       * off — the orchestrator handles that as a no-op for Phase-2
       * (collapses to the underlying PMI writer).
       */
      const useOcctOrchestrator =
        hybridMode === 'occt' || hybridMode === 'both' || includeOcctBindings;

      if (useOcctOrchestrator) {
        let parsedOcctBindings: OcctPmiBinding[] = [];
        if (includeOcctBindings) {
          try {
            parsedOcctBindings = parseOcctBindingsInput(occtBindingsInput);
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            setStepExportError(`${dict.occtBindingsParseError}: ${detail}`);
            return;
          }
        }
        const res = exportSheetStepWithOcctBindings(
          sourceId,
          sheet,
          `${sheet.id}.step`,
          {
            hybridMode,
            occtBindings: parsedOcctBindings,
            includeShapeAspectBindings: includeBindings,
            withSavedView: useSavedView,
          },
        );
        setStepExportWarnings(res.warnings);
        if (res.bindingsCount > 0) {
          setStepExportInfo(`${dict.bindingsApplied}: ${res.bindingsCount}`);
        }
      } else if (includeBindings || useSavedView) {
        // Legacy Phase-1 NNN path — mode is 'shape_aspect' AND user opted
        // into bindings/saved-view but NOT OCCT. Keep this distinct from
        // the orchestrator path so the byte-for-byte STEP output that the
        // existing tests assert against is preserved.
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
    hybridMode,
    includeOcctBindings,
    occtBindingsInput,
    dict.exportStepError,
    dict.bindingsApplied,
    dict.occtBindingsParseError,
  ]);

  const onExportPdf = useCallback(async () => {
    setPdfExportError(null);
    setPdfExportInfo(null);
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

    /**
     * Phase 4.4.3 Phase 3 — paper-size based routing:
     *
     *   - A4 / A3   → legacy `exportSheetsToPdf` (2 px/mm, single tile).
     *                 Preserves the 199 existing drawing-suite tests
     *                 that exercise jsPDF ctor + addImage on A3/A4.
     *   - A2+ paper → `exportLargeSheetToPdf` (auto resolution + tiling).
     *                 The user's `pdfResolution` radio is honoured here;
     *                 banner names the pipeline the wrapper chose (single
     *                 raster vs tiled raster).
     *   - vector format → `exportSheetsToPdfVector` directly (legacy path).
     *                 On `svg2pdf-missing` / `jspdf-missing` we fall back
     *                 to the size-aware raster route — A0 + vector-missing
     *                 still gets a useful tiled raster page out of
     *                 `exportLargeSheetToPdf` rather than a single
     *                 over-stretched A0 PNG.
     */
    const largePaper = isLargePaper(sheet.paperSize, sheet.customPaper);

    /**
     * Raster path — used as the default pipeline AND as the automatic
     * fallback when the user picked 'vector' but the svg2pdf / jspdf
     * optional dep failed to load. The `fellBack` flag controls whether
     * the banner shows the plain "Exported as raster" message or the
     * "vector unavailable, fell back to raster" notice.
     *
     * For A2+ paper we route to {@link exportLargeSheetToPdf} so the
     * caller's `pdfResolution` is honoured and tiling kicks in when the
     * page exceeds the single-canvas pixel budget. The wrapper's choice
     * (single raster vs tiled raster) drives the pipeline tag appended
     * to the success banner.
     */
    const runRaster = async (fellBack: boolean): Promise<void> => {
      try {
        let blob: Blob;
        /**
         * Pipeline label appended to the banner so users know whether
         * their PDF is single-tile, multi-tile, or vector. Defaults to
         * the "single raster" tag for the legacy A4/A3 path; the large
         * path overrides this to either tiled or single raster based on
         * the page's effective pixel footprint.
         */
        let pipelineTag: string = dict.pipelineSingleRaster;
        if (largePaper) {
          // For A2+ raster we call the large-paper wrapper. We deliberately
          // do NOT pass `loadSvg2Pdf` here — the user picked raster (or
          // we're in the fallback path), so we want the wrapper's
          // raster/tiled-raster decision, NOT its vector branch.
          blob = await exportLargeSheetToPdf(sheet, svgEl, {
            resolution: pdfResolution,
          });
          // Heuristic: pdfExportLarge's tiled-raster path is engaged when
          // the page's effective pixel dims exceed MAX_TILE_EDGE (8192) on
          // either axis OR the total pixel budget. Replicating that
          // signal here avoids exposing a sentinel through the wrapper.
          const dim = paperDimensions(sheet.paperSize, sheet.customPaper);
          const pxPerMm =
            pdfResolution === 'print' ? 12 : pdfResolution === 'high' ? 8 : 4;
          const wPx = dim.width * pxPerMm;
          const hPx = dim.height * pxPerMm;
          const tiled = wPx > 8192 || hPx > 8192 || wPx * hPx > 50_000_000;
          pipelineTag = tiled
            ? dict.pipelineTiledRasterPdf
            : dict.pipelineSingleRaster;
        } else {
          blob = await exportSheetsToPdf(sheetsToExport, svgRefs);
        }
        downloadBlob(blob, `${sheet.id}.pdf`);
        const base = fellBack ? dict.fallbackToRaster : dict.exportedAsRaster;
        setPdfExportInfo(`${base} — ${pipelineTag}`);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const isJspdfMissing =
          (err instanceof PdfExportError && err.code === 'jspdf-missing')
          || (err instanceof LargePdfError && err.code === 'jspdf-missing');
        const prefix = isJspdfMissing
          ? `${dict.exportPdfError} (jspdf)`
          : dict.exportPdfError;
        setPdfExportError(`${prefix}: ${detail}`);
      }
    };

    if (pdfFormat === 'vector') {
      try {
        const blob = await exportSheetsToPdfVector(sheetsToExport, svgRefs);
        downloadBlob(blob, `${sheet.id}.pdf`);
        setPdfExportInfo(`${dict.exportedAsVector} — ${dict.pipelineVectorPdf}`);
      } catch (err) {
        if (
          err instanceof VectorPdfError
          && (err.code === 'svg2pdf-missing' || err.code === 'jspdf-missing')
        ) {
          // Automatic fallback: the optional dep isn't installed. Re-run
          // the raster pipeline and surface the bilingual fallback notice.
          await runRaster(true);
          return;
        }
        const detail = err instanceof Error ? err.message : String(err);
        setPdfExportError(`${dict.exportPdfError}: ${detail}`);
      }
      return;
    }

    await runRaster(false);
  }, [
    sheet,
    pdfFormat,
    pdfResolution,
    dict.exportPdfError,
    dict.exportedAsRaster,
    dict.exportedAsVector,
    dict.fallbackToRaster,
    dict.pipelineVectorPdf,
    dict.pipelineTiledRasterPdf,
    dict.pipelineSingleRaster,
  ]);

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
        <header
          data-testid="drawing-page-header"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{dict.title}</h1>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>{dict.subtitle}</p>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: '#374151',
              fontWeight: 600,
            }}
          >
            <input
              type="checkbox"
              data-testid="drawing-assembly-mode-toggle"
              checked={assemblyMode}
              onChange={(e) => setAssemblyMode(e.target.checked)}
            />
            {dict.assemblyMode}
          </label>
        </header>

        {assemblyMode ? (
          <section
            data-testid="drawing-assembly-section"
            style={{
              display: 'grid',
              gridTemplateColumns: '280px 1fr',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            {/* ─── Left panel: sample picker + part list ─────────────── */}
            <aside
              data-testid="drawing-assembly-left-panel"
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
              <label
                style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}
              >
                <span style={{ fontWeight: 600 }}>{dict.assemblySamplePickerLabel}</span>
                <select
                  data-testid="drawing-assembly-sample-select"
                  value={sampleName}
                  onChange={(e) => setSampleName(e.target.value as SampleAssemblyName)}
                  style={{ padding: 6 }}
                >
                  {SAMPLE_ASSEMBLY_NAMES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{dict.partListLabel}</span>
                <ul
                  data-testid="drawing-assembly-part-list"
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {sampleAssembly.state.parts.map((p) => {
                    const hasSheet = Boolean(partSheets[p.id]);
                    const selected = p.id === selectedPartId;
                    const isEditing = editingPartId === p.id && hasSheet;
                    const editingSheet = hasSheet ? partSheets[p.id] : null;
                    return (
                      <li
                        key={p.id}
                        data-testid={`drawing-assembly-part-row-${p.id}`}
                        data-selected={selected ? 'true' : 'false'}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          padding: '6px 8px',
                          borderRadius: 4,
                          background: selected ? '#dbeafe' : '#f3f4f6',
                          fontSize: 12,
                          cursor: hasSheet ? 'pointer' : 'default',
                        }}
                        onClick={() => {
                          if (hasSheet) setSelectedPartId(p.id);
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              data-testid={`drawing-assembly-part-${p.id}-status`}
                              aria-label={hasSheet ? 'sheet-added' : 'no-sheet'}
                              style={{
                                display: 'inline-block',
                                width: 14,
                                textAlign: 'center',
                                color: hasSheet ? '#166534' : '#9ca3af',
                                fontWeight: 700,
                              }}
                            >
                              {hasSheet ? '✓' : '○'}
                            </span>
                            <strong>{p.name}</strong>
                            {!hasSheet ? (
                              <span style={{ color: '#9ca3af' }}> · {dict.noSheetAdded}</span>
                            ) : null}
                          </span>
                          <span style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              data-testid={`drawing-assembly-part-${p.id}-sheet`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddSheetForPart(p.id, p.name);
                              }}
                              disabled={hasSheet}
                              style={{
                                padding: '2px 8px',
                                background: hasSheet ? '#e5e7eb' : '#1d4ed8',
                                color: hasSheet ? '#6b7280' : '#fff',
                                border: 'none',
                                borderRadius: 3,
                                cursor: hasSheet ? 'not-allowed' : 'pointer',
                                fontSize: 11,
                              }}
                            >
                              {dict.addSheet}
                            </button>
                            {hasSheet ? (
                              <button
                                type="button"
                                data-testid={`drawing-assembly-part-${p.id}-edit-sheet`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingPartId((cur) => (cur === p.id ? null : p.id));
                                }}
                                style={{
                                  padding: '2px 8px',
                                  background: isEditing ? '#0f172a' : '#475569',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 3,
                                  cursor: 'pointer',
                                  fontSize: 11,
                                }}
                              >
                                {isEditing ? dict.closeEditor : dict.editSheet}
                              </button>
                            ) : null}
                            {hasSheet ? (
                              <button
                                type="button"
                                data-testid={`drawing-assembly-part-${p.id}-remove-sheet`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveSheet(p.id);
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
                                {dict.removeSheet}
                              </button>
                            ) : null}
                          </span>
                        </div>
                        {isEditing && editingSheet ? (
                          <div
                            data-testid={`drawing-assembly-part-${p.id}-sheet-editor`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                              padding: '6px 8px',
                              background: '#ffffff',
                              border: '1px solid #cbd5e1',
                              borderRadius: 4,
                            }}
                          >
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
                              <span style={{ fontWeight: 600 }}>{dict.paperLabel}</span>
                              <select
                                data-testid="drawing-assembly-sheet-paper-select"
                                value={editingSheet.paperSize}
                                onChange={(e) => {
                                  const next = e.target.value as PaperSize;
                                  // Pull the current scale from the first
                                  // viewport — the sheet builder copies the
                                  // same scale into every viewport, so any
                                  // one of them is canonical.
                                  const currentScale = editingSheet.viewports[0]?.scale ?? 1;
                                  handleEditSheet(p.id, p.name, next, currentScale);
                                }}
                                style={{ padding: 4 }}
                              >
                                {PAPER_SIZES.map((sz) => (
                                  <option key={sz} value={sz}>{sz}</option>
                                ))}
                              </select>
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
                              <span style={{ fontWeight: 600 }}>{dict.scaleLabel}</span>
                              <input
                                data-testid="drawing-assembly-sheet-scale-input"
                                type="number"
                                min={0.1}
                                max={10}
                                step={0.1}
                                value={editingSheet.viewports[0]?.scale ?? 1}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  if (!Number.isFinite(v) || v < 0.1 || v > 10) return;
                                  handleEditSheet(p.id, p.name, editingSheet.paperSize, v);
                                }}
                                style={{ padding: 4 }}
                              />
                            </label>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div
                data-testid="drawing-assembly-bulk-actions"
                style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
              >
                <button
                  type="button"
                  data-testid="drawing-assembly-add-all-sheets"
                  onClick={handleAddAllSheets}
                  disabled={sampleAssembly.state.parts.length === 0}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    background: '#1d4ed8',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 3,
                    cursor:
                      sampleAssembly.state.parts.length === 0 ? 'not-allowed' : 'pointer',
                    fontSize: 11,
                  }}
                >
                  {dict.addAllSheets}
                </button>
                <button
                  type="button"
                  data-testid="drawing-assembly-clear-all-sheets"
                  onClick={handleClearAllSheets}
                  disabled={Object.keys(partSheets).length === 0}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    background: Object.keys(partSheets).length === 0 ? '#e5e7eb' : '#b91c1c',
                    color: Object.keys(partSheets).length === 0 ? '#6b7280' : '#fff',
                    border: 'none',
                    borderRadius: 3,
                    cursor:
                      Object.keys(partSheets).length === 0 ? 'not-allowed' : 'pointer',
                    fontSize: 11,
                  }}
                >
                  {dict.clearAllSheets}
                </button>
              </div>

              <button
                type="button"
                data-testid="drawing-export-assembly-step"
                onClick={onExportAssemblyStep}
                disabled={sampleAssembly.state.parts.length === 0}
                style={{
                  padding: '8px 14px',
                  background:
                    sampleAssembly.state.parts.length === 0 ? '#9ca3af' : '#0f172a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor:
                    sampleAssembly.state.parts.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                }}
              >
                {dict.exportAssemblyStep}
              </button>
              {/*
                Assembly-mode PDF format radio. Shares the `pdfFormat`
                state with the single-part footer so a user who picked
                'vector' once continues to get vector PDFs across both
                flows. Default raster.
              */}
              <fieldset
                data-testid="drawing-assembly-pdf-format-group"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  border: '1px solid #e5e7eb',
                  borderRadius: 4,
                  padding: '4px 8px',
                  margin: 0,
                  fontSize: 11,
                  color: '#374151',
                }}
              >
                <legend style={{ padding: '0 4px', fontWeight: 600 }}>
                  {dict.pdfFormat}
                </legend>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="radio"
                    name="drawing-assembly-pdf-format"
                    data-testid="drawing-assembly-pdf-format-raster"
                    value="raster"
                    checked={pdfFormat === 'raster'}
                    onChange={() => setPdfFormat('raster')}
                  />
                  {dict.formatRaster}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="radio"
                    name="drawing-assembly-pdf-format"
                    data-testid="drawing-assembly-pdf-format-vector"
                    value="vector"
                    checked={pdfFormat === 'vector'}
                    onChange={() => setPdfFormat('vector')}
                  />
                  {dict.formatVector}
                </label>
              </fieldset>
              <button
                type="button"
                data-testid="drawing-assembly-export-pdf"
                onClick={() => { void onExportAssemblyPdf(); }}
                disabled={Object.keys(partSheets).length === 0}
                style={{
                  padding: '8px 14px',
                  background:
                    Object.keys(partSheets).length === 0 ? '#9ca3af' : '#1d4ed8',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor:
                    Object.keys(partSheets).length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                }}
              >
                {dict.exportAssemblyPdf}
              </button>
            </aside>

            {/* ─── Centre: selected part's sheet preview ─────────────── */}
            <div
              data-testid="drawing-assembly-canvas"
              style={{
                background: '#e5e7eb',
                padding: 12,
                borderRadius: 6,
                overflow: 'auto',
                display: 'flex',
                justifyContent: 'center',
                minHeight: 200,
              }}
            >
              {selectedPartId && partSheets[selectedPartId] ? (
                <SheetRenderer sheet={partSheets[selectedPartId]} />
              ) : (
                <p
                  data-testid="drawing-assembly-no-selection"
                  style={{ fontSize: 12, color: '#6b7280', margin: 0 }}
                >
                  {dict.noSheetAdded}
                </p>
              )}
            </div>

            {/*
              Hidden multi-sheet mount used by the PDF exporter. Each
              part's SheetRenderer is mounted here so the exporter can
              query its SVG element regardless of which part the user
              has selected in the centre preview. `aria-hidden` keeps it
              out of assistive-tech focus order; `position: absolute`
              + `visibility: hidden` keeps the layout clean while
              ensuring jsdom + browser layout pipelines populate the
              renderer's `<svg>` mount the same way the visible canvas
              does.
            */}
            <div
              ref={hiddenSheetsRef}
              data-testid="drawing-assembly-hidden-sheets"
              aria-hidden="true"
              style={{
                position: 'absolute',
                width: 0,
                height: 0,
                overflow: 'hidden',
                visibility: 'hidden',
                pointerEvents: 'none',
              }}
            >
              {Object.entries(partSheets).map(([pid, ps]) => (
                <div key={pid} data-part-id={pid}>
                  <SheetRenderer sheet={ps} />
                </div>
              ))}
            </div>

            {/* ─── Export result + warnings ──────────────────────────── */}
            {assemblyExport ? (
              <div
                data-testid="drawing-assembly-export-result"
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    padding: '6px 10px',
                    background: '#dcfce7',
                    color: '#166534',
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  <strong>{dict.assemblyResultLabel}: </strong>
                  parts={assemblyExport.ranges.length}, bindings={assemblyExport.bindingsCount}
                </p>
                {assemblyExport.warnings.length > 0 ? (
                  <div
                    data-testid="drawing-assembly-export-warnings"
                    role="alert"
                    style={{
                      padding: '6px 10px',
                      background: '#fef3c7',
                      color: '#92400e',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <strong style={{ display: 'block', marginBottom: 2 }}>
                      {dict.assemblyWarningsTitle}
                    </strong>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {assemblyExport.warnings.map((w, i) => (
                        <li
                          key={`${i}-${w}`}
                          data-testid={`drawing-assembly-warning-${i}`}
                        >
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {assemblyExportError ? (
              <p
                data-testid="drawing-assembly-export-error"
                role="alert"
                style={{
                  gridColumn: '1 / -1',
                  margin: 0,
                  padding: '6px 10px',
                  background: '#fee2e2',
                  color: '#991b1b',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                {assemblyExportError}
              </p>
            ) : null}
            {assemblyPdfInfo ? (
              <p
                data-testid="drawing-assembly-pdf-info"
                style={{
                  gridColumn: '1 / -1',
                  margin: 0,
                  padding: '6px 10px',
                  background: '#dcfce7',
                  color: '#166534',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                {assemblyPdfInfo}
              </p>
            ) : null}
            {assemblyPdfError ? (
              <p
                data-testid="drawing-assembly-pdf-error"
                role="alert"
                style={{
                  gridColumn: '1 / -1',
                  margin: 0,
                  padding: '6px 10px',
                  background: '#fee2e2',
                  color: '#991b1b',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                {assemblyPdfError}
              </p>
            ) : null}
          </section>
        ) : (
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

            {/*
              Snap toggle — opt-in cursor snapping for dimension /
              GD&T placement. Defaults OFF so the 195 pre-existing
              drawing-suite tests don't see the new DOM, and so a
              user who hasn't asked for snap doesn't get an unexpected
              indicator chasing the cursor. The hint below is only
              shown when snap is on.
            */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#374151',
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                data-testid="drawing-snap-toggle"
                checked={snapEnabled}
                onChange={(e) => {
                  setSnapEnabled(e.target.checked);
                  if (!e.target.checked) {
                    setSnapTarget(null);
                    setSnapScreenPos(null);
                  }
                }}
              />
              {dict.enableSnap}
            </label>
            {snapEnabled ? (
              <p
                data-testid="drawing-snap-hint"
                style={{ margin: 0, fontSize: 11, color: '#6b7280' }}
              >
                {dict.snapHint}
              </p>
            ) : null}
          </aside>

          {/* ─── Main canvas ─────────────────────────────────────────── */}
          <div
            ref={sheetRef}
            data-testid="drawing-page-canvas"
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={handleCanvasMouseLeave}
            style={{
              background: '#e5e7eb',
              padding: 12,
              borderRadius: 6,
              overflow: 'auto',
              display: 'flex',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <SheetRenderer sheet={sheet} />
            {snapEnabled ? (
              <SheetSnapIndicator
                snap={snapTarget}
                screenPos={snapScreenPos ?? undefined}
              />
            ) : null}
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
        )}

        {/* ─── Bottom: export buttons + error banner ───────────────── */}
        {!assemblyMode ? (
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
            {/*
              PDF format radio group — wired via `pdfFormat`. Default is
              'raster' so the 195 pre-existing drawing-suite tests keep
              passing without modification. The 'vector' option opts the
              caller into `exportSheetsToPdfVector` (svg2pdf.js); if the
              optional dep isn't installed, the export handler auto-falls
              back to raster.
            */}
            <fieldset
              data-testid="drawing-pdf-format-group"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: '1px solid #e5e7eb',
                borderRadius: 4,
                padding: '4px 8px',
                margin: 0,
                fontSize: 12,
                color: '#374151',
              }}
            >
              <legend style={{ padding: '0 4px', fontWeight: 600 }}>
                {dict.pdfFormat}
              </legend>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="radio"
                  name="drawing-pdf-format"
                  data-testid="drawing-pdf-format-raster"
                  value="raster"
                  checked={pdfFormat === 'raster'}
                  onChange={() => setPdfFormat('raster')}
                />
                {dict.formatRaster}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="radio"
                  name="drawing-pdf-format"
                  data-testid="drawing-pdf-format-vector"
                  value="vector"
                  checked={pdfFormat === 'vector'}
                  onChange={() => setPdfFormat('vector')}
                />
                {dict.formatVector}
              </label>
            </fieldset>
            {/*
              Phase 4.4.3 Phase 3 — large-paper PDF resolution radio.
              Only consulted when the resolved sheet is A2+; for A4/A3
              the legacy raster path keeps its baked-in 2 px/mm. We still
              render the radio uncondtionally so users can dial in the
              preset BEFORE switching to A1/A0, and so the data-testid
              hooks exist for tests regardless of paper size.
            */}
            <fieldset
              data-testid="drawing-pdf-resolution-group"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: '1px solid #e5e7eb',
                borderRadius: 4,
                padding: '4px 8px',
                margin: 0,
                fontSize: 12,
                color: '#374151',
              }}
            >
              <legend style={{ padding: '0 4px', fontWeight: 600 }}>
                {dict.pdfResolution}
              </legend>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="radio"
                  name="drawing-pdf-resolution"
                  data-testid="drawing-pdf-resolution-standard"
                  value="standard"
                  checked={pdfResolution === 'standard'}
                  onChange={() => setPdfResolution('standard')}
                />
                {dict.resStandard}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="radio"
                  name="drawing-pdf-resolution"
                  data-testid="drawing-pdf-resolution-high"
                  value="high"
                  checked={pdfResolution === 'high'}
                  onChange={() => setPdfResolution('high')}
                />
                {dict.resHigh}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="radio"
                  name="drawing-pdf-resolution"
                  data-testid="drawing-pdf-resolution-print"
                  value="print"
                  checked={pdfResolution === 'print'}
                  onChange={() => setPdfResolution('print')}
                />
                {dict.resPrint}
              </label>
            </fieldset>
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
            {/*
              Phase 5.3.5 hybridMode dropdown. Default 'shape_aspect'
              preserves the NNN flow byte-for-byte; switching to 'occt'
              or 'both' routes the next Export STEP+PMI click through
              the OCCT orchestrator. Wrapped in a `<label>` so the
              accessible name matches the dict entry (mirrors the
              pattern used by the surrounding checkboxes).
            */}
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#374151' }}
            >
              <span style={{ fontWeight: 600 }}>{dict.hybridMode}</span>
              <select
                data-testid="drawing-hybrid-mode-select"
                value={hybridMode}
                onChange={(e) => setHybridMode(e.target.value as HybridBindingMode)}
                style={{ padding: 4 }}
              >
                <option value="shape_aspect">{dict.shapeAspectOnly}</option>
                <option value="occt">{dict.occtDirect}</option>
                <option value="both">{dict.bothMode}</option>
              </select>
            </label>
            {hybridMode === 'occt' || hybridMode === 'both' ? (
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#374151' }}
              >
                <input
                  type="checkbox"
                  data-testid="drawing-include-occt-bindings"
                  checked={includeOcctBindings}
                  onChange={(e) => setIncludeOcctBindings(e.target.checked)}
                />
                {dict.includeOcctBindings}
              </label>
            ) : null}
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
          {/*
            Phase 5.3.5 OCCT bindings textarea. Only rendered when the
            hybrid mode is 'occt' or 'both' AND the user explicitly
            opted in via the include-occt checkbox. Free-form JSON
            input — the export handler parses on click and surfaces
            parse failures via the same error banner used for STEP
            writer throws.
          */}
          {(hybridMode === 'occt' || hybridMode === 'both') && includeOcctBindings ? (
            <label
              data-testid="drawing-occt-bindings-input-label"
              style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#374151' }}
            >
              <span style={{ fontWeight: 600 }}>{dict.occtBindingsInputLabel}</span>
              <textarea
                data-testid="drawing-occt-bindings-input"
                value={occtBindingsInput}
                onChange={(e) => setOcctBindingsInput(e.target.value)}
                placeholder={dict.occtBindingsPlaceholder}
                rows={4}
                style={{
                  padding: 6,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 11,
                  resize: 'vertical',
                }}
              />
            </label>
          ) : null}
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
          {pdfExportInfo ? (
            <p
              data-testid="drawing-export-pdf-info"
              style={{
                margin: 0,
                padding: '6px 10px',
                background: '#dcfce7',
                color: '#166534',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {pdfExportInfo}
            </p>
          ) : null}
        </footer>
        ) : null}
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
