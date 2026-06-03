'use client';

/**
 * StepImportModal — Phase 5.2 standalone modal that imports a STEP file
 * into a FeatureTree of supported extrude features. Wraps `/api/step-import`.
 *
 * Architecture:
 *   - Standalone (NOT a wrapper of SolverSketchEditor). The parent decides
 *     what to do with the returned tree (replace current tree, merge into
 *     assembly, etc.). The modal only exposes `(tree, warnings, unsupported)`
 *     via the `onImport` callback.
 *   - Two upload modes inside the same modal:
 *       1. File picker (default).  Accepts .step / .stp (any case).
 *       2. Paste-source mode.       Toggled by a "Paste STEP source" button;
 *          opens a textarea for users who already have the source in their
 *          clipboard (handy for diffs, samples, snippets).
 *     Both submit to the same endpoint; the file branch goes via multipart
 *     form-data, the paste branch via JSON.
 *   - 6-language UI (ko / en / ja / zh / es / ar) — error codes returned
 *     by the API are mapped here to localised copy. The free-form
 *     `message` from the server is *not* shown to the user; it is logged
 *     to console.warn for support.
 *
 * Test surface (data-testids — all prefixed step-import-):
 *   step-import-modal,
 *   step-import-file-input,
 *   step-import-toggle-paste, step-import-source-textarea,
 *   step-import-submit, step-import-cancel,
 *   step-import-error,
 *   step-import-summary,
 *   step-import-entries, step-import-entry-{idx},
 *   step-import-warnings, step-import-warning-{idx},
 *   step-import-unsupported, step-import-unsupported-{idx},
 *   step-import-phase3-wishlist, step-import-wishlist-{idx}.
 */

import React, { useCallback, useRef, useState } from 'react';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { SweepFeature } from '@/lib/cad/sweepLoft';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';
import SketchInferFromImagePanel from './SketchInferFromImagePanel';

export type StepImportLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  modalTitle: string;
  /** Tab strip label for the STEP-file import sub-tab (default-active). */
  tabStep: string;
  /** Tab strip label for the image-inference sub-tab (Phase 3.AI.UI). */
  tabImage: string;
  filePickerLabel: string;
  togglePaste: string;
  togglePicker: string;
  sourcePlaceholder: string;
  submit: string;
  cancel: string;
  importing: string;
  summarySingle: (count: number) => string;
  summaryEmpty: string;
  /** Joiner used between summary count and the per-kind fragment list
   *  (e.g. ": " in English, "： " in Japanese / Chinese). */
  summarySeparator: string;
  /** Joiner used between per-kind fragments in the summary, e.g. ", ". */
  summaryListSeparator: string;
  warningsHeading: string;
  unsupportedHeading: string;
  entriesHeading: string;
  /** Heading for the Phase 3 wishlist note shown under the unsupported list. */
  phase3WishlistHeading: string;
  /** Static list of Phase 3 wishlist items (importer features intentionally
   *  routed to `unsupported` until a later phase). Surfaced as a hint so
   *  users know which limitations are known. */
  phase3WishlistItems: ReadonlyArray<string>;
  /** Map server `error` code → localised user-facing copy. */
  errorByCode: Record<'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE' | 'PARSE_ERROR' | 'NETWORK_ERROR', string>;
  errorPrefix: string;
  /** Per-feature summary fragments. `boxFragment` / `cylinderFragment` /
   *  `sweepFragment` / `revolveFragment` are pluralised counts; the polygon
   *  fragment is emitted PER ENTRY (taking the vertex count) so users can
   *  see "1 3-vertex polygon prism, 1 5-vertex polygon prism" rather than
   *  a single opaque "2 polygon prisms" line — vertex counts matter when
   *  inspecting an imported sketch. */
  boxFragment: (n: number) => string;
  polygonFragment: (vertices: number) => string;
  cylinderFragment: (n: number) => string;
  revolveFragment: (n: number) => string;
  sweepFragment: (n: number) => string;
  /** Per-entry kind labels shown in the entries list + tooltip details. */
  entryLabelBox: string;
  entryLabelPolygon: (vertices: number) => string;
  entryLabelCylinder: string;
  entryLabelRevolve: string;
  entryLabelSweep: string;
  entryTooltipBox: (w: number, h: number, d: number) => string;
  entryTooltipPolygon: (vertices: number, depth: number) => string;
  entryTooltipCylinder: (radius: number, height: number) => string;
  entryTooltipRevolve: (vertices: number, angleDeg: number) => string;
  entryTooltipSweep: (vertices: number, length: number) => string;
}

