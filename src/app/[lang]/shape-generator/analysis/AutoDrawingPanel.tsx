'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import {
  type ProjectionView,
  type DrawingConfig,
  type DrawingResult,
  type DrawingLine,
  type DrawingText,
  type ToleranceSpec,
  type RoughnessSpec,
  computeDrawingGeometryFingerprint,
  generateDrawing,
} from './autoDrawing';
import { DRAWING_TITLE_REVISION_LABEL, exportDrawingPDF, exportDrawingDXF } from './drawingExport';
import { bumpDrawingRevision } from './drawingRevisionPolicy';
import { reportInfo } from '../lib/telemetry';

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  accent: '#388bfd',
  green: '#3fb950',
  red: '#f85149',
  white: '#ffffff',
};

/* ─── i18n ───────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    title: '자동 도면 생성', views: '투영 뷰',
    front: '정면', top: '평면', right: '우측면', iso: '등각',
    scale: '축척', paper: '용지', dimensions: '치수', centerlines: '중심선',
    generate: '도면 생성', download: 'SVG 다운로드', printPDF: 'PDF 다운로드', downloadDXF: 'DXF 다운로드',
    titleBlock: '표제란', partName: '부품명', material: '재질', drawnBy: '작성자', date: '날짜', revision: '리비전',
    close: '닫기', landscape: '가로', portrait: '세로', noGeometry: '지오메트리 없음',
    tolerance: '공차', linearTol: '치수 공차', angularTol: '각도 공차', roughness: '표면 조도', raValue: 'Ra 값 (µm)',
    presets: '프리셋', presetPrec: '정밀', presetStd: '표준', presetRough: '거침',
    hintPrecision: '정밀 가공 (CNC, 비용 1.5~2배)',
    hintStandard: '일반 기계 가공 표준',
    hintRough: '판금/주물·저비용',
    pdfExportFail: 'PDF 내보내기 실패',
    dxfExportFail: 'DXF 내보내기 실패',
    generalTol: '일반 공차',
    linearLabel: '선형',
    angleLabel: '각도',
    drawingStaleHint: '3D 모델이 도면 생성 이후 바뀌었습니다. 다시 생성하면 최신 형상에 맞춥니다.',
    exportNeedsRegen: '도면이 최신 3D와 맞지 않습니다. 먼저「도면 생성」을 누르세요.',
    bumpRevision: '리비전 올리기',
    bumpRevisionTitle: '표제란 리비전만 증가합니다. 이후「도면 생성」으로 형상을 반영하세요.',
  },
  en: {
    title: 'Auto Drawing', views: 'Views',
    front: 'Front', top: 'Top', right: 'Right', iso: 'Isometric',
    scale: 'Scale', paper: 'Paper', dimensions: 'Dimensions', centerlines: 'Centerlines',
    generate: 'Generate', download: 'Download SVG', printPDF: 'Download PDF', downloadDXF: 'Download DXF',
    titleBlock: 'Title Block', partName: 'Part Name', material: 'Material', drawnBy: 'Drawn By', date: 'Date', revision: 'Revision',
    close: 'Close', landscape: 'Landscape', portrait: 'Portrait', noGeometry: 'No geometry',
    tolerance: 'Tolerance', linearTol: 'Linear Tol.', angularTol: 'Angular Tol.', roughness: 'Surface Finish', raValue: 'Ra Value (µm)',
    presets: 'Preset', presetPrec: 'Precision', presetStd: 'Standard', presetRough: 'Rough',
    hintPrecision: 'Tight CNC tolerance (1.5-2x cost)',
    hintStandard: 'Typical machining standard',
    hintRough: 'Sheet / cast — low cost',
    pdfExportFail: 'PDF export failed',
    dxfExportFail: 'DXF export failed',
    generalTol: 'General Tolerance',
    linearLabel: 'Linear',
    angleLabel: 'Angular',
    drawingStaleHint: 'The 3D model changed after this drawing was generated. Click Generate to refresh.',
    exportNeedsRegen: 'Drawing is out of date with the 3D model. Click Generate before exporting.',
    bumpRevision: 'Bump revision',
    bumpRevisionTitle: 'Increments the title-block revision only — click Generate to refresh views from the latest 3D.',
  },
  ja: {
    title: '自動図面生成', views: 'ビュー',
    front: '正面', top: '平面', right: '右側面', iso: 'アイソメ',
    scale: 'スケール', paper: '用紙', dimensions: '寸法', centerlines: '中心線',
    generate: '生成', download: 'SVGダウンロード', printPDF: 'PDFダウンロード', downloadDXF: 'DXFダウンロード',
    titleBlock: '表題欄', partName: '部品名', material: '材質', drawnBy: '作成者', date: '日付', revision: 'リビジョン',
    close: '閉じる', landscape: '横', portrait: '縦', noGeometry: 'ジオメトリなし',
    tolerance: '公差', linearTol: '寸法公差', angularTol: '角度公差', roughness: '表面粗さ', raValue: 'Ra値 (µm)',
    presets: 'プリセット', presetPrec: '精密', presetStd: '標準', presetRough: '粗',
    hintPrecision: '精密加工 (CNC、コスト1.5～2倍)',
    hintStandard: '一般的な機械加工標準',
    hintRough: '板金/鋳物・低コスト',
    pdfExportFail: 'PDFエクスポート失敗',
    dxfExportFail: 'DXFエクスポート失敗',
    generalTol: '一般公差',
    linearLabel: '線形',
    angleLabel: '角度',
    drawingStaleHint: '図面生成後に3Dモデルが変更されました。「生成」で最新に合わせてください。',
    exportNeedsRegen: '図面が3Dと一致しません。エクスポート前に「生成」してください。',
    bumpRevision: 'リビジョンを上げる',
    bumpRevisionTitle: '表題欄のリビジョンのみ進めます。その後「生成」で3Dを反映してください。',
  },
  zh: {
    title: '自动工程图', views: '视图',
    front: '正面', top: '顶面', right: '右侧', iso: '等轴测',
    scale: '比例', paper: '纸张', dimensions: '尺寸', centerlines: '中心线',
    generate: '生成', download: '下载SVG', printPDF: '下载PDF', downloadDXF: '下载DXF',
    titleBlock: '标题栏', partName: '零件名', material: '材料', drawnBy: '绘制人', date: '日期', revision: '版本',
    close: '关闭', landscape: '横向', portrait: '纵向', noGeometry: '无几何体',
    tolerance: '公差', linearTol: '线性公差', angularTol: '角度公差', roughness: '表面粗糙度', raValue: 'Ra值 (µm)',
    presets: '预设', presetPrec: '精密', presetStd: '标准', presetRough: '粗加工',
    hintPrecision: '精密加工 (CNC, 成本1.5~2倍)',
    hintStandard: '常规机加工标准',
    hintRough: '钣金/铸造 · 低成本',
    pdfExportFail: 'PDF导出失败',
    dxfExportFail: 'DXF导出失败',
    generalTol: '一般公差',
    linearLabel: '线性',
    angleLabel: '角度',
    drawingStaleHint: '生成图纸后三维模型已更改。请点击「生成」以匹配最新几何。',
    exportNeedsRegen: '图纸与三维不同步。导出前请先点击「生成」。',
    bumpRevision: '提升版本',
    bumpRevisionTitle: '仅递增标题栏版本号；请点击「生成」以反映最新三维模型。',
  },
  es: {
    title: 'Dibujo Auto', views: 'Vistas',
    front: 'Frontal', top: 'Superior', right: 'Derecha', iso: 'Isométrica',
    scale: 'Escala', paper: 'Papel', dimensions: 'Cotas', centerlines: 'Ejes',
    generate: 'Generar', download: 'Descargar SVG', printPDF: 'Descargar PDF', downloadDXF: 'Descargar DXF',
    titleBlock: 'Cuadro título', partName: 'Pieza', material: 'Material', drawnBy: 'Dibujado por', date: 'Fecha', revision: 'Revisión',
    close: 'Cerrar', landscape: 'Horizontal', portrait: 'Vertical', noGeometry: 'Sin geometría',
    tolerance: 'Tolerancia', linearTol: 'Tol. lineal', angularTol: 'Tol. angular', roughness: 'Acabado', raValue: 'Valor Ra (µm)',
    presets: 'Preset', presetPrec: 'Precisión', presetStd: 'Estándar', presetRough: 'Basto',
    hintPrecision: 'Tolerancia CNC estrecha (coste 1.5-2x)',
    hintStandard: 'Estándar de mecanizado típico',
    hintRough: 'Chapa/fundición — bajo coste',
    pdfExportFail: 'Fallo al exportar PDF',
    dxfExportFail: 'Fallo al exportar DXF',
    generalTol: 'Tolerancia general',
    linearLabel: 'Lineal',
    angleLabel: 'Angular',
    drawingStaleHint: 'El modelo 3D cambió después de generar el dibujo. Pulse Generar para actualizar.',
    exportNeedsRegen: 'El dibujo no coincide con el 3D. Pulse Generar antes de exportar.',
    bumpRevision: 'Subir revisión',
    bumpRevisionTitle: 'Solo incrementa la revisión del cartucho; pulse Generar para actualizar la geometría 3D.',
  },
  ar: {
    title: 'رسم تلقائي', views: 'المناظر',
    front: 'أمامي', top: 'علوي', right: 'يمين', iso: 'متساوي القياس',
    scale: 'مقياس', paper: 'ورقة', dimensions: 'أبعاد', centerlines: 'خطوط المركز',
    generate: 'توليد', download: 'تحميل SVG', printPDF: 'تحميل PDF', downloadDXF: 'تحميل DXF',
    titleBlock: 'كتلة العنوان', partName: 'اسم الجزء', material: 'مادة', drawnBy: 'رسم بواسطة', date: 'تاريخ', revision: 'مراجعة',
    close: 'إغلاق', landscape: 'أفقي', portrait: 'عمودي', noGeometry: 'لا هندسة',
    tolerance: 'التسامح', linearTol: 'تفاوت خطي', angularTol: 'تفاوت زاوي', roughness: 'تشطيب سطحي', raValue: 'قيمة Ra (µm)',
    presets: 'إعداد', presetPrec: 'دقيق', presetStd: 'قياسي', presetRough: 'خشن',
    hintPrecision: 'تفاوت CNC ضيق (تكلفة 1.5-2×)',
    hintStandard: 'معيار تصنيع نموذجي',
    hintRough: 'صفائح/سباكة — تكلفة منخفضة',
    pdfExportFail: 'فشل تصدير PDF',
    dxfExportFail: 'فشل تصدير DXF',
    generalTol: 'التسامح العام',
    linearLabel: 'خطي',
    angleLabel: 'زاوي',
    drawingStaleHint: 'تغيّر النموذج ثلاثي الأبعاد بعد إنشاء الرسم. اضغط «توليد» للتحديث.',
    exportNeedsRegen: 'الرسم غير متزامن مع النموذج ثلاثي الأبعاد. اضغط «توليد» قبل التصدير.',
    bumpRevision: 'رفع المراجعة',
    bumpRevisionTitle: 'يزيد رقم المراجعة في كتلة العنوان فقط — اضغط «توليد» لمزامنة الشكل ثلاثي الأبعاد.',
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

/* ─── Tolerance / surface-finish presets ────────────────────────────────── */

