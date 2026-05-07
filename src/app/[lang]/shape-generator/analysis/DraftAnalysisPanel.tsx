'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import type { DraftAnalysisResult, PullAxis } from './draftAnalysis';
import { PULL_AXES } from './draftAnalysis';

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  blue: '#2e80cc',
};

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict: Record<Lang, {
  header: string;
  pullDir: string;
  minDraft: string;
  run: string;
  legend: string;
  undercutLeg: string;
  insufficientLeg: (d: number) => string;
  positiveLeg: (d: number) => string;
  excellent: string;
  verdictUndercut: string;
  verdictVertical: string;
  verdictOk: string;
  faceDist: string;
  undercut: string;
  insufficient: string;
  positive: string;
  minAngle: string;
  maxAngle: string;
  totalTri: string;
  empty: string;
}> = {
  ko: {
    header: '구배 분석 (Draft)',
    pullDir: '금형 이형 방향',
    minDraft: '최소 구배각',
    run: '분석 실행',
    legend: '색상 범례',
    undercutLeg: '언더컷 (< 0°)',
    insufficientLeg: (d) => `부족 (< ${d}°)`,
    positiveLeg: (d) => `양호 (≥ ${d}°)`,
    excellent: '우수 (≥ 10°)',
    verdictUndercut: '언더컷 검출 — 성형 불가',
    verdictVertical: '구배 부족 — 이형 시 스커핑 위험',
    verdictOk: '성형 가능 — 모든 면 충분한 구배',
    faceDist: '면 분포',
    undercut: '언더컷',
    insufficient: '부족',
    positive: '양호',
    minAngle: '최소 각도',
    maxAngle: '최대 각도',
    totalTri: '총 삼각형',
    empty: '분석을 실행하면 결과가 여기에 표시됩니다.',
  },
  en: {
    header: 'Draft Analysis',
    pullDir: 'Mold Pull Direction',
    minDraft: 'Min Draft Angle',
    run: 'Run Analysis',
    legend: 'Color Legend',
    undercutLeg: 'Undercut (< 0°)',
    insufficientLeg: (d) => `Insufficient (< ${d}°)`,
    positiveLeg: (d) => `Positive (≥ ${d}°)`,
    excellent: 'Excellent (≥ 10°)',
    verdictUndercut: 'Undercut detected — not moldable',
    verdictVertical: 'Insufficient draft — scuffing risk',
    verdictOk: 'Moldable — all faces have sufficient draft',
    faceDist: 'Face Distribution',
    undercut: 'Undercut',
    insufficient: 'Insufficient',
    positive: 'Positive',
    minAngle: 'Min angle',
    maxAngle: 'Max angle',
    totalTri: 'Total triangles',
    empty: 'Run analysis to see results here.',
  },
  ja: {
    header: '抜き勾配解析',
    pullDir: '金型の抜き方向',
    minDraft: '最小勾配角',
    run: '解析を実行',
    legend: 'カラー凡例',
    undercutLeg: 'アンダーカット (< 0°)',
    insufficientLeg: (d) => `不足 (< ${d}°)`,
    positiveLeg: (d) => `良好 (≥ ${d}°)`,
    excellent: '優秀 (≥ 10°)',
    verdictUndercut: 'アンダーカット検出 — 成形不可',
    verdictVertical: '勾配不足 — 離型時にスカッフィングの懸念',
    verdictOk: '成形可 — 全面で十分な勾配',
    faceDist: '面分布',
    undercut: 'アンダーカット',
    insufficient: '不足',
    positive: '良好',
    minAngle: '最小角度',
    maxAngle: '最大角度',
    totalTri: '総三角形数',
    empty: '解析を実行すると結果がここに表示されます。',
  },
  zh: {
    header: '拔模分析',
    pullDir: '模具脱模方向',
    minDraft: '最小拔模角',
    run: '运行分析',
    legend: '颜色图例',
    undercutLeg: '倒扣 (< 0°)',
    insufficientLeg: (d) => `不足 (< ${d}°)`,
    positiveLeg: (d) => `良好 (≥ ${d}°)`,
    excellent: '优秀 (≥ 10°)',
    verdictUndercut: '检测到倒扣 — 无法成型',
    verdictVertical: '拔模不足 — 脱模时有刮擦风险',
    verdictOk: '可成型 — 所有面拔模充分',
    faceDist: '面分布',
    undercut: '倒扣',
    insufficient: '不足',
    positive: '良好',
    minAngle: '最小角度',
    maxAngle: '最大角度',
    totalTri: '三角形总数',
    empty: '运行分析后结果将显示在这里。',
  },
  es: {
    header: 'Análisis de desmoldeo',
    pullDir: 'Dirección de desmoldeo',
    minDraft: 'Ángulo mínimo de desmoldeo',
    run: 'Ejecutar análisis',
    legend: 'Leyenda de colores',
    undercutLeg: 'Contrasalida (< 0°)',
    insufficientLeg: (d) => `Insuficiente (< ${d}°)`,
    positiveLeg: (d) => `Adecuado (≥ ${d}°)`,
    excellent: 'Excelente (≥ 10°)',
    verdictUndercut: 'Contrasalida detectada — no moldeable',
    verdictVertical: 'Desmoldeo insuficiente — riesgo de arañazos',
    verdictOk: 'Moldeable — todas las caras con suficiente desmoldeo',
    faceDist: 'Distribución de caras',
    undercut: 'Contrasalida',
    insufficient: 'Insuficiente',
    positive: 'Adecuado',
    minAngle: 'Ángulo mín.',
    maxAngle: 'Ángulo máx.',
    totalTri: 'Triángulos totales',
    empty: 'Ejecuta el análisis para ver los resultados aquí.',
  },
  ar: {
    header: 'تحليل الانسحاب',
    pullDir: 'اتجاه سحب القالب',
    minDraft: 'الحد الأدنى لزاوية الانسحاب',
    run: 'تشغيل التحليل',
    legend: 'مفتاح الألوان',
    undercutLeg: 'تقويض (< 0°)',
    insufficientLeg: (d) => `غير كافٍ (< ${d}°)`,
    positiveLeg: (d) => `جيد (≥ ${d}°)`,
    excellent: 'ممتاز (≥ 10°)',
    verdictUndercut: 'تم اكتشاف تقويض — غير قابل للقولبة',
    verdictVertical: 'انسحاب غير كافٍ — خطر التخديش',
    verdictOk: 'قابل للقولبة — جميع الأوجه بانسحاب كافٍ',
    faceDist: 'توزيع الأوجه',
    undercut: 'تقويض',
    insufficient: 'غير كافٍ',
    positive: 'جيد',
    minAngle: 'أدنى زاوية',
    maxAngle: 'أقصى زاوية',
    totalTri: 'إجمالي المثلثات',
    empty: 'قم بتشغيل التحليل لرؤية النتائج هنا.',
  },
};