const dict: Record<StepImportLang, Dict> = {
  ko: {
    modalTitle: 'STEP 가져오기',
    tabStep: 'STEP',
    tabImage: '이미지',
    filePickerLabel: 'STEP 파일 선택 (.step / .stp)',
    togglePaste: 'STEP 소스 붙여넣기',
    togglePicker: '파일 선택으로 돌아가기',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: '가져오기',
    cancel: '취소',
    importing: '가져오는 중...',
    summarySingle: (count) => `${count}개 솔리드를 가져왔습니다`,
    summaryEmpty: '인식 가능한 솔리드가 없습니다.',
    summarySeparator: ' — ',
    summaryListSeparator: ', ',
    warningsHeading: '경고',
    unsupportedHeading: '지원되지 않는 형상',
    entriesHeading: '가져온 항목',
    phase3WishlistHeading: 'Phase 3 미지원 목록',
    phase3WishlistItems: [
      'SWEPT_DISK_SOLID (파이프/호스 프리미티브)',
      '비축 정렬 스윕 / 회전 축',
      '여러 개의 SURFACE_OF_LINEAR_EXTRUSION (필렛 프리즘 등)',
      '비선형 (스플라인/원호) 스윕 경로',
      '로프트 (단면 가변)',
    ],
    errorByCode: {
      BAD_REQUEST: '잘못된 요청입니다. STEP 소스를 확인해 주세요.',
      PAYLOAD_TOO_LARGE: 'STEP 파일이 너무 큽니다 (최대 5MB).',
      PARSE_ERROR: 'STEP 파일을 분석할 수 없습니다.',
      NETWORK_ERROR: '네트워크 오류가 발생했습니다.',
    },
    errorPrefix: '오류',
    boxFragment: (n) => `박스 ${n}개`,
    polygonFragment: (v) => `${v}꼭짓점 다각형 프리즘`,
    cylinderFragment: (n) => `원기둥 ${n}개`,
    revolveFragment: (n) => `회전체 ${n}개`,
    sweepFragment: (n) => `선형 프리즘 ${n}개`,
    entryLabelBox: '박스',
    entryLabelPolygon: (v) => `다각형 프리즘 (${v}꼭짓점)`,
    entryLabelCylinder: '원기둥',
    entryLabelRevolve: '회전체',
    entryLabelSweep: '선형 프리즘',
    entryTooltipBox: (w, h, d) => `박스 ${w} × ${h} × ${d} mm`,
    entryTooltipPolygon: (v, d) => `다각형 프리즘 · ${v}꼭짓점 · 높이 ${d} mm`,
    entryTooltipCylinder: (r, h) => `원기둥 · 반지름 ${r} mm · 높이 ${h} mm`,
    entryTooltipRevolve: (v, a) => `회전체 · ${v}꼭짓점 프로파일 · 각도 ${a}°`,
    entryTooltipSweep: (v, l) => `선형 프리즘 · ${v}꼭짓점 프로파일 · 길이 ${l} mm`,
  },
  en: {
    modalTitle: 'Import STEP',
    tabStep: 'STEP',
    tabImage: 'Image',
    filePickerLabel: 'Pick a STEP file (.step / .stp)',
    togglePaste: 'Paste STEP source instead',
    togglePicker: 'Back to file picker',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: 'Import',
    cancel: 'Cancel',
    importing: 'Importing...',
    summarySingle: (count) => `Imported ${count} solid${count === 1 ? '' : 's'}`,
    summaryEmpty: 'No recognised solids found.',
    summarySeparator: ': ',
    summaryListSeparator: ', ',
    warningsHeading: 'Warnings',
    unsupportedHeading: 'Unsupported geometry',
    entriesHeading: 'Imported entries',
    phase3WishlistHeading: 'Phase 3 wishlist (not yet imported)',
    phase3WishlistItems: [
      'SWEPT_DISK_SOLID (pipe / hose primitive)',
      'Non-axis-aligned sweep / revolve axis',
      'Multiple SURFACE_OF_LINEAR_EXTRUSION faces (e.g. filleted prisms)',
      'Non-linear (spline / arc) sweep paths',
      'Loft (variable cross-section)',
    ],
    errorByCode: {
      BAD_REQUEST: 'Bad request — please check the STEP source.',
      PAYLOAD_TOO_LARGE: 'STEP file is too large (max 5MB).',
      PARSE_ERROR: 'Could not parse STEP file.',
      NETWORK_ERROR: 'Network error.',
    },
    errorPrefix: 'Error',
    boxFragment: (n) => `${n} box${n === 1 ? '' : 'es'}`,
    polygonFragment: (v) => `${v}-vertex polygon prism`,
    cylinderFragment: (n) => `${n} cylinder${n === 1 ? '' : 's'}`,
    revolveFragment: (n) => `${n} body of revolution${n === 1 ? '' : 's'}`,
    sweepFragment: (n) => `${n} sweep${n === 1 ? '' : 's'}`,
    entryLabelBox: 'Box',
    entryLabelPolygon: (v) => `Polygon prism (${v}-vertex)`,
    entryLabelCylinder: 'Cylinder',
    entryLabelRevolve: 'Body of revolution',
    entryLabelSweep: 'Linear prism',
    entryTooltipBox: (w, h, d) => `Box · ${w} × ${h} × ${d} mm`,
    entryTooltipPolygon: (v, d) => `Polygon prism · ${v}-vertex · depth ${d} mm`,
    entryTooltipCylinder: (r, h) => `Cylinder · radius ${r} mm · height ${h} mm`,
    entryTooltipRevolve: (v, a) => `Body of revolution · ${v}-vertex profile · angle ${a}°`,
    entryTooltipSweep: (v, l) => `Linear prism · ${v}-vertex profile · length ${l} mm`,
  },
  ja: {
    modalTitle: 'STEPインポート',
    tabStep: 'STEP',
    tabImage: '画像',
    filePickerLabel: 'STEPファイルを選択 (.step / .stp)',
    togglePaste: 'STEPソースを貼り付け',
    togglePicker: 'ファイル選択に戻る',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: 'インポート',
    cancel: 'キャンセル',
    importing: 'インポート中...',
    summarySingle: (count) => `${count}個のソリッドをインポートしました`,
    summaryEmpty: '認識できるソリッドが見つかりません。',
    summarySeparator: ' — ',
    summaryListSeparator: '、',
    warningsHeading: '警告',
    unsupportedHeading: '未対応形状',
    entriesHeading: 'インポート項目',
    phase3WishlistHeading: 'Phase 3 未対応リスト',
    phase3WishlistItems: [
      'SWEPT_DISK_SOLID (パイプ/ホース)',
      '非軸整列の押し出し / 回転軸',
      '複数の SURFACE_OF_LINEAR_EXTRUSION (フィレットプリズム等)',
      '非線形 (スプライン/円弧) スイープ経路',
      'ロフト (断面可変)',
    ],
    errorByCode: {
      BAD_REQUEST: '不正なリクエストです。STEPソースを確認してください。',
      PAYLOAD_TOO_LARGE: 'STEPファイルが大きすぎます (最大5MB)。',
      PARSE_ERROR: 'STEPファイルを解析できません。',
      NETWORK_ERROR: 'ネットワークエラーが発生しました。',
    },
    errorPrefix: 'エラー',
    boxFragment: (n) => `ボックス${n}個`,
    polygonFragment: (v) => `${v}頂点ポリゴンプリズム`,
    cylinderFragment: (n) => `円柱${n}個`,
    revolveFragment: (n) => `回転体${n}個`,
    sweepFragment: (n) => `線形プリズム${n}個`,
    entryLabelBox: 'ボックス',
    entryLabelPolygon: (v) => `ポリゴンプリズム (${v}頂点)`,
    entryLabelCylinder: '円柱',
    entryLabelRevolve: '回転体',
    entryLabelSweep: '線形プリズム',
    entryTooltipBox: (w, h, d) => `ボックス · ${w} × ${h} × ${d} mm`,
    entryTooltipPolygon: (v, d) => `ポリゴンプリズム · ${v}頂点 · 高さ ${d} mm`,
    entryTooltipCylinder: (r, h) => `円柱 · 半径 ${r} mm · 高さ ${h} mm`,
    entryTooltipRevolve: (v, a) => `回転体 · ${v}頂点プロファイル · 角度 ${a}°`,
    entryTooltipSweep: (v, l) => `線形プリズム · ${v}頂点プロファイル · 長さ ${l} mm`,
  },
  zh: {
    modalTitle: '导入 STEP',
    tabStep: 'STEP',
    tabImage: '图像',
    filePickerLabel: '选择 STEP 文件 (.step / .stp)',
    togglePaste: '改为粘贴 STEP 源',
    togglePicker: '返回文件选择',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: '导入',
    cancel: '取消',
    importing: '导入中...',
    summarySingle: (count) => `已导入 ${count} 个实体`,
    summaryEmpty: '未找到可识别的实体。',
    summarySeparator: ' — ',
    summaryListSeparator: '、',
    warningsHeading: '警告',
    unsupportedHeading: '不支持的几何',
    entriesHeading: '导入条目',
    phase3WishlistHeading: 'Phase 3 未支持清单',
    phase3WishlistItems: [
      'SWEPT_DISK_SOLID (管道/软管)',
      '非轴对齐的扫掠 / 旋转轴',
      '多个 SURFACE_OF_LINEAR_EXTRUSION (圆角棱柱等)',
      '非线性 (样条/弧) 扫掠路径',
      '放样 (截面变化)',
    ],
    errorByCode: {
      BAD_REQUEST: '错误请求 — 请检查 STEP 源。',
      PAYLOAD_TOO_LARGE: 'STEP 文件过大 (最大 5MB)。',
      PARSE_ERROR: '无法解析 STEP 文件。',
      NETWORK_ERROR: '网络错误。',
    },
    errorPrefix: '错误',
    boxFragment: (n) => `${n} 个长方体`,
    polygonFragment: (v) => `${v} 顶点多边形棱柱`,
    cylinderFragment: (n) => `${n} 个圆柱`,
    revolveFragment: (n) => `${n} 个旋转体`,
    sweepFragment: (n) => `${n} 个线性棱柱`,
    entryLabelBox: '长方体',
    entryLabelPolygon: (v) => `多边形棱柱 (${v} 顶点)`,
    entryLabelCylinder: '圆柱',
    entryLabelRevolve: '旋转体',
    entryLabelSweep: '线性棱柱',
    entryTooltipBox: (w, h, d) => `长方体 · ${w} × ${h} × ${d} mm`,
    entryTooltipPolygon: (v, d) => `多边形棱柱 · ${v} 顶点 · 高度 ${d} mm`,
    entryTooltipCylinder: (r, h) => `圆柱 · 半径 ${r} mm · 高度 ${h} mm`,
    entryTooltipRevolve: (v, a) => `旋转体 · ${v} 顶点轮廓 · 角度 ${a}°`,
    entryTooltipSweep: (v, l) => `线性棱柱 · ${v} 顶点轮廓 · 长度 ${l} mm`,
  },
  es: {
    modalTitle: 'Importar STEP',
    tabStep: 'STEP',
    tabImage: 'Imagen',
    filePickerLabel: 'Selecciona un archivo STEP (.step / .stp)',
    togglePaste: 'Pegar el código STEP en su lugar',
    togglePicker: 'Volver al selector de archivos',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: 'Importar',
    cancel: 'Cancelar',
    importing: 'Importando...',
    summarySingle: (count) => `Importado ${count} sólido${count === 1 ? '' : 's'}`,
    summaryEmpty: 'No se encontraron sólidos reconocibles.',
    summarySeparator: ' — ',
    summaryListSeparator: ', ',
    warningsHeading: 'Avisos',
    unsupportedHeading: 'Geometría no soportada',
    entriesHeading: 'Entradas importadas',
    phase3WishlistHeading: 'Lista de deseos Phase 3 (aún sin importar)',
    phase3WishlistItems: [
      'SWEPT_DISK_SOLID (tubo / manguera)',
      'Eje de barrido / revolución no alineado a un eje',
      'Múltiples SURFACE_OF_LINEAR_EXTRUSION (p. ej. prismas con redondeo)',
      'Trayectorias de barrido no lineales (spline / arco)',
      'Loft (sección variable)',
    ],
    errorByCode: {
      BAD_REQUEST: 'Solicitud incorrecta — revisa el código STEP.',
      PAYLOAD_TOO_LARGE: 'El archivo STEP es demasiado grande (máx. 5 MB).',
      PARSE_ERROR: 'No se pudo analizar el archivo STEP.',
      NETWORK_ERROR: 'Error de red.',
    },
    errorPrefix: 'Error',
    boxFragment: (n) => `${n} caja${n === 1 ? '' : 's'}`,
    polygonFragment: (v) => `prisma poligonal de ${v} vértices`,
    cylinderFragment: (n) => `${n} cilindro${n === 1 ? '' : 's'}`,
    revolveFragment: (n) => `${n} cuerpo${n === 1 ? '' : 's'} de revolución`,
    sweepFragment: (n) => `${n} barrido${n === 1 ? '' : 's'}`,
    entryLabelBox: 'Caja',
    entryLabelPolygon: (v) => `Prisma poligonal (${v} vértices)`,
    entryLabelCylinder: 'Cilindro',
    entryLabelRevolve: 'Cuerpo de revolución',
    entryLabelSweep: 'Prisma lineal',
    entryTooltipBox: (w, h, d) => `Caja · ${w} × ${h} × ${d} mm`,
    entryTooltipPolygon: (v, d) => `Prisma poligonal · ${v} vértices · profundidad ${d} mm`,
    entryTooltipCylinder: (r, h) => `Cilindro · radio ${r} mm · altura ${h} mm`,
    entryTooltipRevolve: (v, a) => `Cuerpo de revolución · perfil de ${v} vértices · ángulo ${a}°`,
    entryTooltipSweep: (v, l) => `Prisma lineal · perfil de ${v} vértices · longitud ${l} mm`,
  },
  ar: {
    modalTitle: 'استيراد STEP',
    tabStep: 'STEP',
    tabImage: 'صورة',
    filePickerLabel: 'اختر ملف STEP (.step / .stp)',
    togglePaste: 'لصق مصدر STEP بدلاً من ذلك',
    togglePicker: 'العودة إلى اختيار الملف',
    sourcePlaceholder: 'ISO-10303-21; ... END-ISO-10303-21;',
    submit: 'استيراد',
    cancel: 'إلغاء',
    importing: 'جارٍ الاستيراد...',
    summarySingle: (count) => `تم استيراد ${count} مجسم`,
    summaryEmpty: 'لم يتم العثور على مجسمات معروفة.',
    summarySeparator: ' — ',
    summaryListSeparator: '، ',
    warningsHeading: 'تحذيرات',
    unsupportedHeading: 'هندسة غير مدعومة',
    entriesHeading: 'العناصر المستوردة',
    phase3WishlistHeading: 'قائمة Phase 3 (غير مدعوم بعد)',
    phase3WishlistItems: [
      'SWEPT_DISK_SOLID (أنبوب / خرطوم)',
      'محور كنس / دوران غير متوافق مع المحاور الرئيسية',
      'عدة وجوه SURFACE_OF_LINEAR_EXTRUSION (مواشير مدورة الحواف)',
      'مسارات كنس غير خطية (سبلاين / قوس)',
      'Loft (مقطع متغير)',
    ],
    errorByCode: {
      BAD_REQUEST: 'طلب غير صالح — تحقق من مصدر STEP.',
      PAYLOAD_TOO_LARGE: 'ملف STEP كبير جدًا (الحد الأقصى 5 ميغابايت).',
      PARSE_ERROR: 'تعذر تحليل ملف STEP.',
      NETWORK_ERROR: 'خطأ في الشبكة.',
    },
    errorPrefix: 'خطأ',
    boxFragment: (n) => `${n} صندوق`,
    polygonFragment: (v) => `موشور مضلع بـ ${v} رأس`,
    cylinderFragment: (n) => `${n} أسطوانة`,
    revolveFragment: (n) => `${n} جسم دوراني`,
    sweepFragment: (n) => `${n} موشور خطي`,
    entryLabelBox: 'صندوق',
    entryLabelPolygon: (v) => `موشور مضلع (${v} رأس)`,
    entryLabelCylinder: 'أسطوانة',
    entryLabelRevolve: 'جسم دوراني',
    entryLabelSweep: 'موشور خطي',
    entryTooltipBox: (w, h, d) => `صندوق · ${w} × ${h} × ${d} مم`,
    entryTooltipPolygon: (v, d) => `موشور مضلع · ${v} رأس · ارتفاع ${d} مم`,
    entryTooltipCylinder: (r, h) => `أسطوانة · نصف القطر ${r} مم · ارتفاع ${h} مم`,
    entryTooltipRevolve: (v, a) => `جسم دوراني · ملف ${v} رأس · زاوية ${a}°`,
    entryTooltipSweep: (v, l) => `موشور خطي · ملف ${v} رأس · طول ${l} مم`,
  },
};

