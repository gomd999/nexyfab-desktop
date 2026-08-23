'use client';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useToast, type ToastType } from '@/components/ToastProvider';
import { formatDateTime } from '@/lib/formatDate';

// ─── 파트너 추천 모달 ──────────────────────────────────────────────────────────

interface MatchScore {
  partnerId: string;
  email: string;
  company: string;
  score: number;
  reasons: string[];
}

function ScoreBar({ score }: { score: number }) {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-400' : 'bg-gray-300';
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold text-gray-700 w-8 text-right">{L(pct + '점', pct + ' pts')}</span>
    </div>
  );
}

function MatchModal({
  inquiryId,
  onClose,
  onSendQuote,
}: {
  inquiryId: string;
  onClose: () => void;
  onSendQuote: (email: string, company: string) => void;
}) {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const [matches, setMatches] = useState<MatchScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const RANK_ICONS = ['🥇', '🥈', '🥉'];

  useEffect(() => {
    fetch(`/api/match?inquiryId=${encodeURIComponent(inquiryId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setMatches(data.matches || []);
      })
      .catch((e) => setError(e.message || L('오류가 발생했습니다.', 'An error occurred.')))
      .finally(() => setLoading(false));
  }, [inquiryId, L]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{L('🎯 추천 파트너', '🎯 Recommended partners')}</h2>
            <p className="text-xs text-gray-400">{L('문의 분야·예산·평점·완료 건수 기반 상위 5개', 'Top five based on inquiry field, budget, rating, and completed jobs')}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {loading && <div className="text-center text-gray-400 py-8">{L('분석 중...', 'Analyzing…')}</div>}
          {error && <div className="text-center text-red-500 py-8">{error}</div>}
          {!loading && !error && matches.length === 0 && (
            <div className="text-center text-gray-400 py-8">{L('매칭 결과가 없습니다.', 'No matching results.')}<br /><span className="text-xs">{L('승인된 파트너가 없거나 조건이 맞지 않습니다.', 'No approved partner matches the criteria.')}</span></div>
          )}
          {matches.map((m, idx) => (
            <div key={m.partnerId} className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-lg">{RANK_ICONS[idx] || L((idx + 1) + '위', String(idx + 1))}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{m.company}</p>
                  <p className="text-xs text-gray-400 truncate">{m.email}</p>
                </div>
                <ScoreBar score={m.score} />
              </div>
              {m.reasons.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-9">
                  {m.reasons.map((r) => (
                    <span key={r} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                      ✓ {r}
                    </span>
                  ))}
                </div>
              )}
              <div className="pl-9">
                <button
                  onClick={() => onSendQuote(m.email, m.company)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors"
                >
                  {L('견적 요청 보내기', 'Send quote request')}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t">
          <button onClick={onClose} className="w-full py-2 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">{L('닫기', 'Close')}</button>
        </div>
      </div>
    </div>
  );
}

// ─── 견적 요청 빠른 발송 모달 ──────────────────────────────────────────────────

function QuickQuoteModal({
  inquiryId,
  inquiryName,
  partnerEmail,
  partnerCompany,
  onClose,
}: {
  inquiryId: string;
  inquiryName: string;
  partnerEmail: string;
  partnerCompany: string;
  onClose: () => void;
}) {
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);
  const { toast } = useToast();
  const [projectName, setProjectName] = useState(inquiryName);
  const [details, setDetails] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!projectName.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inquiryId,
          projectName,
          factoryName: partnerCompany,
          estimatedAmount: 0,
          details,
          validUntil: validUntil || null,
          partnerEmail,
        }),
      });
      const data = await res.json();
      if (data.quote) {
        toast('success', L('견적 요청이 발송되었습니다. 파트너: ' + partnerCompany + ' / 견적 ID: ' + data.quote.id, 'Quote request sent. Partner: ' + partnerCompany + ' / Quote ID: ' + data.quote.id));
        onClose();
      } else {
        toast('error', L('견적 요청 발송에 실패했습니다.', 'Failed to send the quote request.'));
      }
    } catch {
      toast('error', L('오류가 발생했습니다.', 'An error occurred.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-gray-900 mb-1">{L('견적 요청 보내기', 'Send quote request')}</h2>
        <p className="text-xs text-gray-400 mb-4">→ {partnerCompany} ({partnerEmail})</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">{L('프로젝트명 *', 'Project name *')}</label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">{L('요청 상세', 'Request details')}</label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              placeholder={L('요청 내용을 입력하세요...', 'Enter request details...')}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">{L('견적 유효기간', 'Quote validity period')}</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSend}
            disabled={!projectName.trim() || sending}
            className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
          >
            {sending ? L('발송 중...', 'Sending...') : L('발송', 'Send')}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            {L('취소', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function downloadCSV(data: Inquiry[], filename: string, L: (ko: string, en: string) => string, toast?: (type: ToastType, message: string) => void) {
  if (data.length === 0) { toast?.('warning', L('내보낼 데이터가 없습니다.', 'There is no data to export.')); return; }
  const headers = ['날짜', '상태', '이름', '회사', '이메일', '전화', '요청분야', '범위', '예산', '내용'].map(label => L(label, {
    날짜: 'Date', 상태: 'Status', 이름: 'Name', 회사: 'Company', 이메일: 'Email', 전화: 'Phone', 요청분야: 'Request field', 범위: 'Scope', 예산: 'Budget', 내용: 'Message',
  }[label] ?? label));
  const rows = data.map(inq => [
    inq.date?.slice(0, 16) || '',
    inq.status || 'new',
    inq.name || '',
    inq.company || '',
    inq.email || '',
    inq.phone || '',
    inq.request_field || '',
    inq.scope || '',
    inq.budget_range || '',
    (inq.message || '').replace(/[\n\r,]/g, ' '),
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type Status = 'new' | 'reviewing' | 'contacted' | 'closed';

// 파트너 인터페이스
interface Partner {
  id: string;
  email: string;
  company: string;
  status?: string;
}

interface Inquiry {
  id: string;
  date: string;
  status?: Status;
  updatedAt?: string;
  adminNote?: string;
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  request_field?: string;
  scope?: string;
  budget_range?: string;
  message?: string;
  factoryId?: string | null; // 디렉터리에서 특정 공장에 "문의하기"한 경우
  contractId?: string; // 이미 계약이 생성된 경우
}

const STATUS_COLORS: Record<Status, string> = {
  new: 'bg-blue-100 text-blue-700 border-blue-300',
  reviewing: 'bg-amber-100 text-amber-700 border-amber-300',
  contacted: 'bg-green-100 text-green-700 border-green-300',
  closed: 'bg-gray-100 text-gray-500 border-gray-300',
};

const STATUS_ORDER: Status[] = ['new', 'reviewing', 'contacted', 'closed'];

function StatusBadge({
  status,
  onChange,
}: {
  status: Status;
  onChange: (s: Status) => void;
}) {
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);
  const statusLabels: Record<Status, string> = {
    new: L('신규', 'New'),
    reviewing: L('검토중', 'Reviewing'),
    contacted: L('연락완료', 'Contacted'),
    closed: L('종료', 'Closed'),
  };
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-xs font-semibold px-2 py-1 rounded border cursor-pointer select-none ${STATUS_COLORS[status]}`}
        title={L('클릭하여 상태 변경', 'Click to change status')}
      >
        {statusLabels[status]}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 bg-white border rounded shadow-lg min-w-[100px]">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => {
                setOpen(false);
                onChange(s);
              }}
              className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${
                s === status ? 'font-bold' : ''
              }`}
            >
              {statusLabels[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 인라인 계약 전환 폼 컴포넌트 ────────────────────────────────────────

function InlineConvertForm({
  inquiry,
  partners,
  onClose,
  onSuccess,
}: {
  inquiry: Inquiry;
  partners: Partner[];
  onClose: () => void;
  onSuccess: (contractId: string) => void;
}) {
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);
  const [projectName, setProjectName] = useState(
    inquiry.request_field || inquiry.message?.slice(0, 50) || ''
  );
  const [contractAmount, setContractAmount] = useState('');
  const [plan, setPlan] = useState('standard');
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [factoryNameManual, setFactoryNameManual] = useState(inquiry.company || '');
  const [deadline, setDeadline] = useState('');
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState('');
  const [successContractId, setSuccessContractId] = useState('');

  // 파트너 선택값 → factoryName/partnerEmail 결정
  const selectedPartner = partners.find(p => p.id === selectedPartnerId);
  const factoryName = selectedPartner ? selectedPartner.company : factoryNameManual;
  const partnerEmail = selectedPartner ? selectedPartner.email : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectName || !contractAmount) {
      setError(L('프로젝트명과 계약금액은 필수입니다.', 'Project name and contract amount are required.'));
      return;
    }
    setConverting(true);
    setError('');
    try {
      // 1) 계약 생성
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName,
          factoryName,
          partnerEmail,
          contractAmount: Number(String(contractAmount).replace(/[^0-9]/g, '')),
          plan,
          quoteId: inquiry.id,
          customerEmail: inquiry.email || '',
          deadline: deadline || undefined,
        }),
      });
      const data = await res.json();
      if (!data.contract) {
        setError(data.error || L('계약 생성에 실패했습니다.', 'Failed to create the contract.'));
        return;
      }
      const contractId = data.contract.id;

      // 2) 문의 상태를 'contacted'(계약됨)로 업데이트 — contractId도 함께 저장
      await fetch('/api/inquiries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: inquiry.id,
          status: 'contacted',
          note: L('계약 전환 완료: ' + contractId, 'Contract conversion complete: ' + contractId),
          contractId,
        }),
      });

      setSuccessContractId(contractId);
      onSuccess(contractId);
    } catch {
      setError(L('오류가 발생했습니다. 다시 시도해 주세요.', 'An error occurred. Please try again.'));
    } finally {
      setConverting(false);
    }
  }

  // 성공 화면
  if (successContractId) {
    return (
      <div className="mt-3 p-4 bg-green-50 border border-green-200 rounded-xl space-y-2">
        <p className="text-sm font-bold text-green-700">{L('계약이 생성되었습니다!', 'Contract created!')}</p>
        <p className="text-xs text-green-600">{L('계약 ID:', 'Contract ID:')} <span className="font-mono font-bold">{successContractId}</span></p>
        <div className="flex gap-2 mt-2">
          <Link
            href="/admin/contracts"
            prefetch={false}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
          >
            {L('계약 관리로 이동 →', 'Go to contracts →')}
          </Link>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            {L('닫기', 'Close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 border border-blue-100 bg-blue-50/50 rounded-xl p-4 space-y-3"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-bold text-blue-700">{L('📄 계약 전환', '📄 Convert to contract')}</p>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      {/* 프로젝트명 */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">{L('프로젝트명 *', 'Project name *')}</label>
        <input
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
          placeholder={L('프로젝트명 입력', 'Enter project name')}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
        />
      </div>

      {/* 계약금액 */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">{L('계약금액 (원) *', 'Contract amount (KRW) *')}</label>
        <input
          value={contractAmount}
          onChange={e => setContractAmount(e.target.value)}
          placeholder={L('예: 50000000', 'e.g. 50000000')}
          type="number"
          min="0"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
        />
      </div>

      {/* 플랜 */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">{L('플랜', 'Plan')}</label>
        <select
          value={plan}
          onChange={e => setPlan(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
        >
          <option value="standard">{L('Standard (수수료 공제 50만원)', 'Standard (KRW 500,000 fee deduction)')}</option>
          <option value="premium">{L('Premium (수수료 공제 100만원)', 'Premium (KRW 1,000,000 fee deduction)')}</option>
        </select>
      </div>

      {/* 파트너사 선택 */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">{L('파트너사', 'Partner')}</label>
        {partners.length > 0 ? (
          <select
            value={selectedPartnerId}
            onChange={e => setSelectedPartnerId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
          >
            <option value="">-- {L('직접 입력', 'enter manually')} --</option>
            {partners.map(p => (
              <option key={p.id} value={p.id}>
                {p.company} ({p.email})
              </option>
            ))}
          </select>
        ) : null}
        {/* 파트너가 없거나 직접 입력 선택 시 텍스트 필드 */}
        {(!selectedPartnerId) && (
          <input
            value={factoryNameManual}
            onChange={e => setFactoryNameManual(e.target.value)}
            placeholder={L('파트너사명 직접 입력', 'Enter partner name')}
            className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
          />
        )}
      </div>

      {/* 납기일 */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">{L('납기일', 'Delivery date')}</label>
        <input
          type="date"
          value={deadline}
          onChange={e => setDeadline(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
        />
      </div>

      {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={!projectName || !contractAmount || converting}
          className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
        >
          {converting ? L('처리 중...', 'Processing...') : L('계약 생성', 'Create contract')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          {L('취소', 'Cancel')}
        </button>
      </div>
    </form>
  );
}

function InquiryCard({
  inquiry,
  partners,
  onUpdate,
  onMatch,
}: {
  inquiry: Inquiry;
  partners: Partner[];
  onUpdate: (id: string, status: Status, note: string, contractId?: string) => Promise<void>;
  onMatch: (inq: Inquiry) => void;
}) {
  const { locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);
  const status: Status = (inquiry.status as Status) || 'new';
  const [note, setNote] = useState(inquiry.adminNote || '');
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [convertedContractId, setConvertedContractId] = useState(inquiry.contractId || '');
  const message = inquiry.message || '';
  const isLong = message.length > 100;

  const handleStatusChange = async (s: Status) => {
    await onUpdate(inquiry.id, s, note);
  };

  const handleNoteSave = async () => {
    setSaving(true);
    await onUpdate(inquiry.id, status, note);
    setSaving(false);
  };

  // 계약 전환 가능 상태: contacted, reviewing
  const canConvert = status === 'contacted' || status === 'reviewing';
  const alreadyConverted = !!convertedContractId;

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusBadge status={status} onChange={handleStatusChange} />
          <span className="text-xs text-gray-400">{formatDateTime(inquiry.date, locale)}</span>
          {inquiry.updatedAt && (
            <span className="text-xs text-gray-300">{L('수정:', 'Updated:')} {formatDateTime(inquiry.updatedAt, locale)}</span>
          )}
          {/* 계약됨 배지 */}
          {alreadyConverted && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
              ✓ {L('계약됨', 'Contracted')}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-300 font-mono">{inquiry.id}</span>
      </div>

      {/* Contact info */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div>
          <span className="text-gray-400 text-xs block">{L('이름', 'Name')}</span>
          <span className="font-medium">{inquiry.name || '-'}</span>
        </div>
        <div>
          <span className="text-gray-400 text-xs block">{L('회사', 'Company')}</span>
          <span>{inquiry.company || '-'}</span>
        </div>
        <div>
          <span className="text-gray-400 text-xs block">{L('이메일', 'Email')}</span>
          <a href={`mailto:${inquiry.email}`} className="text-blue-600 hover:underline break-all">
            {inquiry.email || '-'}
          </a>
        </div>
        <div>
          <span className="text-gray-400 text-xs block">{L('전화', 'Phone')}</span>
          <span>{inquiry.phone || '-'}</span>
        </div>
      </div>

      {/* Inquiry details */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <div>
          <span className="text-gray-400 text-xs block">{L('요청 분야', 'Request field')}</span>
          <span>{inquiry.request_field || '-'}</span>
        </div>
        <div>
          <span className="text-gray-400 text-xs block">{L('범위', 'Scope')}</span>
          <span>{inquiry.scope || '-'}</span>
        </div>
        <div>
          <span className="text-gray-400 text-xs block">{L('예산', 'Budget')}</span>
          <span>{inquiry.budget_range || '-'}</span>
        </div>
      </div>

      {/* 디렉터리에서 특정 공장을 골라 들어온 문의 — 그 공장으로 라우팅 가능하게 표시 */}
      {inquiry.factoryId && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <span className="text-base">🏭</span>
          <span className="text-gray-500 text-xs">{L('요청 공장(디렉터리)', 'Requested factory (directory)')}</span>
          <code className="font-mono text-xs text-blue-800 break-all">{inquiry.factoryId}</code>
          <a
            href={`/api/factories/?id=${encodeURIComponent(inquiry.factoryId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
          >
            {L('공장 보기 →', 'View factory →')}
          </a>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className="text-sm">
          <span className="text-gray-400 text-xs block mb-1">{L('메시지', 'Message')}</span>
          <p className="text-gray-700 whitespace-pre-line bg-gray-50 rounded p-2 text-xs leading-relaxed">
            {expanded || !isLong ? message : message.slice(0, 100) + '…'}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-blue-500 hover:underline mt-1"
            >
              {expanded ? L('접기', 'Collapse') : L('더 보기', 'View more')}
            </button>
          )}
        </div>
      )}

      {/* Admin note */}
      <div className="text-sm">
        <span className="text-gray-400 text-xs block mb-1">{L('관리자 메모', 'Admin note')}</span>
        <div className="flex gap-2 items-start">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={L('내부 메모를 입력하세요...', 'Enter an internal note...')}
            className="flex-1 text-xs border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
          <button
            onClick={handleNoteSave}
            disabled={saving}
            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? L('저장중…', 'Saving…') : L('저장', 'Save')}
          </button>
        </div>
      </div>

      {/* 액션 버튼 행 */}
      {(canConvert || alreadyConverted) && (
        <div className="flex flex-wrap gap-2 mt-1">
          {canConvert && (
            <button
              onClick={() => onMatch(inquiry)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors"
            >
              {L('🎯 파트너 추천', '🎯 Recommend partners')}
            </button>
          )}
          {canConvert && !alreadyConverted && !showConvertForm && (
            <button
              onClick={() => setShowConvertForm(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              {L('📄 계약 전환', '📄 Convert to contract')}
            </button>
          )}
          {alreadyConverted && (
            <Link
              href="/admin/contracts"
              prefetch={false}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors"
            >
              {L('계약 보기 →', 'View contract →')}
            </Link>
          )}
        </div>
      )}

      {/* 인라인 계약 전환 폼 (슬라이드다운) */}
      {showConvertForm && !alreadyConverted && (
        <InlineConvertForm
          inquiry={inquiry}
          partners={partners}
          onClose={() => setShowConvertForm(false)}
          onSuccess={(contractId) => {
            setConvertedContractId(contractId);
            setShowConvertForm(false);
          }}
        />
      )}
    </div>
  );
}

export default function InquiriesPage() {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const { toast } = useToast();
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // 파트너 목록 (인라인 계약 전환 폼용)
  const [partners, setPartners] = useState<Partner[]>([]);

  // 파트너 추천 모달
  const [matchModal, setMatchModal] = useState<Inquiry | null>(null);
  // 견적 빠른 발송 모달
  const [quickQuoteModal, setQuickQuoteModal] = useState<{ inquiry: Inquiry; email: string; company: string } | null>(null);

  const fetchInquiries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/inquiries');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setInquiries(data.inquiries || []);
    } catch {
      setError(L('문의 데이터를 불러오지 못했습니다.', 'Unable to load inquiries.'));
    } finally {
      setLoading(false);
    }
  }, [L]);

  useEffect(() => {
    fetchInquiries();
  }, [fetchInquiries]);

  // 파트너 목록 로드 (계약 전환 드롭다운용)
  useEffect(() => {
    fetch('/api/partners')
      .then((r) => r.json())
      .then((data) => {
        // 승인된 파트너만 표시 (status가 없거나 approved)
        const list: Partner[] = (data.partners || data || []).filter(
          (p: Partner) => !p.status || p.status === 'approved' || p.status === 'active'
        );
        setPartners(list);
      })
      .catch(() => {
        // API 없으면 빈 배열 유지
        setPartners([]);
      });
  }, []);

  const handleUpdate = async (id: string, status: Status, note: string, contractId?: string) => {
    const body: Record<string, unknown> = { id, status, note };
    if (contractId) body.contractId = contractId;
    const res = await fetch('/api/inquiries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setInquiries((prev) =>
        prev.map((i) => (i.id === id ? { ...i, ...data.inquiry } : i))
      );
    }
  };

  const openMatchModal = (inq: Inquiry) => {
    setMatchModal(inq);
  };

  const handleSendQuote = (email: string, company: string) => {
    if (!matchModal) return;
    setMatchModal(null);
    setQuickQuoteModal({ inquiry: matchModal, email, company });
  };

  const stats = {
    total: inquiries.length,
    new: inquiries.filter((i) => (i.status || 'new') === 'new').length,
    reviewing: inquiries.filter((i) => i.status === 'reviewing').length,
    contacted: inquiries.filter((i) => i.status === 'contacted').length,
    closed: inquiries.filter((i) => i.status === 'closed').length,
  };

  const filtered = inquiries.filter((i) => {
    const matchStatus = filter === 'all' || (i.status || 'new') === filter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      (i.name || '').toLowerCase().includes(q) ||
      (i.email || '').toLowerCase().includes(q) ||
      (i.company || '').toLowerCase().includes(q);
    const inqDate = i.date?.slice(0, 10) || '';
    const matchDate = (!dateFrom || inqDate >= dateFrom) && (!dateTo || inqDate <= dateTo);
    return matchStatus && matchSearch && matchDate;
  });

  const FILTER_BUTTONS: { key: Status | 'all'; label: string }[] = [
    { key: 'all', label: L('전체', 'All') },
    { key: 'new', label: L('신규', 'New') },
    { key: 'reviewing', label: L('검토중', 'Reviewing') },
    { key: 'contacted', label: L('연락완료', 'Contacted') },
    { key: 'closed', label: L('종료', 'Closed') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">{L('문의 관리', 'Inquiry management')}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadCSV(filtered, `inquiries_${new Date().toISOString().slice(0,10)}.csv`, L, toast)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            {L('CSV 내보내기', 'Export CSV')}
          </button>
          <button
            onClick={fetchInquiries}
            className="text-sm text-gray-500 hover:text-gray-700 border px-3 py-1.5 rounded hover:bg-gray-50"
          >
            {L('새로고침', 'Refresh')}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: L('전체', 'All'), value: stats.total, color: 'text-gray-700' },
          { label: L('신규', 'New'), value: stats.new, color: 'text-blue-600' },
          { label: L('검토중', 'Reviewing'), value: stats.reviewing, color: 'text-amber-600' },
          { label: L('연락완료', 'Contacted'), value: stats.contacted, color: 'text-green-600' },
          { label: L('종료', 'Closed'), value: stats.closed, color: 'text-gray-400' },
        ].map((s) => (
          <div key={s.label} className="bg-white border rounded-lg p-3 text-center shadow-sm">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {FILTER_BUTTONS.map((btn) => (
            <button
              key={btn.key}
              onClick={() => setFilter(btn.key)}
              className={`text-sm px-3 py-1.5 rounded border transition-colors ${
                filter === btn.key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={L('이름 / 이메일 / 회사 검색...', 'Search name / email / company...')}
          className="text-sm border rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 min-w-[200px]"
        />
      </div>
      <div className="flex items-center gap-2 mt-3">
        <span className="text-xs text-gray-500">{L('기간', 'Period')}</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <span className="text-xs text-gray-400">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-gray-400 hover:text-gray-600">{L('초기화', 'Reset')}</button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">{L('불러오는 중...', 'Loading…')}</div>
      ) : error ? (
        <div className="text-center text-red-500 py-12">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          {search || filter !== 'all' ? L('검색 결과가 없습니다.', 'No search results.') : L('문의 내역이 없습니다.', 'No inquiries found.')}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">{L(filtered.length + '건 표시 중', filtered.length + ' shown')}</p>
          {filtered.map((inq) => (
            <InquiryCard
              key={inq.id}
              inquiry={inq}
              partners={partners}
              onUpdate={handleUpdate}
              onMatch={openMatchModal}
            />
          ))}
        </div>
      )}

      {/* 파트너 추천 모달 */}
      {matchModal && (
        <MatchModal
          inquiryId={matchModal.id}
          onClose={() => setMatchModal(null)}
          onSendQuote={handleSendQuote}
        />
      )}

      {/* 견적 빠른 발송 모달 */}
      {quickQuoteModal && (
        <QuickQuoteModal
          inquiryId={quickQuoteModal.inquiry.id}
          inquiryName={quickQuoteModal.inquiry.request_field || quickQuoteModal.inquiry.message?.slice(0, 50) || ''}
          partnerEmail={quickQuoteModal.email}
          partnerCompany={quickQuoteModal.company}
          onClose={() => setQuickQuoteModal(null)}
        />
      )}

    </div>
  );
}
