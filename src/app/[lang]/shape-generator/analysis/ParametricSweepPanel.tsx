'use client';
import React, { useState, useMemo, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  runParametricSweep,
  computeSensitivity,
  type SweepParam,
  type SweepObjective,
  type SweepResult,
  type SensitivityEntry,
} from './parametricSweep';

/* ── i18n ──────────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    title: '매개변수 탐색',
    addParam: '매개변수 추가',
    steps: '단계',
    objective: '목적함수',
    run: '실행',
    results: '결과',
    best: '최적',
    sensitivity: '민감도',
    apply: '최적값 적용',
    volume: '체적',
    surfaceArea: '표면적',
    mass: '질량',
    maxStress: '최대응력',
    close: '닫기',
    running: '실행 중...',
    noParams: '탐색할 매개변수를 추가하세요',
    rank: '순위',
    value: '값',
    min: '최소',
    max: '최대',
    combo: '조합',
    heatmap: '히트맵',
    pareto: '파레토',
    heatmapNote: '히트맵을 보려면 정확히 2개의 매개변수를 선택하세요',
    primary: '주 목적',
    secondary: '부 목적',
    dominant: '파레토 최적',
    dominated: '열세',
  },
  en: {
    title: 'Parametric Sweep',
    addParam: 'Add Parameter',
    steps: 'Steps',
    objective: 'Objective',
    run: 'Run',
    results: 'Results',
    best: 'Best',
    sensitivity: 'Sensitivity',
    apply: 'Apply Best',
    volume: 'Volume',
    surfaceArea: 'Surface Area',
    mass: 'Mass',
    maxStress: 'Max Stress',
    close: 'Close',
    running: 'Running...',
    noParams: 'Add parameters to sweep',
    rank: 'Rank',
    value: 'Value',
    min: 'Min',
    max: 'Max',
    combo: 'Combination',
    heatmap: 'Heatmap',
    pareto: 'Pareto',
    heatmapNote: 'Select exactly 2 parameters to see heatmap',
    primary: 'Primary',
    secondary: 'Secondary',
    dominant: 'Pareto Optimal',
    dominated: 'Dominated',
  },
  ja: {
    title: 'パラメトリックスイープ',
    addParam: 'パラメータ追加',
    steps: 'ステップ',
    objective: '目的関数',
    run: '実行',
    results: '結果',
    best: '最適',
    sensitivity: '感度',
    apply: '最適値を適用',
    volume: '体積',
    surfaceArea: '表面積',
    mass: '質量',
    maxStress: '最大応力',
    close: '閉じる',
    running: '実行中...',
    noParams: 'スイープするパラメータを追加',
    rank: '順位',
    value: '値',
    min: '最小',
    max: '最大',
    combo: '組み合わせ',
    heatmap: 'ヒートマップ',
    pareto: 'パレート',
    heatmapNote: 'ヒートマップを表示するには正確に2つのパラメータを選択してください',
    primary: '主目的',
    secondary: '副目的',
    dominant: 'パレート最適',
    dominated: '非最適',
  },
  zh: {
    title: '参数扫描',
    addParam: '添加参数',
    steps: '步数',
    objective: '目标函数',
    run: '运行',
    results: '结果',
    best: '最优',
    sensitivity: '灵敏度',
    apply: '应用最优值',
    volume: '体积',
    surfaceArea: '表面积',
    mass: '质量',
    maxStress: '最大应力',
    close: '关闭',
    running: '运行中...',
    noParams: '请添加要扫描的参数',
    rank: '排名',
    value: '值',
    min: '最小',
    max: '最大',
    combo: '组合',
    heatmap: '热图',
    pareto: '帕累托',
    heatmapNote: '请选择恰好2个参数以查看热图',
    primary: '主目标',
    secondary: '次目标',
    dominant: '帕累托最优',
    dominated: '被支配',
  },
  es: {
    title: 'Barrido Paramétrico',
    addParam: 'Agregar Parámetro',
    steps: 'Pasos',
    objective: 'Objetivo',
    run: 'Ejecutar',
    results: 'Resultados',
    best: 'Mejor',
    sensitivity: 'Sensibilidad',
    apply: 'Aplicar Mejor',
    volume: 'Volumen',
    surfaceArea: 'Área Superficial',
    mass: 'Masa',
    maxStress: 'Estrés Máximo',
    close: 'Cerrar',
    running: 'Ejecutando...',
    noParams: 'Agregue parámetros para barrer',
    rank: 'Rango',
    value: 'Valor',
    min: 'Mín',
    max: 'Máx',
    combo: 'Combinación',
    heatmap: 'Mapa de Calor',
    pareto: 'Pareto',
    heatmapNote: 'Seleccione exactamente 2 parámetros para ver el mapa de calor',
    primary: 'Primario',
    secondary: 'Secundario',
    dominant: 'Óptimo Pareto',
    dominated: 'Dominado',
  },
  ar: {
    title: 'مسح بارامتري',
    addParam: 'إضافة معامل',
    steps: 'خطوات',
    objective: 'الهدف',
    run: 'تشغيل',
    results: 'النتائج',
    best: 'الأفضل',
    sensitivity: 'الحساسية',
    apply: 'تطبيق الأفضل',
    volume: 'الحجم',
    surfaceArea: 'مساحة السطح',
    mass: 'الكتلة',
    maxStress: 'أقصى إجهاد',
    close: 'إغلاق',
    running: '...جارٍ التشغيل',
    noParams: 'أضف معاملات للمسح',
    rank: 'الترتيب',
    value: 'القيمة',
    min: 'أدنى',
    max: 'أقصى',
    combo: 'التركيبة',
    heatmap: 'خريطة حرارية',
    pareto: 'باريتو',
    heatmapNote: 'اختر بالضبط معاملَين لرؤية الخريطة الحرارية',
    primary: 'أساسي',
    secondary: 'ثانوي',
    dominant: 'أمثل باريتو',
    dominated: 'مهيمن عليه',
  },
};

type Lang = keyof typeof dict;
const langMap: Record<string, Lang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

/* ── Props ─────────────────────────────────────────────────────────────────── */

