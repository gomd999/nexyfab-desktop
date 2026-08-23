'use client';

type SectionGaugeLocale = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export type SectionGaugeDimension = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
};

export type ArchitectureInteriorSectionGaugePanelProps = {
  lang: string;
  kind: 'building' | 'interior';
  widthMm: number;
  depthMm: number;
  heightMm: number;
  dimensions: readonly SectionGaugeDimension[];
  onDimensionChange: (id: string, value: number) => void;
};

const COPY: Record<SectionGaugeLocale, {
  title: string;
  section: string;
  envelope: string;
  width: string;
  depth: string;
  height: string;
  gauge: string;
  current: string;
  minimum: string;
  maximum: string;
  edit: string;
}> = {
  ko: { title: '단면·치수 게이지', section: '개념 단면', envelope: '현재 치수로 표시한 개념 외곽선', width: '폭', depth: '깊이', height: '높이', gauge: '치수 게이지', current: '현재', minimum: '최소', maximum: '최대', edit: '치수 편집' },
  en: { title: 'Section & dimension gauges', section: 'Concept section', envelope: 'Concept envelope from the visible dimensions', width: 'Width', depth: 'Depth', height: 'Height', gauge: 'Dimension gauges', current: 'Current', minimum: 'Minimum', maximum: 'Maximum', edit: 'Edit dimension' },
  ja: { title: '断面・寸法ゲージ', section: 'コンセプト断面', envelope: '表示中の寸法から作成したコンセプト外形', width: '幅', depth: '奥行き', height: '高さ', gauge: '寸法ゲージ', current: '現在', minimum: '最小', maximum: '最大', edit: '寸法を編集' },
  zh: { title: '剖面与尺寸仪表', section: '概念剖面', envelope: '根据当前可见尺寸显示的概念外轮廓', width: '宽度', depth: '深度', height: '高度', gauge: '尺寸仪表', current: '当前', minimum: '最小', maximum: '最大', edit: '编辑尺寸' },
  es: { title: 'Sección y medidores de dimensiones', section: 'Sección conceptual', envelope: 'Envolvente conceptual con las dimensiones visibles', width: 'Ancho', depth: 'Fondo', height: 'Altura', gauge: 'Medidores de dimensiones', current: 'Actual', minimum: 'Mínimo', maximum: 'Máximo', edit: 'Editar dimensión' },
  ar: { title: 'مقطع ومقاييس الأبعاد', section: 'مقطع تصوري', envelope: 'الغلاف التصوري المبني على الأبعاد الظاهرة', width: 'العرض', depth: 'العمق', height: 'الارتفاع', gauge: 'مقاييس الأبعاد', current: 'الحالي', minimum: 'الحد الأدنى', maximum: 'الحد الأقصى', edit: 'تحرير البعد' },
};

function locale(lang: string): SectionGaugeLocale {
  if (lang === 'ko' || lang === 'kr') return 'ko';
  if (lang === 'ja' || lang === 'zh' || lang === 'es' || lang === 'ar') return lang;
  return 'en';
}

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function ArchitectureInteriorSectionGaugePanel({ lang, kind, widthMm, depthMm, heightMm, dimensions, onDimensionChange }: ArchitectureInteriorSectionGaugePanelProps) {
  const t = COPY[locale(lang)];
  const width = Math.max(1, widthMm);
  const height = Math.max(1, heightMm);
  const scale = Math.min(220 / width, 150 / height);
  const rectWidth = Math.max(30, width * scale);
  const rectHeight = Math.max(30, height * scale);
  const rectX = (260 - rectWidth) / 2;
  const rectY = 184 - rectHeight;
  const kindLabel = kind === 'building' ? t.section : t.section;

  return (
    <section dir={locale(lang) === 'ar' ? 'rtl' : 'ltr'} data-testid={`${kind}-section-gauge`} aria-label={t.title} style={{ display: 'grid', gap: 9, marginTop: 10, padding: 10, border: '1px solid var(--nx-border)', borderRadius: 8, background: 'var(--nx-panel)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <b style={{ fontSize: 11 }}>{t.title}</b>
        <small style={{ color: 'var(--nx-text-3)' }}>{kindLabel}</small>
      </div>
      <svg data-testid={`${kind}-section-view`} role="img" aria-label={`${t.section}: ${widthMm} × ${heightMm} mm`} viewBox="0 0 260 210" style={{ width: '100%', height: 190, border: '1px solid var(--nx-border)', borderRadius: 6, background: 'var(--nx-panel-2)' }}>
        <rect x={rectX} y={rectY} width={rectWidth} height={rectHeight} fill="color-mix(in srgb, var(--nx-accent) 12%, transparent)" stroke="var(--nx-accent)" strokeWidth="2" />
        <line x1="20" y1="184" x2="240" y2="184" stroke="var(--nx-text-3)" strokeWidth="1" />
        <line x1={rectX} y1="191" x2={rectX + rectWidth} y2="191" stroke="var(--nx-text-2)" strokeWidth="1" />
        <text x="130" y="207" textAnchor="middle" fill="var(--nx-text-2)" fontSize="9">{t.width}: {widthMm} mm</text>
        <text x={rectX + rectWidth + 5} y={rectY + rectHeight / 2} fill="var(--nx-text-2)" fontSize="9">{t.height}: {heightMm} mm</text>
      </svg>
      <small style={{ color: 'var(--nx-text-3)', lineHeight: 1.4 }}>{t.envelope} · {t.depth}: {depthMm} mm</small>
      <div style={{ display: 'grid', gap: 8 }}>
        <b style={{ fontSize: 10.5 }}>{t.gauge}</b>
        {dimensions.map(dimension => {
          const current = bounded(dimension.value, dimension.min, dimension.max);
          const inputId = `${kind}-section-gauge-${dimension.id}`;
          const rangeId = `${inputId}-range`;
          return (
            <div key={dimension.id} data-testid={`${kind}-gauge-${dimension.id}`} style={{ display: 'grid', gap: 4 }}>
              <label htmlFor={inputId} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 10.5 }}>
                <span>{dimension.label}</span>
                <span>{t.current}: {current} {dimension.unit}</span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 82px', gap: 7, alignItems: 'center' }}>
                <input id={rangeId} aria-label={`${t.edit}: ${dimension.label}`} type="range" min={dimension.min} max={dimension.max} step={dimension.step} value={current} onChange={event => onDimensionChange(dimension.id, bounded(Number(event.target.value), dimension.min, dimension.max))} />
                <input id={inputId} aria-label={`${t.edit}: ${dimension.label}`} type="number" min={dimension.min} max={dimension.max} step={dimension.step} value={current} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onDimensionChange(dimension.id, bounded(next, dimension.min, dimension.max)); }} style={{ width: '100%', height: 28, border: '1px solid var(--nx-border)', borderRadius: 5, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', padding: '0 6px', fontSize: 10.5 }} />
              </div>
              <small style={{ color: 'var(--nx-text-3)' }}>{t.minimum}: {dimension.min} · {t.maximum}: {dimension.max} · {dimension.unit}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
