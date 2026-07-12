'use client';

/**
 * 결정론 파라메트릭 프리셋 패널(완벽화 Pillar ①) — 기계·장비·판금.
 *
 * AI 없이 파라미터(슬라이더/숫자)로 형상을 만든다. GET /preset로 템플릿·파라미터 명세를
 * 받아 폼을 그리고, "생성"에서 POST /preset({templateId,params}) → {intent,scad,verify}를
 * 받아 부모(onApply)로 넘겨 뷰어 렌더·검증·내보내기를 잇는다. 표준 케이스는 항상 유효·manifold.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

interface ParamSpec { name: string; labelKo: string; unit: string; default: number; min: number; max: number }
interface Template { id: string; labelKo: string; labelEn: string; params: ParamSpec[] }

interface Applied {
  ok: boolean;
  intent?: { name?: string; features?: unknown[] };
  scad?: string;
  verify?: { manifold?: boolean; triangles?: number; nonManifoldEdges?: number; error?: string } | null;
  gateErrors?: string[];
  error?: string;
}

export default function ParametricPresetPanel({
  lang,
  onApply,
}: {
  lang: string;
  onApply: (intent: { name?: string; features?: unknown[] }, scad: string, verify: Applied['verify']) => void | Promise<void>;
}) {
  const ko = isKorean(lang);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tid, setTid] = useState('');
  const [params, setParams] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/nexyfab/drawing/preset/')
      .then((r) => r.json())
      .then((d: { ok: boolean; templates?: Template[] }) => {
        if (!alive || !d.ok || !d.templates) return;
        setTemplates(d.templates);
        if (d.templates[0]) setTid(d.templates[0].id);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const tpl = useMemo(() => templates?.find((t) => t.id === tid) ?? null, [templates, tid]);

  // 템플릿 바뀌면 파라미터를 기본값으로.
  useEffect(() => {
    if (!tpl) return;
    setParams(Object.fromEntries(tpl.params.map((p) => [p.name, p.default])));
    setMsg(null);
  }, [tpl]);

  const generate = useCallback(async () => {
    if (!tid) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/preset/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: tid, params }),
      });
      const data = (await res.json()) as Applied;
      if (data.ok && data.intent && data.scad) {
        await onApply(data.intent, data.scad, data.verify);
        setMsg(ko ? '생성됨 · 항상 유효(결정론)' : 'Generated · always valid (deterministic)');
      } else {
        setMsg((ko ? '실패: ' : 'Failed: ') + (data.gateErrors?.join('; ') ?? data.error ?? ''));
      }
    } catch (e) {
      setMsg((ko ? '실패: ' : 'Failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [tid, params, onApply, ko]);

  if (!templates) return null;

  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: 'var(--nx-accent-soft, #eef4ff)', border: '1px solid var(--nx-border, #dfe3e8)' }}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
        {ko ? '파라메트릭 프리셋' : 'Parametric preset'}
        <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
          {ko ? 'AI 없이 · 항상 유효' : 'no AI · always valid'}
        </span>
      </div>

      <select value={tid} onChange={(e) => setTid(e.target.value)} style={selStyle}>
        {templates.map((t) => <option key={t.id} value={t.id}>{ko ? t.labelKo : t.labelEn}</option>)}
      </select>

      {tpl && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '8px 0' }}>
          {tpl.params.map((p) => (
            <label key={p.name} style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{p.labelKo}{p.unit ? ` (${p.unit})` : ''}</span>
              <input
                type="number" inputMode="decimal"
                value={params[p.name] ?? ''}
                min={p.min} max={p.max}
                onChange={(e) => setParams((s) => ({ ...s, [p.name]: Number(e.target.value) }))}
                style={inpStyle}
              />
            </label>
          ))}
        </div>
      )}

      <button type="button" onClick={generate} disabled={busy} style={genStyle}>
        {busy ? (ko ? '생성 중…' : 'Generating…') : ko ? '프리셋 생성' : 'Generate preset'}
      </button>
      {msg && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--nx-text-2, #46505e)' }}>{msg}</div>}
    </div>
  );
}

const selStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12,
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'var(--nx-text, #1a2230)',
};
const inpStyle: React.CSSProperties = {
  padding: '5px 7px', borderRadius: 6, fontSize: 12, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
};
const genStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 7, border: 'none',
  background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
