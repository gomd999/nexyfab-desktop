'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';
import {
  type ProjectionView,
  type DrawingConfig,
  type DrawingResult,
  type DrawingLine,
  type DrawingText,
  type ToleranceSpec,
  type RoughnessSpec,
  generateDrawing,
} from './autoDrawing';

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

type LangKey = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

const T: Record<string, Record<LangKey, string>> = {
  title:        { ko: '자동 도면 생성', en: 'Auto Drawing', ja: '自動図面生成', cn: '自动工程图', es: 'Dibujo Auto', ar: 'رسم تلقائي' },
  views:        { ko: '투영 뷰', en: 'Views', ja: 'ビュー', cn: '视图', es: 'Vistas', ar: 'المناظر' },
  front:        { ko: '정면', en: 'Front', ja: '正面', cn: '正面', es: 'Frontal', ar: 'أمامي' },
  top:          { ko: '평면', en: 'Top', ja: '平面', cn: '顶面', es: 'Superior', ar: 'علوي' },
  right:        { ko: '우측면', en: 'Right', ja: '右側面', cn: '右侧', es: 'Derecha', ar: 'يمين' },
  iso:          { ko: '등각', en: 'Isometric', ja: 'アイソメ', cn: '等轴测', es: 'Isométrica', ar: 'متساوي القياس' },
  scale:        { ko: '축척', en: 'Scale', ja: 'スケール', cn: '比例', es: 'Escala', ar: 'مقياس' },
  paper:        { ko: '용지', en: 'Paper', ja: '用紙', cn: '纸张', es: 'Papel', ar: 'ورقة' },
  dimensions:   { ko: '치수', en: 'Dimensions', ja: '寸法', cn: '尺寸', es: 'Cotas', ar: 'أبعاد' },
  centerlines:  { ko: '중심선', en: 'Centerlines', ja: '中心線', cn: '中心线', es: 'Ejes', ar: 'خطوط المركز' },
  generate:     { ko: '도면 생성', en: 'Generate', ja: '生成', cn: '生成', es: 'Generar', ar: 'توليد' },
  download:     { ko: 'SVG 다운로드', en: 'Download SVG', ja: 'SVGダウンロード', cn: '下载SVG', es: 'Descargar SVG', ar: 'تحميل SVG' },
  printPDF:     { ko: 'PDF 출력', en: 'Print PDF', ja: 'PDF印刷', cn: '打印PDF', es: 'Imprimir PDF', ar: 'طباعة PDF' },
  titleBlock:   { ko: '표제란', en: 'Title Block', ja: '表題欄', cn: '标题栏', es: 'Cuadro título', ar: 'كتلة العنوان' },
  partName:     { ko: '부품명', en: 'Part Name', ja: '部品名', cn: '零件名', es: 'Pieza', ar: 'اسم الجزء' },
  material:     { ko: '재질', en: 'Material', ja: '材質', cn: '材料', es: 'Material', ar: 'مادة' },
  drawnBy:      { ko: '작성자', en: 'Drawn By', ja: '作成者', cn: '绘制人', es: 'Dibujado por', ar: 'رسم بواسطة' },
  date:         { ko: '날짜', en: 'Date', ja: '日付', cn: '日期', es: 'Fecha', ar: 'تاريخ' },
  revision:     { ko: '리비전', en: 'Revision', ja: 'リビジョン', cn: '版本', es: 'Revisión', ar: 'مراجعة' },
  close:        { ko: '닫기', en: 'Close', ja: '閉じる', cn: '关闭', es: 'Cerrar', ar: 'إغلاق' },
  landscape:    { ko: '가로', en: 'Landscape', ja: '横', cn: '横向', es: 'Horizontal', ar: 'أفقي' },
  portrait:     { ko: '세로', en: 'Portrait', ja: '縦', cn: '纵向', es: 'Vertical', ar: 'عمودي' },
  noGeometry:   { ko: '지오메트리 없음', en: 'No geometry', ja: 'ジオメトリなし', cn: '无几何体', es: 'Sin geometría', ar: 'لا هندسة' },
  tolerance:    { ko: '공차', en: 'Tolerance', ja: '公差', cn: '公差', es: 'Tolerancia', ar: 'التسامح' },
  linearTol:    { ko: '치수 공차', en: 'Linear Tol.', ja: '寸法公差', cn: '线性公差', es: 'Tol. lineal', ar: 'تفاوت خطي' },
  angularTol:   { ko: '각도 공차', en: 'Angular Tol.', ja: '角度公差', cn: '角度公差', es: 'Tol. angular', ar: 'تفاوت زاوي' },
  roughness:    { ko: '표면 조도', en: 'Surface Finish', ja: '表面粗さ', cn: '表面粗糙度', es: 'Acabado', ar: 'تشطيب سطحي' },
  raValue:      { ko: 'Ra 값 (µm)', en: 'Ra Value (µm)', ja: 'Ra値 (µm)', cn: 'Ra值 (µm)', es: 'Valor Ra (µm)', ar: 'قيمة Ra (µm)' },
};

function t(key: string, lang: string): string {
  const lk = (lang || 'en') as LangKey;
  return T[key]?.[lk] ?? T[key]?.en ?? key;
}

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
  }, [geometry, selectedViews, scaleVal, paperSize, orientation, showDimensions, showCenterlines, linearTol, angularTol, raValue, tbPartName, tbMaterial, tbDrawnBy, tbDate, tbRevision]);

  const handleDownload = useCallback(() => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgRef.current);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tbPartName || 'drawing'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [tbPartName]);

  const handlePrintPDF = useCallback(() => {
    if (!svgRef.current || !drawing) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgRef.current);
    const isLandscape = drawing.paperWidth > drawing.paperHeight;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${tbPartName || 'Drawing'}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; }
  svg { width: 100vw; height: 100vh; display: block; }
  @media print { @page { size: ${isLandscape ? 'A4 landscape' : 'A4 portrait'}; margin: 0; } }
