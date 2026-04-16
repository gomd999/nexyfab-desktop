'use client';

import { useState, useEffect, useRef } from 'react';
import { useToast, type ToastType } from '@/components/ToastProvider';

function downloadContractsCSV(data: any[], toast?: (type: ToastType, message: string) => void) {
  if (data.length === 0) { toast?.('warning', '내보낼 데이터가 없습니다.'); return; }
  const headers = ['계약ID', '날짜', '프로젝트명', '파트너사', '계약금액', '신규우대', '수수료율(%)', '우대할인', '총수수료', '플랜공제', '최종수수료', '상태', '완료일'];
  const rows = data.map(c => [
    c.id, c.contractDate || c.createdAt?.slice(0,10) || '',
    c.projectName || '', c.factoryName || '',
    c.contractAmount || 0,
    c.isFirstContract ? '신규1%우대' : '일반',
    c.commissionRate || 0,
    c.firstContractDiscount || 0,
    c.grossCommission || 0, c.planDeduction || 0, c.finalCharge || 0,
    c.status || '', c.completedAt?.slice(0,10) || '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `contracts_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export const dynamic = 'force-dynamic';

interface ProgressNote {
  date: string;
  note: string;
  updatedBy: string;
}

interface Attachment {
  id: string;
  filename: string;
  originalName: string;
  type: 'image' | 'model' | 'document';
  mimeType: string;
  size: number;
  url: string;
  uploadedBy: string;
  uploadedAt: string;
}

interface CustomerContact {
  name?: string;
  email?: string;
  phone?: string;
}

interface Contract {
  id: string;
  projectName: string;
  factoryName: string;
  contractAmount: number;
  plan: string;
  status: string;
  commissionRate: number;
  baseCommissionRate?: number;
  grossCommission: number;
  planDeduction: number;
  finalCharge: number;
  contractDate: string;
  createdAt: string;
  quoteId?: string;
  customerEmail?: string;
  commissionStatus?: string;
  completedAt?: string;
  partnerEmail?: string;
  progressNotes?: ProgressNote[];
  attachments?: Attachment[];
  deadline?: string;
  customerContact?: CustomerContact;
  completionRequested?: boolean;
  completionRequestedAt?: string;
  // 최초 계약 우대
  isFirstContract?: boolean;
  firstContractDiscount?: number;
}

interface Message {
  id: string;
  contractId: string;
  sender: string;
  senderType: 'admin' | 'partner' | 'customer';
  text: string;
  createdAt: string;
}

interface ApprovedPartner {
  id: string;
  email?: string;
  company?: string;
  name?: string;
  partnerStatus: string;
}

const STATUS_LABELS: Record<string, string> = {
  contracted: '계약 완료',
  in_progress: '진행 중',
  quality_check: '품질 검수',
  delivered: '납품 완료',
  completed: '완료',
  cancelled: '취소됨',
};

const STATUS_COLORS: Record<string, string> = {
  contracted: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  quality_check: 'bg-orange-100 text-orange-700',
  delivered: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_FLOW: Record<string, string> = {
  contracted: 'in_progress',
  in_progress: 'quality_check',
  quality_check: 'delivered',
  delivered: 'completed',
};

const TOKEN_KEY = 'nexyfab_admin_authed';

const won = (n: number) => n?.toLocaleString('ko-KR') + '원';

function formatBytes(bytes: number) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function getFileIcon(att: Attachment) {
  const modelExts = ['stl', 'step', 'stp', 'obj', '3ds', 'iges', 'igs'];
  const docExts = ['pdf', 'dwg', 'dxf'];
  const ext = att.originalName.split('.').pop()?.toLowerCase() || '';
  if (modelExts.includes(ext)) return '🧊';
  if (docExts.includes(ext)) return '📐';
  return '📎';
}

export default function ContractsAdminPage() {
  const { toast } = useToast();
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [detailContract, setDetailContract] = useState<Contract | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [approvedPartners, setApprovedPartners] = useState<ApprovedPartner[]>([]);
  const [assigningPartner, setAssigningPartner] = useState(false);
  const [partnerEmailInput, setPartnerEmailInput] = useState('');

  // 상세 모달 추가 필드
  const [deadlineInput, setDeadlineInput] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [modalAttachments, setModalAttachments] = useState<Attachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);

  // 메시지 스레드
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const msgListRef = useRef<HTMLDivElement>(null);

  // Check stored token on mount
  useEffect(() => {
    if (localStorage.getItem(TOKEN_KEY) === '1') setAuthed(true);
  }, []);

  // Fetch contracts whenever authed
  useEffect(() => {
    if (authed) {
      fetchContracts();
      fetchApprovedPartners();
    }
  }, [authed]);

  // 상세 모달 열릴 때 첨부 파일 로드
  useEffect(() => {
    if (!detailContract) return;
    setDeadlineInput(detailContract.deadline || '');
    setContactName(detailContract.customerContact?.name || '');
    setContactEmail(detailContract.customerContact?.email || '');
    setContactPhone(detailContract.customerContact?.phone || '');
    setModalAttachments(detailContract.attachments || []);
    setMessages([]);
    setMsgInput('');
    // API에서 최신 첨부 파일 조회
    setLoadingAttachments(true);
    fetch(`/api/files/${detailContract.id}`)
      .then(r => r.json())
      .then(d => setModalAttachments(d.attachments || []))
      .catch(() => {})
      .finally(() => setLoadingAttachments(false));
    // 메시지 초기 로드
    fetch(`/api/messages?contractId=${detailContract.id}`)
      .then(r => r.json())
      .then(d => setMessages(d.messages || []))
      .catch(() => {});
  }, [detailContract?.id]);

  // 메시지 15초 폴링
  useEffect(() => {
    if (!detailContract) return;
    const timerId = setInterval(() => {
      fetch(`/api/messages?contractId=${detailContract.id}`)
        .then(r => r.json())
        .then(d => setMessages(d.messages || []))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(timerId);
  }, [detailContract?.id]);

  async function sendMessage() {
    if (!detailContract || !msgInput.trim()) return;
    setSendingMsg(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: detailContract.id,
          sender: '관리자',
          senderType: 'admin',
          text: msgInput.trim(),
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMessages(prev => [...prev, data.message]);
      setMsgInput('');
      setTimeout(() => {
        if (msgListRef.current) msgListRef.current.scrollTop = msgListRef.current.scrollHeight;
      }, 50);
    } catch {
      toast('error', '메시지 전송에 실패했습니다.');
    } finally {
      setSendingMsg(false);
    }
  }

  async function fetchApprovedPartners() {
    try {
      const res = await fetch('/api/partners');
      const data = await res.json();
      setApprovedPartners((data.partners || []).filter((p: ApprovedPartner) => p.partnerStatus === 'approved'));
    } catch { /* silent */ }
  }

  async function assignPartner(contractId: string, partnerEmail: string) {
    setAssigningPartner(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerEmail }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setContracts(prev => prev.map(c => c.id === contractId ? data.contract : c));
      setDetailContract(data.contract);
      toast('success', '파트너가 배정되었습니다.');
    } catch {
      toast('error', '파트너 배정에 실패했습니다.');
    } finally {
      setAssigningPartner(false);
    }
  }

  async function saveMeta(contractId: string) {
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deadline: deadlineInput || null,
          customerContact: {
            name: contactName,
            email: contactEmail,
            phone: contactPhone,
          },
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setContracts(prev => prev.map(c => c.id === contractId ? data.contract : c));
      setDetailContract(data.contract);
      toast('success', '저장되었습니다.');
    } catch {
      toast('error', '저장에 실패했습니다.');
    } finally {
      setSavingMeta(false);
    }
  }

  async function completeContract(contractId: string) {
    if (!confirm('최종 완료 처리하시겠습니까?')) return;
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setContracts(prev => prev.map(c => c.id === contractId ? data.contract : c));
      setDetailContract(data.contract);
    } catch {
      toast('error', '완료 처리에 실패했습니다.');
    }
  }

  async function fetchContracts() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/contracts');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setContracts(data.contracts || []);
    } catch {
      setError('계약 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, nextStatus: string) {
    setUpdating(id + ':' + nextStatus);
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error('Update failed');
      const data = await res.json();
      setContracts(prev =>
        prev.map(c => (c.id === id ? data.contract : c))
      );
    } catch {
      toast('error', '상태 업데이트에 실패했습니다.');
    } finally {
      setUpdating(null);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwInput }),
    });
    if (res.ok) {
      localStorage.setItem(TOKEN_KEY, '1');
      setAuthed(true);
      setPwError('');
    } else {
      setPwError('비밀번호가 올바르지 않습니다.');
    }
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setAuthed(false);
    setPwInput('');
  }

  // --- Password gate ---
  if (!authed) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 w-full max-w-sm">
          <h1 className="text-2xl font-black text-gray-900 mb-1">관리자 인증</h1>
          <p className="text-sm text-gray-500 mb-8">계약 관리 페이지에 접근하려면 비밀번호를 입력하세요.</p>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input
              type="password"
              placeholder="비밀번호"
              value={pwInput}
              onChange={e => setPwInput(e.target.value)}
              autoFocus
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            {pwError && <p className="text-red-500 text-sm font-semibold">{pwError}</p>}
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition text-sm"
            >
              로그인
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- Filtered contracts ---
  const filtered = contracts.filter(c => {
    const cDate = c.contractDate || c.createdAt?.slice(0, 10) || '';
    return (!dateFrom || cDate >= dateFrom) && (!dateTo || cDate <= dateTo);
  });

  // --- Stats ---
  const totalAmount = contracts.reduce((s, c) => s + c.contractAmount, 0);
  const totalFinalCharge = contracts.reduce((s, c) => s + c.finalCharge, 0);
  const completedCount = contracts.filter(c => c.status === 'completed').length;

  // --- Main page ---
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900">계약 관리</h1>
          <p className="text-sm text-gray-500 mt-1">NexyFab Admin — 전체 계약 현황</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => downloadContractsCSV(filtered, toast)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            CSV 내보내기
          </button>
          <button
            onClick={fetchContracts}
            disabled={loading}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
          >
            {loading ? '새로고침 중...' : '새로고침'}
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-200 transition"
          >
            로그아웃
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">총 계약 수</p>
          <p className="text-2xl font-black text-gray-900">{contracts.length}건</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">총 계약 금액</p>
          <p className="text-xl font-black text-gray-900 truncate">{won(totalAmount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">총 최종 수수료</p>
          <p className="text-xl font-black text-blue-600 truncate">{won(totalFinalCharge)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">완료 건수</p>
          <p className="text-2xl font-black text-green-600">{completedCount}건</p>
        </div>
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">기간</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <span className="text-xs text-gray-400">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-gray-400 hover:text-gray-600">초기화</button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm font-semibold rounded-xl">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-gray-400 text-sm">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-gray-400 text-sm">등록된 계약이 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">프로젝트명</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">파트너사</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">계약금액</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">수수료율</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">최종 수수료</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">플랜</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">상태</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">계약일</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">액션</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => {
                  const nextStatus = STATUS_FLOW[c.status];
                  const canAdvance = !!nextStatus;
                  const canCancel = c.status !== 'cancelled' && c.status !== 'completed';
                  const isUpdating = updating?.startsWith(c.id);

                  return (
                    <tr
                      key={c.id}
                      onClick={() => { setDetailContract(c); setPartnerEmailInput(c.partnerEmail || ''); }}
                      className={`border-b border-gray-50 hover:bg-gray-50 transition cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">
                        {c.id}
                        {c.completionRequested && (
                          <span className="ml-1 text-amber-500" title="파트너가 완료 확인 요청함">⚡</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap max-w-[160px] truncate">{c.projectName}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.factoryName || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{won(c.contractAmount)}</td>
                      <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                        {c.commissionRate}%
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-blue-600 whitespace-nowrap">{won(c.finalCharge)}</td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${c.plan === 'premium' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'}`}>
                          {c.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[c.status] || c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap text-xs">{c.contractDate}</td>
                      <td className="px-4 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-2">
                          {canAdvance && (
                            <button
                              onClick={() => updateStatus(c.id, nextStatus)}
                              disabled={!!isUpdating}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition disabled:opacity-50 whitespace-nowrap"
                            >
                              {isUpdating && updating === c.id + ':' + nextStatus
                                ? '...'
                                : `다음 단계 →`}
                            </button>
                          )}
                          {canCancel && (
                            <button
                              onClick={() => {
                                if (confirm(`계약 "${c.projectName}"을 취소하시겠습니까?`)) {
                                  updateStatus(c.id, 'cancelled');
                                }
                              }}
                              disabled={!!isUpdating}
                              className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg border border-red-200 transition disabled:opacity-50 whitespace-nowrap"
                            >
                              취소
                            </button>
                          )}
                          {!canAdvance && !canCancel && (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {detailContract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetailContract(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between sticky top-0">
              <div>
                <div className="text-xs text-gray-400 font-mono">{detailContract.id}</div>
                <div className="text-lg font-bold mt-0.5">{detailContract.projectName}</div>
              </div>
              <button
                onClick={async () => {
                  const res = await fetch(`/api/contracts/${detailContract.id}/pdf`);
                  const html = await res.text();
                  const win = window.open('', '_blank');
                  win?.document.write(html);
                  win?.document.close();
                  win?.print();
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20"
              >
                🖨️ 계약서 출력
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* 완료 요청 배지 */}
              {detailContract.completionRequested && detailContract.status !== 'completed' && (
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-amber-700">⚡ 파트너가 완료 확인 요청함</p>
                    {detailContract.completionRequestedAt && (
                      <p className="text-xs text-amber-600 mt-0.5">
                        {new Date(detailContract.completionRequestedAt).toLocaleDateString('ko-KR')}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => completeContract(detailContract.id)}
                    className="px-3 py-2 text-xs font-bold rounded-lg bg-green-600 hover:bg-green-700 text-white transition"
                  >
                    완료 처리
                  </button>
                </div>
              )}

              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: '파트너사', value: detailContract.factoryName || '—' },
                  { label: '플랜', value: detailContract.plan === 'premium' ? 'Premium' : 'Standard' },
                  { label: '계약일', value: detailContract.contractDate || '—' },
                  { label: '상태', value: STATUS_LABELS[detailContract.status] || detailContract.status },
                ].map(item => (
                  <div key={item.label} className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-400">{item.label}</div>
                    <div className="text-sm font-semibold text-gray-800 mt-0.5">{item.value}</div>
                  </div>
                ))}
              </div>

              {/* 수수료 계산 */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-700">수수료 계산</h3>
                  {/* 신규 우대 수동 토글 */}
                  <button
                    onClick={async () => {
                      const next = !detailContract.isFirstContract;
                      await fetch(`/api/contracts/${detailContract.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isFirstContract: next }),
                      });
                      setContracts(prev => prev.map(c => {
                        if (c.id !== detailContract.id) return c;
                        const baseRate = c.baseCommissionRate ?? c.commissionRate;
                        const newRate = Math.max(3, baseRate - (next ? 1 : 0));
                        const discount = next ? Math.round(c.contractAmount * 0.01) : 0;
                        const gross = Math.round(c.contractAmount * newRate / 100);
                        const updated = { ...c, isFirstContract: next, firstContractDiscount: discount, commissionRate: newRate, grossCommission: gross, finalCharge: Math.max(0, gross - c.planDeduction) };
                        setDetailContract(updated);
                        return updated;
                      }));
                    }}
                    className={`text-xs px-2.5 py-1 rounded-full font-bold border transition-colors ${detailContract.isFirstContract ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'}`}
                  >
                    🎁 신규 고객 1% 우대 {detailContract.isFirstContract ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="space-y-2">
                  {[
                    { label: '계약금액', value: won(detailContract.contractAmount), bold: false },
                    { label: `수수료율 (${detailContract.commissionRate}%)`, value: won(detailContract.grossCommission), bold: false },
                    { label: '플랜 공제', value: '- ' + won(detailContract.planDeduction), bold: false, color: 'text-red-500' },
                    { label: '최종 수수료', value: won(detailContract.finalCharge), bold: true, color: 'text-blue-700' },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                      <span className={`text-sm ${row.bold ? 'font-bold text-gray-900' : 'text-gray-600'}`}>{row.label}</span>
                      <span className={`text-sm font-semibold ${row.color || 'text-gray-800'} ${row.bold ? 'text-base' : ''}`}>{row.value}</span>
                    </div>
                  ))}
                </div>
                {/* 신규 우대 적용 여부 — 어드민 내부 확인용 (고객 노출 없음) */}
                {detailContract.isFirstContract && (
                  <p className="mt-2 text-xs text-gray-400">* 신규 계약 우대 적용됨</p>
                )}
              </div>

              {detailContract.quoteId && (
                <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-600">
                  연결된 문의 ID: {detailContract.quoteId}
                </div>
              )}

              {/* 납기일 설정 */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">납기일 설정</h3>
                <input
                  type="date"
                  value={deadlineInput}
                  onChange={e => setDeadlineInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                />
              </div>

              {/* 고객 담당자 연락처 */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">고객 담당자 연락처</h3>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={contactName}
                    onChange={e => setContactName(e.target.value)}
                    placeholder="담당자명"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    placeholder="이메일"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={e => setContactPhone(e.target.value)}
                    placeholder="전화번호"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                </div>
                <button
                  onClick={() => saveMeta(detailContract.id)}
                  disabled={savingMeta}
                  className="mt-3 w-full py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                >
                  {savingMeta ? '저장 중...' : '납기일 및 담당자 저장'}
                </button>
              </div>

              {/* 파트너 배정 */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">파트너 배정</h3>
                {detailContract.partnerEmail && (
                  <div className="mb-2 px-3 py-2 bg-green-50 rounded-lg text-xs text-green-700 font-semibold">
                    현재 배정: {detailContract.partnerEmail}
                  </div>
                )}
                <div className="flex gap-2">
                  <select
                    value={partnerEmailInput}
                    onChange={e => setPartnerEmailInput(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 bg-white"
                  >
                    <option value="">— 파트너 선택 —</option>
                    {approvedPartners.map(p => (
                      <option key={p.id} value={p.email || ''}>
                        {p.company || p.name || '이름없음'} ({p.email || '이메일없음'})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => { if (partnerEmailInput) assignPartner(detailContract.id, partnerEmailInput); }}
                    disabled={assigningPartner || !partnerEmailInput}
                    className="px-3 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                  >
                    {assigningPartner ? '저장 중...' : '배정'}
                  </button>
                </div>
              </div>

              {/* 업로드된 파일 목록 */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">
                  업로드된 파일 {modalAttachments.length > 0 && `(${modalAttachments.length}개)`}
                </h3>
                {loadingAttachments ? (
                  <p className="text-xs text-gray-400">로딩 중...</p>
                ) : modalAttachments.length === 0 ? (
                  <p className="text-xs text-gray-400">첨부된 파일이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {modalAttachments.filter(a => a.type === 'image').length > 0 && (
                      <div className="grid grid-cols-4 gap-2 mb-2">
                        {modalAttachments.filter(a => a.type === 'image').map(att => (
                          <a key={att.id} href={att.url} target="_blank" rel="noreferrer">
                            <img
                              src={att.url}
                              alt={att.originalName}
                              className="w-full h-16 object-cover rounded-lg border border-gray-100 hover:border-blue-300 transition"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                    {modalAttachments.filter(a => a.type !== 'image').map(att => (
                      <div key={att.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                        <span className="text-lg">{getFileIcon(att)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-700 truncate">{att.originalName}</p>
                          <p className="text-xs text-gray-400">{att.uploadedBy} · {formatBytes(att.size)}</p>
                        </div>
                        <a
                          href={att.url}
                          download={att.originalName}
                          className="px-2 py-1 text-xs font-semibold rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 transition shrink-0"
                        >
                          다운로드
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 진행 기록 */}
              {detailContract.progressNotes && detailContract.progressNotes.length > 0 && (
                <div className="border-t border-gray-100 pt-4">
                  <h3 className="text-sm font-bold text-gray-700 mb-3">진행 기록</h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {[...detailContract.progressNotes].reverse().map((pn, idx) => (
                      <div key={idx} className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-gray-700">{pn.updatedBy}</span>
                          <span className="text-gray-400">{new Date(pn.date).toLocaleDateString('ko-KR')}</span>
                        </div>
                        <p className="text-sm text-gray-600">{pn.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 메시지 스레드 */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">💬 메시지 스레드</h3>
                <div
                  ref={msgListRef}
                  className="h-48 overflow-y-auto mb-3 space-y-2 bg-gray-50 rounded-xl p-3"
                >
                  {messages.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center pt-4">메시지가 없습니다.</p>
                  ) : (
                    messages.map(msg => {
                      const isAdmin = msg.senderType === 'admin';
                      const isCustomer = msg.senderType === 'customer';
                      return (
                        <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] px-3 py-2 rounded-xl text-xs ${
                            isAdmin
                              ? 'bg-blue-600 text-white'
                              : isCustomer
                              ? 'bg-green-100 text-green-800'
                              : 'bg-white border border-gray-200 text-gray-700'
                          }`}>
                            <div className={`text-[10px] font-semibold mb-0.5 ${isAdmin ? 'text-blue-100' : isCustomer ? 'text-green-600' : 'text-gray-400'}`}>
                              {msg.sender}
                            </div>
                            <p className="leading-relaxed break-words">{msg.text}</p>
                            <div className={`text-[10px] mt-1 ${isAdmin ? 'text-blue-200' : 'text-gray-400'}`}>
                              {new Date(msg.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    value={msgInput}
                    onChange={e => setMsgInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="메시지 입력..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sendingMsg || !msgInput.trim()}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                  >
                    {sendingMsg ? '...' : '전송'}
                  </button>
                </div>
              </div>
            </div>

            <div className="px-6 pb-5">
              <button onClick={() => setDetailContract(null)} className="w-full py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