type ImportState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; tree: FeatureTree; warnings: string[]; unsupported: string[] }
  | { status: 'error'; message: string };

export interface StepImportResponse {
  ok: boolean;
  tree?: FeatureTree;
  warnings?: string[];
  unsupported?: string[];
  error?: string;
  message?: string;
}

export type StepImportFetcher = (
  body: { source: string } | FormData,
) => Promise<StepImportResponse>;

const defaultFetcher: StepImportFetcher = async (body) => {
  const init: RequestInit = body instanceof FormData
    ? { method: 'POST', body }
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      };
  const res = await fetch('/api/step-import', init);
  return (await res.json()) as StepImportResponse;
};

export interface StepImportModalProps {
  lang: StepImportLang;
  onClose: () => void;
  onImport: (tree: FeatureTree, warnings: string[], unsupported: string[]) => void;
  /** Injectable for tests. Defaults to POST /api/step-import. */
  stepImportFetcher?: StepImportFetcher;
  /**
   * Optional callback for the Image tab (B31.2 SketchInferFromImagePanel).
   * Forwarded VERBATIM as the panel's `onAccept` so the host can route the
   * inferred SolverViewState into its sketch state. When omitted the Image
   * tab's Accept button is disabled — matching the standalone panel's own
   * "no callback → no accept" contract.
   */
  onImageAccept?: (sketch: SolverViewState) => void;
}