/* ─── Component ──────────────────────────────────────────────────────────── */

interface DraftAnalysisPanelProps {
  result: DraftAnalysisResult | null;
  onAnalyze: (pullDirection: [number, number, number], minDraftDeg: number) => void;
  onClose: () => void;
  isKo: boolean;
}

export default function DraftAnalysisPanel({
  result,
  onAnalyze,
  onClose,
}: DraftAnalysisPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, Lang> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const tt = dict[langMap[seg] ?? 'en'];

  const [pullAxis, setPullAxis] = useState<PullAxis>('+y');
  const [minDraftDeg, setMinDraftDeg] = useState(3);

  const handleAnalyze = () => {
    onAnalyze(PULL_AXES[pullAxis], minDraftDeg);
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const axisButtons: Array<{ key: PullAxis; label: string }> = [
    { key: '+x', label: '+X' }, { key: '-x', label: '−X' },
    { key: '+y', label: '+Y' }, { key: '-y', label: '−Y' },
    { key: '+z', label: '+Z' }, { key: '-z', label: '−Z' },
  ];

  const total = result?.counts.total ?? 0;
  const undercutPct = result ? (result.counts.undercut / Math.max(total, 1)) * 100 : 0;
  const verticalPct = result ? (result.counts.vertical / Math.max(total, 1)) * 100 : 0;
  const positivePct = result ? (result.counts.positive / Math.max(total, 1)) * 100 : 0;

  const verdict = (() => {
    if (!result) return null;
    if (result.counts.undercut > 0) {
      return { label: tt.verdictUndercut, color: C.red };
    }
    if (result.counts.vertical > 0) {
      return { label: tt.verdictVertical, color: C.yellow };
    }
    return { label: tt.verdictOk, color: C.green };
  })();

  return (
    <div style={{
      width: isMobile ? '100vw' : 300,
      maxWidth: '100vw',
      background: C.bg, borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontSize: 12, color: C.text, userSelect: 'none',
      ...(isMobile ? { position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 600 } : {}),
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`, background: C.card,
      }}>
        <span style={{ fontWeight: 800, fontSize: 13 }}>
          📐 {tt.header}
        </span>
        <button onClick={onClose} style={{
          border: 'none', background: 'none', color: C.textDim,
          fontSize: 16, cursor: 'pointer', lineHeight: 1,
        }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {/* ── Settings ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {tt.pullDir}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
            {axisButtons.map(({ key, label }) => {
              const active = pullAxis === key;
              return (
                <button
                  key={key}
                  onClick={() => setPullAxis(key)}
                  style={{
                    padding: '8px 4px',
                    border: `1px solid ${active ? C.accent : C.border}`,
                    background: active ? C.accent : C.card,
                    color: active ? '#fff' : C.text,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >{label}</button>
              );
            })}
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {tt.minDraft}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, fontFamily: 'monospace' }}>
                {minDraftDeg}°
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={minDraftDeg}
              onChange={(e) => setMinDraftDeg(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <button
            onClick={handleAnalyze}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >{tt.run}</button>
        </div>

        {/* ── Legend ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
            {tt.legend}
          </div>
          <LegendRow color={C.red} label={tt.undercutLeg} />
          <LegendRow color={C.yellow} label={tt.insufficientLeg(minDraftDeg)} />
          <LegendRow color={C.green} label={tt.positiveLeg(minDraftDeg)} />
          <LegendRow color={C.blue} label={tt.excellent} />
        </div>

        {/* ── Results ── */}
        {result && (
          <>
            <div style={{
              padding: 10,
              background: C.card,
              border: `1px solid ${verdict!.color}`,
              borderRadius: 4,
              marginBottom: 12,
              fontSize: 12,
              fontWeight: 700,
              color: verdict!.color,
            }}>
              {verdict!.label}
            </div>

            <div style={{ fontWeight: 700, fontSize: 11, color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>
              {tt.faceDist}
            </div>

            <StatRow
              color={C.red}
              label={tt.undercut}
              count={result.counts.undercut}
              pct={undercutPct}
            />
            <StatRow
              color={C.yellow}
              label={tt.insufficient}
              count={result.counts.vertical}
              pct={verticalPct}
            />
            <StatRow
              color={C.green}
              label={tt.positive}
              count={result.counts.positive}
              pct={positivePct}
            />

            <div style={{
              marginTop: 12,
              padding: 10,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'monospace',
              color: C.textDim,
            }}>
              <div>{tt.minAngle}: <span style={{ color: result.minAngle < 0 ? C.red : C.text }}>{result.minAngle.toFixed(2)}°</span></div>
              <div>{tt.maxAngle}: <span style={{ color: C.text }}>{result.maxAngle.toFixed(2)}°</span></div>
              <div>{tt.totalTri}: <span style={{ color: C.text }}>{result.counts.total.toLocaleString()}</span></div>
            </div>
          </>
        )}

        {!result && (
          <div style={{ textAlign: 'center', color: C.textDim, fontSize: 11, padding: 20 }}>
            {tt.empty}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}>
      <div style={{ width: 14, height: 14, background: color, borderRadius: 2 }} />
      <span>{label}</span>
    </div>
  );
}

function StatRow({ color, label, count, pct }: { color: string; label: string; count: number; pct: number }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
        <span style={{ color }}>● {label}</span>
        <span style={{ fontFamily: 'monospace' }}>{count.toLocaleString()} ({pct.toFixed(1)}%)</span>
      </div>
      <div style={{ height: 4, background: '#0d1117', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
