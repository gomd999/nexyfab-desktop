'use client';

/**
 * 도메인 어셈블리 프리셋 패널 (#6 비-기계 3D UI) — RC 골조·파고라·데크·카페 등
 * 결정론 어셈블리 템플릿(parts[])을 파라미터로 생성하고, 빌드 결과(질량·간섭·경고)를
 * 보여준 뒤 설계 패키지(zip: GA 3D 계통색·2D GA·구조·BOQ 재적·Dossier·FEA·SCAD)를
 * 바로 다운로드한다. GET/POST /api/nexyfab/drawing/preset?kind=assembly.
 *
 * 어셈블리 템플릿이 없는 분야(mech·rack·civil)에서는 렌더되지 않는다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

interface ParamSpec { name: string; labelKo: string; unit: string; default: number; min: number; max: number }
interface Template { domain: string; id: string; labelKo: string; labelEn: string; params: ParamSpec[] }

interface AssemblyPart { id?: string; type?: string; material?: string; role?: string }
interface Structural { totalMassKg?: number; warnings?: string[]; ok?: boolean }
interface BuildResp {
  ok: boolean;
  assembly?: { name?: string; domain?: string; parts?: AssemblyPart[] };
  openscad?: string;
  composeIntent?: { name?: string; features?: unknown[] };
  interferences?: Array<{ a: string; b: string }>;
  structural?: Structural | null;
  gateErrors?: string[];
  error?: string;
}

export default function AssemblyPresetPanel({
  lang,
  domain,
  onApply,
}: {
  lang: string;
  domain: string;
  onApply: (intent: { name?: string; features?: unknown[] }, scad: string) => void | Promise<void>;
}) {
  const ko = isKorean(lang);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tid, setTid] = useState('');
  const [params, setParams] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [built, setBuilt] = useState<BuildResp | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/nexyfab/drawing/preset/?kind=assembly&domain=${encodeURIComponent(domain)}`)
      .then((r) => r.json())
      .then((d: { ok: boolean; templates?: Template[] }) => {
        if (!alive || !d.ok || !d.templates?.length) return;
        setTemplates(d.templates);
        setTid(d.templates[0].id);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [domain]);

  const tpl = useMemo(() => templates?.find((t) => t.id === tid) ?? null, [templates, tid]);

  useEffect(() => {
    if (!tpl) return;
    setParams(Object.fromEntries(tpl.params.map((p) => [p.name, p.default])));
    setMsg(null);
    setBuilt(null);
  }, [tpl]);

  const generate = useCallback(async () => {
    if (!tid) return;
    setBusy(true); setMsg(null); setBuilt(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/preset/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'assembly', domain, templateId: tid, params }),
      });
      const data = (await res.json()) as BuildResp;
      if (data.ok && data.composeIntent && data.openscad) {
        setBuilt(data);
        await onApply(data.composeIntent, data.openscad);
        const mass = data.structural?.totalMassKg;
        setMsg(
          (ko ? '생성됨 · 부재 ' : 'Built · parts ') + (data.assembly?.parts?.length ?? 0)
          + (mass ? ` · ${mass >= 1000 ? (mass / 1000).toFixed(1) + 't' : mass.toFixed(0) + 'kg'}` : '')
          + (data.interferences?.length ? (ko ? ` · ⚠간섭 ${data.interferences.length}` : ` · ⚠clash ${data.interferences.length}`) : ''),
        );
      } else {
        setMsg((ko ? '실패: ' : 'Failed: ') + (data.gateErrors?.join('; ') ?? data.error ?? ''));
      }
    } catch (e) {
      setMsg((ko ? '실패: ' : 'Failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [tid, params, onApply, ko, domain]);

  const downloadPackage = useCallback(async () => {
    if (!built?.assembly) return;
    setPkgBusy(true);
    try {
      const r = await fetch('/api/nexyfab/drawing/package/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly: built.assembly }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; zipBase64?: string; files?: Array<{ name: string; content: string; mime?: string }>; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? (ko ? '패키지 생성 실패' : 'package failed'));
      if (typeof j.zipBase64 === 'string') {
        const bin = atob(j.zipBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        const a = document.createElement('a'); a.href = url; a.download = 'design_package.zip'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } else if (Array.isArray(j.files)) {
        for (const f of j.files) {
          const url = URL.createObjectURL(new Blob([f.content], { type: f.mime ?? 'text/html' }));
          const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        }
      } else throw new Error(ko ? '패키지 생성 실패' : 'package failed');
    } catch (e) {
      setMsg((ko ? '패키지 실패: ' : 'Package failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPkgBusy(false);
    }
  }, [built, ko]);

  if (!templates) return null;

  const warnings = built?.structural?.warnings ?? [];

  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: 'var(--nx-accent-soft, #eef4ff)', border: '1px solid var(--nx-border, #dfe3e8)' }}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
        {ko ? '어셈블리 템플릿' : 'Assembly template'}
        <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
          {ko ? '다부재 · 설계 패키지 지원' : 'multi-part · design package'}
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
        {busy ? (ko ? '빌드 중…' : 'Building…') : ko ? '어셈블리 생성' : 'Build assembly'}
      </button>

      {built && (
        <button type="button" onClick={downloadPackage} disabled={pkgBusy} style={{ ...genStyle, marginTop: 6, background: 'var(--nx-panel, #fff)', color: 'var(--nx-accent, #2563eb)', border: '1px solid var(--nx-accent, #2563eb)' }}>
          {pkgBusy ? (ko ? '패키지 생성 중…' : 'Packaging…') : ko ? '📦 설계 패키지 다운로드' : '📦 Download design package'}
        </button>
      )}

      {msg && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--nx-text-2, #46505e)' }}>{msg}</div>}
      {warnings.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#991b1b' }}>
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
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