/** 5 MB client-side cap matches the server-side limit. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Per-entry kind classifier. Inspects a `FeatureNode.payload` and returns a
 * stable `kind` tag the UI renders into a label + tooltip. Pure — no React.
 *
 * Cylinder-vs-revolve disambiguation: the VVVVVV importer emits a cylinder
 * primitive as a `RevolveFeature` whose loop is the canonical rectangle
 *   `[(0,0), (r,0), (r,h), (0,h)]`
 * with `angleDegrees === 360`. Any other revolve loop (e.g. a turned vase,
 * a partial revolve, or a non-rectangular profile) is shown as
 * "Body of revolution".
 */
type EntryKind =
  | { kind: 'box'; width: number; height: number; depth: number }
  | { kind: 'polygon'; vertices: number; depth: number }
  | { kind: 'cylinder'; radius: number; height: number }
  | { kind: 'revolve'; vertices: number; angleDegrees: number }
  | { kind: 'sweep'; vertices: number; length: number }
  | { kind: 'other'; payloadKind: string };

/** Tolerance for "is this rectangle the canonical (0,0)-(r,0)-(r,h)-(0,h)?". */
const CYLINDER_EPS = 1e-6;

function classifyEntry(node: FeatureNode): EntryKind {
  const payload = node.payload;
  if (payload.kind === 'extrude') {
    const f = payload as ExtrudeFeature;
    const loop = f.loop;
    // Box: 4 vertices forming an axis-aligned rectangle. The VVVVVV BREP box
    // detector always emits the loop as
    //   [(x0,y0), (x1,y0), (x1,y1), (x0,y1)]
    // (CCW) — so we check the corner pattern rather than just loop.length===4
    // (any general 4-vertex prism would otherwise pick up the "box" label).
    if (loop.length === 4 && isAxisAlignedRect(loop)) {
      const xs = loop.map((p) => p.x);
      const ys = loop.map((p) => p.y);
      const width = roundDim(Math.max(...xs) - Math.min(...xs));
      const height = roundDim(Math.max(...ys) - Math.min(...ys));
      const depth = roundDim(Math.abs(f.depth));
      return { kind: 'box', width, height, depth };
    }
    return {
      kind: 'polygon',
      vertices: loop.length,
      depth: roundDim(Math.abs(f.depth)),
    };
  }
  if (payload.kind === 'revolve') {
    const f = payload as RevolveFeature;
    const cyl = matchCanonicalCylinder(f);
    if (cyl) return { kind: 'cylinder', radius: cyl.radius, height: cyl.height };
    return {
      kind: 'revolve',
      vertices: f.loop.length,
      angleDegrees: roundDim(f.angleDegrees),
    };
  }
  if (payload.kind === 'sweep') {
    const f = payload as SweepFeature;
    const length = sweepLength(f.path);
    return {
      kind: 'sweep',
      vertices: f.profile.points.length,
      length: roundDim(length),
    };
  }
  return { kind: 'other', payloadKind: (payload as { kind: string }).kind };
}

