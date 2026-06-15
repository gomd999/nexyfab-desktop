'use client';

import React, { useCallback, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import { useStepWorker } from '../workers/useStepWorker';
import type { StepAnalysisStats } from '../workers/stepWorker';
import { useLocalActiveGeometries } from '../hooks/useGeometryGC';
import StepReversePanel from './StepReversePanel';
import {
  classifyStepEntities,
  formatClassifySummary,
  type ClassifyStepEntitiesResult,
} from '../stepImport/entityClassifier';
import { analytics } from '@/lib/analytics';


const dict = {
  ko: {
    dropZone: 'STEP / STP / IGES 파일을 드래그하거나 클릭하여 선택',
    uploading: '분석 중...', cancel: '취소',
    applyDesign: '설계에 적용', loadViewport: '3D 뷰포트에서 보기',
    loadingGeo: '형상 변환 중...', retry: '다시 시도',
    stats: '형상 분석 결과', dfm: 'DFM 제안',
    faces: '면(삼각형) 수', edges: '엣지 수 (추정)', shells: '셸 수',
    volume: '부피 (cm³)', surface: '표면적 (cm²)', bbox: '경계 박스 (cm)',
    solid: '솔리드', manifold: '매니폴드', yes: '예', no: '아니오',
    errType: '지원하지 않는 파일 형식입니다 (.step .stp .iges .igs 허용)',
    maxSize: '파일 크기 제한: 50 MB',
    parts: '파트', assembly: '전체 어셈블리', partList: '파트 트리 (개별 검사)',
    showDetails: '상세 보기', hideDetails: '상세 숨기기',
    colCategory: '카테고리', colType: '엔티티 타입', colCount: '개수',
  },
  en: {
    dropZone: 'Drag & drop a STEP / STP / IGES file, or click to browse',
    uploading: 'Analyzing...', cancel: 'Cancel',
    applyDesign: 'Apply to Design', loadViewport: 'View in 3D Viewport',
    loadingGeo: 'Converting geometry…', retry: 'Try Again',
    stats: 'Shape Analysis', dfm: 'DFM Suggestions',
    faces: 'Faces (triangles)', edges: 'Edges (est.)', shells: 'Shell count',
    volume: 'Volume (cm³)', surface: 'Surface area (cm²)', bbox: 'Bounding box (cm)',
    solid: 'Solid', manifold: 'Manifold', yes: 'Yes', no: 'No',
    errType: 'Unsupported file type (.step .stp .iges .igs allowed)',
    maxSize: 'File size limit: 50 MB',
    parts: 'Parts', assembly: 'Whole Assembly', partList: 'Part Tree (Inspect Individual)',
    showDetails: 'Show details', hideDetails: 'Hide details',
    colCategory: 'Category', colType: 'Entity Type', colCount: 'Count',
  },
  ja: {
    dropZone: 'STEP / STP / IGES ファイルをドラッグするかクリックして選択',
    uploading: '分析中...', cancel: 'キャンセル',
    applyDesign: '設計に適用', loadViewport: '3D ビューポートで表示',
    loadingGeo: '形状を変換中…', retry: '再試行',
    stats: '形状分析結果', dfm: 'DFM 提案',
    faces: '面数（三角形）', edges: 'エッジ数（推定）', shells: 'シェル数',
    volume: '体積 (cm³)', surface: '表面積 (cm²)', bbox: 'バウンディングボックス (cm)',
    solid: 'ソリッド', manifold: 'マニフォールド', yes: 'はい', no: 'いいえ',
    errType: 'サポートされていないファイル形式です (.step .stp .iges .igs のみ許可)',
    maxSize: 'ファイルサイズ制限: 50 MB',
    parts: 'パーツ', assembly: '全体アセンブリ', partList: 'パーツツリー (個別検査)',
    showDetails: '詳細を表示', hideDetails: '詳細を隠す',
    colCategory: 'カテゴリ', colType: 'エンティティ', colCount: '件数',
  },
  zh: {
    dropZone: '拖放 STEP / STP / IGES 文件，或点击浏览',
    uploading: '分析中...', cancel: '取消',
    applyDesign: '应用到设计', loadViewport: '在 3D 视口中查看',
    loadingGeo: '正在转换几何...', retry: '重试',
    stats: '形状分析', dfm: 'DFM 建议',
    faces: '面数（三角形）', edges: '边数（估算）', shells: '壳数',
    volume: '体积 (cm³)', surface: '表面积 (cm²)', bbox: '边界框 (cm)',
    solid: '实体', manifold: '流形', yes: '是', no: '否',
    errType: '不支持的文件类型（仅允许 .step .stp .iges .igs）',
    maxSize: '文件大小限制: 50 MB',
    parts: '零件', assembly: '整个装配体', partList: '零件树（单独检查）',
    showDetails: '显示详情', hideDetails: '隐藏详情',
    colCategory: '类别', colType: '实体类型', colCount: '数量',
  },
  es: {
    dropZone: 'Arrastra un archivo STEP / STP / IGES o haz clic para examinar',
    uploading: 'Analizando...', cancel: 'Cancelar',
    applyDesign: 'Aplicar al Diseño', loadViewport: 'Ver en Viewport 3D',
    loadingGeo: 'Convirtiendo geometría…', retry: 'Reintentar',
    stats: 'Análisis de Forma', dfm: 'Sugerencias DFM',
    faces: 'Caras (triángulos)', edges: 'Aristas (est.)', shells: 'Nº de cáscaras',
    volume: 'Volumen (cm³)', surface: 'Área de superficie (cm²)', bbox: 'Caja contenedora (cm)',
    solid: 'Sólido', manifold: 'Variedad', yes: 'Sí', no: 'No',
    errType: 'Tipo de archivo no soportado (.step .stp .iges .igs permitidos)',
    maxSize: 'Límite de tamaño: 50 MB',
    parts: 'Partes', assembly: 'Ensamblaje Completo', partList: 'Árbol de partes (Inspección individual)',
    showDetails: 'Ver detalles', hideDetails: 'Ocultar detalles',
    colCategory: 'Categoría', colType: 'Tipo de entidad', colCount: 'Recuento',
  },
  ar: {
    dropZone: 'اسحب وأفلت ملف STEP / STP / IGES أو انقر للاستعراض',
    uploading: 'جارٍ التحليل...', cancel: 'إلغاء',
    applyDesign: 'تطبيق على التصميم', loadViewport: 'عرض في عارض 3D',
    loadingGeo: 'جارٍ تحويل الشكل الهندسي…', retry: 'حاول مرة أخرى',
    stats: 'تحليل الشكل', dfm: 'اقتراحات DFM',
    faces: 'الأوجه (المثلثات)', edges: 'الحواف (تقديري)', shells: 'عدد الأغلفة',
    volume: 'الحجم (cm³)', surface: 'مساحة السطح (cm²)', bbox: 'المربع المحيط (cm)',
    solid: 'صلب', manifold: 'متنوع', yes: 'نعم', no: 'لا',
    errType: 'نوع الملف غير مدعوم (.step .stp .iges .igs مسموح بها)',
    maxSize: 'حد حجم الملف: 50 MB',
    parts: 'أجزاء', assembly: 'التجميع بأكمله', partList: 'شجرة الأجزاء',
    showDetails: 'عرض التفاصيل', hideDetails: 'إخفاء التفاصيل',
    colCategory: 'الفئة', colType: 'نوع الكيان', colCount: 'العدد',
  },
};

// Re-export for consumers
export type { StepAnalysisStats };
export interface StepAnalysisResult extends StepAnalysisStats {
  dfmSuggestions: string[];
  geometry?: THREE.BufferGeometry;
  partsGeo?: { geometry: THREE.BufferGeometry; name: string }[];
}

interface StepUploaderProps {
  onAnalysisComplete: (stats: StepAnalysisResult) => void;
  /** Optional: load STEP geometry into the 3D viewport */
  onGeometryLoad?: (file: File, filename: string) => void;
  onPartSelect?: (partId: string | null) => void;
  lang?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 2) {
  return n.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: dec });
}

