'use client';

import { useEffect, useState, useCallback } from 'react';
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
function formatKRW(n: number) {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억원`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만원`;
  return `${n.toLocaleString('ko-KR')}원`;
}

// ── CSV 내보내기 ─────────────────────────────────────────────────────────────
function exportCSV(settlements: Settlement[]) {
  const headers = [
    '정산ID', '계약ID', '프로젝트명', '파트너사',
    '계약금액', '수수료율', '총수수료', '플랜공제', '최종수수료',
    '상태', '인보이스번호', '청구일', '입금일', '메모', '생성일',
  ];
  const rows = settlements.map(s => [
    s.id, s.contractId, s.projectName, s.factoryName,
    s.contractAmount, `${s.commissionRate}%`,
    s.grossCommission, s.planDeduction, s.finalCharge,
    s.status === 'pending' ? '미청구' : s.status === 'invoiced' ? '청구완료' : '입금완료',
    s.invoiceNumber ?? '',
    formatDate(s.invoicedAt),
    formatDate(s.paidAt),
    s.notes,
    formatDate(s.createdAt),
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
const STATUS_LABEL: Record<Settlement['status'], string> = {
  pending: '미청구',
  invoiced: '청구완료',
  paid: '입금완료',
};

type FilterTab = 'all' | 'pending' | 'invoiced' | 'paid';

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function SettlementsPage() {
  const { toast } = useToast();
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [completedContracts, setCompletedContracts] = useState<Contract[]>([]);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setError('데이터 로드 실패');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

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
        const d = await res.json();
        toast('error', d.error || '정산 생성 실패');
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
        const d = await res.json();
        toast('error', d.error || '상태 변경 실패');
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
          <p className="text-sm">불러오는 중...</p>
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
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">정산 관리</h1>
          <p className="text-gray-500 text-sm mt-1">수수료 청구 및 입금 현황 관리</p>
        </div>
        <button
          onClick={() => exportCSV(settlements)}
          className="px-4 py-2 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
        >
          CSV 내보내기
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border-l-4 border-amber-400 p-5 shadow-sm">
          <div className="text-xs text-gray-400 mb-1">미수금 합계</div>
          <div className="text-2xl font-bold text-amber-600">{formatKRW(outstanding)}</div>
          <div className="text-xs text-gray-400 mt-0.5">미청구 + 청구완료 합산</div>
        </div>
        <div className="bg-white rounded-xl border-l-4 border-blue-400 p-5 shadow-sm">
          <div className="text-xs text-gray-400 mb-1">이번달 수수료</div>
          <div className="text-2xl font-bold text-blue-600">{formatKRW(thisMonthCommission)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{thisMonthKey} 기준</div>
        </div>
        <div className="bg-white rounded-xl border-l-4 border-green-400 p-5 shadow-sm">
          <div className="text-xs text-gray-400 mb-1">누적 수납액</div>
          <div className="text-2xl font-bold text-green-600">{formatKRW(totalPaid)}</div>
          <div className="text-xs text-gray-400 mt-0.5">입금 완료 건 합계</div>
        </div>
      </div>

      {/* 정산 미생성 완료 계약 알림 */}
      {completedContracts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-amber-600 font-semibold text-sm">
              정산 미생성 완료 계약 {completedContracts.length}건
            </span>
            <span className="text-xs text-amber-500">— 아래 버튼으로 정산 항목을 생성하세요</span>
          </div>
          <div className="space-y-2">
            {completedContracts.map(c => (
              <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border border-amber-100">
                <div>
                  <span className="text-sm font-medium text-gray-800">{c.projectName}</span>
                  <span className="text-xs text-gray-400 ml-2">{c.id}</span>
                  <span className="text-xs text-gray-400 ml-2">{formatKRW(c.contractAmount || 0)}</span>
                </div>
                <button
                  onClick={() => createSettlement(c)}
                  disabled={actionLoading === `create-${c.id}`}
                  className="text-xs px-3 py-1 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  {actionLoading === `create-${c.id}` ? '생성중...' : '정산 생성'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 필터 탭 */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: 'all', label: '전체' },
          { key: 'pending', label: '미청구' },
          { key: 'invoiced', label: '청구완료' },
          { key: 'paid', label: '입금완료' },
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
              {tabCounts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      {/* 정산 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">해당 상태의 정산 항목이 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">정산ID</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">계약ID</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">프로젝트명</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">파트너사</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">계약금액</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 text-xs">수수료</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 text-xs">상태</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs">인보이스</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 text-xs">청구일</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 text-xs">입금일</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 text-xs">액션</th>
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
                          최초우대
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.factoryName || '-'}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-800">
                      {formatKRW(s.contractAmount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-green-700">{formatKRW(s.finalCharge)}</span>
                      <div className="text-xs text-gray-400">{s.commissionRate}% - 플랜공제</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_BADGE[s.status]}`}>
                        {STATUS_LABEL[s.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                      {s.invoiceNumber ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">
                      {formatDate(s.invoicedAt)}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">
                      {formatDate(s.paidAt)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {s.status === 'pending' && (
                        <button
                          onClick={() => updateStatus(s.id, 'invoiced')}
                          disabled={actionLoading === s.id}
                          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {actionLoading === s.id ? '처리중...' : '청구서 발행'}
                        </button>
                      )}
                      {s.status === 'invoiced' && (
                        <button
                          onClick={() => updateStatus(s.id, 'paid')}
                          disabled={actionLoading === s.id}
                          className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {actionLoading === s.id ? '처리중...' : '입금 확인'}
                        </button>
                      )}
                      {s.status === 'paid' && (
                        <span className="text-xs text-green-500 font-medium">완료</span>
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
        <span className="font-medium text-gray-500">수수료 계산 기준:</span>
        {' '}계약금액 × 수수료율 - 플랜 기본공제 (스탠다드 50만원 / 프리미엄 100만원) = 최종 수수료.
        최초 계약 고객은 1% 우대 할인 적용.
      </div>
    </div>
  );
}
