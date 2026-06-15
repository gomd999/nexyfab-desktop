'use client';

import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import {
  computeBucklingForPanel,
  BUCKLING_MATERIALS,
  type PanelBucklingResult,
} from './partBucklingFEM';

/* ─── Styles (shared tokens with the other analysis panels) ──────────────── */
const C = {
  bg: 'var(--nx-panel)',
  card: 'var(--nx-panel-2)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  textDim: 'var(--nx-text-2)',
  accent: 'var(--nx-accent)',
  green: 'var(--nx-ok)',
  warn: 'var(--nx-warn)',
};

/* ─── i18n ───────────────────────────────────────────────────────────────── */
const dict = {
  ko: {
    title: '좌굴 해석', material: '재질', fixedFace: '고정 면 (하중 축)', refStress: '기준 압축 응력',
    run: '해석 실행', running: '해석 중...', results: '결과',
    critFactor: '임계 하중 계수 λcr', critStress: '임계 좌굴 응력', nodes: '절점 수',
    noGeometry: '지오메트리가 없습니다',
    bottom: '하단', top: '상단', left: '좌측', right: '우측', front: '전면', back: '후면',
    hint: 'λcr는 기준 응력에 곱하는 배수입니다. λcr<1이면 기준 하중에서 좌굴.',
  },
  en: {
    title: 'Buckling Analysis', material: 'Material', fixedFace: 'Fixed Face (load axis)', refStress: 'Reference Compression',
    run: 'Run Analysis', running: 'Running...', results: 'Results',
    critFactor: 'Critical Load Factor λcr', critStress: 'Critical Buckling Stress', nodes: 'Nodes',
    noGeometry: 'No geometry loaded',
    bottom: 'Bottom', top: 'Top', left: 'Left', right: 'Right', front: 'Front', back: 'Back',
    hint: 'λcr multiplies the reference stress. λcr<1 means buckling at the reference load.',
  },
  ja: {
    title: '座屈解析', material: '材料', fixedFace: '固定面 (荷重軸)', refStress: '基準圧縮応力',
    run: '解析実行', running: '解析中...', results: '結果',
    critFactor: '臨界荷重係数 λcr', critStress: '臨界座屈応力', nodes: '節点数',
    noGeometry: 'ジオメトリなし',
    bottom: '下面', top: '上面', left: '左面', right: '右面', front: '前面', back: '背面',
    hint: 'λcrは基準応力への倍率。λcr<1なら基準荷重で座屈。',
  },
  zh: {
    title: '屈曲分析', material: '材料', fixedFace: '固定面 (载荷轴)', refStress: '参考压应力',
    run: '运行分析', running: '分析中...', results: '结果',
    critFactor: '临界载荷因子 λcr', critStress: '临界屈曲应力', nodes: '节点数',
    noGeometry: '无几何体',
    bottom: '底面', top: '顶面', left: '左面', right: '右面', front: '前面', back: '后面',
    hint: 'λcr 是参考应力的倍数。λcr<1 表示在参考载荷下屈曲。',
  },
  es: {
    title: 'Análisis de Pandeo', material: 'Material', fixedFace: 'Cara fija (eje de carga)', refStress: 'Compresión de referencia',
    run: 'Ejecutar análisis', running: 'Ejecutando...', results: 'Resultados',
    critFactor: 'Factor de carga crítico λcr', critStress: 'Tensión crítica de pandeo', nodes: 'Nodos',
    noGeometry: 'Sin geometría',
    bottom: 'Inferior', top: 'Superior', left: 'Izquierda', right: 'Derecha', front: 'Frontal', back: 'Trasera',
    hint: 'λcr multiplica la tensión de referencia. λcr<1 = pandeo con la carga de referencia.',
  },
  ar: {
    title: 'تحليل الانبعاج', material: 'المادة', fixedFace: 'الوجه الثابت (محور الحمل)', refStress: 'إجهاد الضغط المرجعي',
    run: 'تشغيل التحليل', running: '...جاري التشغيل', results: 'النتائج',
    critFactor: 'معامل الحمل الحرج λcr', critStress: 'إجهاد الانبعاج الحرج', nodes: 'العقد',
    noGeometry: 'لا يوجد هندسة',
    bottom: 'السفلي', top: 'العلوي', left: 'اليسار', right: 'اليمين', front: 'الأمامي', back: 'الخلفي',
    hint: 'λcr مضاعف للإجهاد المرجعي. λcr<1 يعني انبعاجًا عند الحمل المرجعي.',
  },
};