/** Round a dimension to a stable display value (4 fractional digits, then
 *  trim trailing zeros). Keeps tooltips readable without losing precision. */
function roundDim(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Number(v.toFixed(4));
}

function isAxisAlignedRect(loop: ReadonlyArray<{ x: number; y: number }>): boolean {
  if (loop.length !== 4) return false;
  // Two distinct X values and two distinct Y values, each repeated twice.
  const xs = Array.from(new Set(loop.map((p) => roundDim(p.x))));
  const ys = Array.from(new Set(loop.map((p) => roundDim(p.y))));
  return xs.length === 2 && ys.length === 2;
}

/**
 * Recognise the BREP-cylinder rectangle the importer emits. The loop is
 *   [(0,0), (r,0), (r,h), (0,h)]
 * (vertex order may rotate but the (X,Y) set is determined by (r, h)).
 * Returns `null` if the loop doesn't match that pattern.
 */
function matchCanonicalCylinder(
  f: RevolveFeature,
): { radius: number; height: number } | null {
  if (Math.abs(f.angleDegrees - 360) > 1e-6) return null;
  if (f.loop.length !== 4) return null;
  const xs = f.loop.map((p) => p.x);
  const ys = f.loop.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // Origin corner must sit at (0,0) within CYLINDER_EPS.
  if (Math.abs(minX) > CYLINDER_EPS) return null;
  if (Math.abs(minY) > CYLINDER_EPS) return null;
  const r = maxX - minX;
  const h = maxY - minY;
  if (!(r > CYLINDER_EPS) || !(h > CYLINDER_EPS)) return null;
  // Verify the loop visits exactly the 4 corners (any rotation, CCW or CW).
  const cornerSet = new Set([
    `${roundDim(0)},${roundDim(0)}`,
    `${roundDim(r)},${roundDim(0)}`,
    `${roundDim(r)},${roundDim(h)}`,
    `${roundDim(0)},${roundDim(h)}`,
  ]);
  for (const p of f.loop) {
    const key = `${roundDim(p.x)},${roundDim(p.y)}`;
    if (!cornerSet.has(key)) return null;
  }
  return { radius: roundDim(r), height: roundDim(h) };
}