</style></head><body>${svgStr}
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
</body></html>`;
    const win = window.open('', '_blank', 'width=860,height=620');
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }, [drawing, tbPartName]);

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
      <div style={panelStyle}>
        <div style={headerStyle}>
          <span>{t('title', lang)}</span>
          <button style={closeBtnStyle} onClick={onClose}>x</button>
        </div>
        <div style={{ padding: 32, textAlign: 'center', color: C.textDim }}>{t('noGeometry', lang)}</div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span>{t('title', lang)}</span>
        <button style={closeBtnStyle} onClick={onClose}>x</button>
      </div>

      {/* View selection */}
      <div style={sectionStyle}>
        <span style={labelStyle}>{t('views', lang)}</span>
        <div style={checkboxRow}>
          {ALL_VIEWS.map((v) => (
            <label key={v.key} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selectedViews.has(v.key)}
                onChange={() => toggleView(v.key)}
              />
              {t(v.label, lang)}
            </label>
          ))}
        </div>
      </div>

      {/* Scale / Paper / Orientation */}
      <div style={sectionStyle}>
        <div style={grid3}>
          <div>
            <span style={labelStyle}>{t('scale', lang)}</span>
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
            <span style={labelStyle}>{t('paper', lang)}</span>
            <select value={paperSize} onChange={(e) => setPaperSize(e.target.value as 'A4' | 'A3' | 'A2')} style={selectStyle}>
              <option value="A4">A4</option>
              <option value="A3">A3</option>
              <option value="A2">A2</option>
            </select>
          </div>
          <div>
            <span style={labelStyle}>{t('landscape', lang)} / {t('portrait', lang)}</span>
            <select value={orientation} onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')} style={selectStyle}>
              <option value="landscape">{t('landscape', lang)}</option>
              <option value="portrait">{t('portrait', lang)}</option>
            </select>
          </div>
        </div>

        <div style={{ ...checkboxRow, marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showDimensions} onChange={() => setShowDimensions(!showDimensions)} />
            {t('dimensions', lang)}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={showCenterlines} onChange={() => setShowCenterlines(!showCenterlines)} />
            {t('centerlines', lang)}
          </label>
        </div>
      </div>

      {/* Tolerance & Surface Finish */}
      <div style={sectionStyle}>
        <span style={{ ...labelStyle, fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{t('tolerance', lang)} / {t('roughness', lang)}</span>
        <div style={grid3}>
          <div>
            <span style={labelStyle}>{t('linearTol', lang)}</span>
            <input value={linearTol} onChange={e => setLinearTol(e.target.value)} style={inputStyle} placeholder="±0.1" />
          </div>
          <div>
            <span style={labelStyle}>{t('angularTol', lang)}</span>
            <input value={angularTol} onChange={e => setAngularTol(e.target.value)} style={inputStyle} placeholder="±0°30'" />
          </div>
          <div>
            <span style={labelStyle}>{t('raValue', lang)}</span>
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
        <span style={{ ...labelStyle, fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{t('titleBlock', lang)}</span>
        <div style={gridRow}>
          <div>
            <span style={labelStyle}>{t('partName', lang)}</span>
            <input value={tbPartName} onChange={(e) => setTbPartName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{t('material', lang)}</span>
            <input value={tbMaterial} onChange={(e) => setTbMaterial(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{t('drawnBy', lang)}</span>
            <input value={tbDrawnBy} onChange={(e) => setTbDrawnBy(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <span style={labelStyle}>{t('date', lang)}</span>
            <input type="date" value={tbDate} onChange={(e) => setTbDate(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ ...gridRow, marginTop: 8 }}>
          <div>
            <span style={labelStyle}>{t('revision', lang)}</span>
            <input value={tbRevision} onChange={(e) => setTbRevision(e.target.value)} style={inputStyle} />
          </div>
          <div />
        </div>
      </div>

      {/* Actions */}
      <div style={{ ...sectionStyle, display: 'flex', gap: 8 }}>
        <button style={primaryBtn} onClick={handleGenerate}>{t('generate', lang)}</button>
        {drawing && (
          <>
            <button style={secondaryBtn} onClick={handleDownload}>{t('download', lang)}</button>
            <button style={secondaryBtn} onClick={handlePrintPDF}>🖨️ {t('printPDF', lang)}</button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button style={secondaryBtn} onClick={onClose}>{t('close', lang)}</button>
      </div>

      {/* SVG Preview */}
      {drawing && previewData && (
        <div style={{ padding: 16 }}>
          <svg
            ref={svgRef}
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
                  {t(view.projection, lang)}
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
                  {`일반 공차: 선형 ${drawing.tolerance.linear}  각도 ${drawing.tolerance.angular}`}
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
                {t('material', lang)}: {drawing.titleBlock.material}
              </text>
              <text x={drawing.paperWidth - 53} y={drawing.paperHeight - 20} fontSize={2} fill="#555">
                {t('scale', lang)}: {drawing.titleBlock.scale}
              </text>
              <text x={drawing.paperWidth - 103} y={drawing.paperHeight - 14} fontSize={2} fill="#555">
                {t('drawnBy', lang)}: {drawing.titleBlock.drawnBy}
              </text>
              <text x={drawing.paperWidth - 53} y={drawing.paperHeight - 14} fontSize={2} fill="#555">
                {t('date', lang)}: {drawing.titleBlock.date}
              </text>
              <text x={drawing.paperWidth - 53} y={drawing.paperHeight - 26} fontSize={2} fill="#555">
                Rev: {drawing.titleBlock.revision}
              </text>
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