interface TolPreset {
  id: 'precision' | 'standard' | 'rough';
  linear: string;
  angular: string;
  ra: number;
  costMult: number;          // relative cost multiplier vs. standard
  hintKey: 'hintPrecision' | 'hintStandard' | 'hintRough';
}

const TOL_PRESETS: TolPreset[] = [
  { id: 'precision', linear: '±0.05', angular: "±0°15'", ra: 1.6,  costMult: 1.6, hintKey: 'hintPrecision' },
  { id: 'standard',  linear: '±0.1',  angular: "±0°30'", ra: 3.2,  costMult: 1.0, hintKey: 'hintStandard' },
  { id: 'rough',     linear: '±0.3',  angular: "±1°",    ra: 12.5, costMult: 0.7, hintKey: 'hintRough' },
];

/* ─── Props ──────────────────────────────────────────────────────────────── */

interface AutoDrawingPanelProps {
  lang: string;
  geometry: THREE.BufferGeometry | null;
  partName: string;
  material: string;
  onClose: () => void;
}

/* ─── View checkboxes ────────────────────────────────────────────────────── */

const ALL_VIEWS: { key: ProjectionView; label: string }[] = [
  { key: 'front', label: 'front' },
  { key: 'top', label: 'top' },
  { key: 'right', label: 'right' },
  { key: 'iso', label: 'iso' },
];

