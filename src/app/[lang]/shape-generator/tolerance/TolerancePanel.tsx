'use client';

/**
 * TolerancePanel.tsx — Stack-up analysis panel.
 *
 * Lets users define a linear chain of dimensions + run worst-case
 * / RSS / Monte Carlo and view the resulting envelope.
 */

import React, { useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import { worstCase, rss, monteCarlo, type StackupChain, type DimensionLink } from './toleranceStackup';

interface TolerancePanelProps {
  lang: string;
  /** Initial chain — caller can populate from feature dimensions. */
  initialChain?: StackupChain;
  onClose?: () => void;
}

const COPY = {
  ko: {
    title: '공차 누적 분석',
    nominal: '공칭',
    plus: '+ 공차', minus: '- 공차',
    direction: '방향',
    addLink: '+ 링크 추가',
    runAnalysis: '분석 실행',
    wcLabel: '워스트케이스', rssLabel: '루트제곱합', mcLabel: '몬테카를로',
  },
  en: {
    title: 'Tolerance Stack-up',
    nominal: 'Nominal',
    plus: '+ Tol', minus: '- Tol',
    direction: 'Dir',
    addLink: '+ Add Link',
    runAnalysis: 'Run',
    wcLabel: 'Worst Case', rssLabel: 'RSS', mcLabel: 'Monte Carlo',
  },
  ja: {
    title: '公差積み上げ解析',
    nominal: '公称',
    plus: '+ 公差', minus: '- 公差',
    direction: '方向',
    addLink: '+ リンク追加',
    runAnalysis: '解析実行',
    wcLabel: 'ワーストケース', rssLabel: '二乗和平方根', mcLabel: 'モンテカルロ',
  },
  zh: {
    title: '公差累积分析',
    nominal: '公称值',
    plus: '+ 公差', minus: '- 公差',
    direction: '方向',
    addLink: '+ 添加环节',
    runAnalysis: '运行分析',
    wcLabel: '最坏情况', rssLabel: '方和根', mcLabel: '蒙特卡洛',
  },
  es: {
    title: 'Análisis de acumulación de tolerancias',
    nominal: 'Nominal',
    plus: '+ Tol.', minus: '- Tol.',
    direction: 'Dir.',
    addLink: '+ Añadir eslabón',
    runAnalysis: 'Ejecutar',
    wcLabel: 'Caso más desfavorable', rssLabel: 'RSS', mcLabel: 'Montecarlo',
  },
  ar: {
    title: 'تحليل تراكم التفاوتات',
    nominal: 'القيمة الاسمية',
    plus: '+ تفاوت', minus: '- تفاوت',
    direction: 'الاتجاه',
    addLink: '+ إضافة حلقة',
    runAnalysis: 'تشغيل التحليل',
    wcLabel: 'أسوأ الحالات', rssLabel: 'جذر مجموع المربعات', mcLabel: 'مونت كارلو',
  },
} as const;

export default function TolerancePanel({
  lang, initialChain, onClose,
}: TolerancePanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;
  const [chain, setChain] = useState<StackupChain>(initialChain ?? { links: [] });
  const [results, setResults] = useState<null | {
    wc: ReturnType<typeof worstCase>;
    rss: ReturnType<typeof rss>;
    mc: ReturnType<typeof monteCarlo>;
  }>(null);

  const updateLink = (idx: number, patch: Partial<DimensionLink>) => {
    const links = chain.links.slice();
    links[idx] = { ...links[idx]!, ...patch };
    setChain({ ...chain, links });
  };

  const addLink = () => {
    setChain({
      ...chain,
      links: [
        ...chain.links,
        { name: `Link ${chain.links.length + 1}`, nominalMm: 10, tolPlusMm: 0.1, tolMinusMm: -0.1, direction: 1 },
      ],
    });
  };

  const run = () => {
    setResults({
      wc: worstCase(chain),
      rss: rss(chain),
      mc: monteCarlo(chain, 5000),
    });
  };

  return (
    <div
      style={{
        // right: 336 clears the 320px right property pane (2026-06-12)
        position: 'fixed', top: 80, right: 340,
        zIndex: 700, width: 420,
        background: 'var(--nx-panel)', color: 'var(--nx-text)',
        borderRadius: 10, padding: '14px 16px',
        boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && (
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer' }}>✕</button>
        )}
      </div>

      <div style={{ marginBottom: 10, maxHeight: '40vh', overflowY: 'auto' }}>
        {chain.links.map((link, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 50px 50px 30px', gap: 4, marginBottom: 4 }}>
            <input
              type="text" value={link.name}
              onChange={e => updateLink(i, { name: e.target.value })}
              style={inputStyle()}
            />
            <input
              type="number" value={link.nominalMm}
              onChange={e => updateLink(i, { nominalMm: Number(e.target.value) })}
              style={inputStyle()}
            />
            <input
              type="number" value={link.tolPlusMm}
              onChange={e => updateLink(i, { tolPlusMm: Number(e.target.value) })}
              style={inputStyle()}
            />
            <input
              type="number" value={link.tolMinusMm}
              onChange={e => updateLink(i, { tolMinusMm: Number(e.target.value) })}
              style={inputStyle()}
            />
            <select
              value={link.direction}
              onChange={e => updateLink(i, { direction: Number(e.target.value) as 1 | -1 })}
              style={{ ...inputStyle(), padding: 4 }}
            >
              <option value={1}>+</option>
              <option value={-1}>−</option>
            </select>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={addLink} style={btnStyle('var(--nx-panel-2)', 'var(--nx-text-2)')}>{t.addLink}</button>
        <button onClick={run} style={btnStyle('#3b82f6', 'white')}>{t.runAnalysis}</button>
      </div>

      {results && (
        <div style={{ fontSize: 11, lineHeight: 1.6 }}>
          <div><strong>{t.wcLabel}:</strong> {results.wc.minMm.toFixed(3)} ~ {results.wc.maxMm.toFixed(3)} mm (±{(results.wc.toleranceMm / 2).toFixed(3)})</div>
          <div><strong>{t.rssLabel}:</strong> 1σ = {results.rss.sigmaMm.toFixed(4)}, 3σ = ±{results.rss.threeSigmaMm.toFixed(3)} mm</div>
          <div><strong>{t.mcLabel}:</strong> 평균 {results.mc.meanMm.toFixed(3)}, σ {results.mc.sigmaMm.toFixed(4)}, min {results.mc.minMm.toFixed(3)}, max {results.mc.maxMm.toFixed(3)}</div>
        </div>
      )}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    background: 'var(--nx-panel-2)', color: 'var(--nx-text)',
    border: '1px solid var(--nx-border)', borderRadius: 4,
    padding: '4px 6px', fontSize: 11, width: '100%',
  };
}

function btnStyle(bg: string, fg: string): React.CSSProperties {
  return {
    background: bg, color: fg, border: 'none',
    padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
  };
}
