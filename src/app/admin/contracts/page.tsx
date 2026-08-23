'use client';

import { useState, useEffect, useRef } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { useToast, type ToastType } from '@/components/ToastProvider';
import { formatDate } from '@/lib/formatDate';

type Localize = (ko: string, en: string) => string;

function downloadContractsCSV(data: Contract[], toast: (type: ToastType, message: string) => void, L: Localize) {
  if (data.length === 0) { toast('warning', L('내보낼 데이터가 없습니다.', 'There is no data to export.')); return; }
  const headerEn: Record<string, string> = {
    계약ID: 'Contract ID', 날짜: 'Date', 프로젝트명: 'Project', 파트너사: 'Partner', 계약금액: 'Contract amount', 신규우대: 'New-customer discount', '수수료율(%)': 'Commission rate (%)', 우대할인: 'Discount', 총수수료: 'Gross commission', 플랜공제: 'Plan deduction', 최종수수료: 'Final commission', 상태: 'Status', 완료일: 'Completed at',
  };
  const headers = Object.keys(headerEn).map(header => L(header, headerEn[header]));
  const rows = data.map(c => [
    c.id, c.contractDate || c.createdAt?.slice(0,10) || '',
    c.projectName || '', c.factoryName || '',
    c.contractAmount || 0,
    c.isFirstContract ? L('신규1%우대', 'New 1% discount') : L('일반', 'Standard'),
    c.commissionRate || 0,
    c.firstContractDiscount || 0,
    c.grossCommission || 0, c.planDeduction || 0, c.finalCharge || 0,
    c.status ? statusLabel(c.status, L) : '', c.completedAt?.slice(0,10) || '',
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

const STATUS_LABELS: Record<string, [string, string]> = {
  contracted: ['계약 완료', 'Contracted'],
  in_progress: ['진행 중', 'In progress'],
  quality_check: ['품질 검수', 'Quality check'],
  delivered: ['납품 완료', 'Delivered'],
  completed: ['완료', 'Completed'],
  cancelled: ['취소됨', 'Cancelled'],
};

const STATUS_COLORS: Record<string, string> = {
  contracted: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  quality_check: 'bg-orange-100 text-orange-700',
  delivered: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

function statusLabel(status: string, L: Localize) {
  const pair = STATUS_LABELS[status] ?? [status, status];
  return L(pair[0], pair[1]);
}

const STATUS_FLOW: Record<string, string> = {
  contracted: 'in_progress',
  in_progress: 'quality_check',
  quality_check: 'delivered',
  delivered: 'completed',
};

const TOKEN_KEY = 'nexyfab_admin_authed';

const won = (n: number, locale: string, L: Localize) => `${n?.toLocaleString(locale === 'ko' ? 'ko-KR' : locale === 'zh' ? 'zh-CN' : locale)} ${L('원', 'KRW')}`;

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
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);
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
  }, [detailContract]);

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
  }, [detailContract]);

  async function sendMessage() {
    if (!detailContract || !msgInput.trim()) return;
    setSendingMsg(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: detailContract.id,
          sender: L('관리자', 'Admin'),
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
      toast('error', L('메시지 전송에 실패했습니다.', 'Failed to send the message.'));
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
      toast('success', L('파트너가 배정되었습니다.', 'Partner assigned.'));
    } catch {
      toast('error', L('파트너 배정에 실패했습니다.', 'Failed to assign partner.'));
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
      toast('success', L('저장되었습니다.', 'Saved.'));
    } catch {
      toast('error', L('저장에 실패했습니다.', 'Failed to save.'));
    } finally {
      setSavingMeta(false);
    }
  }

  async function completeContract(contractId: string) {
    if (!confirm(L('최종 완료 처리하시겠습니까?', 'Mark this contract as finally completed?'))) return;
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
      toast('error', L('완료 처리에 실패했습니다.', 'Failed to complete the contract.'));
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
      setError(L('계약 목록을 불러오지 못했습니다.', 'Could not load contracts.'));
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
      toast('error', L('상태 업데이트에 실패했습니다.', 'Failed to update status.'));
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
      setPwError(L('비밀번호가 올바르지 않습니다.', 'The password is incorrect.'));
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
          <h1 className="text-2xl font-black text-gray-900 mb-1">{L('관리자 인증', 'Admin authentication')}</h1>
          <p className="text-sm text-gray-500 mb-8">{L('계약 관리 페이지에 접근하려면 비밀번호를 입력하세요.', 'Enter the password to access contract management.')}</p>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input
              type="password"
              placeholder={L('비밀번호', 'Password')}
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
              {L('로그인', 'Log in')}
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
          <h1 className="text-2xl font-black text-gray-900">{L('계약 관리', 'Contract management')}</h1>
          <p className="text-sm text-gray-500 mt-1">{L('NexyFab Admin — 전체 계약 현황', 'NexyFab Admin — all contracts')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => downloadContractsCSV(filtered, toast, L)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            {L('CSV 내보내기', 'Export CSV')}
          </button>
          <button
            onClick={fetchContracts}
            disabled={loading}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
          >
            {loading ? L('새로고침 중...', 'Refreshing...') : L('새로고침', 'Refresh')}
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-200 transition"
          >
            {L('로그아웃', 'Log out')}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">{L('총 계약 수', 'Total contracts')}</p>
          <p className="text-2xl font-black text-gray-900">{L(`${contracts.length}건`, `${contracts.length} records`)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">{L('총 계약 금액', 'Total contract amount')}</p>
          <p className="text-xl font-black text-gray-900 truncate">{won(totalAmount, locale, L)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">{L('총 최종 수수료', 'Total final commission')}</p>
          <p className="text-xl font-black text-blue-600 truncate">{won(totalFinalCharge, locale, L)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">{L('완료 건수', 'Completed')}</p>
          <p className="text-2xl font-black text-green-600">{L(`${completedCount}건`, `${completedCount} records`)}</p>
        </div>
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">{L('기간', 'Date range')}</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <span className="text-xs text-gray-400">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-gray-400 hover:text-gray-600">{L('초기화', 'Reset')}</button>
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
          <div className="py-20 text-center text-gray-400 text-sm">{L('불러오는 중...', 'Loading...')}</div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-gray-400 text-sm">{L('등록된 계약이 없습니다', 'No contracts found')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{L('프로젝트명', 'Project')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{L('파트너사', 'Partner')}</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{L('계약금액', 'Contract amount')}</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{L('수수료율', 'Commission rate')}</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{L('최종 수수료', 'Final commission')}</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{L('플랜', 'Plan')}</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{L('상태', 'Status')}</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{L('계약일', 'Contract date')}</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{L('액션', 'Action')}</th>
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
                          <span className="ml-1 text-amber-500" title={L('파트너가 완료 확인 요청함', 'Partner requested completion confirmation')}>⚡</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap max-w-[160px] truncate">{c.projectName}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.factoryName || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{won(c.contractAmount, locale, L)}</td>
                      <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                        {c.commissionRate}%
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-blue-600 whitespace-nowrap">{won(c.finalCharge, locale, L)}</td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${c.plan === 'premium' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'}`}>
                          {c.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-600'}`}>
                          {statusLabel(c.status, L)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap text-xs">{formatDate(c.contractDate, locale)}</td>
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
                                : L('다음 단계 →', 'Next step →')}
                            </button>
                          )}
                          {canCancel && (
                            <button
                              onClick={() => {
                                if (confirm(L(`계약 "${c.projectName}"을 취소하시겠습니까?`, `Cancel contract "${c.projectName}"?`))) {
                                  updateStatus(c.id, 'cancelled');
                                }
                              }}
                              disabled={!!isUpdating}
                              className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg border border-red-200 transition disabled:opacity-50 whitespace-nowrap"
                            >
                              {L('취소', 'Cancel')}
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
                {L('🖨️ 계약서 출력', '🖨️ Print contract')}
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* 완료 요청 배지 */}
              {detailContract.completionRequested && detailContract.status !== 'completed' && (
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-amber-700">{L('⚡ 파트너가 완료 확인 요청함', '⚡ Partner requested completion confirmation')}</p>
                    {detailContract.completionRequestedAt && (
                      <p className="text-xs text-amber-600 mt-0.5">
                        {formatDate(detailContract.completionRequestedAt, locale)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => completeContract(detailContract.id)}
                    className="px-3 py-2 text-xs font-bold rounded-lg bg-green-600 hover:bg-green-700 text-white transition"
                  >
                    {L('완료 처리', 'Complete')}
                  </button>
                </div>
              )}

              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: L('파트너사', 'Partner'), value: detailContract.factoryName || '—' },
                  { label: L('플랜', 'Plan'), value: detailContract.plan === 'premium' ? 'Premium' : 'Standard' },
                  { label: L('계약일', 'Contract date'), value: detailContract.contractDate ? formatDate(detailContract.contractDate, locale) : '—' },
                  { label: L('상태', 'Status'), value: statusLabel(detailContract.status, L) },
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
                  <h3 className="text-sm font-bold text-gray-700">{L('수수료 계산', 'Commission calculation')}</h3>
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
                    {L('🎁 신규 고객 1% 우대', '🎁 New-customer 1% discount')} {detailContract.isFirstContract ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="space-y-2">
                  {[
                    { label: L('계약금액', 'Contract amount'), value: won(detailContract.contractAmount, locale, L), bold: false },
                    { label: L(`수수료율 (${detailContract.commissionRate}%)`, `Commission rate (${detailContract.commissionRate}%)`), value: won(detailContract.grossCommission, locale, L), bold: false },
                    { label: L('플랜 공제', 'Plan deduction'), value: '- ' + won(detailContract.planDeduction, locale, L), bold: false, color: 'text-red-500' },
                    { label: L('최종 수수료', 'Final commission'), value: won(detailContract.finalCharge, locale, L), bold: true, color: 'text-blue-700' },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                      <span className={`text-sm ${row.bold ? 'font-bold text-gray-900' : 'text-gray-600'}`}>{row.label}</span>
                      <span className={`text-sm font-semibold ${row.color || 'text-gray-800'} ${row.bold ? 'text-base' : ''}`}>{row.value}</span>
                    </div>
                  ))}
                </div>
                {/* 신규 우대 적용 여부 — 어드민 내부 확인용 (고객 노출 없음) */}
                {detailContract.isFirstContract && (
                  <p className="mt-2 text-xs text-gray-400">{L('* 신규 계약 우대 적용됨', '* New-contract discount applied')}</p>
                )}
              </div>

              {detailContract.quoteId && (
                <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-600">
                  {L('연결된 문의 ID:', 'Linked inquiry ID:')} {detailContract.quoteId}
                </div>
              )}

              {/* 납기일 설정 */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">{L('납기일 설정', 'Set delivery date')}</h3>
                <input
                  type="date"
                  value={deadlineInput}
                  onChange={e => setDeadlineInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                />
              </div>

              {/* 고객 담당자 연락처 */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">{L('고객 담당자 연락처', 'Customer contact')}</h3>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={contactName}
                    onChange={e => setContactName(e.target.value)}
                    placeholder={L('담당자명', 'Contact name')}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    placeholder={L('이메일', 'Email')}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={e => setContactPhone(e.target.value)}
                    placeholder={L('전화번호', 'Phone number')}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                </div>
                <button
                  onClick={() => saveMeta(detailContract.id)}
                  disabled={savingMeta}
                  className="mt-3 w-full py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                >
                  {savingMeta ? L('저장 중...', 'Saving...') : L('납기일 및 담당자 저장', 'Save delivery date and contact')}
                </button>
              </div>

              {/* 파트너 배정 */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">{L('파트너 배정', 'Assign partner')}</h3>
                {detailContract.partnerEmail && (
                  <div className="mb-2 px-3 py-2 bg-green-50 rounded-lg text-xs text-green-700 font-semibold">
                    {L('현재 배정:', 'Currently assigned:')} {detailContract.partnerEmail}
                  </div>
                )}
                <div className="flex gap-2">
                  <select
                    value={partnerEmailInput}
                    onChange={e => setPartnerEmailInput(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 bg-white"
                  >
                    <option value="">{L('— 파트너 선택 —', '— Select partner —')}</option>
                    {approvedPartners.map(p => (
                      <option key={p.id} value={p.email || ''}>
                        {p.company || p.name || L('이름없음', 'Unnamed')} ({p.email || L('이메일없음', 'No email')})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => { if (partnerEmailInput) assignPartner(detailContract.id, partnerEmailInput); }}
                    disabled={assigningPartner || !partnerEmailInput}
                    className="px-3 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                  >
                    {assigningPartner ? L('저장 중...', 'Saving...') : L('배정', 'Assign')}
                  </button>
                </div>
              </div>

              {/* 업로드된 파일 목록 */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">
                  {L('업로드된 파일', 'Uploaded files')} {modalAttachments.length > 0 && L(`(${modalAttachments.length}개)`, `(${modalAttachments.length})`)}
                </h3>
                {loadingAttachments ? (
                  <p className="text-xs text-gray-400">{L('로딩 중...', 'Loading...')}</p>
                ) : modalAttachments.length === 0 ? (
                  <p className="text-xs text-gray-400">{L('첨부된 파일이 없습니다.', 'No attachments.')}</p>
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
                          {L('다운로드', 'Download')}
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 진행 기록 */}
              {detailContract.progressNotes && detailContract.progressNotes.length > 0 && (
                <div className="border-t border-gray-100 pt-4">
                  <h3 className="text-sm font-bold text-gray-700 mb-3">{L('진행 기록', 'Progress history')}</h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {[...detailContract.progressNotes].reverse().map((pn, idx) => (
                      <div key={idx} className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-gray-700">{pn.updatedBy}</span>
                          <span className="text-gray-400">{formatDate(pn.date, locale)}</span>
                        </div>
                        <p className="text-sm text-gray-600">{pn.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 메시지 스레드 */}
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">{L('💬 메시지 스레드', '💬 Message thread')}</h3>
                <div
                  ref={msgListRef}
                  className="h-48 overflow-y-auto mb-3 space-y-2 bg-gray-50 rounded-xl p-3"
                >
                  {messages.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center pt-4">{L('메시지가 없습니다.', 'No messages.')}</p>
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
                              {new Date(msg.createdAt).toLocaleString(locale === 'ko' ? 'ko-KR' : locale === 'zh' ? 'zh-CN' : locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
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
                    placeholder={L('메시지 입력...', 'Enter a message...')}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sendingMsg || !msgInput.trim()}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                  >
                    {sendingMsg ? '...' : L('전송', 'Send')}
                  </button>
                </div>
              </div>
            </div>

            <div className="px-6 pb-5">
              <button onClick={() => setDetailContract(null)} className="w-full py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                {L('닫기', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