function sweepLength(path: ReadonlyArray<{ x: number; y: number; z: number }>): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

function entryLabel(entry: EntryKind, t: Dict): string {
  switch (entry.kind) {
    case 'box':
      return t.entryLabelBox;
    case 'polygon':
      return t.entryLabelPolygon(entry.vertices);
    case 'cylinder':
      return t.entryLabelCylinder;
    case 'revolve':
      return t.entryLabelRevolve;
    case 'sweep':
      return t.entryLabelSweep;
    case 'other':
      return entry.payloadKind;
  }
}

function entryTooltip(entry: EntryKind, t: Dict): string {
  switch (entry.kind) {
    case 'box':
      return t.entryTooltipBox(entry.width, entry.height, entry.depth);
    case 'polygon':
      return t.entryTooltipPolygon(entry.vertices, entry.depth);
    case 'cylinder':
      return t.entryTooltipCylinder(entry.radius, entry.height);
    case 'revolve':
      return t.entryTooltipRevolve(entry.vertices, entry.angleDegrees);
    case 'sweep':
      return t.entryTooltipSweep(entry.vertices, entry.length);
    case 'other':
      return entry.payloadKind;
  }
}

/**
 * Build the summary string:
 *   "Imported 4 solids — 2 boxes, 1 cylinder, 1 sweep"
 *
 * Counts are aggregated for box / cylinder / revolve / sweep entries (so
 * "10 boxes" reads cleanly), but polygon prisms are listed per-entry with
 * their vertex count ("3-vertex polygon prism") — vertex count is the most
 * useful identifier when inspecting non-rectangular sketches. Ordering is
 * stable (box → polygon[..] → cylinder → revolve → sweep) so the summary
 * text is deterministic across renders.
 */
