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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  standardThreeViewSheet,
  paperDimensions,
  type PaperSize,
  type Sheet,
  type Viewport,
} from '@/lib/drawing/sheet';
import {
  applyTemplate,
  TEMPLATES,
  type SheetTemplate,
  type SheetTemplateTitleblock,
} from '@/lib/drawing/sheetTemplate';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';
import type { OrdinateDimensionChain } from '@/lib/drawing/ordinateDimension';
import { writeStepWithPmi } from '@/lib/brep-bridge/stepWriteWithPmi';
import { writeStepWithPmiBindings } from '@/lib/brep-bridge/stepWriteWithPmiBindings';
import {
  writeStepWithPmiOcctBindings,
  type HybridBindingMode,
} from '@/lib/brep-bridge/stepWriteWithPmiOcctBindings';
import type { OcctPmiBinding, OcctShapeMeta } from '@/lib/brep-bridge/pmiOcctBinding';
import type { RefBinding } from '@/lib/brep-bridge/pmiShapeBinding';
import { sampleGeometryForSourceId } from '@/lib/drawing/sampleGeometry';
import { featureToPolyhedron, type Polyhedron } from '@/lib/cad/featureMesh';
import { buildExtrudeTopo, edgeMidpoint, type NamedTopology } from '@/lib/cad/topoNaming';
import { fromAnchors, type EdgeAnchorSource } from '@/lib/cad/composedTopo';
import {
  reanchorCuttingPlane,
  auditSheetDimensions,
  formatMeasuredValue,
} from '@/lib/drawing/associativeUpdate';
import {
  collectLostRefs,
  suggestRelinkCandidates,
  applyRelink,
  formatRelinkRecord,
  type LostRef,
  type RelinkRecord,
  type RelinkTarget,
} from '../features/refRelink';
import RefRelinkPanel, { type RefRelinkItem } from '../panels/RefRelinkPanel';
import { projectPolyhedron } from '@/lib/drawing/projectView';
import { formatSurfaceFinish, type SurfaceFinishSymbol } from '@/lib/drawing/surfaceFinishSymbol';
import { formatWeldSymbol, type WeldSymbol } from '@/lib/drawing/weldSymbol';
import type { DrawingAnnotation } from './DimensionAnnotationModal';
import { exportSheetsToPdf, PdfExportError } from '@/lib/drawing/pdfExport';
import { sheetToDxf } from '@/lib/drawing/dxfExport';
import type { CuttingPlane } from './sectionView';
import { loc } from '../lib/loc';
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
import {
  buildAssemblyBomSheet,
  mergePolyhedra,
  type BomPartInput,
} from '@/lib/drawing/assemblyBomSheet';
import { SheetRenderer } from './SheetRenderer';
import DimensionAnnotationModal from './DimensionAnnotationModal';
import { SheetSnapIndicator } from './SheetSnapIndicator';
import { findSheetSnapTarget, type SheetSnapTarget } from '@/lib/drawing/sheetSnap';
import { SheetPngExportButton } from './SheetPngExportButton';
import StepCompareVersionPanel from './StepCompareVersionPanel';
import OrdinateDimensionPanel from './OrdinateDimensionPanel';
import { partitionDrawingReferences } from '@/lib/drawing/referenceReview';
import type { AssemblyDrawingHandoff } from '../assembly/drawingHandoff';
import { assessManufacturingHandoffReadiness } from '../io/manufacturingHandoffReadiness';

const EMPTY_DRAWING_ASSEMBLY: AssemblyDrawingHandoff['assembly'] = {
  state: { parts: [], mates: [] },
  featureTrees: {},
};

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

// ─── R5 named-channel relink helpers ─────────────────────────────────────

/**
 * R5 — anchor source over a part's full named topology: every stable name →
 * one 3D anchor point. Edges use their true midpoint (`edgeMidpoint`); faces
 * use the loop-vertex centroid, which is an APPROXIMATE anchor used for
 * candidate distance-ranking only — it is never presented as a measurement
 * (근사 명시). Covering faces too is what keeps `collectLostRefs` honest on
 * this page: a face ref that still resolves must not be reported as lost.
 */
function topoAnchorSource(topo: NamedTopology): EdgeAnchorSource {
  const map = new Map<string, { x: number; y: number; z: number }>();
  for (const [name, entry] of topo.byName) {
    if (entry.kind === 'edge') {
      const m = edgeMidpoint(topo, name);
      if (m) map.set(name, m);
      continue;
    }
    const f = topo.poly.faces[entry.index];
    if (!f || f.vertices.length === 0) continue;
    let x = 0, y = 0, z = 0;
    for (const vi of f.vertices) {
      const v = topo.poly.vertices[vi];
      x += v.x; y += v.y; z += v.z;
    }
    const n = f.vertices.length;
    map.set(name, { x: x / n, y: y / n, z: z / n });
  }
  return fromAnchors(map);
}

/**
 * Restrict relink candidates to the lost name's own entity family
 * ('f.*' → faces only, 'e.*' → edges only) so a lost face ref is never
 * offered an edge substitute that the measure layer would then refuse as
 * wrong-ref-type. Names outside both families pass through unfiltered.
 */
function sameKindAnchors(src: EdgeAnchorSource, lostName: string): EdgeAnchorSource {
  const prefix = lostName.startsWith('f.') ? 'f.' : lostName.startsWith('e.') ? 'e.' : null;
  if (!prefix) return src;
  const lossReason = src.lossReason?.bind(src);
  return {
    anchor: (n) => (n.startsWith(prefix) ? src.anchor(n) : null),
    names: () => src.names().filter((n) => n.startsWith(prefix)),
    ...(lossReason ? { lossReason } : {}),
  };
}

// ─── Phase 4.1.3 sheet-template picker keys ──────────────────────────────
/**
 * Ordered list of template keys exposed in the dropdown. `'none'` is the
 * sentinel for "no template applied" — it preserves the original sheet's
 * paperSize/customPaper untouched. The remaining four entries map 1:1 to
 * the {@link TEMPLATES} registry.
 */
type TemplateKey = 'none' | 'engineering' | 'architectural' | 'minimal' | 'isoA3';
const TEMPLATE_KEYS: ReadonlyArray<TemplateKey> = [
  'none',
  'engineering',
  'architectural',
  'minimal',
  'isoA3',
];

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
  /** R4 wiring — DXF (R12 ASCII) sheet export. */
  exportDxf: string;
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
  ordinateTag: string;
  editAnnotation: string;
  /** R5 — named-channel relink: button on ⚠ unresolved-ref dimension rows. */
  relinkAnnotation: string;
  /** R5 — toast prefix after a user-confirmed ref substitution. */
  relinkApplied: string;
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
  /** Phase 4.1.3 sheet template picker. */
  templatePicker: string;
  templateNone: string;
  templateEngineering: string;
  templateArchitectural: string;
  templateMinimal: string;
  templateIsoA3: string;
  titleblockSectionLabel: string;
  titleblockTitle: string;
  titleblockDrawnBy: string;
  titleblockProject: string;
  /** B31.4 STEP version compare toggle labels. */
  compareVersions: string;
  hideCompareButton: string;
  /** B31.6 dedicated PNG-export button section toggle. */
  enablePngExport: string;
  enableOrdinateChain: string;
  hideOrdinateChain: string;
  /** SolidWorks-parity Phase 3 — assembly BOM table + auto balloons. */
  bomToggle: string;
  bomSheetTitle: string;
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
    exportDxf: 'DXF 내보내기',
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
    ordinateTag: '기준선',
    editAnnotation: '편집',
    relinkAnnotation: '재지정',
    relinkApplied: '참조 재지정 적용됨',
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
    templatePicker: '시트 템플릿',
    templateNone: '없음',
    templateEngineering: '엔지니어링',
    templateArchitectural: '건축',
    templateMinimal: '미니멀',
    templateIsoA3: 'ISO A3',
    titleblockSectionLabel: '제목 블록',
    titleblockTitle: '제목',
    titleblockDrawnBy: '작성자',
    titleblockProject: '프로젝트',
    compareVersions: '버전 비교',
    hideCompareButton: '비교 패널 숨기기',
    enablePngExport: '고해상도 PNG 내보내기',
    enableOrdinateChain: '기준선 치수',
    hideOrdinateChain: '기준선 치수 숨기기',
    bomToggle: 'BOM + 벌룬',
    bomSheetTitle: '조립체 BOM 시트',
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
    exportDxf: 'Export DXF',
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
    templatePicker: 'Sheet template',
    templateNone: 'None',
    templateEngineering: 'Engineering',
    templateArchitectural: 'Architectural',
    templateMinimal: 'Minimal',
    templateIsoA3: 'ISO A3',
    titleblockSectionLabel: 'Title block',
    titleblockTitle: 'Title',
    titleblockDrawnBy: 'Drawn by',
    titleblockProject: 'Project',
    compareVersions: 'Compare versions',
    hideCompareButton: 'Hide compare panel',
    ordinateTag: 'ORD',
    editAnnotation: 'Edit',
    relinkAnnotation: 'Relink',
    relinkApplied: 'Reference relinked',
    enablePngExport: 'High-res PNG export',
    enableOrdinateChain: 'Ordinate dimensions',
    hideOrdinateChain: 'Hide ordinate dimensions',
    bomToggle: 'BOM + balloons',
    bomSheetTitle: 'Assembly BOM sheet',
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
    exportDxf: 'DXFエクスポート',
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
    ordinateTag: '基準線',
    editAnnotation: '編集',
    relinkAnnotation: '再指定',
    relinkApplied: '参照を再指定しました',
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
    templatePicker: 'シートテンプレート',
    templateNone: 'なし',
    templateEngineering: 'エンジニアリング',
    templateArchitectural: '建築',
    templateMinimal: 'ミニマル',
    templateIsoA3: 'ISO A3',
    titleblockSectionLabel: 'タイトルブロック',
    titleblockTitle: 'タイトル',
    titleblockDrawnBy: '作成者',
    titleblockProject: 'プロジェクト',
    compareVersions: 'バージョン比較',
    hideCompareButton: '比較パネルを非表示',
    enablePngExport: '高解像度PNG出力',
    enableOrdinateChain: '基準線寸法',
    hideOrdinateChain: '基準線寸法を非表示',
    bomToggle: 'BOM + バルーン',
    bomSheetTitle: 'アセンブリ BOM シート',
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
    exportDxf: '导出DXF',
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
    ordinateTag: '基准线',
    editAnnotation: '编辑',
    relinkAnnotation: '重新指定',
    relinkApplied: '已重新指定参照',
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
    templatePicker: '图纸模板',
    templateNone: '无',
    templateEngineering: '工程',
    templateArchitectural: '建筑',
    templateMinimal: '极简',
    templateIsoA3: 'ISO A3',
    titleblockSectionLabel: '标题栏',
    titleblockTitle: '标题',
    titleblockDrawnBy: '绘制者',
    titleblockProject: '项目',
    compareVersions: '版本对比',
    hideCompareButton: '隐藏对比面板',
    enablePngExport: '高分辨率PNG导出',
    enableOrdinateChain: '基准线尺寸',
    hideOrdinateChain: '隐藏基准线尺寸',
    bomToggle: 'BOM + 球标',
    bomSheetTitle: '装配 BOM 图纸',
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
    exportDxf: 'Exportar DXF',
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
    templatePicker: 'Plantilla de hoja',
    templateNone: 'Ninguna',
    templateEngineering: 'Ingeniería',
    templateArchitectural: 'Arquitectónica',
    templateMinimal: 'Mínima',
    templateIsoA3: 'ISO A3',
    titleblockSectionLabel: 'Cuadro de título',
    titleblockTitle: 'Título',
    titleblockDrawnBy: 'Dibujado por',
    titleblockProject: 'Proyecto',
    compareVersions: 'Comparar versiones',
    hideCompareButton: 'Ocultar panel de comparación',
    ordinateTag: 'ORD',
    editAnnotation: 'Editar',
    relinkAnnotation: 'Reasignar',
    relinkApplied: 'Referencia reasignada',
    enablePngExport: 'Exportación PNG alta resolución',
    enableOrdinateChain: 'Cotas de ordenada',
    hideOrdinateChain: 'Ocultar cotas de ordenada',
    bomToggle: 'BOM + globos',
    bomSheetTitle: 'Hoja BOM de ensamblaje',
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
    exportDxf: 'تصدير DXF',
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
    ordinateTag: 'خط الأساس',
    editAnnotation: 'تعديل',
    relinkAnnotation: 'إعادة ربط',
    relinkApplied: 'تمت إعادة ربط المرجع',
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
    templatePicker: 'قالب الورقة',
    templateNone: 'بلا',
    templateEngineering: 'هندسي',
    templateArchitectural: 'معماري',
    templateMinimal: 'بسيط',
    templateIsoA3: 'ISO A3',
    titleblockSectionLabel: 'كتلة العنوان',
    titleblockTitle: 'العنوان',
    titleblockDrawnBy: 'رسم بواسطة',
    titleblockProject: 'المشروع',
    compareVersions: 'مقارنة الإصدارات',
    hideCompareButton: 'إخفاء لوحة المقارنة',
    enablePngExport: 'تصدير PNG بدقة عالية',
    enableOrdinateChain: 'أبعاد خط الأساس',
    hideOrdinateChain: 'إخفاء أبعاد خط الأساس',
    bomToggle: 'BOM + بالونات',
    bomSheetTitle: 'ورقة BOM للتجميع',
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

