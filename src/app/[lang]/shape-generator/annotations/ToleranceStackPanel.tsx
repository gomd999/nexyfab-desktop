'use client';

import React, { useMemo, useState } from 'react';
import {
  analyzeWC,
  analyzeRSS,
  iso2768LinearTolerance,
  type ToleranceStackEntry,
  type StackResult,
} from './toleranceStack';

const C = {
  bg: '#161b22',
  card: '#1c2128',
  border: '#30363d',
  text: '#c9d1d9',
  dim: '#8b949e',
  accent: '#388bfd',
  danger: '#f85149',
  success: '#3fb950',
};

interface Props {
  initialEntries?: ToleranceStackEntry[];
  lang?: 'ko' | 'en';
  onChange?: (entries: ToleranceStackEntry[], result: StackResult) => void;
}

function newEntry(): ToleranceStackEntry {
  return {
    id: `E${Math.random().toString(36).slice(2, 8)}`,
    label: '',
    nominal: 10,
    upper: 0.1,
    lower: 0.1,
    direction: 'add',
  };
}

export default function ToleranceStackPanel({ initialEntries, lang = 'ko', onChange }: Props) {
  const [entries, setEntries] = useState<ToleranceStackEntry[]>(initialEntries ?? [newEntry()]);
  const [method, setMethod] = useState<'WC' | 'RSS'>('WC');
  const [specLsl, setSpecLsl] = useState<string>('');
  const [specUsl, setSpecUsl] = useState<string>('');

  const result = useMemo(() => {
    const r = method === 'WC' ? analyzeWC(entries) : analyzeRSS(entries);
    if (onChange) onChange(entries, r);
    return r;
  }, [entries, method, onChange]);

  const spec = useMemo(() => {
    const lsl = Number(specLsl), usl = Number(specUsl);
    if (!Number.isFinite(lsl) || !Number.isFinite(usl) || usl <= lsl) return null;
    const withinMin = result.min >= lsl;
    const withinMax = result.max <= usl;
    return { lsl, usl, withinMin, withinMax, passing: withinMin && withinMax };
  }, [specLsl, specUsl, result]);

  const update = (id: string, patch: Partial<ToleranceStackEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const remove = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const add = () => setEntries((prev) => [...prev, newEntry()]);

  const iso2768Apply = (id: string, cls: 'f' | 'm' | 'c' | 'v') => {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    const t = iso2768LinearTolerance(e.nominal, cls);
    update(id, { upper: t, lower: t });
  };

  const T = lang === 'ko'
    ? { title: '공차 스택 분석', add: '+ 행 추가', method: '해석법', wc: '최악 조건', rss: 'RSS', label: '이름', nominal: '공칭', upper: '상편차', lower: '하편차', dir: '방향', iso: 'ISO 2768', result: '스택 결과', min: '최소', max: '최대', nominalLabel: '공칭', total: '총 공차', specWin: '규격 윈도우(선택)', lsl: '하한', usl: '상한', pass: '합격', fail: '불합격', contribs: '기여도', addSub: { add: '+', sub: '−' } }
    : { title: 'Tolerance Stack Analysis', add: '+ Add row', method: 'Method', wc: 'Worst-Case', rss: 'RSS', label: 'Label', nominal: 'Nom.', upper: '+Tol', lower: '−Tol', dir: 'Dir', iso: 'ISO 2768', result: 'Stack Result', min: 'Min', max: 'Max', nominalLabel: 'Nominal', total: 'Total tol', specWin: 'Spec Window (opt.)', lsl: 'LSL', usl: 'USL', pass: 'PASS', fail: 'FAIL', contribs: 'Contributions', addSub: { add: '+', sub: '−' } };

  return (
    <div style={{ background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 700 }}>{T.title}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setMethod('WC')}  style={methodBtn(method === 'WC')}>{T.wc}</button>
          <button onClick={() => setMethod('RSS')} style={methodBtn(method === 'RSS')}>{T.rss}</button>
        </div>
      </div>

      {/* Table header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 0.8fr 0.8fr 0.5fr 1fr 28px', gap: 4, color: C.dim, fontSize: 10, marginBottom: 4, textTransform: 'uppercase' }}>
        <div>{T.label}</div><div>{T.nominal}</div><div>{T.upper}</div><div>{T.lower}</div><div>{T.dir}</div><div>{T.iso}</div><div></div>
      </div>

      {entries.map((e) => (
        <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 0.8fr 0.8fr 0.5fr 1fr 28px', gap: 4, marginBottom: 4 }}>
          <input value={e.label} onChange={(ev) => update(e.id, { label: ev.target.value })} style={input} placeholder="dim" />
          <input type="number" step="0.01" value={e.nominal} onChange={(ev) => update(e.id, { nominal: Number(ev.target.value) })} style={input} />
          <input type="number" step="0.001" value={e.upper} onChange={(ev) => update(e.id, { upper: Math.max(0, Number(ev.target.value)) })} style={input} />
          <input type="number" step="0.001" value={e.lower} onChange={(ev) => update(e.id, { lower: Math.max(0, Number(ev.target.value)) })} style={input} />
          <button
            onClick={() => update(e.id, { direction: e.direction === 'add' ? 'subtract' : 'add' })}
            style={{ ...input, cursor: 'pointer', background: e.direction === 'add' ? '#1f2937' : '#3f1f1f', textAlign: 'center' }}
          >
            {e.direction === 'add' ? T.addSub.add : T.addSub.sub}
          </button>
          <select onChange={(ev) => ev.target.value && iso2768Apply(e.id, ev.target.value as 'f' | 'm' | 'c' | 'v')} defaultValue="" style={input}>
            <option value="">—</option>
            <option value="f">f (fine)</option>
            <option value="m">m (med)</option>
            <option value="c">c (coarse)</option>
            <option value="v">v (v-coarse)</option>
          </select>
          <button onClick={() => remove(e.id)} style={{ ...input, background: 'transparent', color: C.danger, cursor: 'pointer', border: 'none' }}>×</button>
        </div>
      ))}

      <button onClick={add} style={{ marginTop: 4, padding: '6px 10px', background: 'transparent', color: C.accent, border: `1px dashed ${C.border}`, borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
        {T.add}
      </button>

      {/* Result */}
      <div style={{ marginTop: 12, padding: 10, background: C.card, borderRadius: 6, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10, color: C.dim, textTransform: 'uppercase', marginBottom: 6 }}>{T.result} ({result.method})</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 12 }}>
          <div><div style={{ color: C.dim, fontSize: 10 }}>{T.nominalLabel}</div><div style={{ fontWeight: 700 }}>{result.nominal.toFixed(3)}</div></div>
          <div><div style={{ color: C.dim, fontSize: 10 }}>{T.min}</div><div style={{ fontWeight: 700, color: spec && !spec.withinMin ? C.danger : C.text }}>{result.min.toFixed(3)}</div></div>
          <div><div style={{ color: C.dim, fontSize: 10 }}>{T.max}</div><div style={{ fontWeight: 700, color: spec && !spec.withinMax ? C.danger : C.text }}>{result.max.toFixed(3)}</div></div>
          <div><div style={{ color: C.dim, fontSize: 10 }}>{T.total}</div><div style={{ fontWeight: 700 }}>±{(result.upperTol + result.lowerTol).toFixed(3)}</div></div>
        </div>
      </div>

      {/* Spec window check */}
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'center' }}>
        <input type="number" step="0.01" value={specLsl} onChange={(e) => setSpecLsl(e.target.value)} placeholder={T.lsl} style={input} />
        <input type="number" step="0.01" value={specUsl} onChange={(e) => setSpecUsl(e.target.value)} placeholder={T.usl} style={input} />
        <span style={{ fontSize: 11, fontWeight: 700, color: spec ? (spec.passing ? C.success : C.danger) : C.dim, minWidth: 40, textAlign: 'center' }}>
          {spec ? (spec.passing ? T.pass : T.fail) : T.specWin}
        </span>
      </div>

      {/* Contributions */}
      {result.contributions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: C.dim, textTransform: 'uppercase', marginBottom: 4 }}>{T.contribs}</div>
          {result.contributions.slice(0, 5).map((c) => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr 40px', fontSize: 11, marginBottom: 2 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.label || c.id}
                <span style={{ display: 'inline-block', marginLeft: 6, height: 4, verticalAlign: 'middle', background: C.accent, width: `${Math.min(60, c.share * 60)}px`, borderRadius: 2 }} />
              </div>
              <div style={{ textAlign: 'right', color: C.dim }}>{(c.share * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const methodBtn = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  background: active ? C.accent : 'transparent',
  color: active ? '#fff' : C.dim,
  border: `1px solid ${active ? C.accent : C.border}`,
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 11,
});

const input: React.CSSProperties = {
  padding: '4px 6px',
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 4,
  color: C.text,
  fontSize: 11,
  outline: 'none',
  fontFamily: 'inherit',
};