interface ParamDef {
  name: string;
  label: string;
  min: number;
  max: number;
}

interface Props {
  lang: string;
  currentParams: Record<string, number>;
  paramDefs: ParamDef[];
  onApplyBest: (params: Record<string, number>) => void;
  onClose: () => void;
  onEvaluate?: (params: Record<string, number>, objective: SweepObjective) => number;
}

/* ── Theme ─────────────────────────────────────────────────────────────────── */

const C = {
  bg: '#0d1117',
  card: '#161b22',
  border: '#30363d',
  text: '#c9d1d9',
  muted: '#8b949e',
  accent: '#388bfd',
  green: '#3fb950',
  red: '#f85149',
  yellow: '#d29922',
};

/* ── Helpers ───────────────────────────────────────────────────────────────── */

/** Map a normalized value 0-1 to a 5-stop blue→green→yellow→red gradient color */
function heatColor(t: number): string {
  // stops: 0=blue, 0.25=cyan, 0.5=green, 0.75=yellow, 1=red
  const stops: [number, number, number][] = [
    [0, 0, 255],    // blue
    [0, 200, 220],  // cyan
    [0, 200, 80],   // green
    [230, 210, 0],  // yellow
    [240, 50, 30],  // red
  ];
  const seg = t * (stops.length - 1);
  const lo = Math.floor(seg);
  const hi = Math.min(lo + 1, stops.length - 1);
  const f = seg - lo;
  const r = Math.round(stops[lo][0] + f * (stops[hi][0] - stops[lo][0]));
  const g = Math.round(stops[lo][1] + f * (stops[hi][1] - stops[lo][1]));
  const b = Math.round(stops[lo][2] + f * (stops[hi][2] - stops[lo][2]));
  return `rgb(${r},${g},${b})`;
}

/* ── HeatmapTab ─────────────────────────────────────────────────────────────── */

