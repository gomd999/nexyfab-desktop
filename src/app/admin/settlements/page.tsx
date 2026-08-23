'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { useToast } from '@/components/ToastProvider';
import { formatDate } from '@/lib/formatDate';

// ── 타입 정의 ────────────────────────────────────────────────────────────────
interface Settlement {
  id: string;
  contractId: string;
  projectName: string;
  factoryName: string;
  contractAmount: number;
  commissionRate: number;
  grossCommission: number;
  planDeduction: number;
  finalCharge: number;
  isFirstContract: boolean;
  firstContractDiscount: number;
  status: 'pending' | 'invoiced' | 'paid';
  invoiceNumber: string | null;
  invoicedAt: string | null;
  paidAt: string | null;
  notes: string;
  createdAt: string;
}
interface Contract {
  id: string;
  projectName: string;
  factoryName: string;
  contractAmount: number;
  commissionRate: number;
  grossCommission: number;
  planDeduction: number;
  finalCharge: number;
  isFirstContract: boolean;
  firstContractDiscount: number;
  status: string;
  createdAt: string;
}

// ── 유틸 함수 ────────────────────────────────────────────────────────────────
function formatKRW(n: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n);
}

// ── CSV 내보내기 ─────────────────────────────────────────────────────────────
function exportCSV(settlements: Settlement[], L: (ko: string, en: string) => string, locale: string) {
  const headers = [
    L('정산ID', 'Settlement ID'), L('계약ID', 'Contract ID'), L('프로젝트명', 'Project'), L('파트너사', 'Partner'),
    L('계약금액', 'Contract amount'), L('수수료율', 'Commission rate'), L('총수수료', 'Gross commission'), L('플랜공제', 'Plan deduction'), L('최종수수료', 'Final charge'),
    L('상태', 'Status'), L('인보이스번호', 'Invoice number'), L('청구일', 'Invoiced at'), L('입금일', 'Paid at'), L('메모', 'Notes'), L('생성일', 'Created at'),
  ];
  const rows = settlements.map(s => [
    s.id, s.contractId, s.projectName, s.factoryName,
    s.contractAmount.toLocaleString(locale), `${s.commissionRate.toLocaleString(locale)}%`,
    s.grossCommission.toLocaleString(locale), s.planDeduction.toLocaleString(locale), s.finalCharge.toLocaleString(locale),
    s.status === 'pending' ? L('미청구', 'Pending invoice') : s.status === 'invoiced' ? L('청구완료', 'Invoiced') : L('입금완료', 'Paid'),
    s.invoiceNumber ?? '',
    formatDate(s.invoicedAt, locale),
    formatDate(s.paidAt, locale),
    s.notes,
    formatDate(s.createdAt, locale),
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `settlements_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 상태 배지 ────────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<Settlement['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  invoiced: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
};
type FilterTab = 'all' | 'pending' | 'invoiced' | 'paid';

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function SettlementsPage() {
  const { copy, locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const { toast } = useToast();
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [completedContracts, setCompletedContracts] = useState<Contract[]>([]);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusLabel = (status: Settlement['status']) => ({
    pending: L('미청구', 'Pending invoice'),
    invoiced: L('청구완료', 'Invoiced'),
    paid: L('입금완료', 'Paid'),
  }[status]);

  // 데이터 로드
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [sRes, cRes] = await Promise.all([
        fetch('/api/settlements'),
        fetch('/api/contracts'),
      ]);
      const sData = await sRes.json();
      const cData = await cRes.json();

      setSettlements(sData.settlements || []);

      // 완료 계약 중 아직 정산 없는 것들
      const existingContractIds = new Set(
        (sData.settlements as Settlement[]).map(s => s.contractId)
      );
      const completed = (cData.contracts as Contract[]).filter(
        c => c.status === 'completed' && !existingContractIds.has(c.id)
      );
      setCompletedContracts(completed);
    } catch (e) {
      setError(L('데이터를 불러오지 못했습니다.', 'Could not load settlement data.'));
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [L]);

  useEffect(() => { loadData(); }, [loadData]);

  // 정산 수동 생성 (completed 계약에서)
  async function createSettlement(contract: Contract) {
    setActionLoading(`create-${contract.id}`);
    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: contract.id,
          projectName: contract.projectName,
          factoryName: contract.factoryName,
          contractAmount: contract.contractAmount,
          commissionRate: contract.commissionRate,
          grossCommission: contract.grossCommission,
          planDeduction: contract.planDeduction,
          finalCharge: contract.finalCharge,
          isFirstContract: contract.isFirstContract,
          firstContractDiscount: contract.firstContractDiscount,
        }),
      });
      if (!res.ok) {
        await res.json();
        toast('error', L('정산 생성에 실패했습니다.', 'Could not create the settlement.'));
      } else {
        await loadData();
      }
    } finally {
      setActionLoading(null);
    }
  }

  // 상태 변경 (pending→invoiced, invoiced→paid)
  async function updateStatus(id: string, newStatus: 'invoiced' | 'paid') {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/settlements/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        await res.json();
        toast('error', L('상태 변경에 실패했습니다.', 'Could not update the status.'));
      } else {
        // 응답의 최신 settlement로 상태 갱신 후 전체 리로드
        const d = await res.json();
        if (d.settlement) {
          setSettlements(prev =>
            prev.map(s => s.id === id ? d.settlement : s)
          );
        }
        await loadData();
      }
    } finally {
      setActionLoading(null);
    }
  }

  // ── 통계 계산 ─────────────────────────────────────────────────────────────
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // 미수금 (pending + invoiced의 finalCharge 합)
  const outstanding = settlements
    .filter(s => s.status !== 'paid')
    .reduce((sum, s) => sum + s.finalCharge, 0);

  // 이번달 수수료 (생성일 기준)
  const thisMonthCommission = settlements
    .filter(s => s.createdAt.slice(0, 7) === thisMonthKey)
    .reduce((sum, s) => sum + s.finalCharge, 0);

  // 누적 수납액
  const totalPaid = settlements
    .filter(s => s.status === 'paid')
    .reduce((sum, s) => sum + s.finalCharge, 0);

  // ── 필터 적용 ─────────────────────────────────────────────────────────────
  const filtered = filterTab === 'all'
    ? settlements
    : settlements.filter(s => s.status === filterTab);

  // ── 탭 카운트 ─────────────────────────────────────────────────────────────
  const tabCounts: Record<FilterTab, number> = {
    all: settlements.length,
    pending: settlements.filter(s => s.status === 'pending').length,
    invoiced: settlements.filter(s => s.status === 'invoiced').length,
    paid: settlements.filter(s => s.status === 'paid').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">{L('불러오는 중...', 'Loading...')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 text-sm mb-4">{error}</p>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {L('다시 시도', 'Try again')}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{copy.pageTitles.settlements}</h1>
          <p className="text-gray-500 text-sm mt-1">{L('수수료 청구 및 입금 현황 관리', 'Manage commission billing and payments')}</p>
        </div>
        <button
          onClick={() => exportCSV(settlements, L, locale)}
          className="px-4 py-2 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
        >
          {L('CSV 내보내기', 'Export CSV')}
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border-l-4 border-amber-400 p-5 shadow-sm">
          <div className="text-xs text-gray-400 mb-1">{L('미수금 합계', 'Total outstanding')}</div>
          <div className="text-2xl font-bold text-amber-600">{formatKRW(outstanding, locale)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{L('미청구 + 청구완료 합산', 'Pending invoices + invoiced')}</div>
        </div>
        <div className="bg-white rounded-xl border-l-4 border-blue-400 p-5 shadow-sm">
          <div className="text-xs text-gray-400 mb-1">{L('이번달 수수료', 'Commission this month')}</div>
          <div className="text-2xl font-bold text-blue-600">{formatKRW(thisMonthCommission, locale)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{thisMonthKey} {L('기준', 'as of')}</div>
        </div>
        <div className="bg-white rounded-xl border-l-4 border-green-400 p-5 shadow-sm">
          <div className="text-xs text-gray-400 mb-1">{L('누적 수납액', 'Total collected')}</div>
          <div className="text-2xl font-bold text-green-600">{formatKRW(totalPaid, locale)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{L('입금 완료 건 합계', 'Total paid settlements')}</div>
        </div>
      </div>

      {/* 정산 미생성 완료 계약 알림 */}
      {completedContracts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-amber-600 font-semibold text-sm">
              {L('정산 미생성 완료 계약 ', 'Completed contracts without settlements: ')}{completedContracts.length.toLocaleString(locale)}{L('건', ' items')}
            </span>
            <span className="text-xs text-amber-500">— {L('아래 버튼으로 정산 항목을 생성하세요', 'Create settlement items with the buttons below')}</span>
          </div>
          <div className="space-y-2">
            {completedContracts.map(c => (
              <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border border-amber-100">
                <div>
                  <span className="text-sm font-medium text-gray-800">{c.projectName}</span>
                  <span className="text-xs text-gray-400 ml-2">{c.id}</span>
                  <span className="text-xs text-gray-400 ml-2">{formatKRW(c.contractAmount || 0, locale)}</span>
                </div>
                <button
                  onClick={() => createSettlement(c)}
                  disabled={actionLoading === `create-${c.id}`}
                  className="text-xs px-3 py-1 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  {actionLoading === `create-${c.id}` ? L('생성중...', 'Creating...') : L('정산 생성', 'Create settlement')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 필터 탭 */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: 'all', label: L('전체', 'All') },
          { key: 'pending', label: statusLabel('pending') },
          { key: 'invoiced', label: statusLabel('invoiced') },
          { key: 'paid', label: statusLabel('paid') },
        ] as { key: FilterTab; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(tab.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filterTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
              filterTab === tab.key ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'
            }`}>
              {tabCounts[tab.key].toLocaleString(locale)}
            </span>
          </button>
        ))}
      </div>

      {/* 정산 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">{L('해당 상태의 정산 항목이 없습니다.', 'No settlements match this status.')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">{L('정산ID', 'Settlement ID')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">{L('계약ID', 'Contract ID')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">{L('프로젝트명', 'Project')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">{L('파트너사', 'Partner')}</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">{L('계약금액', 'Contract amount')}</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">{L('수수료', 'Commission')}</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 text-xs">{L('상태', 'Status')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">{L('인보이스', 'Invoice')}</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 text-xs">{L('청구일', 'Invoiced at')}</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 text-xs">{L('입금일', 'Paid at')}</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 text-xs">{L('액션', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, idx) => (
                  <tr
                    key={s.id}
                    className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                      idx % 2 === 0 ? '' : 'bg-gray-50/30'
                    }`}
                  >
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">{s.id}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">{s.contractId}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-800">{s.projectName}</span>
                      {s.isFirstContract && (
                        <span className="ml-1.5 text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">
                          {L('최초우대', 'First-contract discount')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.factoryName || '-'}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-800">
                      {formatKRW(s.contractAmount, locale)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-green-700">{formatKRW(s.finalCharge, locale)}</span>
                      <div className="text-xs text-gray-400">{s.commissionRate.toLocaleString(locale)}% - {L('플랜공제', 'plan deduction')}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_BADGE[s.status]}`}>
                        {statusLabel(s.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                      {s.invoiceNumber ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">
                      {formatDate(s.invoicedAt, locale)}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">
                      {formatDate(s.paidAt, locale)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {s.status === 'pending' && (
                        <button
                          onClick={() => updateStatus(s.id, 'invoiced')}
                          disabled={actionLoading === s.id}
                          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {actionLoading === s.id ? L('처리중...', 'Processing...') : L('청구서 발행', 'Issue invoice')}
                        </button>
                      )}
                      {s.status === 'invoiced' && (
                        <button
                          onClick={() => updateStatus(s.id, 'paid')}
                          disabled={actionLoading === s.id}
                          className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {actionLoading === s.id ? L('처리중...', 'Processing...') : L('입금 확인', 'Confirm payment')}
                        </button>
                      )}
                      {s.status === 'paid' && (
                        <span className="text-xs text-green-500 font-medium">{L('완료', 'Complete')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 수수료 계산 안내 */}
      <div className="mt-4 text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
        <span className="font-medium text-gray-500">{L('수수료 계산 기준:', 'Commission calculation:')}</span>{' '}
        {L('계약금액 × 수수료율 - 플랜 기본공제 (스탠다드 50만원 / 프리미엄 100만원) = 최종 수수료. 최초 계약 고객은 1% 우대 할인 적용.', 'Contract amount × commission rate - plan deduction (Standard KRW 500,000 / Premium KRW 1,000,000) = final charge. First contracts receive a 1% discount.')}
      </div>
    </div>
  );
}