function isStepFile(file: File) {
  const name = file.name.toLowerCase();
  return ['.step', '.stp', '.iges', '.igs'].some(ext => name.endsWith(ext));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--nx-panel-2)' }}>
      <span style={{ color: 'var(--nx-text-2)', fontSize: 12, fontWeight: 500 }}>{label}</span>
      <span style={{ color: 'var(--nx-text)', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

/** Per-category color used in the details table chip + table column.
 *  Mirrors the seven `EntityCategory` values. Keep in sync with
 *  `entityClassifier.ts::EntityCategory`. */
const CATEGORY_COLORS: Record<string, string> = {
  core: '#3fb950',         // green
  tessellated: '#388bfd',  // blue
  pmi: '#a371f7',          // purple
  units: '#8b949e',        // gray
  style: '#e3b341',        // yellow
  bim: '#f85149',          // red
  unknown: '#d29922',      // orange (amber)
};

interface BannerStrings {
  showDetails: string;
  hideDetails: string;
  colCategory: string;
  colType: string;
  colCount: string;
}

/** Phase D follow-up — pre-flight entity classification banner shown
 *  during OCCT parse. Three colors:
 *    green  — importable (core geometry + no BIM blockers)
 *    amber  — importable but has unknown entities (>0)
 *    red    — bim-blocked or no geometry (importable=false)
 *
 *  Expandable "Show details" reveals the full `byType` table (sorted
 *  by count desc — already sorted by classifier). Local state, not
 *  hoisted because no consumer cares about open/close. */
function ClassificationBanner({
  classification,
  strings,
}: {
  classification: ClassifyStepEntitiesResult;
  strings: BannerStrings;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const isBlocked = !classification.importable;
  const hasUnknown = classification.byCategory.unknown > 0;
  const color = isBlocked ? '#f85149' : hasUnknown ? '#d29922' : '#3fb950';
  const bgColor = isBlocked ? 'rgba(248,81,73,0.08)' : hasUnknown ? 'rgba(210,153,34,0.08)' : 'rgba(63,185,80,0.08)';
  const borderColor = isBlocked ? 'rgba(248,81,73,0.3)' : hasUnknown ? 'rgba(210,153,34,0.3)' : 'rgba(63,185,80,0.3)';

  const hasRows = classification.byType.length > 0;

  return (
    <div
      data-testid="classification-banner"
      style={{
        marginTop: 8,
        padding: '8px 12px',
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 6,
        fontSize: 11,
        color: 'var(--nx-text-2)',
        lineHeight: 1.6,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <div style={{ color, fontWeight: 700, marginBottom: 2 }}>
        {formatClassifySummary(classification)}
      </div>
      {classification.bimTypes.length > 0 && (
        <div>BIM entities: {classification.bimTypes.slice(0, 5).join(', ')}
          {classification.bimTypes.length > 5 && ` (+${classification.bimTypes.length - 5})`}
        </div>
      )}
      {hasUnknown && classification.unknownTypes.length > 0 && (
        <div>Unknown: {classification.unknownTypes.slice(0, 3).join(', ')}
          {classification.unknownTypes.length > 3 && ` (+${classification.unknownTypes.length - 3})`}
        </div>
      )}

      {hasRows && (
        <button
          type="button"
          data-testid="classification-details-toggle"
          aria-expanded={showDetails}
          onClick={() => setShowDetails(s => !s)}
          style={{
            marginTop: 6,
            padding: '2px 6px',
            background: 'transparent',
            border: 'none',
            color: 'var(--nx-accent-2)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              transition: 'transform 0.15s',
              transform: showDetails ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            ▶
          </span>
          {showDetails ? strings.hideDetails : strings.showDetails}
        </button>
      )}

      {hasRows && showDetails && (
        <div
          data-testid="classification-details-table-wrap"
          style={{
            marginTop: 6,
            maxHeight: 300,
            overflowY: 'auto',
            border: '1px solid var(--nx-panel-2)',
            borderRadius: 4,
            background: 'var(--nx-bg)',
          }}
        >
          <table
            data-testid="classification-details-table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <thead style={{
              position: 'sticky',
              top: 0,
              background: 'var(--nx-panel-2)',
              color: 'var(--nx-text-2)',
            }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>
                  {strings.colCategory}
                </th>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>
                  {strings.colType}
                </th>
                <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>
                  {strings.colCount}
                </th>
              </tr>
            </thead>
            <tbody>
              {classification.byType.map(row => {
                const categoryColor = CATEGORY_COLORS[row.category] ?? 'var(--nx-text-2)';
                return (
                  <tr
                    key={row.entityType}
                    data-testid={`classification-details-row-${row.entityType}`}
                    data-category={row.category}
                    style={{ borderTop: '1px solid var(--nx-panel-2)' }}
                  >
                    <td
                      data-testid={`classification-details-category-${row.entityType}`}
                      data-category={row.category}
                      style={{
                        padding: '3px 8px',
                        color: categoryColor,
                        fontWeight: 600,
                      }}
                    >
                      {row.category}
                    </td>
                    <td style={{ padding: '3px 8px', color: 'var(--nx-text)' }}>
                      {row.entityType}
                    </td>
                    <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--nx-text)' }}>
                      {row.count.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StepUploader({ onAnalysisComplete, onGeometryLoad, onPartSelect, lang = 'en' }: StepUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingGeo, setIsLoadingGeo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<StepAnalysisResult | null>(null);
  /** Pre-flight entity classification (Phase D follow-up). Set right after
   *  the buffer is read, before OCCT WASM parse runs. Surfaces BIM
   *  warnings + entity counts so the user can abort a ~30s parse on a
   *  file we already know won't import cleanly. */
  const [classification, setClassification] = useState<ClassifyStepEntitiesResult | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { parseStep, cancel: cancelWorker } = useStepWorker();

  // Protect the local result geometry from being GC'd while it is still held here
  useLocalActiveGeometries([
    result?.geometry,
    ...(result?.partsGeo?.map(p => p.geometry) || [])
  ]);

  React.useEffect(() => {
    if (onPartSelect) {
      onPartSelect(selectedPartId);
    }
  }, [selectedPartId, onPartSelect]);

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  const T = t;

  const analyze = useCallback(async (file: File) => {
    if (!isStepFile(file)) { setError(T.errType); return; }
    if (file.size > 50 * 1024 * 1024) { setError(T.maxSize); return; }

    setError(null);
    setResult(null);
    setClassification(null);
    setFileName(file.name);
    fileRef.current = file;
    setIsUploading(true);
    setUploadProgress(0);

    try {
      setUploadProgress(20); // 20% when read starts
      const buffer = await file.arrayBuffer();

      // Pre-flight entity classification — runs before OCCT WASM parse so
      // a BIM/IFC file gets caught with a banner before users wait 30s.
      // Cheap (≤50ms on a 5MB file); never throws.
      try {
        const stepText = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
        const cls = classifyStepEntities(stepText);
        setClassification(cls);
        // Fire-and-forget telemetry — top-N unknown/bim type names
        // help backlog prioritize the next whitelist additions.
        analytics.stepClassify({
          schema: cls.schema ?? 'unknown',
          total: cls.totalEntities,
          core: cls.byCategory.core,
          tessellated: cls.byCategory.tessellated,
          pmi: cls.byCategory.pmi,
          bim: cls.byCategory.bim,
          unknown: cls.byCategory.unknown,
          importable: cls.importable,
          topUnknown: cls.unknownTypes.slice(0, 5).join(','),
          topBim: cls.bimTypes.slice(0, 5).join(','),
        });
      } catch {
        // Classifier failure is non-fatal — fall through to OCCT.
      }

      setUploadProgress(60); // 60% when parsing starts in worker

      const workerResult = await parseStep(buffer, file.name);
      setUploadProgress(100);

      const res: StepAnalysisResult = {
        ...workerResult.stats,
        dfmSuggestions: workerResult.dfmSuggestions,
        geometry: workerResult.geometry,
        partsGeo: workerResult.parts,
      };
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsUploading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, parseStep]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) analyze(file);
  }, [analyze]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) analyze(file);
    e.target.value = '';
  }, [analyze]);

  const handleCancel = () => {
    cancelWorker();
    setIsUploading(false);
    setUploadProgress(0);
  };

  const handleReset = () => {
    setResult(null);
    setClassification(null);
    setError(null);
    setFileName(null);
    setUploadProgress(0);
    setSelectedPartId(null);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      background: 'var(--nx-bg)',
      border: '1px solid var(--nx-panel-2)',
      borderRadius: 12,
      padding: 20,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: 'var(--nx-text)',
      maxWidth: 480,
    }}>

      {/* Drop zone */}
      {!isUploading && !result && (
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragging ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
            borderRadius: 10,
            padding: '36px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: isDragging ? 'rgba(56,139,253,0.06)' : 'transparent',
            transition: 'all 0.15s ease',
          }}
        >
          {/* Icon */}
          <svg width={40} height={40} viewBox="0 0 24 24" fill="none"
            style={{ margin: '0 auto 12px', display: 'block', opacity: 0.5 }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
              stroke="var(--nx-accent-2)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="14 2 14 8 20 8"
              stroke="var(--nx-accent-2)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="18" x2="12" y2="12"
              stroke="var(--nx-accent-2)" strokeWidth={1.5} strokeLinecap="round" />
            <polyline points="9 15 12 12 15 15"
              stroke="var(--nx-accent-2)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p style={{ fontSize: 13, color: 'var(--nx-text-2)', margin: 0, lineHeight: 1.6 }}>{T.dropZone}</p>
          {fileName && (
            <p style={{ fontSize: 11, color: 'var(--nx-border-strong)', marginTop: 8 }}>{fileName}</p>
          )}
          <input ref={inputRef} type="file" accept=".step,.stp,.iges,.igs"
            style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      )}

      {/* Progress bar */}
      {isUploading && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--nx-text-2)' }}>{T.uploading}</span>
            <span style={{ fontSize: 12, color: 'var(--nx-border-strong)', fontVariantNumeric: 'tabular-nums' }}>{uploadProgress}%</span>
          </div>
          <div style={{ height: 6, background: 'var(--nx-panel-2)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${uploadProgress}%`,
              background: 'linear-gradient(90deg, var(--nx-accent), var(--nx-accent-2))',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }} />
          </div>
          {fileName && (
            <p style={{ fontSize: 11, color: 'var(--nx-border-strong)', marginTop: 8 }}>{fileName}</p>
          )}
          {classification && (
            <ClassificationBanner
              classification={classification}
              strings={{
                showDetails: T.showDetails,
                hideDetails: T.hideDetails,
                colCategory: T.colCategory,
                colType: T.colType,
                colCount: T.colCount,
              }}
            />
          )}
          <button onClick={handleCancel} style={{
            marginTop: 12, padding: '5px 14px', borderRadius: 6,
            border: '1px solid var(--nx-border)', background: 'transparent',
            color: 'var(--nx-text-2)', fontSize: 12, cursor: 'pointer',
          }}>
            {T.cancel}
          </button>
        </div>
      )}

      {/* Error */}
      {error && !isUploading && (
        <div>
          <div style={{
            background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 12,
          }}>
            <span style={{ fontSize: 12, color: 'var(--nx-error)' }}>{error}</span>
          </div>
          <button onClick={handleReset} style={{
            padding: '6px 16px', borderRadius: 6, border: '1px solid var(--nx-border)',
            background: 'var(--nx-panel-2)', color: 'var(--nx-text)', fontSize: 12, cursor: 'pointer',
          }}>
            {T.retry}
          </button>
        </div>
      )}

      {/* Results */}
      {result && !isUploading && (
        <div>
          {/* Stats header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--nx-accent-2)' }}>{T.stats}</h4>
            <button onClick={handleReset} style={{
              padding: '3px 10px', borderRadius: 5, border: '1px solid var(--nx-border)',
              background: 'transparent', color: 'var(--nx-text-2)', fontSize: 11, cursor: 'pointer',
            }}>
              {T.retry}
            </button>
          </div>

          {/* Part Selection Tree */}
          {result.parts && result.parts.length > 1 && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--nx-text-2)', display: 'block', marginBottom: 4 }}>{T.partList}</label>
              <select
                value={selectedPartId || ''}
                onChange={e => setSelectedPartId(e.target.value || null)}
                style={{
                  width: '100%', padding: '6px 8px', borderRadius: 6,
                  border: '1px solid var(--nx-border)', background: 'var(--nx-bg)', color: 'var(--nx-text)',
                  fontSize: 12, outline: 'none'
                }}
              >
                <option value="">{T.assembly} ({result.parts.length} {T.parts})</option>
                {result.parts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {(() => {
            const displayStats = selectedPartId ? result.parts?.find(p => p.id === selectedPartId) || result : result;
            return (
              <>
                <div style={{ marginBottom: 16 }}>
                  <StatRow label={T.faces}    value={displayStats.faceCount.toLocaleString()} />
                  <StatRow label={T.edges}    value={displayStats.edgeCount.toLocaleString()} />
                  {displayStats === result && <StatRow label={T.shells}   value={result.shellCount.toString()} />}
                  <StatRow label={T.volume}   value={fmt(displayStats.volume_cm3)} />
                  <StatRow label={T.surface}  value={fmt(displayStats.surfaceArea_cm2)} />
                  <StatRow label={T.bbox}     value={`${fmt(displayStats.bbox.w, 1)} × ${fmt(displayStats.bbox.h, 1)} × ${fmt(displayStats.bbox.d, 1)}`} />
                  <StatRow label={T.solid}    value={displayStats.isSolid   ? T.yes : T.no} />
                  <StatRow label={T.manifold} value={displayStats.isManifold ? T.yes : T.no} />
                </div>

                {/* DFM suggestions */}
                {displayStats.dfmSuggestions && displayStats.dfmSuggestions.length > 0 && (
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#e3b341', marginBottom: 6 }}>{T.dfm}</p>
                    <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                      {displayStats.dfmSuggestions.map((s, i) => (
                        <li key={i} style={{
                          fontSize: 11, color: 'var(--nx-text-2)', lineHeight: 1.6,
                          marginBottom: 4, listStyle: 'disc',
                        }}>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            );
          })()}

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
            {onGeometryLoad && (
              <button
                disabled={isLoadingGeo}
                onClick={async () => {
                  if (!fileRef.current || !fileName) return;
                  setIsLoadingGeo(true);
                  try {
                    onGeometryLoad(fileRef.current, fileName);
                  } finally {
                    setIsLoadingGeo(false);
                  }
                }}
                style={{
                  width: '100%', padding: '9px 0', borderRadius: 8,
                  border: 'none', background: isLoadingGeo ? 'var(--nx-panel-2)' : 'var(--nx-ok)',
                  color: isLoadingGeo ? 'var(--nx-text-2)' : 'var(--nx-text)',
                  fontSize: 13, fontWeight: 700,
                  cursor: isLoadingGeo ? 'default' : 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!isLoadingGeo) (e.currentTarget as HTMLButtonElement).style.background = '#56d364'; }}
                onMouseLeave={e => { if (!isLoadingGeo) (e.currentTarget as HTMLButtonElement).style.background = 'var(--nx-ok)'; }}
              >
                {isLoadingGeo ? T.loadingGeo : T.loadViewport}
              </button>
            )}
            <button
              onClick={() => onAnalysisComplete(result)}
              style={{
                width: '100%', padding: '9px 0', borderRadius: 8,
                border: 'none', background: 'var(--nx-accent)',
                color: 'var(--nx-text)', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--nx-accent-2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--nx-accent)'; }}
            >
              {T.applyDesign}
            </button>
          </div>

          {/* Reverse Engineering Analysis */}
          {result.geometry && (
            <div style={{ marginTop: 12 }}>
              <StepReversePanel
                geometry={result.geometry}
                lang={lang}
                visible
              />
            </div>
          )}
        </div>
      )}

    </div>
  );
}