function describeTree(tree: FeatureTree, t: Dict): string {
  const nodes = tree.nodes;
  if (nodes.length === 0) return t.summaryEmpty;

  let boxCount = 0;
  let cylinderCount = 0;
  let revolveCount = 0;
  let sweepCount = 0;
  const polygonVertices: number[] = [];
  for (const node of nodes) {
    const entry = classifyEntry(node);
    switch (entry.kind) {
      case 'box':
        boxCount++;
        break;
      case 'polygon':
        polygonVertices.push(entry.vertices);
        break;
      case 'cylinder':
        cylinderCount++;
        break;
      case 'revolve':
        revolveCount++;
        break;
      case 'sweep':
        sweepCount++;
        break;
      case 'other':
        // Unknown payload kinds aren't summarised — they still appear in the
        // entries list so the user can inspect them individually.
        break;
    }
  }

  const fragments: string[] = [];
  if (boxCount > 0) fragments.push(t.boxFragment(boxCount));
  for (const v of polygonVertices) fragments.push(t.polygonFragment(v));
  if (cylinderCount > 0) fragments.push(t.cylinderFragment(cylinderCount));
  if (revolveCount > 0) fragments.push(t.revolveFragment(revolveCount));
  if (sweepCount > 0) fragments.push(t.sweepFragment(sweepCount));

  const head = t.summarySingle(nodes.length);
  if (fragments.length === 0) return `${head}.`;
  return `${head}${t.summarySeparator}${fragments.join(t.summaryListSeparator)}.`;
}

