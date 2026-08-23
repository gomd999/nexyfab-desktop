'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

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

function formatDate(ts: number | null, locale: string) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
}

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

function formatMoney(amount: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${formatNumber(amount, locale)} ${currency}`;
  }
}

export default function RefundQueuePage() {
  const { copy, locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const [invoices, setInvoices] = useState<PendingInvoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/nexyfab/admin/refund-queue', { credentials: 'include' });
      if (!res.ok) throw new Error('load failed');
      const j = await res.json() as { invoices: PendingInvoice[] };
      setInvoices(j.invoices);
    } catch {
      setError(L('환불 요청을 불러오지 못했습니다.', 'Could not load refund requests.'));
    } finally {
      setLoading(false);
    }
  }, [L]);

  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(async (invoiceId: string, action: 'approve' | 'reject') => {
    const reason = action === 'approve'
      ? prompt(L('사유 (선택):', 'Reason (optional):')) ?? ''
      : prompt(L('거절 사유:', 'Reason for rejection:')) ?? '';
    if (action === 'reject' && !reason.trim()) {
      alert(L('거절 사유를 입력해야 합니다.', 'A rejection reason is required.'));
      return;
    }
    if (action === 'approve' && !confirm(L('이 인보이스를 승인하고 환불하시겠습니까? 되돌릴 수 없습니다.', 'Approve and refund this invoice? This is irreversible.'))) {
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
      await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('refund action failed');
      // Remove the row from the local list — server already flipped status.
      setInvoices(prev => prev?.filter(p => p.id !== invoiceId) ?? null);
    } catch {
      setError(action === 'approve'
        ? L('환불 승인에 실패했습니다.', 'Could not approve the refund.')
        : L('환불 요청 거절에 실패했습니다.', 'Could not reject the refund request.'));
    } finally {
      setActing(null);
    }
  }, [L]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-semibold">{copy.pageTitles.refundQueue}</h1>
          <button onClick={() => void load()} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-sm">
            {L('새로고침', 'Reload')}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          {L('자동 승인 기준을 통과한 셀프서비스 환불 요청입니다 (Round 28). 승인하면 결제 제공업체에 환불을 요청하고, 거절하면 인보이스가 결제완료 상태로 돌아갑니다.', 'Self-serve refund requests that auto-qualified (Round 28). Approve to call the payment provider; reject to return the invoice to paid status.')}
        </p>

        {loading && <p className="text-gray-500 text-sm">{L('불러오는 중…', 'Loading…')}</p>}
        {error && <p className="text-red-400 text-sm">{L('오류: ', 'Error: ')}{error}</p>}

        {invoices && invoices.length === 0 && (
          <p className="text-gray-500 text-sm">{L('대기 중인 환불 요청이 없습니다.', 'No pending refunds.')}</p>
        )}
        {invoices && invoices.length > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b border-gray-800">
                <tr>
                  <th className="text-left px-3 py-2">{L('인보이스', 'Invoice')}</th>
                  <th className="text-left px-3 py-2">{L('사용자', 'User')}</th>
                  <th className="text-left px-3 py-2">{L('제품', 'Product')}</th>
                  <th className="text-right px-3 py-2">{L('금액', 'Amount')}</th>
                  <th className="text-left px-3 py-2">{L('결제일', 'Paid')}</th>
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
                    <td className="px-3 py-2 text-xs text-right font-mono">{formatMoney(r.amount, r.currency, locale)}</td>
                    <td className="px-3 py-2 text-xs text-gray-400 font-mono">{formatDate(r.paidAt, locale)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          onClick={() => void decide(r.id, 'reject')}
                          disabled={acting === r.id}
                          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded"
                        >{L('거절', 'Reject')}</button>
                        <button
                          onClick={() => void decide(r.id, 'approve')}
                          disabled={acting === r.id}
                          className="text-xs px-2 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded"
                        >{acting === r.id ? '…' : L('승인 및 환불', 'Approve & refund')}</button>
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