/* ─── SVG rendering helpers ──────────────────────────────────────────────── */

function lineStrokeProps(lineType: DrawingLine['type']): React.SVGProps<SVGLineElement> {
  switch (lineType) {
    case 'visible':
      return { stroke: '#000', strokeWidth: 0.5 };
    case 'hidden':
      return { stroke: '#000', strokeWidth: 0.3, strokeDasharray: '2 1' };
    case 'center':
      return { stroke: '#0066cc', strokeWidth: 0.2, strokeDasharray: '6 2 1 2' };
    case 'dimension':
      return { stroke: '#cc0000', strokeWidth: 0.2 };
    default:
      return { stroke: '#000', strokeWidth: 0.3 };
  }
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function AutoDrawingPanel({
  lang,
  geometry,
  partName,
  material,
  onClose,
}: AutoDrawingPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const tt = dict[langMap[seg] ?? (langMap[lang] ?? 'en')];
  const svgRef = useRef<SVGSVGElement>(null);

  // View selection
  const [selectedViews, setSelectedViews] = useState<Set<ProjectionView>>(
    new Set<ProjectionView>(['front', 'top', 'right']),
  );
  const [scaleVal, setScaleVal] = useState(1);
  const [paperSize, setPaperSize] = useState<'A4' | 'A3' | 'A2'>('A4');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [showDimensions, setShowDimensions] = useState(true);
  const [showCenterlines, setShowCenterlines] = useState(true);

  // Title block
  const [tbPartName, setTbPartName] = useState(partName || '');
  const [tbMaterial, setTbMaterial] = useState(material || '');
  const [tbDrawnBy, setTbDrawnBy] = useState('');
  const [tbDate, setTbDate] = useState(new Date().toISOString().slice(0, 10));
  const [tbRevision, setTbRevision] = useState('A');

  // Tolerance & surface finish
  const [linearTol, setLinearTol] = useState('±0.1');
  const [angularTol, setAngularTol] = useState("±0°30'");
  const [raValue, setRaValue] = useState(3.2);

  // Drawing result
  const [drawing, setDrawing] = useState<DrawingResult | null>(null);
  /** `computeDrawingGeometryFingerprint` at last successful Generate — mismatch ⇒ stale preview */
  const [fpAtLastGenerate, setFpAtLastGenerate] = useState<string | null>(null);

  const toggleView = useCallback((v: ProjectionView) => {
    setSelectedViews((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }, []);

  const handleGenerate = useCallback(() => {
    if (!geometry) return;
    const config: DrawingConfig = {
      views: Array.from(selectedViews),
      scale: scaleVal,
      paperSize,
      orientation,
      showDimensions,
      showCenterlines,
      tolerance: { linear: linearTol, angular: angularTol },
      roughness: [{ ra: raValue, nx: 0.85, ny: 0.15 }],
      titleBlock: {
        partName: tbPartName,
        material: tbMaterial,
        drawnBy: tbDrawnBy,
        date: tbDate,
        scale: `${scaleVal}:1`,
        revision: tbRevision,
      },
    };
    const result = generateDrawing(geometry, config);
    setDrawing(result);
    setFpAtLastGenerate(computeDrawingGeometryFingerprint(geometry));
  }, [geometry, selectedViews, scaleVal, paperSize, orientation, showDimensions, showCenterlines, linearTol, angularTol, raValue, tbPartName, tbMaterial, tbDrawnBy, tbDate, tbRevision]);

  const currentFp = geometry ? computeDrawingGeometryFingerprint(geometry) : null;
  const drawingStale =
    Boolean(drawing && fpAtLastGenerate && currentFp && currentFp !== fpAtLastGenerate);

  const handleDownload = useCallback(() => {
    void (async () => {
      if (drawingStale) return;
      if (!svgRef.current) return;
      const { downloadBlob } = await import('@/lib/platform');
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svgRef.current);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      await downloadBlob(`${tbPartName || 'drawing'}.svg`, blob);
      reportInfo('drawing_export', 'svg_export', { format: 'svg', partName: tbPartName || 'drawing' });
    })();
  }, [tbPartName, drawingStale]);

  const handlePrintPDF = useCallback(async () => {
    if (!drawing || drawingStale) return;
    try {
      await exportDrawingPDF(drawing, tbPartName || 'drawing');
      reportInfo('drawing_export', 'pdf_export', { format: 'pdf', partName: tbPartName || 'drawing' });
    }
    catch (e) { console.error('PDF export failed', e); alert(tt.pdfExportFail); }
  }, [drawing, drawingStale, tbPartName, tt]);

  const handleDownloadDXF = useCallback(() => {
    void (async () => {
      if (!drawing || drawingStale) return;
      try {
        await exportDrawingDXF(drawing, tbPartName || 'drawing');
        reportInfo('drawing_export', 'dxf_export', { format: 'dxf', partName: tbPartName || 'drawing' });
      }
      catch (e) { console.error('DXF export failed', e); alert(tt.dxfExportFail); }
    })();
  }, [drawing, drawingStale, tbPartName, tt]);

  // Compute SVG preview scale to fit panel
  const previewData = useMemo(() => {
    if (!drawing) return null;
    const svgW = 660;
    const aspect = drawing.paperHeight / drawing.paperWidth;
    const svgH = svgW * aspect;
    const sx = svgW / drawing.paperWidth;
    const sy = svgH / drawing.paperHeight;
    return { svgW, svgH, sx, sy };
  }, [drawing]);

  /* ─── Styles ─ */
  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: 60,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 700,
    maxWidth: '90vw',
    maxHeight: 'calc(100vh - 80px)',
    overflowY: 'auto',
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    zIndex: 900,
    color: C.text,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    boxShadow: '0 8px 32px rgba(0,0,0,.6)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: `1px solid ${C.border}`,
    fontWeight: 600,
    fontSize: 15,
  };

  const sectionStyle: React.CSSProperties = {
    padding: '10px 16px',
    borderBottom: `1px solid ${C.border}`,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: C.textDim,
    marginBottom: 4,
    display: 'block',
  };

  const inputStyle: React.CSSProperties = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    color: C.text,
    padding: '4px 8px',
    fontSize: 12,
    width: '100%',
    boxSizing: 'border-box',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
  };

  const btnStyle: React.CSSProperties = {
    padding: '6px 14px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 12,
  };

  const primaryBtn: React.CSSProperties = {
    ...btnStyle,
    background: C.accent,
    color: '#fff',
  };

  const secondaryBtn: React.CSSProperties = {
    ...btnStyle,
    background: C.card,
    color: C.text,
    border: `1px solid ${C.border}`,
  };

  const exportBlocked = Boolean(drawing && drawingStale);
  const exportBtnStyle: React.CSSProperties = exportBlocked
    ? { ...secondaryBtn, opacity: 0.45, cursor: 'not-allowed' }
    : secondaryBtn;

  const closeBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: C.textDim,
    cursor: 'pointer',
    fontSize: 18,
    lineHeight: 1,
  };

  const checkboxRow: React.CSSProperties = {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 4,
  };

  const gridRow: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginTop: 4,
  };

  const grid3: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 8,
    marginTop: 4,
  };

  if (!geometry) {
    return (
      <div style={panelStyle} data-testid="auto-drawing-panel">
        <div style={headerStyle}>
          <span>{tt.title}</span>
          <button style={closeBtnStyle} onClick={onClose}>x</button>
        </div>
        <div data-testid="auto-drawing-empty" style={{ padding: 32, textAlign: 'center', color: C.textDim }}>{tt.noGeometry}</div>
      </div>
    );
  }

  return (
    <div style={panelStyle} data-testid="auto-drawing-panel">
      {/* Header */}
      <div style={headerStyle}>
        <span>{tt.title}</span>
        <button style={closeBtnStyle} onClick={onClose}>x</button>
      </div>

      {/* View selection */}
      <div style={sectionStyle}>
        <span style={labelStyle}>{tt.views}</span>
        <div style={checkboxRow}>
          {ALL_VIEWS.map((v) => (
            <label key={v.key} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selectedViews.has(v.key)}
                onChange={() => toggleView(v.key)}
              />
              {tt[v.label as 'front' | 'top' | 'right' | 'iso']}
            </label>
          ))}
        </div>
      </div>

      {/* Scale / Paper / Orientation */}
      <div style={sectionStyle}>
        <div style={grid3}>
          <div>
            <span style={labelStyle}>{tt.scale}</span>
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={scaleVal}
              onChange={(e) => setScaleVal(parseFloat(e.target.value) || 1)}
              style={inputStyle}
            />
          </div>
          <div>
            <span style={labelStyle}>{tt.paper}</span>
            <select value={paperSize} onChange={(e) => setPaperSize(e.target.value as 'A4' | 'A3' | 'A2')} style={selectStyle}>
              <option value="A4">A4</option>
              <option value="A3">A3</option>
              <option value="A2">A2</option>
            </select>
          </div>
          <div>
            <span style={labelStyle}>{tt.landscape} / {tt.portrait}</span>
            <select value={orientation} onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')} style={selectStyle}>
              <option value="landscape">{tt.landscape}</option>
              <option value="portrait">{tt.portrait}</option>
            </select>
          </div>
        </div>

        <div style={{ ...checkboxRow, marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showDimensions} onChange={() => setShowDimensions(!showDimensions)} />
            {tt.dimensions}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showCenterlines} onChange={() => setShowCenterlines(!showCenterlines)} />
            {tt.centerlines}
          </label>
        </div>
      </div>

      {/* Tolerance & Surface Finish */}
      <div style={sectionStyle}>
        <span style={{ ...labelStyle, fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{tt.tolerance} / {tt.roughness}</span>

        {/* Preset chips — one click sets matching linear/angular/Ra together */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: '#8b949e', fontWeight: 600 }}>{tt.presets}:</span>
          {TOL_PRESETS.map(p => {
            const active = linearTol === p.linear && angularTol === p.angular && raValue === p.ra;
            const labelKey = p.id === 'precision' ? 'presetPrec' : p.id === 'standard' ? 'presetStd' : 'presetRough';
            const hint = tt[p.hintKey];
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setLinearTol(p.linear); setAngularTol(p.angular); setRaValue(p.ra); }}
                title={`${hint}\n${p.linear} / ${p.angular} / Ra ${p.ra}`}
                style={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: '3px 8px',
                  borderRadius: 6,
                  fontSize: 10,
                  lineHeight: 1.3,
                  cursor: 'pointer',
                  border: active ? '1px solid #58a6ff' : '1px solid #30363d',
                  background: active ? 'rgba(56,139,253,0.15)' : '#0d1117',
                  color: active ? '#58a6ff' : '#c9d1d9',
                  transition: 'all 0.1s',
                }}
              >
                <span style={{ fontWeight: 700 }}>{tt[labelKey]}</span>
                <span style={{ fontSize: 9, color: active ? '#58a6ff' : '#6e7681', fontFamily: 'monospace' }}>
                  {p.linear} · Ra{p.ra}
                </span>
              </button>
            );
          })}
        </div>

        <div style={grid3}>
          <div>
            <span style={labelStyle}>{tt.linearTol}</span>
            <input value={linearTol} onChange={e => setLinearTol(e.target.value)} style={inputStyle} placeholder="±0.1" />
          </div>
          <div>
            <span style={labelStyle}>{tt.angularTol}</span>
            <input value={angularTol} onChange={e => setAngularTol(e.target.value)} style={inputStyle} placeholder="±0°30'" />
          </div>
          <div>
            <span style={labelStyle}>{tt.raValue}</span>
            <select value={raValue} onChange={e => setRaValue(Number(e.target.value))} style={selectStyle}>
              {[0.4, 0.8, 1.6, 3.2, 6.3, 12.5, 25].map(v => (
                <option key={v} value={v}>Ra {v}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Title block fields */}
      <div style={sectionStyle}>
        <span style={{ ...labelStyle, fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{tt.titleBlock}</span>
        <div style={gridRow}>
          <div>
            <span style={labelStyle}>{tt.partName}</span>
            <input value={tbPartName} onChange={(e) => setTbPartName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{tt.material}</span>
            <input value={tbMaterial} onChange={(e) => setTbMaterial(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{tt.drawnBy}</span>
            <input value={tbDrawnBy} onChange={(e) => setTbDrawnBy(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{tt.date}</span>
            <input type="date" value={tbDate} onChange={(e) => setTbDate(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ ...gridRow, marginTop: 8 }}>
          <div>
            <span style={labelStyle}>{tt.revision}</span>
            <input value={tbRevision} onChange={(e) => setTbRevision(e.target.value)} style={inputStyle} />
          </div>
          <div />
        </div>
      </div>

      {drawingStale && (
        <div
          data-testid="auto-drawing-stale-banner"
          style={{
            padding: '10px 16px',
            background: 'rgba(240,136,62,0.12)',
            borderBottom: `1px solid ${C.border}`,
            fontSize: 12,
            color: '#f0883e',
            lineHeight: 1.45,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
          role="status"
        >
          <span style={{ flex: '1 1 200px' }}>{tt.drawingStaleHint}</span>
          <button
            type="button"
            title={tt.bumpRevisionTitle}
            onClick={() => setTbRevision(bumpDrawingRevision(tbRevision))}
            style={{
              flexShrink: 0,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #f0883e',
              background: 'rgba(240,136,62,0.2)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {tt.bumpRevision}
          </button>
        </div>
      )}

      {/* Actions */}
      <div style={{ ...sectionStyle, display: 'flex', gap: 8 }}>
        <button type="button" data-testid="auto-drawing-generate" style={primaryBtn} onClick={handleGenerate}>{tt.generate}</button>
        {drawing && (
          <>
            <button
              type="button"
              data-testid="auto-drawing-export-svg"
              disabled={exportBlocked}
              title={exportBlocked ? tt.exportNeedsRegen : undefined}
              style={exportBtnStyle}
              onClick={handleDownload}
            >
              {tt.download}
            </button>
            <button
              type="button"
              data-testid="auto-drawing-export-pdf"
              disabled={exportBlocked}
              title={exportBlocked ? tt.exportNeedsRegen : undefined}
              style={exportBtnStyle}
              onClick={handlePrintPDF}
            >
              📄 {tt.printPDF}
            </button>
            <button
              type="button"
              data-testid="auto-drawing-export-dxf"
              disabled={exportBlocked}
              title={exportBlocked ? tt.exportNeedsRegen : undefined}
              style={exportBtnStyle}
              onClick={handleDownloadDXF}
            >
              📐 {tt.downloadDXF}
            </button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button style={secondaryBtn} onClick={onClose}>{tt.close}</button>
      </div>

      {/* SVG Preview */}
      {drawing && previewData && (
        <div style={{ padding: 16 }}>
          <svg
            ref={svgRef}
            data-testid="auto-drawing-preview-svg"
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${drawing.paperWidth} ${drawing.paperHeight}`}
            width={previewData.svgW}
            height={previewData.svgH}
            style={{ background: C.white, borderRadius: 4, display: 'block', margin: '0 auto' }}
          >
            {/* Border frame */}
            <rect
              x={5}
              y={5}
              width={drawing.paperWidth - 10}
              height={drawing.paperHeight - 10}
              fill="none"
              stroke="#000"
              strokeWidth={0.5}
            />

            {/* Projected views */}
            {drawing.views.map((view, vi) => (
              <g key={vi} transform={`translate(${view.position.x}, ${view.position.y})`}>
                {/* View label */}
                <text x={view.width / 2} y={-3} textAnchor="middle" fontSize={3} fill="#555">
                  {tt[view.projection as 'front' | 'top' | 'right' | 'iso']}
                </text>
                {/* Drawing lines (flip Y for SVG coordinate system) */}
                {view.lines.map((line, li) => (
                  <line
                    key={li}
                    x1={line.x1}
                    y1={view.height - line.y1}
                    x2={line.x2}
                    y2={view.height - line.y2}
                    {...lineStrokeProps(line.type)}
                  />
                ))}
                {/* Dimension texts & annotations */}
                {view.texts && view.texts.map((tx, ti) => {
                  const textColor = tx.style === 'dimension' ? '#cc0000' : tx.style === 'roughness' ? '#6600aa' : '#333';
                  const transform = tx.rotate
                    ? `translate(${tx.x},${view.height - tx.y}) rotate(${tx.rotate})`
                    : `translate(${tx.x},${view.height - tx.y})`;
                  return (
                    <text
                      key={ti}
                      transform={transform}
                      textAnchor={tx.anchor}
                      fontSize={tx.fontSize}
                      fill={textColor}
                      fontFamily="monospace"
                    >
                      {tx.text}
                    </text>
                  );
                })}
              </g>
            ))}
            {/* General tolerance block — bottom-left of drawing */}
            {drawing.tolerance && (
              <g transform={`translate(5, ${drawing.paperHeight - 28})`}>
                <text fontSize={2} fill="#333" fontFamily="monospace">
                  {`${tt.generalTol}: ${tt.linearLabel} ${drawing.tolerance.linear}  ${tt.angleLabel} ${drawing.tolerance.angular}`}
                </text>
              </g>
            )}

            {/* Title block */}
            <g>
              {/* Title block border */}
              <rect
                x={drawing.paperWidth - 100 - 5}
                y={drawing.paperHeight - 25 - 5}
                width={100}
                height={25}
                fill="none"
                stroke="#000"
                strokeWidth={0.4}
              />
              {/* Horizontal divider lines */}
              <line
                x1={drawing.paperWidth - 105}
                y1={drawing.paperHeight - 25}
                x2={drawing.paperWidth - 5}
                y2={drawing.paperHeight - 25}
                stroke="#000"
                strokeWidth={0.2}
              />
              <line
                x1={drawing.paperWidth - 105}
                y1={drawing.paperHeight - 18}
                x2={drawing.paperWidth - 5}
                y2={drawing.paperHeight - 18}
                stroke="#000"
                strokeWidth={0.2}
              />
              {/* Vertical divider */}
              <line
                x1={drawing.paperWidth - 55}
                y1={drawing.paperHeight - 30}
                x2={drawing.paperWidth - 55}
                y2={drawing.paperHeight - 10}
                stroke="#000"
                strokeWidth={0.2}
              />
              {/* Title block text */}
              <text x={drawing.paperWidth - 103} y={drawing.paperHeight - 26} fontSize={2.5} fill="#333">
                {drawing.titleBlock.partName}
              </text>
              <text x={drawing.paperWidth - 103} y={drawing.paperHeight - 20} fontSize={2} fill="#555">
                {tt.material}: {drawing.titleBlock.material}
              </text>
              <text x={drawing.paperWidth - 53} y={drawing.paperHeight - 20} fontSize={2} fill="#555">
                {tt.scale}: {drawing.titleBlock.scale}
              </text>
              <text x={drawing.paperWidth - 103} y={drawing.paperHeight - 14} fontSize={2} fill="#555">
                {tt.drawnBy}: {drawing.titleBlock.drawnBy}
              </text>
              <text x={drawing.paperWidth - 53} y={drawing.paperHeight - 14} fontSize={2} fill="#555">
                {tt.date}: {drawing.titleBlock.date}
              </text>
              <text x={drawing.paperWidth - 53} y={drawing.paperHeight - 26} fontSize={2} fill="#555">
                {DRAWING_TITLE_REVISION_LABEL}: {drawing.titleBlock.revision}
              </text>
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