export default function StepImportModal({
  lang,
  onClose,
  onImport,
  stepImportFetcher = defaultFetcher,
  onImageAccept,
}: StepImportModalProps): React.ReactElement {
  const t = dict[lang];

  // Top-level tab — 'step' is the default so the legacy STEP-only contract
  // is preserved (zero regression for callers that never touch onImageAccept).
  // Switching to 'image' unmounts the STEP form below (the panel sits in its
  // own subtree) so SketchInferFromImagePanel starts from a clean slate every
  // time it's re-entered — matches user expectation of "switching tabs resets
  // the inner workflow".
  const [activeTab, setActiveTab] = useState<'step' | 'image'>('step');

  const [pasteMode, setPasteMode] = useState<boolean>(false);
  const [pastedSource, setPastedSource] = useState<string>('');
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [state, setState] = useState<ImportState>({ status: 'idle' });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onSubmit = useCallback(async () => {
    // Validate: at least one source must be supplied.
    if (pasteMode) {
      if (pastedSource.trim().length === 0) {
        setState({ status: 'error', message: t.errorByCode.BAD_REQUEST });
        return;
      }
      if (pastedSource.length > MAX_BYTES) {
        setState({ status: 'error', message: t.errorByCode.PAYLOAD_TOO_LARGE });
        return;
      }
    } else {
      if (!pickedFile) {
        setState({ status: 'error', message: t.errorByCode.BAD_REQUEST });
        return;
      }
      if (pickedFile.size > MAX_BYTES) {
        setState({ status: 'error', message: t.errorByCode.PAYLOAD_TOO_LARGE });
        return;
      }
    }

    setState({ status: 'loading' });
    try {
      let res: StepImportResponse;
      if (pasteMode) {
        res = await stepImportFetcher({ source: pastedSource });
      } else {
        const fd = new FormData();
        fd.append('file', pickedFile!, pickedFile!.name);
        res = await stepImportFetcher(fd);
      }
      if (res.ok && res.tree) {
        const warnings = res.warnings ?? [];
        const unsupported = res.unsupported ?? [];
        setState({ status: 'ok', tree: res.tree, warnings, unsupported });
        onImport(res.tree, warnings, unsupported);
      } else {
        const codeKey = (res.error ?? 'PARSE_ERROR') as keyof Dict['errorByCode'];
        const localised = t.errorByCode[codeKey] ?? t.errorByCode.PARSE_ERROR;
        if (res.message) {
          console.warn('[step-import]', res.error, res.message);
        }
        setState({ status: 'error', message: localised });
      }
    } catch (e) {
      console.warn('[step-import] network error', e);
      setState({ status: 'error', message: t.errorByCode.NETWORK_ERROR });
    }
  }, [pasteMode, pastedSource, pickedFile, stepImportFetcher, onImport, t.errorByCode]);

  return (
    <div
      data-testid="step-import-modal"
      role="dialog"
      aria-labelledby="step-import-title"
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
          maxWidth: 640,
          width: '92%',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 id="step-import-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {t.modalTitle}
        </h3>

        {/* B31.2 tab strip — switches between the legacy STEP import sub-form
            and the SketchInferFromImagePanel (image-inference). Default tab
            is 'step' so the modal is back-compatible (zero regression for
            callers that don't supply onImageAccept). */}
        <div
          data-testid="step-import-tab-bar"
          role="tablist"
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid #e5e7eb',
            marginBottom: 4,
          }}
        >
          {(['step', 'image'] as const).map((tab) => {
            const active = activeTab === tab;
            const label = tab === 'step' ? t.tabStep : t.tabImage;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`step-import-tab-${tab}`}
                data-active={active ? 'true' : 'false'}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  background: active ? '#fff' : '#f3f4f6',
                  color: active ? '#0284c7' : '#4b5563',
                  border: '1px solid #e5e7eb',
                  borderBottom: active ? '2px solid #0284c7' : '1px solid #e5e7eb',
                  borderRadius: '4px 4px 0 0',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Image tab — mounts SketchInferFromImagePanel verbatim. The panel's
            onAccept(SolverViewState) is forwarded to our onImageAccept prop
            unchanged; the host is responsible for routing the sketch into
            its own state (we don't translate it into a FeatureTree here —
            sketch ≠ feature tree, and forcing the conversion would tie this
            modal to a specific extrude policy). */}
        {activeTab === 'image' && (
          <SketchInferFromImagePanel
            lang={lang}
            onAccept={onImageAccept}
          />
        )}

        {activeTab === 'step' && !pasteMode && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            {t.filePickerLabel}
            <input
              ref={fileInputRef}
              type="file"
              accept=".step,.stp,.STEP,.STP"
              data-testid="step-import-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setPickedFile(f);
              }}
              style={{ fontSize: 12 }}
            />
          </label>
        )}

        {activeTab === 'step' && pasteMode && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            {t.togglePaste}
            <textarea
              data-testid="step-import-source-textarea"
              value={pastedSource}
              onChange={(e) => setPastedSource(e.target.value)}
              placeholder={t.sourcePlaceholder}
              rows={8}
              style={{
                padding: 8,
                fontFamily: 'monospace',
                fontSize: 11,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                resize: 'vertical',
              }}
            />
          </label>
        )}

        {activeTab === 'step' && (
          <button
            type="button"
            data-testid="step-import-toggle-paste"
            onClick={() => {
              setPasteMode((m) => !m);
              setState({ status: 'idle' });
            }}
            style={{
              alignSelf: 'flex-start',
              padding: '4px 8px',
              fontSize: 11,
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {pasteMode ? t.togglePicker : t.togglePaste}
          </button>
        )}

        {activeTab === 'step' && state.status === 'loading' && (
          <div style={{ padding: 12, textAlign: 'center', color: '#6b7280', fontSize: 12 }}>
            {t.importing}
          </div>
        )}

        {activeTab === 'step' && state.status === 'error' && (
          <div
            data-testid="step-import-error"
            style={{
              padding: 12,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              color: '#dc2626',
              fontSize: 12,
            }}
          >
            {t.errorPrefix}: {state.message}
          </div>
        )}

        {activeTab === 'step' && state.status === 'ok' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              data-testid="step-import-summary"
              style={{
                padding: 10,
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: 4,
                color: '#065f46',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {describeTree(state.tree, t)}
            </div>
            {state.tree.nodes.length > 0 && (
              <div data-testid="step-import-entries">
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  {t.entriesHeading}
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    fontSize: 11,
                    color: '#065f46',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: 4,
                    padding: '6px 6px 6px 24px',
                  }}
                >
                  {state.tree.nodes.map((node, idx) => {
                    const entry = classifyEntry(node);
                    const label = entryLabel(entry, t);
                    const tooltip = entryTooltip(entry, t);
                    return (
                      <li
                        key={node.id}
                        data-testid={`step-import-entry-${idx}`}
                        data-entry-kind={entry.kind}
                        title={tooltip}
                      >
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        {' — '}
                        <span style={{ color: '#374151' }}>{node.name}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {state.warnings.length > 0 && (
              <div data-testid="step-import-warnings">
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  {t.warningsHeading}
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    fontSize: 11,
                    color: '#92400e',
                    background: '#fffbeb',
                    border: '1px solid #fcd34d',
                    borderRadius: 4,
                    padding: '6px 6px 6px 24px',
                  }}
                >
                  {state.warnings.map((w, idx) => (
                    <li key={idx} data-testid={`step-import-warning-${idx}`}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {state.unsupported.length > 0 && (
              <div data-testid="step-import-unsupported">
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  {t.unsupportedHeading}
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    fontSize: 11,
                    color: '#92400e',
                    background: '#fff7ed',
                    border: '1px solid #fdba74',
                    borderRadius: 4,
                    padding: '6px 6px 6px 24px',
                  }}
                >
                  {state.unsupported.map((u, idx) => (
                    <li key={idx} data-testid={`step-import-unsupported-${idx}`}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
            {state.unsupported.length > 0 && (
              <div data-testid="step-import-phase3-wishlist">
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#6b7280' }}>
                  {t.phase3WishlistHeading}
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    fontSize: 11,
                    color: '#4b5563',
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    borderRadius: 4,
                    padding: '6px 6px 6px 24px',
                  }}
                >
                  {t.phase3WishlistItems.map((item, idx) => (
                    <li key={idx} data-testid={`step-import-wishlist-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={onClose}
            data-testid="step-import-cancel"
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
          {activeTab === 'step' && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={state.status === 'loading'}
              data-testid="step-import-submit"
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: state.status === 'loading' ? '#e5e7eb' : '#0ea5e9',
                color: state.status === 'loading' ? '#9ca3af' : '#fff',
                border: '1px solid #0284c7',
                borderRadius: 4,
                cursor: state.status === 'loading' ? 'not-allowed' : 'pointer',
              }}
            >
              {t.submit}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
