'use client';

import { useEffect, useState, useCallback } from 'react';

interface PendingInvoice {
  id: string;
  userId: string;
  userEmail: string | null;
  product: string;
  amount: number;
  currency: string;
  country: string;
  paidAt: number | null;
  createdAt: number;
  description: string | null;
}

function fmtDate(ts: number | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function fmtAmount(krw: number, ccy: string) {
  if (ccy === 'KRW') return `${krw.toLocaleString('ko-KR')}원`;
  return `${krw.toLocaleString()} ${ccy}`;
}

export default function RefundQueuePage() {
  const [invoices, setInvoices] = useState<PendingInvoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/nexyfab/admin/refund-queue', { credentials: 'include' });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const j = await res.json() as { invoices: PendingInvoice[] };
      setInvoices(j.invoices);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(async (invoiceId: string, action: 'approve' | 'reject') => {
    const reason = action === 'approve'
      ? prompt('Reason (optional):') ?? ''
      : prompt('Reason for rejection:') ?? '';
    if (action === 'reject' && !reason.trim()) {
      alert('A rejection reason is required.');
      return;
    }
    if (action === 'approve' && !confirm('Approve and refund this invoice? This is irreversible.')) {
      return;
    }
    setActing(invoiceId); setError(null);
    try {
      const res = await fetch('/api/nexyfab/admin/refund-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invoiceId, action, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Server ${res.status}`);
      // Remove the row from the local list — server already flipped status.
      setInvoices(prev => prev?.filter(p => p.id !== invoiceId) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-semibold">Refund Queue</h1>
          <button onClick={() => void load()} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-sm">
            Reload
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Self-serve refund requests that auto-qualified (Round 28). Approve to call the payment provider; reject to return the invoice to paid status.
        </p>

        {loading && <p className="text-gray-500 text-sm">Loading…</p>}
        {error && <p className="text-red-400 text-sm">Error: {error}</p>}

        {invoices && invoices.length === 0 && (
          <p className="text-gray-500 text-sm">No pending refunds.</p>
        )}
        {invoices && invoices.length > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b border-gray-800">
                <tr>
                  <th className="text-left px-3 py-2">Invoice</th>
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Paid</th>
                  <th className="text-right px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(r => (
                  <tr key={r.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/40">
                    <td className="px-3 py-2 text-xs font-mono">{r.id.slice(0, 16)}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="text-gray-300">{r.userEmail ?? r.userId.slice(0, 8)}</div>
                      <div className="text-gray-600 font-mono">{r.userId.slice(0, 8)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.product}</td>
                    <td className="px-3 py-2 text-xs text-right font-mono">{fmtAmount(r.amount, r.currency)}</td>
                    <td className="px-3 py-2 text-xs text-gray-400 font-mono">{fmtDate(r.paidAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          onClick={() => void decide(r.id, 'reject')}
                          disabled={acting === r.id}
                          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded"
                        >Reject</button>
                        <button
                          onClick={() => void decide(r.id, 'approve')}
                          disabled={acting === r.id}
                          className="text-xs px-2 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded"
                        >{acting === r.id ? '…' : 'Approve & refund'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
