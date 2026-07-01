'use client';

// Admin: enter real quotes to calibrate the parametric cost model. Each entry
// feeds nf_quote_history; the estimate for that (process, material, region)
// bucket then bends toward reality. Super-admin session required.

import { use, useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

const PROCESSES = ['cnc', 'injection', 'sheet_metal', '3d_print', 'casting'];
const MATERIALS = ['aluminum', 'steel', 'titanium', 'copper', 'abs_white', 'abs_black', 'nylon', 'ceramic', 'unspecified'];

interface QuoteRow {
  id: string; process: string; material: string | null; region: string | null;
  quantity: number | null; estimated_krw: number | null; actual_krw: number; created_at: number;
}

export default function AdminQuotesPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const ko = lang === 'ko' || lang === 'kr';
  const T = (k: string, e: string) => (ko ? k : e);
  const { user } = useAuthStore();

  const [process, setProcess] = useState('cnc');
  const [material, setMaterial] = useState('aluminum');
  const [region, setRegion] = useState('kr');
  const [quantity, setQuantity] = useState('100');
  const [estimatedKrw, setEstimatedKrw] = useState('');
  const [actualKrw, setActualKrw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<QuoteRow[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/quotes', { credentials: 'include' });
      if (!res.ok) return;
      const d = await res.json() as { quotes?: QuoteRow[] };
      setRows(d.quotes ?? []);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    const actual = Number(actualKrw);
    if (!actual || actual <= 0) { setMsg(T('실제 견적가(개당, 원)를 입력하세요.', 'Enter the real per-part price (KRW).')); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/quotes', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          process, material, region,
          quantity: Number(quantity) || undefined,
          estimatedKrw: estimatedKrw ? Number(estimatedKrw) : undefined,
          actualKrw: actual,
        }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; factor?: number; error?: string };
      if (!res.ok || !d.ok) { setMsg(d.error || T('저장 실패', 'Save failed')); return; }
      setMsg(T(`저장됨. 이 버킷(${process}/${material}/${region}) 현재 보정계수 ×${d.factor?.toFixed(2)} (3건+부터 반영)`, `Saved. Bucket factor ×${d.factor?.toFixed(2)} (applies from 3+ quotes)`));
      setActualKrw(''); setEstimatedKrw('');
      void load();
    } catch { setMsg(T('네트워크 오류', 'Network error')); } finally { setSaving(false); }
  };

  if (user && user.role !== 'super_admin') {
    return <div className="p-8 text-sm text-red-400">{T('super_admin 권한이 필요합니다.', 'super_admin only.')}</div>;
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto text-[var(--nx-text,#e6edf3)]">
      <h1 className="text-2xl font-bold mb-1">📥 {T('실견적 입력 (원가 보정)', 'Real-quote intake (cost calibration)')}</h1>
      <p className="text-sm opacity-70 mb-6">{T('받은 실제 견적을 넣으면 예상 견적이 실데이터로 점점 정확해집니다.', 'Recording real quotes calibrates the parametric estimate over time.')}</p>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <label className="text-xs">{T('공정', 'Process')}
            <select value={process} onChange={e => setProcess(e.target.value)} className="mt-1 w-full bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm">
              {PROCESSES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-xs">{T('재질', 'Material')}
            <select value={material} onChange={e => setMaterial(e.target.value)} className="mt-1 w-full bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm">
              {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="text-xs">{T('지역', 'Region')}
            <select value={region} onChange={e => setRegion(e.target.value)} className="mt-1 w-full bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm">
              <option value="kr">KR</option><option value="cn">CN</option>
            </select>
          </label>
          <label className="text-xs">{T('수량', 'Quantity')}
            <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 w-full bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm" />
          </label>
          <label className="text-xs">{T('예상견적(개당,원)', 'Estimated (per ea)')} <span className="opacity-50">{T('선택', 'opt')}</span>
            <input type="number" value={estimatedKrw} onChange={e => setEstimatedKrw(e.target.value)} placeholder={T('보정률 계산용', 'for calibration ratio')} className="mt-1 w-full bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold">{T('실제견적(개당,원) *', 'Actual (per ea) *')}
            <input type="number" value={actualKrw} onChange={e => setActualKrw(e.target.value)} className="mt-1 w-full bg-emerald-500/10 border border-emerald-500/30 rounded-md px-2 py-2 text-sm" />
          </label>
        </div>
        <button onClick={submit} disabled={saving} className="mt-4 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-bold">
          {saving ? T('저장 중…', 'Saving…') : T('실견적 저장', 'Save real quote')}
        </button>
        {msg && <div className="text-xs mt-2 opacity-80">{msg}</div>}
        <div className="text-[11px] opacity-50 mt-1">{T('※ 보정계수는 버킷별 실견적 3건 이상부터 예상견적에 반영됩니다.', '※ Calibration applies once a bucket has 3+ real quotes.')}</div>
      </div>

      <h2 className="text-sm font-bold mb-2">🕘 {T('최근 실견적', 'Recent real quotes')} ({rows.length})</h2>
      <table className="w-full text-xs">
        <thead><tr className="opacity-60 border-b border-white/10 text-left">
          <th className="py-1">{T('공정', 'Process')}</th><th>{T('재질', 'Material')}</th><th>{T('지역', 'Region')}</th>
          <th className="text-right">{T('수량', 'Qty')}</th><th className="text-right">{T('예상', 'Est')}</th><th className="text-right">{T('실제', 'Actual')}</th><th className="text-right">{T('비율', 'Ratio')}</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-white/5">
              <td className="py-1">{r.process}</td><td>{r.material}</td><td>{(r.region ?? '').toUpperCase()}</td>
              <td className="text-right">{r.quantity ?? '-'}</td>
              <td className="text-right opacity-70">{r.estimated_krw ? Number(r.estimated_krw).toLocaleString() : '-'}</td>
              <td className="text-right font-semibold">{Number(r.actual_krw).toLocaleString()}</td>
              <td className="text-right opacity-70">{r.estimated_krw ? '×' + (Number(r.actual_krw) / Number(r.estimated_krw)).toFixed(2) : '-'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="py-3 opacity-50 text-center">{T('아직 실견적이 없습니다.', 'No real quotes yet.')}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