const FACE_KEYS = ['bottom', 'top', 'left', 'right', 'front', 'back'] as const;

interface BucklingAnalysisPanelProps {
  lang: string;
  geometry: THREE.BufferGeometry | null;
  onResult?: (r: PanelBucklingResult) => void;
  onClose: () => void;
}

export default function BucklingAnalysisPanel({
  lang, geometry, onResult, onClose,
}: BucklingAnalysisPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [materialKey, setMaterialKey] = useState('steel');
  const [fixedFace, setFixedFace] = useState<string>('left');
  const [refStress, setRefStress] = useState(1);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PanelBucklingResult | null>(null);

  const faceLabel = (f: string): string => (t as Record<string, string>)[f] ?? f;

  const handleRun = useCallback(async () => {
    if (!geometry) return;
    setRunning(true);
    setResult(null);
    try {
      // Heavy synchronous eigen-solve — yield a frame so the spinner paints.
      await new Promise((r) => setTimeout(r, 0));
      const res = computeBucklingForPanel(geometry, materialKey, fixedFace, refStress);
      setResult(res);
      onResult?.(res);
    } finally {
      setRunning(false);
    }
  }, [geometry, materialKey, fixedFace, refStress, onResult]);

  const labelStyle: React.CSSProperties = { color: C.textDim, fontSize: 11, marginBottom: -4 };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', background: C.card, color: C.text,
    border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, outline: 'none',
  };

  return (
    <div
      data-testid="buckling-panel"
      style={{
        // right: 336 clears the 320px right property pane (2026-06-12)
        position: 'fixed', top: 60, right: 336, width: 320,
        maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
        zIndex: 800, color: C.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        fontSize: 13, boxShadow: '0 8px 32px rgba(0,0,0,.45)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{t.title}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>✕</button>
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={labelStyle}>{t.material}</label>
        <select value={materialKey} onChange={(e) => setMaterialKey(e.target.value)} style={inputStyle}>
          {Object.entries(BUCKLING_MATERIALS).map(([key, mat]) => (
            <option key={key} value={key}>{mat.name} (E={mat.E.toLocaleString()} MPa)</option>
          ))}
        </select>

        <label style={labelStyle}>{t.fixedFace}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {FACE_KEYS.map((face) => (
            <label key={face} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: fixedFace === face ? C.accent : C.textDim }}>
              <input type="radio" name="buckling-fixed-face" checked={fixedFace === face} onChange={() => setFixedFace(face)} style={{ accentColor: C.accent }} />
              {faceLabel(face)}
            </label>
          ))}
        </div>

        <label style={labelStyle}>{t.refStress}: {refStress} MPa</label>
        <input type="range" min={1} max={100} value={refStress} onChange={(e) => setRefStress(Number(e.target.value))} style={{ width: '100%', accentColor: C.accent }} />

        <button
          data-testid="buckling-run"
          onClick={handleRun}
          disabled={running || !geometry}
          style={{
            width: '100%', padding: '8px 0', background: geometry ? C.accent : C.border,
            color: 'var(--nx-text)', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 13,
            cursor: geometry && !running ? 'pointer' : 'not-allowed', opacity: running ? 0.7 : 1,
          }}
        >
          {!geometry ? t.noGeometry : running ? t.running : t.run}
        </button>

        {result && (
          <div data-testid="buckling-result" style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 4 }}>
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>{t.results}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: C.textDim, fontSize: 12 }}>{t.critFactor}</span>
              <span data-testid="buckling-kt" style={{ fontFamily: 'monospace', fontWeight: 700, color: result.criticalLoadFactor < 1 ? C.warn : C.green }}>
                {result.criticalLoadFactor.toFixed(3)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: C.textDim, fontSize: 12 }}>{t.critStress}</span>
              <span style={{ fontFamily: 'monospace' }}>{result.bucklingStressMPa.toFixed(2)} MPa</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: C.textDim, fontSize: 12 }}>{t.nodes}</span>
              <span style={{ fontFamily: 'monospace' }}>{result.nodeCount} ({result.freeDofCount} DOF)</span>
            </div>
            <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.4 }}>{t.hint}</div>
          </div>
        )}
      </div>
    </div>
  );
}