interface HeatmapTabProps {
  result: SweepResult;
  sweepParams: SweepParam[];
  note: string;
  best: string;
  muted: string;
  text: string;
  border: string;
  card: string;
}

function HeatmapTab({ result, sweepParams, note, best, muted, text, border, card }: HeatmapTabProps) {
  if (sweepParams.length !== 2) {
    return (
      <div style={{ color: muted, fontSize: 11, padding: '12px 0', textAlign: 'center' }}>
        {note}
      </div>
    );
  }

  const p1 = sweepParams[0];
  const p2 = sweepParams[1];

  // Collect unique values for each axis
  const vals1Set = new Set<number>();
  const vals2Set = new Set<number>();
  for (const combo of result.combinations) {
    vals1Set.add(combo[p1.name]);
    vals2Set.add(combo[p2.name]);
  }
  const vals1 = Array.from(vals1Set).sort((a, b) => a - b);
  const vals2 = Array.from(vals2Set).sort((a, b) => a - b);

  // Build lookup: "v1|v2" → objective value
  const lookup = new Map<string, number>();
  result.combinations.forEach((combo, i) => {
    lookup.set(`${combo[p1.name]}|${combo[p2.name]}`, result.values[i]);
  });

  const allVals = result.values;
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  const bestCombo = result.combinations[result.bestIdx];

  // Layout
  const cellW = 28;
  const cellH = 20;
  const marginLeft = 52;
  const marginBottom = 36;
  const marginTop = 8;
  const marginRight = 8;
  const svgW = marginLeft + vals1.length * cellW + marginRight;
  const svgH = marginTop + vals2.length * cellH + marginBottom;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        {/* Y axis label */}
        <text
          x={10}
          y={marginTop + (vals2.length * cellH) / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={muted}
          fontSize={9}
          transform={`rotate(-90, 10, ${marginTop + (vals2.length * cellH) / 2})`}
        >
          {p2.name}
        </text>

        {/* X axis label */}
        <text
          x={marginLeft + (vals1.length * cellW) / 2}
          y={svgH - 4}
          textAnchor="middle"
          fill={muted}
          fontSize={9}
        >
          {p1.name}
        </text>

        {/* X tick labels */}
        {vals1.map((v, xi) => (
          <text
            key={xi}
            x={marginLeft + xi * cellW + cellW / 2}
            y={marginTop + vals2.length * cellH + 12}
            textAnchor="middle"
            fill={muted}
            fontSize={8}
          >
            {v.toFixed(1)}
          </text>
        ))}

        {/* Y tick labels */}
        {vals2.map((v, yi) => (
          <text
            key={yi}
            x={marginLeft - 4}
            y={marginTop + yi * cellH + cellH / 2}
            textAnchor="end"
            dominantBaseline="middle"
            fill={muted}
            fontSize={8}
          >
            {v.toFixed(1)}
          </text>
        ))}

        {/* Cells */}
        {vals2.map((v2, yi) =>
          vals1.map((v1, xi) => {
            const val = lookup.get(`${v1}|${v2}`);
            if (val === undefined) return null;
            const t = (val - minV) / range;
            const isBest = bestCombo[p1.name] === v1 && bestCombo[p2.name] === v2;
            return (
              <rect
                key={`${xi}-${yi}`}
                x={marginLeft + xi * cellW}
                y={marginTop + yi * cellH}
                width={cellW}
                height={cellH}
                fill={heatColor(t)}
                stroke={isBest ? '#ffffff' : border}
                strokeWidth={isBest ? 2 : 0.5}
                opacity={0.88}
              >
                <title>{`${p1.name}=${v1.toFixed(2)}, ${p2.name}=${v2.toFixed(2)}\n${best}: ${val.toFixed(3)}`}</title>
              </rect>
            );
          })
        )}
      </svg>

      {/* Color scale legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 8, color: muted }}>{minV.toFixed(2)}</span>
        <div
          style={{
            flex: 1,
            height: 8,
            borderRadius: 4,
            background: 'linear-gradient(to right, rgb(0,0,255), rgb(0,200,220), rgb(0,200,80), rgb(230,210,0), rgb(240,50,30))',
          }}
        />
        <span style={{ fontSize: 8, color: muted }}>{maxV.toFixed(2)}</span>
      </div>
    </div>
  );
}

/* ── ParetoTab ──────────────────────────────────────────────────────────────── */

interface ParetoTabProps {
  result: SweepResult;
  result2: SweepResult | null;
  sweepParams: SweepParam[];
  primary: string;
  secondary: string;
  dominant: string;
  dominated: string;
  best: string;
  muted: string;
  text: string;
  border: string;
  card: string;
  objective: string;
}

function ParetoTab({ result, result2, sweepParams, primary, secondary, dominant, dominated, best, muted, text, border, card, objective }: ParetoTabProps) {
  const xs = result.values;
  const ys = result2 ? result2.values : result.values.map((_, i) => i / result.values.length);

  const n = xs.length;
  if (n === 0) return null;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  // Pareto dominance: point i dominates j if xs[i]<=xs[j] && ys[i]<=ys[j] with at least one strict
  const isDominated = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (xs[j] <= xs[i] && ys[j] <= ys[i] && (xs[j] < xs[i] || ys[j] < ys[i])) {
        isDominated[i] = true;
        break;
      }
    }
  }

  const svgW = 316;
  const svgH = 200;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 36;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const px = (v: number) => padL + ((v - minX) / rangeX) * plotW;
  const py = (v: number) => padT + plotH - ((v - minY) / rangeY) * plotH;

  // Y tick count
  const yTicks = 4;
  const xTicks = 4;

  return (
    <div>
      <svg width={svgW} height={svgH} style={{ display: 'block', width: '100%' }}>
        {/* Grid lines */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = minY + (i / yTicks) * rangeY;
          const y = py(v);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke={border} strokeWidth={0.5} />
              <text x={padL - 3} y={y} textAnchor="end" dominantBaseline="middle" fill={muted} fontSize={8}>
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const v = minX + (i / xTicks) * rangeX;
          const x = px(v);
          return (
            <g key={i}>
              <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke={border} strokeWidth={0.5} />
              <text x={x} y={padT + plotH + 12} textAnchor="middle" fill={muted} fontSize={8}>
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={padL + plotW / 2} y={svgH - 4} textAnchor="middle" fill={muted} fontSize={9}>
          {primary} ({objective})
        </text>
        <text
          x={10}
          y={padT + plotH / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={muted}
          fontSize={9}
          transform={`rotate(-90, 10, ${padT + plotH / 2})`}
        >
          {secondary}
        </text>

        {/* Points */}
        {Array.from({ length: n }, (_, i) => {
          const isOptimal = !isDominated[i];
          const isBest = i === result.bestIdx;
          const cx = px(xs[i]);
          const cy = py(ys[i]);
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={isBest ? 6 : 3}
              fill={isOptimal ? '#f0a030' : '#555'}
              stroke={isBest ? '#ffffff' : 'none'}
              strokeWidth={isBest ? 1.5 : 0}
              opacity={0.85}
            >
              <title>{`${primary}: ${xs[i].toFixed(3)}\n${secondary}: ${ys[i].toFixed(3)}${isBest ? `\n(${best})` : ''}`}</title>
            </circle>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 9, color: muted }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#f0a030' }} />
          {dominant}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#555' }} />
          {dominated}
        </span>
      </div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export default function ParametricSweepPanel({
  lang,
  currentParams,
  paramDefs,
  onApplyBest,
  onClose,
  onEvaluate,
}: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const resolvedLang: Lang = langMap[seg] ?? langMap[lang] ?? 'en';
  const t = dict[resolvedLang];
  const isRTL = resolvedLang === 'ar';

  // Which params are selected for sweep
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Per-param sweep ranges
  const [ranges, setRanges] = useState<Record<string, { min: number; max: number; steps: number }>>({});
  // Objective
  const [objective, setObjective] = useState<SweepObjective>('volume');
  // Running state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Results
  const [result, setResult] = useState<SweepResult | null>(null);
  const [sensitivity, setSensitivity] = useState<SensitivityEntry[]>([]);
  // Secondary results (for Pareto)
  const [result2, setResult2] = useState<SweepResult | null>(null);
  // Results tab
  const [tab, setTab] = useState<'table' | 'sensitivity' | 'heatmap' | 'pareto'>('table');
  // Sort
  const [sortAsc, setSortAsc] = useState(true);

  const objectives: SweepObjective[] = ['volume', 'surfaceArea', 'mass', 'maxStress'];

  const toggleParam = useCallback((name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    // Init range from paramDef
    if (!ranges[name]) {
      const def = paramDefs.find(p => p.name === name);
      if (def) {
        setRanges(prev => ({
          ...prev,
          [name]: { min: def.min, max: def.max, steps: 5 },
        }));
      }
    }
  }, [ranges, paramDefs]);

  const updateRange = useCallback((name: string, key: 'min' | 'max' | 'steps', value: number) => {
    setRanges(prev => ({
      ...prev,
      [name]: { ...prev[name], [key]: value },
    }));
  }, []);

  const sweepParams = useMemo<SweepParam[]>(() => {
    return Array.from(selected).map(name => ({
      name,
      min: ranges[name]?.min ?? 0,
      max: ranges[name]?.max ?? 100,
      steps: ranges[name]?.steps ?? 5,
    }));
  }, [selected, ranges]);

  const runSweep = useCallback(() => {
    if (sweepParams.length === 0 || running) return;
    setRunning(true);
    setProgress({ done: 0, total: 0 });
    setResult(null);
    setResult2(null);
    setSensitivity([]);

    // Use requestAnimationFrame to avoid blocking UI
    requestAnimationFrame(() => {
      try {
        const res = runParametricSweep(
          { params: sweepParams, objective },
          (params) => {
            if (onEvaluate) return onEvaluate(params, objective);
            // fallback mock if no evaluator provided
            return Object.values(params).reduce((s, v) => s + v * v, 0);
          },
          (done, total) => setProgress({ done, total }),
        );
        // Secondary metric for Pareto: evaluate the complementary objective
        const res2 = runParametricSweep(
          { params: sweepParams, objective },
          (params) => {
            if (onEvaluate) return onEvaluate(params, objective === 'volume' ? 'surfaceArea' : 'volume');
            return Object.values(params).reduce((s, v) => s + v, 0);
          },
        );
        const sens = computeSensitivity(res, sweepParams);
        setResult(res);
        setResult2(res2);
        setSensitivity(sens.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)));
      } catch (e) {
        console.error('[ParametricSweep]', e);
      } finally {
        setRunning(false);
        setProgress(null);
      }
    });
  }, [sweepParams, objective, running]);

  const sortedIndices = useMemo(() => {
    if (!result) return [];
    const indices = result.values.map((_, i) => i);
    indices.sort((a, b) => sortAsc
      ? result.values[a] - result.values[b]
      : result.values[b] - result.values[a]);
    return indices;
  }, [result, sortAsc]);

  const maxAbsDelta = useMemo(() => {
    if (sensitivity.length === 0) return 1;
    return Math.max(...sensitivity.map(s => Math.abs(s.delta)), 1e-9);
  }, [sensitivity]);

  /* ── Styles ──────────────────────────────────────────────────────────────── */

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    top: 60,
    right: 16,
    width: 360,
    maxHeight: 'calc(100vh - 80px)',
    overflowY: 'auto',
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    zIndex: 800,
    fontFamily: 'system-ui, sans-serif',
    color: C.text,
    fontSize: 12,
    direction: isRTL ? 'rtl' : 'ltr',
    boxShadow: '0 8px 32px rgba(0,0,0,.5)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderBottom: `1px solid ${C.border}`,
    background: C.card,
    borderRadius: '8px 8px 0 0',
  };

  const btnStyle = (active = false): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${active ? C.accent : C.border}`,
    background: active ? C.accent : 'transparent',
    color: active ? '#fff' : C.text,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: active ? 600 : 400,
  });

  const inputStyle: React.CSSProperties = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    color: C.text,
    padding: '2px 6px',
    fontSize: 11,
    width: 54,
  };

  /* ── Render ──────────────────────────────────────────────────────────────── */

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{t.title}</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}
        >
          x
        </button>
      </div>

      {/* Parameter selection */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ marginBottom: 6, color: C.muted, fontSize: 10, textTransform: 'uppercase' }}>
          {t.addParam}
        </div>
        {paramDefs.map(pd => {
          const active = selected.has(pd.name);
          return (
            <div key={pd.name} style={{ marginBottom: 6 }}>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleParam(pd.name)}
                  style={{ accentColor: C.accent }}
                />
                <span style={{ flex: 1, fontWeight: active ? 600 : 400 }}>
                  {pd.label}
                </span>
                <span style={{ color: C.muted, fontSize: 10 }}>
                  {currentParams[pd.name]?.toFixed(1) ?? '—'}
                </span>
              </label>

              {active && ranges[pd.name] && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 4, marginLeft: 22 }}>
                  <div>
                    <div style={{ fontSize: 9, color: C.muted }}>{t.min}</div>
                    <input
                      type="number"
                      style={inputStyle}
                      value={ranges[pd.name].min}
                      onChange={e => updateRange(pd.name, 'min', +e.target.value)}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.muted }}>{t.max}</div>
                    <input
                      type="number"
                      style={inputStyle}
                      value={ranges[pd.name].max}
                      onChange={e => updateRange(pd.name, 'max', +e.target.value)}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.muted }}>{t.steps}</div>
                    <input
                      type="number"
                      style={inputStyle}
                      value={ranges[pd.name].steps}
                      min={2}
                      max={20}
                      onChange={e => updateRange(pd.name, 'steps', Math.max(2, +e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Objective selector */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ marginBottom: 4, color: C.muted, fontSize: 10, textTransform: 'uppercase' }}>
          {t.objective}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {objectives.map(obj => (
            <button
              key={obj}
              style={btnStyle(obj === objective)}
              onClick={() => setObjective(obj)}
            >
              {t[obj]}
            </button>
          ))}
        </div>
      </div>

      {/* Run button */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}` }}>
        {sweepParams.length === 0 ? (
          <div style={{ color: C.muted, textAlign: 'center', padding: 8 }}>{t.noParams}</div>
        ) : (
          <>
            <button
              onClick={runSweep}
              disabled={running}
              style={{
                width: '100%',
                padding: '8px 0',
                borderRadius: 6,
                border: 'none',
                background: running ? C.border : C.accent,
                color: '#fff',
                fontWeight: 700,
                fontSize: 12,
                cursor: running ? 'not-allowed' : 'pointer',
              }}
            >
              {running ? t.running : t.run}
            </button>
            {progress && (
              <div style={{ marginTop: 4 }}>
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    background: C.border,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                      background: C.accent,
                      transition: 'width 0.1s',
                    }}
                  />
                </div>
                <div style={{ fontSize: 9, color: C.muted, textAlign: 'center', marginTop: 2 }}>
                  {progress.done} / {progress.total}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Results */}
      {result && (
        <div style={{ padding: '8px 12px' }}>
          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            <button style={btnStyle(tab === 'table')} onClick={() => setTab('table')}>
              {t.results}
            </button>
            <button style={btnStyle(tab === 'sensitivity')} onClick={() => setTab('sensitivity')}>
              {t.sensitivity}
            </button>
            <button style={btnStyle(tab === 'heatmap')} onClick={() => setTab('heatmap')}>
              {t.heatmap}
            </button>
            <button style={btnStyle(tab === 'pareto')} onClick={() => setTab('pareto')}>
              {t.pareto}
            </button>
          </div>

          {/* Table view */}
          {tab === 'table' && (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: '3px 4px', textAlign: 'left', color: C.muted }}>#</th>
                    {sweepParams.map(p => (
                      <th key={p.name} style={{ padding: '3px 4px', textAlign: 'right', color: C.muted }}>
                        {p.name}
                      </th>
                    ))}
                    <th
                      style={{ padding: '3px 4px', textAlign: 'right', color: C.accent, cursor: 'pointer' }}
                      onClick={() => setSortAsc(prev => !prev)}
                    >
                      {t.value} {sortAsc ? '\u25B2' : '\u25BC'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedIndices.slice(0, 50).map((idx, rank) => {
                    const isBest = idx === result.bestIdx;
                    return (
                      <tr
                        key={idx}
                        style={{
                          background: isBest ? 'rgba(56,139,253,.15)' : 'transparent',
                          borderBottom: `1px solid ${C.border}`,
                        }}
                      >
                        <td style={{ padding: '3px 4px', color: isBest ? C.green : C.muted }}>
                          {isBest ? `${t.best}` : rank + 1}
                        </td>
                        {sweepParams.map(p => (
                          <td key={p.name} style={{ padding: '3px 4px', textAlign: 'right', fontFamily: 'monospace' }}>
                            {result.combinations[idx][p.name]?.toFixed(2)}
                          </td>
                        ))}
                        <td
                          style={{
                            padding: '3px 4px',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontWeight: isBest ? 700 : 400,
                            color: isBest ? C.green : C.text,
                          }}
                        >
                          {result.values[idx]?.toFixed(3)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {sortedIndices.length > 50 && (
                <div style={{ textAlign: 'center', color: C.muted, fontSize: 9, padding: 4 }}>
                  +{sortedIndices.length - 50} more
                </div>
              )}
            </div>
          )}

          {/* Sensitivity tornado chart */}
          {tab === 'sensitivity' && (
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 6 }}>{t.rank}</div>
              {sensitivity.map((s, i) => {
                const pct = (Math.abs(s.delta) / maxAbsDelta) * 100;
                const isPositive = s.delta >= 0;
                return (
                  <div key={s.param} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 11 }}>
                        {i + 1}. {s.param}
                      </span>
                      <span style={{ color: C.muted, fontFamily: 'monospace', fontSize: 10 }}>
                        {'\u0394'} {s.delta >= 0 ? '+' : ''}{s.delta.toFixed(3)}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 14,
                        borderRadius: 3,
                        background: C.card,
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: isPositive ? '50%' : `${50 - pct / 2}%`,
                          width: `${pct / 2}%`,
                          height: '100%',
                          background: isPositive ? C.red : C.green,
                          borderRadius: 3,
                          opacity: 0.8,
                        }}
                      />
                      {/* Center line */}
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: 0,
                          width: 1,
                          height: '100%',
                          background: C.muted,
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.muted, marginTop: 1 }}>
                      <span>{t.min}: {s.low.toFixed(2)}</span>
                      <span>{t.max}: {s.high.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Heatmap view */}
          {tab === 'heatmap' && (
            <HeatmapTab
              result={result}
              sweepParams={sweepParams}
              note={t.heatmapNote}
              best={t.best}
              muted={C.muted}
              text={C.text}
              border={C.border}
              card={C.card}
            />
          )}

          {/* Pareto view */}
          {tab === 'pareto' && (
            <ParetoTab
              result={result}
              result2={result2}
              sweepParams={sweepParams}
              primary={t.primary}
              secondary={t.secondary}
              dominant={t.dominant}
              dominated={t.dominated}
              best={t.best}
              muted={C.muted}
              text={C.text}
              border={C.border}
              card={C.card}
              objective={objective}
            />
          )}

          {/* Apply Best button */}
          <button
            onClick={() => {
              if (result) onApplyBest(result.combinations[result.bestIdx]);
            }}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '8px 0',
              borderRadius: 6,
              border: `1px solid ${C.green}`,
              background: 'transparent',
              color: C.green,
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {t.apply}
          </button>
        </div>
      )}
    </div>
  );
}