function isDimension(a: DrawingAnnotation): a is Dimension {
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
 * Export the live Sheet IR as an ASCII DXF (R12) stream via
 * `lib/drawing/dxfExport.sheetToDxf`.
 *
 * Scope note (inherited from the serializer, NOT a regression here):
 * `sheetToDxf` currently emits the sheet border plus one rectangle +
 * label TEXT per viewport — it does NOT yet emit the projected 3D edges
 * or dimension entities (dxfExport.ts header, "Phase 4.4.3"). The
 * download is a real, parseable DXF (the interop round-trip test parses
 * LINE entities straight back out of it), but it is a layout skeleton
 * rather than a finished production drawing.
 *
 * `image/vnd.dxf` is the de-facto MIME browsers/CAD apps associate with
 * DXF; the charset suffix keeps the ASCII group codes intact.
 */
function exportSheetDxf(sheet: Sheet, filename: string): void {
  const blob = new Blob([sheetToDxf(sheet)], {
    type: 'image/vnd.dxf;charset=utf-8',
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
/**
 * SolidWorks-parity Phase 3 — build the BOM builder's part inputs from the
 * sample assembly's PartInstances. Same 30 mm-cube world-bbox convention as
 * {@link partInstanceToAssemblyPart} (x/y span ±15 around the origin, z
 * spans [0, +30] from the one-sided extrude). Material is not carried by
 * PartInstance yet, so the BOM column stays blank.
 */
function rotateByQuaternion(
  point: { x: number; y: number; z: number },
  quaternion: PartInstance['orientation'],
): { x: number; y: number; z: number } {
  const tx = 2 * (quaternion.y * point.z - quaternion.z * point.y);
  const ty = 2 * (quaternion.z * point.x - quaternion.x * point.z);
  const tz = 2 * (quaternion.x * point.y - quaternion.y * point.x);
  return {
    x: point.x + quaternion.w * tx + (quaternion.y * tz - quaternion.z * ty),
    y: point.y + quaternion.w * ty + (quaternion.z * tx - quaternion.x * tz),
    z: point.z + quaternion.w * tz + (quaternion.x * ty - quaternion.y * tx),
  };
}

function worldPolyhedron(poly: Polyhedron, part: PartInstance): Polyhedron {
  return {
    vertices: poly.vertices.map(vertex => {
      const rotated = rotateByQuaternion(vertex, part.orientation);
      return {
        x: rotated.x + part.position.x,
        y: rotated.y + part.position.y,
        z: rotated.z + part.position.z,
      };
    }),
    faces: poly.faces.map(face => ({
      vertices: [...face.vertices],
      normal: rotateByQuaternion(face.normal, part.orientation),
    })),
  };
}

function singleFeaturePreview(tree: { nodes: ReadonlyArray<{ suppressed?: boolean; payload: { kind: string } }> } | undefined): Polyhedron | null {
  const active = tree?.nodes.filter(node => !node.suppressed) ?? [];
  // A single independently meshable feature is a valid drawing preview.
  // Multiple features need an exact regenerated body; selecting only the
  // last payload would silently omit cuts, booleans or earlier bodies.
  if (active.length !== 1) return null;
  return featureToPolyhedron(active[0]!.payload);
}

function partInstanceToBomInput(p: PartInstance, world: Polyhedron): BomPartInput {
  const xs = world.vertices.map(vertex => vertex.x);
  const ys = world.vertices.map(vertex => vertex.y);
  const zs = world.vertices.map(vertex => vertex.z);
  return {
    id: p.id,
    name: p.name,
    bbox: {
      min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
      max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
    },
  };
}

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

export function DrawingPageContent({
  lang,
  handoffId,
  handoffProjectId,
  handoffStorage = 'session',
}: {
  lang: string;
  handoffId?: string;
  handoffProjectId?: string;
  handoffStorage?: 'server' | 'session';
}): React.ReactElement {
  const dict = pickDict(lang);
  const router = useRouter();
  const langSeg = lang === 'ko' ? 'kr' : lang;
  const [assemblyHandoff, setAssemblyHandoff] = useState<AssemblyDrawingHandoff | null>(null);
  const [assemblyHandoffError, setAssemblyHandoffError] = useState<string | null>(null);
  const [assemblyHandoffLoading, setAssemblyHandoffLoading] = useState(Boolean(handoffId));
  const [handoffPersistence, setHandoffPersistence] = useState<'PASS' | 'NOT_RUN'>(
    handoffStorage === 'server' ? 'PASS' : 'NOT_RUN',
  );
  const [sourceId, setSourceId] = useState<string>(SAMPLE_PARTS[0].sourceId);
  const [paperSize, setPaperSize] = useState<PaperSize>('A3');
  const [scale, setScale] = useState<number>(1);
  // User-added section views (increment 2). Each carries its cutting plane in
  // model space; SheetRenderer cuts the solid and draws the cross-section.
  const [sectionViews, setSectionViews] = useState<Array<{ id: string; label: string; plane: CuttingPlane }>>([]);
  /**
   * W4-C — user-added detail / broken views. Positions are stored as
   * FRACTIONS of the front view's projected bbox (not absolute mm), so a
   * model change re-derives the absolute geometry automatically — same
   * associative principle as the W4-B section-plane re-anchoring.
   */
  const [detailViews, setDetailViews] = useState<Array<{
    id: string; label: string;
    centerFrac: { x: number; y: number }; radiusFrac: number; scaleFactor: number;
  }>>([]);
  const [brokenViews, setBrokenViews] = useState<Array<{
    id: string; label: string;
    axis: 'x' | 'y'; startFrac: number; endFrac: number;
  }>>([]);
  const [showHiddenLines, setShowHiddenLines] = useState(true);
  const [showTangentEdges, setShowTangentEdges] = useState(false);
  const [annotations, setAnnotations] = useState<{
    dimensions: Dimension[];
    gdtCallouts: GdtCallout[];
    ordinateChains: OrdinateDimensionChain[];
    /** W4-D — surface finish + weld callouts (renderer existed; authoring UI now feeds it). */
    surfaceFinishSymbols: SurfaceFinishSymbol[];
    weldSymbols: WeldSymbol[];
  }>({ dimensions: [], gdtCallouts: [], ordinateChains: [], surfaceFinishSymbols: [], weldSymbols: [] });
  const ordinateSeq = React.useRef<number>(0);
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

  // ─── B31.4 STEP version-compare panel state ────────────────────────────
  /**
   * Default OFF — the panel is bulky (two large textareas + result block)
   * and unrelated to the 46 pre-existing drawing-suite tests. Flipping
   * the toggle mounts {@link StepCompareVersionPanel} as a bottom-of-page
   * section so the comparison sits below the main drawing without
   * stealing canvas real estate.
   */
  const [compareOpen, setCompareOpen] = useState<boolean>(false);

  // ─── B31.6 high-res PNG export button state ─────────────────────────────
  /**
   * Default OFF so the off-screen `SheetRenderer` inside
   * {@link SheetPngExportButton} does NOT add a second viewport-group set
   * to the DOM that would break the 46 pre-existing drawing-suite tests
   * (`viewportIds(container)` expects exactly 4). Users opt in via the
   * `drawing-png-export-toggle` checkbox.
   */
  const [pngExportEnabled, setPngExportEnabled] = useState<boolean>(false);

  /**
   * Phase 4.2 ordinate-dimension scratchpad. Default OFF (toggle in the
   * footer next to the PNG-export toggle). When ON, mounts the standalone
   * OrdinateDimensionPanel below the footer — a working surface for laying
   * out a baseline/CMM-style chain without touching the live sheet IR.
   */
  const [ordinateEnabled, setOrdinateEnabled] = useState<boolean>(false);
  // Edit flow: a chain pulled back out of the sheet to seed the panel. The
  // bump key forces a panel remount so the seed re-applies.
  const [editingOrdinateChain, setEditingOrdinateChain] = useState<OrdinateDimensionChain | null>(null);
  const [ordinateSeedKey, setOrdinateSeedKey] = useState<number>(0);

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

  // ─── Phase 4.1.3 sheet template picker state ─────────────────────────
  /**
   * Currently-selected template key. Default `'none'` preserves the
   * original drawing-page behaviour (no titleblock, sheet uses the
   * user-picked `paperSize`). Selecting any other key routes the
   * memoised `sheet` through {@link applyTemplate} so the SheetRenderer
   * receives a {@link TemplatedSheet} carrying the template's
   * titleblock + border metadata.
   */
  const [templateKey, setTemplateKey] = useState<TemplateKey>('none');
  /**
   * Editable overlay applied on top of the registry template's titleblock
   * fields. Only `title` / `drawnBy` / `project` are user-editable here —
   * `checkedBy`, `date`, `scale`, and `sheetNumber` keep the registry
   * defaults until a richer titleblock editor lands.
   */
  const [titleblockOverrides, setTitleblockOverrides] = useState<{
    title: string;
    drawnBy: string;
    project: string;
  }>({ title: '', drawnBy: '', project: '' });

  // Whenever the template selection changes, seed the editable overlay
  // with the registry's titleblock fields so the inputs reflect the
  // current state. `none` clears the overlay entirely.
  React.useEffect(() => {
    if (templateKey === 'none') {
      setTitleblockOverrides({ title: '', drawnBy: '', project: '' });
      return;
    }
    const tb = TEMPLATES[templateKey]?.titleblock;
    setTitleblockOverrides({
      title: tb?.title ?? '',
      drawnBy: tb?.drawnBy ?? '',
      project: tb?.project ?? '',
    });
  }, [templateKey]);

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
  /**
   * SolidWorks-parity Phase 3 — "BOM + balloons" toggle. Default OFF so
   * the pre-existing assembly-mode tests (which assert exact sheet / svg
   * counts in the PDF export and hidden-mount wrappers) see no new DOM.
   * When ON, an assembly OVERVIEW sheet (front view + BOM table + auto
   * balloons) mounts below the canvas and is prepended to the assembly
   * PDF export.
   */
  const [bomEnabled, setBomEnabled] = useState<boolean>(false);

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
  /** Mount of the assembly BOM overview SheetRenderer (PDF export source). */
  const bomSheetRef = React.useRef<HTMLDivElement>(null);

  /**
   * Memoised sample assembly. Recomputed only when the user picks a new
   * preset — partSheets edits don't re-run getSampleAssembly so the part
   * list stays stable.
   */
  const sampleAssembly = useMemo(() => {
    return getSampleAssembly(sampleName);
  }, [sampleName]);

  const activeAssembly = assemblyHandoff?.assembly
    ?? (handoffId ? EMPTY_DRAWING_ASSEMBLY : sampleAssembly);
  const activeAssemblyName = assemblyHandoff
    ? assemblyHandoff.source.projectId ?? `revision-${assemblyHandoff.source.stateSha256.slice(0, 12)}`
    : sampleName;

  useEffect(() => {
    let cancelled = false;
    if (!handoffId) {
      setAssemblyHandoff(null);
      setAssemblyHandoffError(null);
      setAssemblyHandoffLoading(false);
      return () => { cancelled = true; };
    }
    setAssemblyHandoffLoading(true);
    if (handoffStorage === 'server' && !handoffProjectId) {
      setAssemblyHandoff(null);
      setAssemblyHandoffError('SERVER_HANDOFF_PROJECT_REQUIRED');
      setAssemblyHandoffLoading(false);
      setHandoffPersistence('NOT_RUN');
      return () => { cancelled = true; };
    }
    const pending = handoffStorage === 'server'
      ? import('../assembly/serverDrawingHandoff').then(({ readServerDrawingHandoff }) =>
          readServerDrawingHandoff(handoffProjectId!, handoffId))
      : import('../assembly/drawingHandoff').then(({ readAssemblyDrawingHandoff }) =>
          readAssemblyDrawingHandoff(handoffId));
    void pending.then(result => {
      if (cancelled) return;
      if (!result.ok) {
        setAssemblyHandoff(null);
        setAssemblyHandoffError(result.reason);
        setAssemblyHandoffLoading(false);
        setHandoffPersistence('NOT_RUN');
        return;
      }
      setAssemblyHandoff(result.handoff);
      setAssemblyHandoffError(null);
      setAssemblyMode(true);
      setBomEnabled(true);
      setHandoffPersistence(handoffStorage === 'server' ? 'PASS' : 'NOT_RUN');
      setAssemblyHandoffLoading(false);
    });
    return () => { cancelled = true; };
  }, [handoffId, handoffProjectId, handoffStorage]);

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
    setBomEnabled(Boolean(assemblyHandoff));
  }, [sampleName, assemblyHandoff]);

  const assemblyGeometry = useMemo(() => {
    const drawingGeometryByPart = new Map<string, ReadonlyMap<string, Polyhedron>>();
    const worldItems: Array<{ poly: Polyhedron; offset: { x: number; y: number; z: number } }> = [];
    const bomParts: BomPartInput[] = [];
    const unresolvedPartIds: string[] = [];
    for (const part of activeAssembly.state.parts) {
      const local = singleFeaturePreview(activeAssembly.featureTrees[part.id]);
      if (!local) {
        unresolvedPartIds.push(part.id);
        continue;
      }
      const world = worldPolyhedron(local, part);
      drawingGeometryByPart.set(part.id, new Map([[part.id, local]]));
      worldItems.push({ poly: world, offset: { x: 0, y: 0, z: 0 } });
      bomParts.push(partInstanceToBomInput(part, world));
    }
    return {
      drawingGeometryByPart,
      bomParts,
      unresolvedPartIds,
      merged: mergePolyhedra(worldItems),
    };
  }, [activeAssembly]);

  /**
   * SolidWorks-parity Phase 3 — the assembly overview sheet (front view +
   * BOM table + balloons). Built only while the toggle is ON; the builder
   * is pure so the memo recomputes only on sample switches.
   */
  const bomSheet = useMemo<Sheet | null>(() => {
    if (!bomEnabled) return null;
    const parts = activeAssembly.state.parts;
    if (parts.length === 0) return null;
    if (assemblyGeometry.unresolvedPartIds.length > 0) return null;
    try {
      return buildAssemblyBomSheet({
        id: `assembly-bom-${activeAssemblyName}`,
        name: `BOM — ${activeAssemblyName}`,
        sourceId: `assembly-${activeAssemblyName}`,
        paperSize: 'A3',
        parts: assemblyGeometry.bomParts,
      });
    } catch {
      return null;
    }
  }, [activeAssembly.state.parts, activeAssemblyName, assemblyGeometry, bomEnabled]);

  /**
   * Merged assembly polyhedron for the overview viewport, keyed by the
   * sheet's sourceId so SheetRenderer draws the real projected edges the
   * balloon anchors were computed against. Each part's FeatureTree is a
   * single extrude (sample cubes) — featureToPolyhedron meshes it; parts
   * whose tree can't mesh are skipped (balloons still render).
   */
  const bomSheetGeometry = useMemo<ReadonlyMap<string, Polyhedron> | undefined>(() => {
    if (!bomEnabled) return undefined;
    return assemblyGeometry.merged
      ? new Map([[`assembly-${activeAssemblyName}`, assemblyGeometry.merged]])
      : undefined;
  }, [activeAssemblyName, assemblyGeometry.merged, bomEnabled]);

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
    const parts = activeAssembly.state.parts;
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
  }, [activeAssembly.state.parts]);

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
      if (assemblyHandoff) {
        const exact = assemblyHandoff.exactSinglePart;
        if (!exact || assemblyHandoff.artifacts.exactBrepStep.status !== 'PASS') {
          throw new Error('BLOCKED: exact B-rep STEP artifact is NOT_RUN for this revision handoff.');
        }
        downloadBlob(
          new Blob([exact.step.text], { type: 'application/step' }),
          `${exact.part.id}-${assemblyHandoff.source.revisionId.replaceAll(':', '-')}.step`,
        );
        return;
      }
      const parts: AssemblyPart[] = activeAssembly.state.parts.map(
        partInstanceToAssemblyPart,
      );
      const result = writeAssemblyWithPmi({
        geometry: {
          kind: 'assembly',
          assemblyName: activeAssemblyName,
          parts,
        },
        partSheets,
        header: {
          description: `NexyFab assembly export — ${activeAssemblyName}`,
          filename: `${activeAssemblyName}.step`,
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
      downloadBlob(blob, `${activeAssemblyName}.step`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setAssemblyExportError(`${dict.assemblyExportError}: ${detail}`);
    }
  }, [activeAssembly.state.parts, activeAssemblyName, assemblyHandoff, partSheets, dict.assemblyExportError]);

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
    if (entries.length === 0 && !(bomEnabled && bomSheet)) {
      setAssemblyPdfInfo(dict.assemblyPdfNoSheets);
      return;
    }

    const sheetsToExport: Sheet[] = [];
    const svgRefs: SVGElement[] = [];
    // SolidWorks-parity Phase 3 — the BOM overview sheet leads the bundle
    // (cover-page convention) when the toggle is on. Its renderer is the
    // visible BOM canvas mount, queried the same way as the hidden mounts.
    if (bomEnabled && bomSheet) {
      const bomSvg = bomSheetRef.current?.querySelector(
        'svg[data-testid="sheet-renderer-root"]',
      ) as SVGElement | null;
      if (bomSvg) {
        sheetsToExport.push(bomSheet);
        svgRefs.push(bomSvg);
      }
    }
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
        downloadBlob(blob, `${activeAssemblyName}.pdf`);
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
        downloadBlob(blob, `${activeAssemblyName}.pdf`);
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
    activeAssemblyName,
    pdfFormat,
    bomEnabled,
    bomSheet,
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

  /**
   * W4-C — the front view's projected bbox (view-plane mm) for the active
   * part. Detail circles and break bands are stored as fractions of this
   * box, so it is the single anchor that keeps them associative.
   */
  const frontViewBbox = useMemo(() => {
    const geo = sampleGeometryForSourceId(sourceId);
    const poly = 'feature' in geo ? featureToPolyhedron(geo.feature) : null;
    if (!poly || poly.vertices.length === 0) return null;
    return projectPolyhedron(poly, 'front').bbox;
  }, [sourceId]);

  const drawingReferencePartition = useMemo(() => {
    const geometry = sampleGeometryForSourceId(sourceId);
    let validRefs: Set<string> | null = null;
    if ('feature' in geometry) {
      try {
        validRefs = new Set(buildExtrudeTopo(geometry.feature).byName.keys());
      } catch {
        validRefs = null;
      }
    }
    return partitionDrawingReferences({
      validRefs,
      dimensions: annotations.dimensions,
      gdt: annotations.gdtCallouts,
    });
  }, [annotations.dimensions, annotations.gdtCallouts, sourceId]);

  const sheet: Sheet = useMemo(() => {
    const built: Sheet = (() => {
    const base = standardThreeViewSheet({
      id: 'drawing-page-sheet',
      name: `Drawing — ${sourceId}`,
      sourceId,
      paperSize,
      scale,
    });
    const withAnnotations: Sheet = {
      ...base,
      dimensions: drawingReferencePartition.dimensions,
      gdtCallouts: drawingReferencePartition.gdt,
      ordinateChains: annotations.ordinateChains,
      surfaceFinishSymbols: annotations.surfaceFinishSymbols,
      weldSymbols: annotations.weldSymbols,
    };
    if (templateKey === 'none') return withAnnotations;
    const registryTemplate = TEMPLATES[templateKey];
    if (!registryTemplate) return withAnnotations;
    /**
     * Splice the editable title / drawnBy / project overrides on top of
     * the registry titleblock so the resulting sheet.template carries the
     * user's edits. `applyTemplate` deep-clones internally, so passing a
     * freshly-built template here doesn't mutate the registry.
     */
    const mergedTitleblock: SheetTemplateTitleblock | undefined = registryTemplate.titleblock
      ? {
          ...registryTemplate.titleblock,
          title: titleblockOverrides.title,
          drawnBy: titleblockOverrides.drawnBy,
          project: titleblockOverrides.project,
        }
      : undefined;
    const merged: SheetTemplate = {
      ...registryTemplate,
      titleblock: mergedTitleblock,
    };
    return applyTemplate(withAnnotations, merged);
    })();
    // Append user-added section / detail / broken viewports along the bottom.
    const extraVps: Viewport[] = sectionViews.map((sv, i) => ({
      id: sv.id,
      sourceId,
      projection: { kind: 'section' as const, cuttingPlaneId: sv.id },
      centerOnSheet: { x: 45 + i * 60, y: 35 },
      widthOnSheet: 50,
      scale,
      label: sv.label,
    }));
    // W4-C — derive absolute detail circles / break bands from the stored
    // fractions against the CURRENT front-view bbox (associative by
    // construction; no bbox → the views cannot exist honestly, so skip).
    if (frontViewBbox) {
      const bw = frontViewBbox.maxX - frontViewBbox.minX;
      const bh = frontViewBbox.maxY - frontViewBbox.minY;
      for (const dv of detailViews) {
        extraVps.push({
          id: dv.id,
          sourceId,
          projection: {
            kind: 'detail' as const,
            sourceViewportId: 'front',
            center: {
              x: frontViewBbox.minX + dv.centerFrac.x * bw,
              y: frontViewBbox.minY + dv.centerFrac.y * bh,
            },
            radius: dv.radiusFrac * Math.max(bw, bh),
            scaleFactor: dv.scaleFactor,
          },
          centerOnSheet: { x: 45 + extraVps.length * 60, y: 35 },
          widthOnSheet: 50,
          scale,
          label: dv.label,
        });
      }
      for (const bv of brokenViews) {
        const span = bv.axis === 'x' ? bw : bh;
        const lo = bv.axis === 'x' ? frontViewBbox.minX : frontViewBbox.minY;
        extraVps.push({
          id: bv.id,
          sourceId,
          projection: {
            kind: 'broken' as const,
            view: 'front' as const,
            axis: bv.axis,
            breakStart: lo + bv.startFrac * span,
            breakEnd: lo + bv.endFrac * span,
            // gap omitted → renderer default (clamped below the band).
          },
          centerOnSheet: { x: 45 + extraVps.length * 60, y: 35 },
          widthOnSheet: 50,
          scale,
          label: bv.label,
        });
      }
    }
    if (extraVps.length === 0) return built;
    return { ...built, viewports: [...built.viewports, ...extraVps] };
  }, [sourceId, paperSize, scale, annotations, drawingReferencePartition, templateKey, titleblockOverrides, sectionViews, detailViews, brokenViews, frontViewBbox]);

  // Cutting planes for the section viewports, keyed by viewport id.
  const cuttingPlanes = useMemo(
    () => (sectionViews.length === 0 ? undefined : new Map(sectionViews.map((sv) => [sv.id, sv.plane]))),
    [sectionViews],
  );

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

  const handleAdd = useCallback((annotation: DrawingAnnotation) => {
    setAnnotations((prev) => {
      if (isDimension(annotation)) {
        return { ...prev, dimensions: [...prev.dimensions, annotation] };
      }
      // W4-D — weld carries `weldType`; GD&T carries `toleranceValue`;
      // what remains is a surface-finish symbol.
      if ('weldType' in annotation) {
        return { ...prev, weldSymbols: [...prev.weldSymbols, annotation] };
      }
      if ('toleranceValue' in annotation) {
        return { ...prev, gdtCallouts: [...prev.gdtCallouts, annotation] };
      }
      return { ...prev, surfaceFinishSymbols: [...prev.surfaceFinishSymbols, annotation] };
    });
    setModalOpen(false);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setAnnotations((prev) => ({
      dimensions: prev.dimensions.filter((d) => d.id !== id),
      gdtCallouts: prev.gdtCallouts.filter((g) => g.id !== id),
      ordinateChains: prev.ordinateChains.filter((c) => c.id !== id),
      surfaceFinishSymbols: prev.surfaceFinishSymbols.filter((s) => s.id !== id),
      weldSymbols: prev.weldSymbols.filter((w) => w.id !== id),
    }));
    setSelectedAnnotationId((cur) => (cur === id ? null : cur));
  }, []);

  /**
   * Commit an ordinate chain built in the panel into the Sheet IR. We assign
   * a fresh unique id (the panel always emits 'panel-chain') so multiple
   * commits coexist; SheetRenderer then draws each chain's leader lines, and
   * the JSON export carries them automatically (they're part of Sheet).
   */
  const handleAddOrdinateChain = useCallback((chain: OrdinateDimensionChain) => {
    setAnnotations((prev) => ({
      ...prev,
      ordinateChains: [
        ...prev.ordinateChains,
        { ...chain, id: `ordinate-${++ordinateSeq.current}` },
      ],
    }));
    // Clear any edit seed so a later toggle-off/on starts blank.
    setEditingOrdinateChain(null);
  }, []);

  /**
   * Edit a committed ordinate chain: pull it out of the sheet and seed the
   * panel with it (origin / axis / precision / unit / points). Bumping the
   * seed key forces the panel to remount and re-read the seed; opening the
   * toggle makes sure the panel is visible. Re-committing assigns a fresh id.
   */
  const handleEditOrdinateChain = useCallback((id: string) => {
    setAnnotations((prev) => {
      const target = prev.ordinateChains.find((c) => c.id === id);
      if (target) setEditingOrdinateChain(target);
      return { ...prev, ordinateChains: prev.ordinateChains.filter((c) => c.id !== id) };
    });
    setOrdinateSeedKey((k) => k + 1);
    setOrdinateEnabled(true);
    setSelectedAnnotationId((cur) => (cur === id ? null : cur));
  }, []);

  /**
   * Polyhedron for the active part, keyed by its sourceId, so SheetRenderer can
   * draw real projected HLR edges in the standard views. All sample parts are
   * extrude features (cube / N-gon prisms), so featureToPolyhedron meshes them.
   */
  const sheetGeometry = useMemo<ReadonlyMap<string, Polyhedron> | undefined>(() => {
    const geo = sampleGeometryForSourceId(sourceId);
    // Single-part geometries carry a `feature`; assembly inputs don't.
    const poly = 'feature' in geo ? featureToPolyhedron(geo.feature) : null;
    return poly ? new Map([[sourceId, poly]]) : undefined;
  }, [sourceId]);

  /**
   * W4-A — named topology for the active part (same keying as sheetGeometry)
   * so SheetRenderer can measure Dimension refs (`f.side.0`, `e.vert.1`, …)
   * for real. All sample parts are extrude prisms, so buildExtrudeTopo covers
   * them; a build failure yields undefined and the renderer keeps its
   * explicit placeholders (측정 불가 시 값 날조 금지).
   */
  const sheetTopologies = useMemo<ReadonlyMap<string, NamedTopology> | undefined>(() => {
    const geo = sampleGeometryForSourceId(sourceId);
    if (!('feature' in geo)) return undefined;
    try {
      return new Map([[sourceId, buildExtrudeTopo(geo.feature)]]);
    } catch {
      return undefined;
    }
  }, [sourceId]);

  /**
   * W4-B — real measured status for every sheet dimension (same resolution
   * rule the SheetRenderer canvas labels use, via associativeUpdate). Feeds
   * the annotation list so a model change immediately shows re-measured
   * values or explicit losses.
   */
  const dimensionAudit = useMemo(
    () => auditSheetDimensions(sheet, sheetTopologies),
    [sheet, sheetTopologies],
  );

  // ── R5 — named-channel relink wiring (도면 페이지) ───────────────────────
  /** Anchor source over the ACTIVE part's full named topology. */
  const currentAnchors = useMemo<EdgeAnchorSource | null>(() => {
    const topo = sheetTopologies?.get(sourceId);
    return topo ? topoAnchorSource(topo) : null;
  }, [sheetTopologies, sourceId]);

  /**
   * PREVIOUS part's anchors, kept one part-switch behind `currentAnchors`
   * (prevSectionPolyRef 패턴): a dimension ref lost in a part switch is
   * ranked against where it USED to sit. Downstream honesty is refRelink's:
   * named-channel candidates are midpoint-distance-ranked only and never
   * marked confident. No prior part yet → no ranking (unranked list).
   */
  const priorAnchorsRef = React.useRef<EdgeAnchorSource | null>(null);
  const lastAnchorsRef = React.useRef<{ sourceId: string; anchors: EdgeAnchorSource } | null>(null);
  useEffect(() => {
    const last = lastAnchorsRef.current;
    if (last && last.sourceId !== sourceId) priorAnchorsRef.current = last.anchors;
    if (currentAnchors) lastAnchorsRef.current = { sourceId, anchors: currentAnchors };
  }, [sourceId, currentAnchors]);

  /** Dimension currently being relinked (⚠ row's 재지정 button), or null. */
  const [relinkDimId, setRelinkDimId] = useState<string | null>(null);
  /** Audit trail of applied relinks (RefRelinkPanel history pane). */
  const [relinkHistory, setRelinkHistory] = useState<RelinkRecord[]>([]);
  const [relinkToast, setRelinkToast] = useState<string | null>(null);
  const [gdtRelinkDraft, setGdtRelinkDraft] = useState<Record<string, string>>({});

  const validGdtTargets = useMemo(
    () => currentAnchors?.names().filter(name => name.startsWith('f.')) ?? [],
    [currentAnchors],
  );

  const handleGdtRelinkApply = useCallback((id: string) => {
    const targetRef = gdtRelinkDraft[id];
    if (!targetRef || !currentAnchors || currentAnchors.anchor(targetRef) === null) return;
    setAnnotations(prev => ({
      ...prev,
      gdtCallouts: prev.gdtCallouts.map(callout =>
        callout.id === id ? { ...callout, targetRef } : callout,
      ),
    }));
    setGdtRelinkDraft(prev => {
      const { [id]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
    setRelinkToast(`${dict.relinkApplied}: ${id} → ${targetRef}`);
  }, [currentAnchors, dict.relinkApplied, gdtRelinkDraft]);

  /**
   * Dimensions whose audit failure is `unresolved-ref` AND whose refs really
   * fail to resolve on the anchor source — the only rows where a relink is
   * applicable. Other explicit failures (not-parallel 등) keep their ⚠ with
   * no relink button: their refs resolve, so there is nothing to relink.
   */
  const relinkableDimIds = useMemo<ReadonlySet<string>>(() => {
    const out = new Set<string>();
    if (!currentAnchors) return out;
    for (const d of annotations.dimensions) {
      const res = dimensionAudit.get(d.id);
      if (
        res && !res.ok && res.reason === 'unresolved-ref' &&
        d.refs.some((r) => currentAnchors.anchor(r) === null)
      ) {
        out.add(d.id);
      }
    }
    return out;
  }, [annotations.dimensions, dimensionAudit, currentAnchors]);

  /** Lost refs + ranked candidates for the dimension being relinked. */
  const relinkItems = useMemo<RefRelinkItem[]>(() => {
    if (!relinkDimId || !currentAnchors) return [];
    const dim = annotations.dimensions.find((d) => d.id === relinkDimId);
    if (!dim) return [];
    const lost = collectLostRefs({
      dimensions: [{ id: dim.id, label: `${dict.dimensionTag} · ${dim.kind}`, refs: dim.refs }],
      anchors: currentAnchors,
      ...(priorAnchorsRef.current ? { priorAnchors: priorAnchorsRef.current } : {}),
    });
    return lost.map((lostRef) => ({
      lostRef,
      suggestion: suggestRelinkCandidates(lostRef, {
        anchors: lostRef.name ? sameKindAnchors(currentAnchors, lostRef.name) : currentAnchors,
      }),
    }));
  }, [relinkDimId, currentAnchors, annotations.dimensions, dict.dimensionTag]);

  /**
   * Apply one user-confirmed candidate: substitute the lost name in the
   * dimension's refs (applyRelink — immutable + audit record), splice the
   * updated refs into the sheet state, and toast the record. The dimension
   * then re-measures on render (or refuses explicitly) — no value is written
   * here. `confident: false` is exact, not an approximation: named-channel
   * candidates are never gate-confident by refRelink's honesty rules.
   */
  const handleRelinkApply = useCallback((lostRef: LostRef, target: RelinkTarget) => {
    if (target.kind !== 'name') return; // this page wires the named channel only
    const dim = annotations.dimensions.find((d) => d.id === lostRef.consumer.id);
    if (!dim) return;
    try {
      const applied = applyRelink(
        { type: 'dimension', id: dim.id, refs: dim.refs },
        lostRef,
        target,
        { confident: false },
      );
      if (!('refs' in applied.consumer)) return; // dimension consumers always carry refs
      const nextRefs = [...applied.consumer.refs];
      setAnnotations((prev) => ({
        ...prev,
        dimensions: prev.dimensions.map((d) => (d.id === dim.id ? { ...d, refs: nextRefs } : d)),
      }));
      setRelinkHistory((h) => [...h, applied.record]);
      setRelinkToast(`${dict.relinkApplied}: ${formatRelinkRecord(applied.record)}`);
    } catch (err) {
      // applyRelink refuses (never partially applies) — surface the reason verbatim.
      setRelinkToast(err instanceof Error ? err.message : String(err));
    }
  }, [annotations.dimensions, dict.relinkApplied]);

  const allAnnotations: ReadonlyArray<{
    id: string;
    tag: string;
    label: string;
    kind: 'dimension' | 'gdt' | 'ordinate' | 'surface' | 'weld';
  }> = useMemo(() => {
    const out: Array<{ id: string; tag: string; label: string; kind: 'dimension' | 'gdt' | 'ordinate' | 'surface' | 'weld' }> = [];
    for (const d of annotations.dimensions) {
      const res = dimensionAudit.get(d.id) ?? null;
      // "= value" when actually measured, "⚠ reason" on explicit failure,
      // nothing when there is no measurement context (값 날조 금지).
      const status = res ? (res.ok ? ` · = ${formatMeasuredValue(res.value, res.unit)}` : ` · ⚠ ${res.reason}`) : '';
      out.push({ id: d.id, tag: dict.dimensionTag, label: `${d.kind} · ${d.viewportId}${status}`, kind: 'dimension' });
    }
    for (const g of annotations.gdtCallouts) {
      out.push({ id: g.id, tag: dict.gdtTag, label: `${g.kind} · ${g.viewportId}`, kind: 'gdt' });
    }
    for (const c of annotations.ordinateChains) {
      out.push({
        id: c.id,
        tag: dict.ordinateTag,
        label: `${c.axis} · ${c.points.length} pt`,
        kind: 'ordinate',
      });
    }
    // W4-D — surface finish + weld entries; labels reuse the same lib
    // formatters the renderer prints, so list and canvas always agree.
    for (const s of annotations.surfaceFinishSymbols) {
      out.push({
        id: s.id,
        tag: '⌵',
        label: `${formatSurfaceFinish(s)} · ${s.viewportId}`,
        kind: 'surface',
      });
    }
    for (const w of annotations.weldSymbols) {
      out.push({
        id: w.id,
        tag: '⊳',
        label: `${formatWeldSymbol(w)} · ${w.viewportId}`,
        kind: 'weld',
      });
    }
    return out;
  }, [annotations, dimensionAudit, dict.dimensionTag, dict.gdtTag, dict.ordinateTag]);

  /**
   * W4-B associative pipe — when the model changes, section views are
   * RE-ANCHORED onto the new body (same normal, same relative station along
   * it) instead of deleted. Dimensions need no handling here: their
   * topo-name refs re-measure automatically (or fail explicitly) on render.
   */
  const prevSectionPolyRef = React.useRef<Polyhedron | null>(null);
  useEffect(() => {
    const nextPoly = sheetGeometry?.get(sourceId) ?? null;
    const oldPoly = prevSectionPolyRef.current;
    prevSectionPolyRef.current = nextPoly;
    setSectionViews((prev) => {
      if (prev.length === 0) return prev;
      // No meshable body → nothing to cut; dropping the views is the only
      // honest outcome (a cutting plane through nothing is a fabrication).
      if (!nextPoly || nextPoly.vertices.length === 0) return [];
      return prev.map((sv) => ({
        ...sv,
        plane: reanchorCuttingPlane(sv.plane, oldPoly, nextPoly),
      }));
    });
  }, [sourceId, sheetGeometry]);

  // Add a section view: a vertical cut (⊥X) through the part's bounding-box
  // centre → a YZ cross-section. SheetRenderer cuts the solid and draws it.
  const addSectionView = useCallback(() => {
    const poly = sheetGeometry?.get(sourceId);
    if (!poly || poly.vertices.length === 0) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of poly.vertices) {
      if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y; if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y; if (v.z > maxZ) maxZ = v.z;
    }
    const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    setSectionViews((prev) => {
      const letter = String.fromCharCode(65 + (prev.length % 26)); // A, B, C, …
      return [
        ...prev,
        { id: `section-${letter}-${prev.length}`, label: `SECTION ${letter}-${letter}`, plane: { origin: center, normal: [1, 0, 0] } },
      ];
    });
  }, [sheetGeometry, sourceId]);

  const clearSectionViews = useCallback(() => setSectionViews([]), []);

  // W4-C — add a detail view: centre of the front view, radius 25% of the
  // larger bbox side, 2× nominal magnification. Fractions, so it follows
  // model changes automatically.
  const addDetailView = useCallback(() => {
    setDetailViews((prev) => {
      const n = prev.length + 1;
      return [
        ...prev,
        {
          id: `detail-${n}`,
          label: `DETAIL ${String.fromCharCode(64 + ((n - 1) % 26) + 1)}`,
          centerFrac: { x: 0.5, y: 0.5 },
          radiusFrac: 0.25,
          scaleFactor: 2,
        },
      ];
    });
  }, []);
  const clearDetailViews = useCallback(() => setDetailViews([]), []);

  // W4-C — add a broken view: remove the middle 30% band along view-X.
  const addBrokenView = useCallback(() => {
    setBrokenViews((prev) => {
      const n = prev.length + 1;
      return [
        ...prev,
        { id: `broken-${n}`, label: `BROKEN ${n}`, axis: 'x' as const, startFrac: 0.35, endFrac: 0.65 },
      ];
    });
  }, []);
  const clearBrokenViews = useCallback(() => setBrokenViews([]), []);

  const onExportPng = useCallback(() => {
    if (!sheetRef.current) return;
    void exportSheetPng(sheetRef.current, `${sheet.id}.png`);
  }, [sheet.id]);

  const onExportJson = useCallback(() => {
    exportSheetJson(sheet, `${sheet.id}.json`);
  }, [sheet]);

  // R4 wiring — sheetToDxf had no UI caller until now.
  const onExportDxf = useCallback(() => {
    exportSheetDxf(sheet, `${sheet.id}.dxf`);
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

  const handoffDrawingCandidateReady = assemblyHandoff?.artifacts.drawing.status === 'PASS'
    && assemblyHandoff.exactSinglePart !== undefined;
  const handoffBomCandidateReady = assemblyHandoff?.artifacts.bom.status === 'PASS'
    && assemblyHandoff.exactSinglePart !== undefined;
  const manufacturingReadiness = assemblyHandoff
    ? assessManufacturingHandoffReadiness({
        revisionId: assemblyHandoff.source.revisionId,
        solver: assemblyHandoff.verification.solver.status,
        featureTrees: assemblyHandoff.artifacts.editableFeatureTrees.status,
        exactStep: assemblyHandoff.artifacts.exactBrepStep.status,
        // A locally generated candidate is not a verified artifact. The
        // source receipt remains NOT_RUN until a governed verification
        // process binds output bytes to this exact revision.
        drawing: assemblyHandoff.artifacts.drawing.status,
        bom: assemblyHandoff.artifacts.bom.status,
        gdtPmi: assemblyHandoff.artifacts.gdtPmi.status,
        releaseDecision: 'BLOCKED',
      })
    : null;

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
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <button
              type="button"
              onClick={() => router.push(`/${langSeg}/shape-generator?expert=1`)}
              title={dict.closeEditor}
              style={{
                marginTop: 2, padding: '6px 12px', borderRadius: 8,
                border: '1px solid #d1d5db', background: '#fff',
                color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              ← {dict.closeEditor}
            </button>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{dict.title}</h1>
              <p style={{ fontSize: 13, color: '#4b5563', margin: '4px 0 0' }}>{dict.subtitle}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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
                data-testid="drawing-compare-toggle"
                checked={compareOpen}
                onChange={(e) => setCompareOpen(e.target.checked)}
              />
              {compareOpen ? dict.hideCompareButton : dict.compareVersions}
            </label>
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
          </div>
        </header>

        {assemblyHandoffLoading ? (
          <div data-testid="drawing-handoff-loading" role="status" style={{ padding: 10, border: '1px solid #93c5fd', borderRadius: 6, background: '#eff6ff', color: '#1e3a8a', fontSize: 12 }}>
            Loading revision-bound assembly handoff…
          </div>
        ) : null}
        {assemblyHandoffError ? (
          <div data-testid="drawing-handoff-error" role="alert" style={{ padding: 10, border: '1px solid #ef4444', borderRadius: 6, background: '#fef2f2', color: '#991b1b', fontSize: 12 }}>
            Assembly handoff BLOCKED: {assemblyHandoffError}. No sample data was substituted for the requested revision.
          </div>
        ) : null}
        {assemblyHandoff ? (
          <section data-testid="drawing-handoff-status" aria-label="Assembly drawing handoff status" style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <strong>Revision-bound assembly handoff</strong>
              <code>{assemblyHandoff.source.revisionId}</code>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span data-testid="drawing-handoff-persistence-status">
                Server persistence {handoffPersistence}{handoffPersistence === 'NOT_RUN' ? ' · session-only' : ' · immutable'}
              </span>
              <span data-testid="drawing-handoff-solver-status">Solver {assemblyHandoff.verification.solver.status}</span>
              <span>FeatureTree {assemblyHandoff.artifacts.editableFeatureTrees.status}</span>
              <span>Exact STEP {assemblyHandoff.artifacts.exactBrepStep.status}</span>
              <span data-testid="drawing-handoff-exact-drawing-status">Drawing {handoffDrawingCandidateReady ? 'PASS · exact 3-view HLR' : 'NOT_RUN'}</span>
              <span data-testid="drawing-handoff-exact-bom-status">BOM {handoffBomCandidateReady ? 'PASS · revision-bound' : 'NOT_RUN'}</span>
              <span>GD&amp;T / PMI {assemblyHandoff.artifacts.gdtPmi.status}</span>
            </div>
            {assemblyGeometry.unresolvedPartIds.length > 0 && !handoffDrawingCandidateReady ? (
              <div data-testid="drawing-handoff-geometry-blockers" role="alert" style={{ color: '#991b1b' }}>
                Drawing geometry BLOCKED for multi-feature or unsupported parts: {assemblyGeometry.unresolvedPartIds.join(', ')}. Exact regenerated artifacts are required; proxy boxes are not used.
              </div>
            ) : null}
            <div data-testid="drawing-manufacturing-readiness" role="status" style={{ color: '#92400e' }}>
              Manufacturing package {manufacturingReadiness?.status}: {manufacturingReadiness?.blockers.join(', ')}
            </div>
            <div
              data-testid="drawing-manufacturing-package-blocked"
              aria-disabled="true"
              style={{ justifySelf: 'start', padding: '7px 10px', border: '1px solid #d97706', borderRadius: 4, color: '#92400e', background: '#fffbeb' }}
            >
              Manufacturing export is unavailable for this revision; no package was produced.
            </div>
            {assemblyHandoff.exactSinglePart ? (
              <section data-testid="drawing-handoff-exact-artifacts" aria-label="Exact single-part artifacts" style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #86efac', borderRadius: 6, background: '#f0fdf4' }}>
                <strong>Exact single-part drawing candidate</strong>
                <img
                  data-testid="drawing-handoff-exact-hlr-svg"
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(assemblyHandoff.exactSinglePart.drawing.svg)}`}
                  alt="Revision-bound front, top and right hidden-line views"
                  style={{ width: '100%', maxHeight: 350, objectFit: 'contain', background: '#fff' }}
                />
                <div data-testid="drawing-handoff-overall-dimensions">
                  Overall bbox (mm): X {assemblyHandoff.exactSinglePart.dimensions.overall.x.toFixed(3)} × Y {assemblyHandoff.exactSinglePart.dimensions.overall.y.toFixed(3)} × Z {assemblyHandoff.exactSinglePart.dimensions.overall.z.toFixed(3)} · scope OVERALL_BBOX_ONLY
                </div>
                <div data-testid="drawing-handoff-one-part-bom">
                  BOM: {assemblyHandoff.exactSinglePart.part.id} · qty 1 · receipt {assemblyHandoff.exactSinglePart.bom.sha256.slice(0, 12)}
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

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
                  disabled={Boolean(handoffId) || assemblyHandoffLoading}
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
                  {activeAssembly.state.parts.map((p) => {
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
                                color: hasSheet ? '#166534' : '#4b5563',
                                fontWeight: 700,
                              }}
                            >
                              {hasSheet ? '✓' : '○'}
                            </span>
                            <strong>{p.name}</strong>
                            {!hasSheet ? (
                              <span style={{ color: '#4b5563' }}> · {dict.noSheetAdded}</span>
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
                  disabled={activeAssembly.state.parts.length === 0}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    background: '#1d4ed8',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 3,
                    cursor:
                      activeAssembly.state.parts.length === 0 ? 'not-allowed' : 'pointer',
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

              {/*
                SolidWorks-parity Phase 3 — BOM + balloons toggle. Adds /
                removes the assembly overview sheet (BOM block + balloons
                on the Sheet IR) below the canvas; the PDF export picks it
                up automatically through the IR.
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
                  data-testid="drawing-assembly-bom-toggle"
                  checked={bomEnabled}
                  onChange={(e) => setBomEnabled(e.target.checked)}
                />
                {dict.bomToggle}
              </label>

              <button
                type="button"
                data-testid="drawing-export-assembly-step"
                onClick={onExportAssemblyStep}
                disabled={(assemblyHandoff !== null && assemblyHandoff.artifacts.exactBrepStep.status !== 'PASS') || activeAssembly.state.parts.length === 0}
                style={{
                  padding: '8px 14px',
                  background:
                    (assemblyHandoff !== null && assemblyHandoff.artifacts.exactBrepStep.status !== 'PASS') || activeAssembly.state.parts.length === 0 ? '#9ca3af' : '#0f172a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor:
                    (assemblyHandoff !== null && assemblyHandoff.artifacts.exactBrepStep.status !== 'PASS') || activeAssembly.state.parts.length === 0 ? 'not-allowed' : 'pointer',
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 28, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="drawing-assembly-pdf-format"
                    data-testid="drawing-assembly-pdf-format-raster"
                    value="raster"
                    checked={pdfFormat === 'raster'}
                    onChange={() => setPdfFormat('raster')}
                    style={{ width: 24, height: 24, margin: 0, cursor: 'pointer' }}
                  />
                  {dict.formatRaster}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 28, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="drawing-assembly-pdf-format"
                    data-testid="drawing-assembly-pdf-format-vector"
                    value="vector"
                    checked={pdfFormat === 'vector'}
                    onChange={() => setPdfFormat('vector')}
                    style={{ width: 24, height: 24, margin: 0, cursor: 'pointer' }}
                  />
                  {dict.formatVector}
                </label>
              </fieldset>
              <button
                type="button"
                data-testid="drawing-assembly-export-pdf"
                onClick={() => { void onExportAssemblyPdf(); }}
                // The BOM overview sheet alone is exportable (cover page),
                // so the toggle also enables the button.
                disabled={Object.keys(partSheets).length === 0 && !(bomEnabled && bomSheet)}
                style={{
                  padding: '8px 14px',
                  background:
                    Object.keys(partSheets).length === 0 && !(bomEnabled && bomSheet)
                      ? '#9ca3af'
                      : '#1d4ed8',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor:
                    Object.keys(partSheets).length === 0 && !(bomEnabled && bomSheet)
                      ? 'not-allowed'
                      : 'pointer',
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
                <SheetRenderer
                  sheet={partSheets[selectedPartId]}
                  geometry={assemblyGeometry.drawingGeometryByPart.get(selectedPartId)}
                />
              ) : (
                <p
                  data-testid="drawing-assembly-no-selection"
                  style={{ fontSize: 12, color: '#4b5563', margin: 0 }}
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
                  <SheetRenderer
                    sheet={ps}
                    geometry={assemblyGeometry.drawingGeometryByPart.get(pid)}
                  />
                </div>
              ))}
            </div>

            {/*
              SolidWorks-parity Phase 3 — assembly overview sheet with the
              BOM table + balloons. Visible full-width section (the PDF
              exporter queries this mount for the cover-page SVG).
            */}
            {bomEnabled && bomSheet ? (
              <div
                data-testid="drawing-assembly-bom-canvas"
                style={{
                  gridColumn: '1 / -1',
                  background: '#e5e7eb',
                  padding: 12,
                  borderRadius: 6,
                  overflow: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#374151' }}>
                  {dict.bomSheetTitle}
                </h2>
                <div ref={bomSheetRef}>
                  <SheetRenderer sheet={bomSheet} geometry={bomSheetGeometry} />
                </div>
              </div>
            ) : null}

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
              Phase 4.1.3 sheet-template picker. Default 'none' preserves
              the legacy behaviour byte-for-byte (no template metadata
              attached, paperSize follows the user-picked dropdown).
              Selecting any other key routes the memoised `sheet` through
              applyTemplate so the SheetRenderer receives a TemplatedSheet
              carrying the registry's titleblock + border metadata,
              spliced with the user-editable title/drawnBy/project fields
              from the inline inputs below.
            */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{dict.templatePicker}</span>
              <select
                data-testid="drawing-template-select"
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value as TemplateKey)}
                style={{ padding: 6 }}
              >
                {TEMPLATE_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k === 'none'
                      ? dict.templateNone
                      : k === 'engineering'
                        ? dict.templateEngineering
                        : k === 'architectural'
                          ? dict.templateArchitectural
                          : k === 'minimal'
                            ? dict.templateMinimal
                            : dict.templateIsoA3}
                  </option>
                ))}
              </select>
            </label>

            {/*
              Editable titleblock fields — only rendered when the active
              template carries a titleblock (engineering / architectural /
              isoA3). Minimal + none templates have no titleblock so the
              section collapses to nothing.
            */}
            {templateKey !== 'none' && TEMPLATES[templateKey]?.titleblock ? (
              <fieldset
                data-testid="drawing-template-titleblock-editor"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  border: '1px solid #e5e7eb',
                  borderRadius: 4,
                  padding: '6px 8px',
                  margin: 0,
                  fontSize: 12,
                  color: '#374151',
                }}
              >
                <legend style={{ padding: '0 4px', fontWeight: 600 }}>
                  {dict.titleblockSectionLabel}
                </legend>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{dict.titleblockTitle}</span>
                  <input
                    type="text"
                    data-testid="drawing-template-title-input"
                    value={titleblockOverrides.title}
                    onChange={(e) =>
                      setTitleblockOverrides((prev) => ({ ...prev, title: e.target.value }))
                    }
                    style={{ padding: 4 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{dict.titleblockDrawnBy}</span>
                  <input
                    type="text"
                    data-testid="drawing-template-drawnBy-input"
                    value={titleblockOverrides.drawnBy}
                    onChange={(e) =>
                      setTitleblockOverrides((prev) => ({ ...prev, drawnBy: e.target.value }))
                    }
                    style={{ padding: 4 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{dict.titleblockProject}</span>
                  <input
                    type="text"
                    data-testid="drawing-template-project-input"
                    value={titleblockOverrides.project}
                    onChange={(e) =>
                      setTitleblockOverrides((prev) => ({ ...prev, project: e.target.value }))
                    }
                    style={{ padding: 4 }}
                  />
                </label>
              </fieldset>
            ) : null}

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

            {/* ─── Display style ─────────────────────────────────────── */}
            <label
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: '#374151', fontWeight: 600,
                borderTop: '1px solid #e5e7eb', paddingTop: 10, marginTop: 4,
              }}
            >
              <input
                type="checkbox"
                data-testid="drawing-hidden-lines-toggle"
                checked={showHiddenLines}
                onChange={(e) => setShowHiddenLines(e.target.checked)}
              />
              {loc(langSeg, {
                ko: '숨은선 표시', en: 'Show hidden lines', ja: '隠れ線を表示',
                zh: '显示隐藏线', es: 'Mostrar líneas ocultas', ar: 'إظهار الخطوط المخفية',
              })}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', fontWeight: 600 }}>
              <input
                type="checkbox"
                data-testid="drawing-tangent-edges-toggle"
                checked={showTangentEdges}
                onChange={(e) => setShowTangentEdges(e.target.checked)}
              />
              {loc(langSeg, {
                ko: '접선 모서리 표시', en: 'Show tangent edges', ja: '接線エッジを表示',
                zh: '显示相切边', es: 'Mostrar aristas tangentes', ar: 'إظهار الحواف المماسية',
              })}
            </label>

            {/* ─── Section views ─────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #e5e7eb', paddingTop: 10, marginTop: 4 }}>
              <button
                type="button"
                data-testid="drawing-add-section"
                onClick={addSectionView}
                disabled={!sheetGeometry}
                style={{
                  padding: '6px 10px', height: 30,
                  border: '1px solid #2563eb', borderRadius: 4,
                  background: sheetGeometry ? '#2563eb' : '#9ca3af',
                  color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: sheetGeometry ? 'pointer' : 'not-allowed',
                }}
              >
                {loc(langSeg, {
                  ko: '단면도 추가', en: 'Add section view', ja: '断面図を追加',
                  zh: '添加剖视图', es: 'Añadir vista de sección', ar: 'إضافة منظر مقطعي',
                })}
              </button>
              {sectionViews.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#6b7280' }}>
                  <span data-testid="drawing-section-count">
                    {loc(langSeg, {
                      ko: `단면도 ${sectionViews.length}개`,
                      en: `${sectionViews.length} section${sectionViews.length > 1 ? 's' : ''}`,
                      ja: `断面図 ${sectionViews.length}個`,
                      zh: `剖视图 ${sectionViews.length} 个`,
                      es: `${sectionViews.length} secci${sectionViews.length > 1 ? 'ones' : 'ón'}`,
                      ar: `${sectionViews.length} مقطع`,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={clearSectionViews}
                    style={{ padding: '2px 8px', border: '1px solid #d1d5db', borderRadius: 3, background: 'transparent', color: '#6b7280', fontSize: 11, cursor: 'pointer' }}
                  >
                    {loc(langSeg, { ko: '지우기', en: 'Clear', ja: 'クリア', zh: '清除', es: 'Borrar', ar: 'مسح' })}
                  </button>
                </div>
              ) : null}

              {/* ─── W4-C: detail + broken views ─────────────────────── */}
              <button
                type="button"
                data-testid="drawing-add-detail"
                onClick={addDetailView}
                disabled={!sheetGeometry}
                style={{
                  padding: '6px 10px', height: 30,
                  border: '1px solid #1d4ed8', borderRadius: 4,
                  background: sheetGeometry ? '#1d4ed8' : '#9ca3af',
                  color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: sheetGeometry ? 'pointer' : 'not-allowed',
                }}
              >
                {loc(langSeg, {
                  ko: '상세도 추가', en: 'Add detail view', ja: '詳細図を追加',
                  zh: '添加局部放大图', es: 'Añadir vista de detalle', ar: 'إضافة منظر تفصيلي',
                })}
              </button>
              {detailViews.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#6b7280' }}>
                  <span data-testid="drawing-detail-count">
                    {loc(langSeg, {
                      ko: `상세도 ${detailViews.length}개`,
                      en: `${detailViews.length} detail view${detailViews.length > 1 ? 's' : ''}`,
                      ja: `詳細図 ${detailViews.length}個`,
                      zh: `局部放大图 ${detailViews.length} 个`,
                      es: `${detailViews.length} detalle${detailViews.length > 1 ? 's' : ''}`,
                      ar: `${detailViews.length} تفصيل`,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={clearDetailViews}
                    style={{ padding: '2px 8px', border: '1px solid #d1d5db', borderRadius: 3, background: 'transparent', color: '#6b7280', fontSize: 11, cursor: 'pointer' }}
                  >
                    {loc(langSeg, { ko: '지우기', en: 'Clear', ja: 'クリア', zh: '清除', es: 'Borrar', ar: 'مسح' })}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                data-testid="drawing-add-broken"
                onClick={addBrokenView}
                disabled={!sheetGeometry}
                style={{
                  padding: '6px 10px', height: 30,
                  border: '1px solid #b45309', borderRadius: 4,
                  background: sheetGeometry ? '#b45309' : '#9ca3af',
                  color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: sheetGeometry ? 'pointer' : 'not-allowed',
                }}
              >
                {loc(langSeg, {
                  ko: '파단도 추가', en: 'Add broken view', ja: '破断図を追加',
                  zh: '添加断裂视图', es: 'Añadir vista interrumpida', ar: 'إضافة منظر مقطوع',
                })}
              </button>
              {brokenViews.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#6b7280' }}>
                  <span data-testid="drawing-broken-count">
                    {loc(langSeg, {
                      ko: `파단도 ${brokenViews.length}개`,
                      en: `${brokenViews.length} broken view${brokenViews.length > 1 ? 's' : ''}`,
                      ja: `破断図 ${brokenViews.length}個`,
                      zh: `断裂视图 ${brokenViews.length} 个`,
                      es: `${brokenViews.length} vista${brokenViews.length > 1 ? 's' : ''} interrumpida${brokenViews.length > 1 ? 's' : ''}`,
                      ar: `${brokenViews.length} منظر مقطوع`,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={clearBrokenViews}
                    style={{ padding: '2px 8px', border: '1px solid #d1d5db', borderRadius: 3, background: 'transparent', color: '#6b7280', fontSize: 11, cursor: 'pointer' }}
                  >
                    {loc(langSeg, { ko: '지우기', en: 'Clear', ja: 'クリア', zh: '清除', es: 'Borrar', ar: 'مسح' })}
                  </button>
                </div>
              ) : null}
            </div>
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
            <SheetRenderer sheet={sheet} geometry={sheetGeometry} topologies={sheetTopologies} cuttingPlanes={cuttingPlanes} showHiddenLines={showHiddenLines} showTangentEdges={showTangentEdges} autoDimension />
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

            {/* R5 — relink history toast: the applied record verbatim
                (formatRelinkRecord), dismissible; latest apply wins. */}
            {relinkToast ? (
              <div
                data-testid="drawing-relink-toast"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 11,
                  background: '#ecfdf5',
                  color: '#065f46',
                  border: '1px solid #a7f3d0',
                  borderRadius: 4,
                  padding: '6px 8px',
                }}
              >
                <span style={{ wordBreak: 'break-all' }}>{relinkToast}</span>
                <button
                  type="button"
                  data-testid="drawing-relink-toast-close"
                  onClick={() => setRelinkToast(null)}
                  style={{ background: 'none', border: 'none', color: '#065f46', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}
                >
                  ✕
                </button>
              </div>
            ) : null}

            {drawingReferencePartition.review.length > 0 ? (
              <div
                data-testid="drawing-reference-review"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: 8,
                  border: '1px solid #f59e0b',
                  borderRadius: 4,
                  background: '#fffbeb',
                  fontSize: 11,
                }}
              >
                <strong>
                  {loc(lang, {
                    ko: `참조 검토 대기 (${drawingReferencePartition.review.length})`, en: `Reference review (${drawingReferencePartition.review.length})`,
                    ja: `参照レビュー (${drawingReferencePartition.review.length})`, zh: `引用审核 (${drawingReferencePartition.review.length})`,
                    es: `Revisión de referencias (${drawingReferencePartition.review.length})`, ar: `مراجعة المراجع (${drawingReferencePartition.review.length})`,
                  })}
                </strong>
                <span>
                  {loc(lang, {
                    ko: '아래 주석은 도면 표시와 내보내기에서 안전하게 제외되었습니다.', en: 'These annotations are safely excluded from rendering and export.',
                    ja: '以下の注釈は図面表示とエクスポートから安全に除外されました。', zh: '以下注释已安全地从图纸显示和导出中排除。',
                    es: 'Estas anotaciones se excluyen de forma segura de la visualización y la exportación.', ar: 'تم استبعاد هذه التعليقات بأمان من العرض والتصدير.',
                  })}
                </span>
                {drawingReferencePartition.review.map(item => (
                  <div
                    key={`${item.consumer}:${item.id}`}
                    data-testid={`drawing-reference-review-${item.consumer}-${item.id}`}
                    style={{ padding: 6, borderRadius: 3, background: '#fff' }}
                  >
                    <div style={{ marginBottom: 5 }}>
                      <code>{item.id}</code> · {item.refs.join(', ')}
                    </div>
                    {item.consumer === 'dimension' ? (
                      <button
                        type="button"
                        onClick={() => setRelinkDimId(item.id)}
                        style={{ padding: '3px 8px', border: 0, borderRadius: 3, background: '#b45309', color: '#fff', cursor: 'pointer' }}
                      >
                        {dict.relinkAnnotation}
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <select
                          aria-label={`GD&T target ${item.id}`}
                          value={gdtRelinkDraft[item.id] ?? ''}
                          onChange={event => setGdtRelinkDraft(prev => ({ ...prev, [item.id]: event.target.value }))}
                          style={{ minWidth: 0, flex: 1, fontSize: 11 }}
                        >
                          <option value="">{loc(lang, { ko: '새 면 선택', en: 'Select face', ja: '面を選択', zh: '选择面', es: 'Seleccionar cara', ar: 'اختر سطحًا' })}</option>
                          {validGdtTargets.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                        <button
                          type="button"
                          disabled={!gdtRelinkDraft[item.id]}
                          onClick={() => handleGdtRelinkApply(item.id)}
                          style={{ padding: '3px 8px', border: 0, borderRadius: 3, background: '#b45309', color: '#fff', cursor: 'pointer' }}
                        >
                          {loc(lang, { ko: '적용', en: 'Apply', ja: '適用', zh: '应用', es: 'Aplicar', ar: 'تطبيق' })}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

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
                      <span style={{ display: 'flex', gap: 4 }}>
                        {a.kind === 'dimension' && relinkableDimIds.has(a.id) ? (
                          <button
                            type="button"
                            data-testid={`drawing-page-relink-annotation-${a.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRelinkDimId(a.id);
                            }}
                            style={{
                              padding: '2px 8px',
                              background: '#b45309',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 3,
                              cursor: 'pointer',
                              fontSize: 11,
                            }}
                          >
                            {dict.relinkAnnotation}
                          </button>
                        ) : null}
                        {a.kind === 'ordinate' ? (
                          <button
                            type="button"
                            data-testid={`drawing-page-edit-annotation-${a.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditOrdinateChain(a.id);
                            }}
                            style={{
                              padding: '2px 8px',
                              background: '#0e7490',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 3,
                              cursor: 'pointer',
                              fontSize: 11,
                            }}
                          >
                            {dict.editAnnotation}
                          </button>
                        ) : null}
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
                      </span>
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
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#374151' }}
            >
              <input
                type="checkbox"
                data-testid="drawing-png-export-toggle"
                checked={pngExportEnabled}
                onChange={(e) => setPngExportEnabled(e.target.checked)}
              />
              {dict.enablePngExport}
            </label>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#374151' }}
            >
              <input
                type="checkbox"
                data-testid="drawing-ordinate-toggle"
                checked={ordinateEnabled}
                onChange={(e) => setOrdinateEnabled(e.target.checked)}
              />
              {ordinateEnabled ? dict.hideOrdinateChain : dict.enableOrdinateChain}
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
              data-testid="drawing-export-dxf-button"
              onClick={onExportDxf}
              style={{
                padding: '8px 14px',
                background: '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {dict.exportDxf}
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
          {/*
            B31.6 standalone high-res PNG export. Mounts the dedicated
            SheetPngExportButton (DPI picker + spinner + iOS canvas-cap
            hint) on demand. Default OFF because the button mounts its
            own off-screen SheetRenderer — leaving it always-on would
            double the viewport-group count and break the legacy
            drawing-suite tests that assert `viewportIds(container)`
            length 4.
          */}
          {pngExportEnabled ? (
            <div
              data-testid="drawing-png-export-section"
              style={{ display: 'flex', justifyContent: 'flex-end' }}
            >
              <SheetPngExportButton lang={lang} sheet={sheet} />
            </div>
          ) : null}
        </footer>
        ) : null}
        {/*
          B31.4 STEP version-compare side panel. Mounts the standalone
          {@link StepCompareVersionPanel} as a sibling section beneath
          the footer — keeps it visible alongside the live drawing for
          quick before/after comparison without overlapping the canvas
          or stealing the footer's export controls. Default OFF (toggle
          lives in the header next to the assembly-mode toggle).
        */}
        {compareOpen ? (
          <section
            data-testid="drawing-compare-panel-section"
            style={{
              padding: 12,
              background: '#ffffff',
              borderRadius: 6,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            <StepCompareVersionPanel lang={lang} />
          </section>
        ) : null}
        {/*
          Phase 4.2 ordinate-dimension scratchpad. Mounts the standalone
          {@link OrdinateDimensionPanel} as a sibling section beneath the
          footer. Default OFF (toggle in the footer next to the PNG-export
          toggle). Self-contained: the engine is pure, so the panel never
          touches the live sheet IR.
        */}
        {ordinateEnabled ? (
          <section
            data-testid="drawing-ordinate-panel-section"
            style={{
              padding: 12,
              background: '#ffffff',
              borderRadius: 6,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            <OrdinateDimensionPanel
              key={ordinateSeedKey}
              lang={lang}
              initialChain={editingOrdinateChain ?? undefined}
              onCommit={handleAddOrdinateChain}
            />
          </section>
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

      {/* R5 — props-injected relink panel, scoped to the one dimension whose
          ⚠ row was clicked. The panel is pure presentation over the engine's
          suggestion (never confident on the named channel); it unmounts
          itself once the dimension has no lost refs left (items empty). */}
      {relinkDimId && !assemblyMode ? (
        <RefRelinkPanel
          lang={lang}
          items={relinkItems}
          onApply={handleRelinkApply}
          onClose={() => setRelinkDimId(null)}
          history={relinkHistory}
        />
      ) : null}
    </main>
  );
}
