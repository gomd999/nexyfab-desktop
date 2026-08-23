'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { useClientLocale } from '@/lib/i18n/clientLocale';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

// ModelViewer pulls in Three.js + OCCT — load only when actually rendered
// so the rest of the portal page doesn't pay the bundle cost.
const ModelViewer = dynamic(() => import('../components/ModelViewer'), { ssr: false });

// ─── 타입 ──────────────────────────────────────────────────────────────────

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
  size: number;
  url: string;
  uploadedBy: string;
  uploadedAt: string;
  version?: number;
  previousVersionId?: string;
}

interface Contract {
  id: string;
  projectName: string;
  factoryName?: string;
  partnerEmail?: string;
  contractAmount: number;
  status: string;
  contractDate?: string;
  deadline?: string;
  completedAt?: string;
  progressNotes?: ProgressNote[];
  attachments?: Attachment[];
}

interface Inquiry {
  id: string;
  date: string;
  status?: string;
  updatedAt?: string;
  name?: string;
  company?: string;
  email?: string;
  request_field?: string;
  budget_range?: string;
  message?: string;
  contract: Contract | null;
}

interface ChatMessage {
  id: string;
  contractId: string;
  sender: string;
  senderType: 'admin' | 'partner' | 'customer';
  text: string;
  createdAt: string;
}

// ─── 상수 ──────────────────────────────────────────────────────────────────

const INQUIRY_STATUS_LABELS: Record<string, { ko: string; en: string }> = {
  new: { ko: '신규', en: 'New' },
  reviewing: { ko: '검토중', en: 'Under review' },
  contacted: { ko: '연락완료', en: 'Contacted' },
  closed: { ko: '종료', en: 'Closed' },
};

const INQUIRY_STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  reviewing: 'bg-amber-100 text-amber-700',
  contacted: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-500',
};

const CONTRACT_STATUS_LABELS: Record<string, { ko: string; en: string }> = {
  contracted: { ko: '계약', en: 'Contracted' },
  in_progress: { ko: '진행중', en: 'In progress' },
  quality_check: { ko: '품질검사', en: 'Quality inspection' },
  delivered: { ko: '납품완료', en: 'Delivered' },
  completed: { ko: '완료', en: 'Complete' },
  cancelled: { ko: '취소', en: 'Cancelled' },
};

const CONTRACT_STATUS_COLORS: Record<string, string> = {
  contracted: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  quality_check: 'bg-orange-100 text-orange-700',
  delivered: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const CONTRACT_STEPS = [
  { key: 'contracted', label: { ko: '계약', en: 'Contracted' } },
  { key: 'in_progress', label: { ko: '진행중', en: 'In progress' } },
  { key: 'quality_check', label: { ko: '품질검사', en: 'Quality inspection' } },
  { key: 'delivered', label: { ko: '납품완료', en: 'Delivered' } },
  { key: 'completed', label: { ko: '완료', en: 'Complete' } },
];

function displayLabel(L: (ko: string, en: string) => string, value?: { ko: string; en: string }, fallback = '') {
  return value ? L(value.ko, value.en) : fallback;
}

function formatDate(iso: string, lang = 'en') {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(lang === 'ko' ? 'ko-KR' : lang === 'zh' ? 'zh-CN' : lang, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatBytes(bytes: number) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// D-day 계산
function getDday(deadline: string, L: (ko: string, en: string) => string): string | null {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dl = new Date(deadline);
  dl.setHours(0, 0, 0, 0);
  const diff = Math.round((dl.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff > 0) return `${L('납기', 'Due')} D-${diff}${L('일', ' days')}`;
  if (diff === 0) return `${L('납기', 'Due')} D-day`;
  return `${L('납기', 'Due')} D+${Math.abs(diff)}${L('일 초과', ' days overdue')}`;
}

// ─── 별점 컴포넌트 ────────────────────────────────────────────────────────

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(0)}
          className={`text-2xl transition-colors leading-none ${
            i <= (hovered || value) ? 'text-yellow-400' : 'text-gray-200'
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ─── 리뷰 탭 컴포넌트 ─────────────────────────────────────────────────────

function ReviewTab({
  contract,
  reviewerEmail,
}: {
  contract: Contract | null;
  reviewerEmail: string;
}) {
  const lang = useClientLocale();
  const L = createCommercialLocalizer(lang);
  const [rating, setRating] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [quality, setQuality] = useState(0);
  const [communication, setCommunication] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  if (!contract) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        {L('계약 정보가 없습니다.', 'No contract information.')}
      </div>
    );
  }

  if (contract.status !== 'completed') {
    return (
      <div className="text-center py-12">
        <p className="text-4xl mb-3">⏳</p>
        <p className="text-gray-500 text-sm font-semibold">{L('프로젝트가 완료된 후 리뷰를 작성할 수 있습니다.', 'You can write a review after the project is complete.')}</p>
        <p className="text-gray-400 text-xs mt-1">{L('현재 상태:', 'Current status:')} {displayLabel(L, CONTRACT_STATUS_LABELS[contract.status], contract.status)}</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="text-center py-12">
        <p className="text-4xl mb-3">🎉</p>
        <p className="text-green-700 font-bold text-base">{L('리뷰가 제출되었습니다!', 'Review submitted!')}</p>
        <p className="text-gray-400 text-sm mt-1">{L('소중한 의견 감사합니다.', 'Thank you for your feedback.')}</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating || !deadline || !quality || !communication) {
      setError(L('모든 별점 항목을 선택해 주세요.', 'Please select a rating for every category.'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: contract!.id,
          partnerEmail: contract!.partnerEmail || '',
          rating,
          categories: { deadline, quality, communication },
          comment,
          reviewerEmail,
        }),
      });
      if (res.status === 409) {
        setError(L('이미 이 계약에 대한 평가를 제출하셨습니다.', 'You have already reviewed this contract.'));
        return;
      }
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || L('제출에 실패했습니다.', 'Submission failed.'));
        return;
      }
      setSubmitted(true);
    } catch {
      setError(L('제출 중 오류가 발생했습니다.', 'An error occurred while submitting.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      <div>
        <p className="text-sm font-bold text-gray-800 mb-1">{contract.projectName}</p>
        <p className="text-xs text-gray-400">{L('파트너:', 'Partner:')} {contract.factoryName || '-'}</p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{L('카테고리별 평가', 'Category ratings')}</p>
        {([
          { label: L('납기 준수', 'On-time delivery'), value: deadline, setter: setDeadline },
          { label: L('품질', 'Quality'), value: quality, setter: setQuality },
          { label: L('소통', 'Communication'), value: communication, setter: setCommunication },
          { label: L('총 만족도', 'Overall satisfaction'), value: rating, setter: setRating },
        ] as { label: string; value: number; setter: (v: number) => void }[]).map(({ label, value, setter }) => (
          <div key={label} className="flex items-center gap-4">
            <span className="text-sm text-gray-600 w-24 shrink-0">{label}</span>
            <StarRating value={value} onChange={setter} />
          </div>
        ))}
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">{L('한줄 후기 (선택)', 'One-line review (optional)')}</label>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder={L('솔직한 후기를 남겨주세요...', 'Share an honest review...')}
          rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition resize-none"
        />
      </div>

      {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="px-6 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-white text-sm font-bold rounded-xl transition disabled:opacity-50"
      >
        {submitting ? L('제출 중...', 'Submitting...') : `★ ${L('리뷰 제출', 'Submit review')}`}
      </button>
    </form>
  );
}

// ─── 타임라인 컴포넌트 ────────────────────────────────────────────────────

function InquiryTimeline({ status }: { status: string }) {
  const lang = useClientLocale();
  const L = createCommercialLocalizer(lang);
  const steps = [
    { key: 'new', label: L('신규 접수', 'New inquiry') },
    { key: 'reviewing', label: L('검토중', 'Under review') },
    { key: 'contacted', label: L('연락완료', 'Contacted') },
    { key: 'closed', label: L('종료', 'Closed') },
  ];
  const currentIdx = steps.findIndex((s) => s.key === (status || 'new'));

  return (
    <div className="flex items-center gap-0 mt-3">
      {steps.map((step, idx) => {
        const done = idx <= currentIdx;
        const isCurrent = idx === currentIdx;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                  isCurrent
                    ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                    : done
                    ? 'bg-blue-200 border-blue-300 text-blue-600'
                    : 'bg-gray-100 border-gray-200 text-gray-400'
                }`}
              >
                {done && !isCurrent ? '✓' : idx + 1}
              </div>
              <span
                className={`text-[10px] mt-1 whitespace-nowrap font-medium ${
                  isCurrent ? 'text-blue-700' : done ? 'text-blue-400' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 mb-4 transition-all ${
                  idx < currentIdx ? 'bg-blue-300' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// 세로 타임라인 (계약 진행용)
function ContractVerticalTimeline({ status, progressNotes }: { status: string; progressNotes?: ProgressNote[] }) {
  const lang = useClientLocale();
  const L = createCommercialLocalizer(lang);
  if (status === 'cancelled') {
    return (
      <div className="mt-3 px-3 py-2 bg-red-50 rounded-lg text-xs text-red-600 font-semibold">
        {L('계약이 취소되었습니다.', 'The contract was cancelled.')}
      </div>
    );
  }

  const currentIdx = CONTRACT_STEPS.findIndex((s) => s.key === status);

  return (
    <div className="mt-4 space-y-0">
      {CONTRACT_STEPS.map((step, idx) => {
        const done = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isLast = idx === CONTRACT_STEPS.length - 1;
        return (
          <div key={step.key} className="flex gap-4">
            {/* 세로 선 + 원 */}
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 shrink-0 ${
                  isCurrent
                    ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                    : done
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'bg-gray-100 border-gray-200 text-gray-400'
                }`}
              >
                {done ? '✓' : idx + 1}
              </div>
              {!isLast && (
                <div
                  className={`w-0.5 flex-1 my-1 ${
                    done ? 'bg-green-300' : isCurrent ? 'bg-blue-200' : 'bg-gray-200'
                  }`}
                  style={{ minHeight: '24px' }}
                />
              )}
            </div>
            {/* 라벨 + 노트 */}
            <div className="pb-4 flex-1 min-w-0">
              <p
                className={`text-sm font-semibold mt-1 ${
                  isCurrent ? 'text-blue-700' : done ? 'text-green-700' : 'text-gray-400'
                }`}
              >
                {displayLabel(L, step.label)}
                {isCurrent && (
                  <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                    {L('현재 단계', 'Current step')}
                  </span>
                )}
              </p>
              {/* 해당 단계의 진행 노트 표시 */}
              {progressNotes && progressNotes.filter(_pn => {
                // 각 단계에 맞는 노트를 연결하기 위한 간단한 매핑 없이 전체 노트를 마지막 단계에만 표시
                return false;
              }).map((pn, i) => (
                <p key={i} className="text-xs text-gray-500 mt-0.5">{pn.note}</p>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 파일 섹션 컴포넌트 ──────────────────────────────────────────────────

// ─── 파일 탭 전용 뷰 ────────────────────────────────────────────────────

function FilesTab({ contract, onLightbox, onViewModel }: {
  contract: Contract | null;
  onLightbox: (url: string) => void;
  onViewModel: (url: string, filename: string) => void;
}) {
  const lang = useClientLocale();
  const L = createCommercialLocalizer(lang);
  if (!contract) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        {L('계약 정보가 없습니다.', 'No contract information.')}
      </div>
    );
  }

  const attachments = contract.attachments || [];
  if (attachments.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-4xl mb-3">📂</p>
        <p className="text-gray-400 text-sm">{L('업로드된 파일이 없습니다.', 'No files uploaded.')}</p>
        <p className="text-gray-300 text-xs mt-1">{L('파트너가 파일을 업로드하면 여기에 표시됩니다.', 'Files uploaded by the partner will appear here.')}</p>
      </div>
    );
  }

  const images = attachments.filter(a => a.type === 'image');
  const models = attachments.filter(a => a.type === 'model');
  const docs = attachments.filter(a => a.type === 'document');

  return (
    <div className="space-y-6">
      {images.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">🖼️ {L('이미지', 'Images')} ({images.length})</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {images.map(att => (
              <div
                key={att.id}
                className="relative h-32 w-full group cursor-pointer rounded-xl overflow-hidden border border-gray-100 hover:border-blue-300 transition"
                onClick={() => onLightbox(att.url)}
              >
                <Image
                  src={att.url}
                  alt={att.originalName}
                  fill
                  className="object-cover group-hover:scale-105 transition duration-300"
                  sizes="(max-width: 640px) 50vw, 200px"
                  unoptimized
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition" />
                <p className="absolute bottom-2 left-2 right-2 text-[10px] text-white font-semibold truncate opacity-0 group-hover:opacity-100 transition">
                  {att.originalName}
                </p>
                {att.version && att.version > 1 && (
                  <span className="absolute top-2 right-2 text-[9px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded-full">
                    v{att.version}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {models.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">🧊 {L('3D 모델', '3D models')} ({models.length})</p>
          <div className="space-y-2">
            {models.map(att => (
              <div key={att.id} className="flex items-center gap-3 px-4 py-3 bg-indigo-50 rounded-xl border border-indigo-100">
                <span className="text-xl shrink-0">🧊</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{att.originalName}</p>
                  <p className="text-xs text-gray-400">{formatBytes(att.size)} · {formatDate(att.uploadedAt, lang)}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => onViewModel(att.url, att.originalName)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition"
                  >
                    {L('3D 뷰어로 보기', 'View in 3D viewer')}
                  </button>
                  <a
                    href={att.url}
                    download={att.originalName}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition"
                  >
                    {L('다운로드', 'Download')}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">📄 {L('문서', 'Documents')} ({docs.length})</p>
          <div className="space-y-2">
            {docs.map(att => (
              <div key={att.id} className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-xl shrink-0">📐</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{att.originalName}</p>
                  <p className="text-xs text-gray-400">{formatBytes(att.size)} · {formatDate(att.uploadedAt, lang)}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => onViewModel(att.url, att.originalName)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition"
                  >
                    👁 {L('미리보기', 'Preview')}
                  </button>
                  <a
                    href={att.url}
                    download={att.originalName}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 transition"
                  >
                    {L('다운로드', 'Download')}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 진행현황 탭 컴포넌트 ────────────────────────────────────────────────

function ProgressTab({ inquiry, customerEmail, onLightbox: _onLightbox, onViewModel: _onViewModel }: {
  inquiry: Inquiry;
  customerEmail: string;
  onLightbox: (url: string) => void;
  onViewModel: (url: string, filename: string) => void;
}) {
  const { toast } = useToast();
  const lang = useClientLocale();
  const L = createCommercialLocalizer(lang);
  const status = inquiry.status || 'new';
  const [msgExpanded, setMsgExpanded] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [msgInput, setMsgInput] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const msgListRef = useRef<HTMLDivElement>(null);

  async function fetchChatMessages(contractId: string) {
    setLoadingMsgs(true);
    try {
      const res = await fetch(`/api/messages?contractId=${contractId}`);
      const data = await res.json();
      setChatMessages(data.messages || []);
    } catch { /* silent */ }
    setLoadingMsgs(false);
  }

  function toggleMsgSection() {
    const next = !msgExpanded;
    setMsgExpanded(next);
    if (next && inquiry.contract?.id && chatMessages.length === 0) {
      fetchChatMessages(inquiry.contract.id);
    }
  }

  async function sendChatMessage() {
    if (!msgInput.trim() || !inquiry.contract?.id) return;
    setSendingMsg(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: inquiry.contract.id,
          sender: customerEmail,
          senderType: 'customer',
          text: msgInput.trim(),
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setChatMessages(prev => [...prev, data.message]);
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

  return (
    <div className="space-y-5">
      {/* 문의 상태 */}
      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{L('문의 진행 현황', 'Inquiry progress')}</p>
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${INQUIRY_STATUS_COLORS[status] || 'bg-gray-100 text-gray-500'}`}>
            {displayLabel(L, INQUIRY_STATUS_LABELS[status], status)}
          </span>
        </div>
        <InquiryTimeline status={status} />
      </div>

      {/* 계약 진행 (세로 타임라인) */}
      {inquiry.contract ? (
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{L('계약 진행 현황', 'Contract progress')}</p>
            <div className="flex items-center gap-2">
              {/* D-day 배지 */}
              {inquiry.contract.deadline && (() => {
                const dday = getDday(inquiry.contract.deadline!, L);
                if (!dday) return null;
                const isOver = dday.includes('+');
                return (
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                    isOver ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {dday}
                  </span>
                );
              })()}
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${CONTRACT_STATUS_COLORS[inquiry.contract.status] || 'bg-gray-100 text-gray-500'}`}>
                {displayLabel(L, CONTRACT_STATUS_LABELS[inquiry.contract.status], inquiry.contract.status)}
              </span>
            </div>
          </div>
          <p className="text-sm font-semibold text-gray-700 mb-1">{inquiry.contract.projectName}</p>
          {inquiry.contract.factoryName && (
            <p className="text-xs text-gray-400 mb-3">{L('파트너사:', 'Partner:')} {inquiry.contract.factoryName}</p>
          )}

          {/* 세로 타임라인 */}
          <ContractVerticalTimeline
            status={inquiry.contract.status}
            progressNotes={inquiry.contract.progressNotes}
          />

          {inquiry.contract.completedAt && (
            <p className="text-xs text-green-600 font-semibold mt-2">
              {L('완료일:', 'Completed:')} {formatDate(inquiry.contract.completedAt, lang)}
            </p>
          )}

          {/* 진행 노트 */}
          {inquiry.contract.progressNotes && inquiry.contract.progressNotes.length > 0 && (
            <div className="mt-4 border-t border-gray-50 pt-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{L('진행 업데이트', 'Progress updates')}</p>
              <div className="space-y-2">
                {[...inquiry.contract.progressNotes].reverse().map((pn, idx) => (
                  <div key={idx} className="flex gap-2 text-xs">
                    <span className="text-blue-500 mt-0.5 shrink-0">📌</span>
                    <div>
                      <span className="text-gray-500">{formatDate(pn.date, lang)} — [{pn.updatedBy}] </span>
                      <span className="text-gray-700">{pn.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 rounded-xl p-4 text-center">
          <p className="text-sm text-gray-400">{L('아직 계약이 연결되지 않았습니다.', 'No contract is linked yet.')}</p>
          <p className="text-xs text-gray-300 mt-1">{L('담당자가 검토 후 계약을 진행합니다.', 'A coordinator will review and proceed with the contract.')}</p>
        </div>
      )}

      {/* 문의 내용 */}
      {inquiry.message && (
        <details className="bg-gray-50 rounded-xl overflow-hidden">
          <summary className="px-4 py-3 text-xs text-blue-500 font-semibold cursor-pointer hover:bg-gray-100 transition">
            {L('문의 내용 보기', 'View inquiry details')}
          </summary>
          <p className="px-4 pb-4 pt-1 text-xs text-gray-600 leading-relaxed whitespace-pre-line">
            {inquiry.message}
          </p>
        </details>
      )}

      {/* 담당자 메시지 */}
      {inquiry.contract && (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <button
            onClick={toggleMsgSection}
            className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-gray-500 hover:bg-gray-50 transition"
          >
            <span>💬 {L('담당자에게 문의', 'Contact coordinator')}</span>
            <span>{msgExpanded ? '▲' : '▼'}</span>
          </button>
          {msgExpanded && (
            <div className="px-4 pb-4">
              <div
                ref={msgListRef}
                className="h-40 overflow-y-auto mb-3 space-y-2 bg-gray-50 rounded-xl p-3"
              >
                {loadingMsgs ? (
                  <p className="text-xs text-gray-400 text-center pt-3">{L('불러오는 중...', 'Loading...')}</p>
                ) : chatMessages.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center pt-3">{L('메시지가 없습니다.', 'No messages.')}</p>
                ) : (
                  chatMessages
                    .filter(m => m.senderType !== 'customer' || m.sender === customerEmail)
                    .map(msg => {
                      const isMe = msg.senderType === 'customer';
                      return (
                        <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] px-3 py-2 rounded-xl text-xs ${
                            isMe ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-700'
                          }`}>
                            <div className={`text-[10px] font-semibold mb-0.5 ${isMe ? 'text-blue-100' : 'text-gray-400'}`}>
                              {isMe ? L('나', 'Me') : msg.sender}
                            </div>
                            <p className="leading-relaxed break-words">{msg.text}</p>
                            <div className={`text-[10px] mt-1 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                              {new Date(msg.createdAt).toLocaleString(lang === 'ko' ? 'ko-KR' : lang === 'zh' ? 'zh-CN' : lang, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
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
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                  placeholder={L('담당자에게 문의하세요...', 'Contact the coordinator...')}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
                />
                <button
                  onClick={sendChatMessage}
                  disabled={sendingMsg || !msgInput.trim()}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                >
                  {sendingMsg ? '...' : L('전송', 'Send')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 탭 포털 카드 (단일 계약/문의 뷰) ──────────────────────────────────

type PortalTab = 'progress' | 'files' | 'review';

function PortalTabs({ inquiry, customerEmail, onLightbox, onViewModel }: {
  inquiry: Inquiry;
  customerEmail: string;
  onLightbox: (url: string) => void;
  onViewModel: (url: string, filename: string) => void;
}) {
  const lang = useClientLocale();
  const L = createCommercialLocalizer(lang);
  const [tab, setTab] = useState<PortalTab>('progress');
  const isCompleted = inquiry.contract?.status === 'completed';
  const hasFiles = (inquiry.contract?.attachments?.length || 0) > 0;

  const tabs: { key: PortalTab; label: string; badge?: string }[] = [
    { key: 'progress', label: L('진행현황', 'Progress') },
    { key: 'files', label: L('파일/결과물', 'Files/results'), badge: hasFiles ? String(inquiry.contract?.attachments?.length) : undefined },
    { key: 'review', label: L('리뷰 작성', 'Write a review'), badge: isCompleted ? '✓' : undefined },
  ];

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      {/* 카드 헤더 */}
      <div className="px-5 py-4 border-b border-gray-50">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${INQUIRY_STATUS_COLORS[inquiry.status || 'new'] || 'bg-gray-100 text-gray-500'}`}>
            {displayLabel(L, INQUIRY_STATUS_LABELS[inquiry.status || 'new'], inquiry.status)}
          </span>
          <span className="text-xs text-gray-400">{formatDate(inquiry.date, lang)} {L('접수', 'received')}</span>
          {inquiry.updatedAt && (
            <span className="text-xs text-gray-300">· {L('업데이트:', 'Updated:')} {formatDate(inquiry.updatedAt, lang)}</span>
          )}
        </div>
        {(inquiry.company || inquiry.request_field) && (
          <p className="text-sm font-semibold text-gray-800">
            {inquiry.company || ''}
            {inquiry.company && inquiry.request_field ? ' · ' : ''}
            {inquiry.request_field || ''}
          </p>
        )}
        <p className="text-[10px] text-gray-300 font-mono mt-0.5">{inquiry.id}</p>
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex border-b border-gray-100">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-3 text-xs font-semibold transition flex items-center justify-center gap-1 ${
              tab === t.key
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t.label}
            {t.badge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="p-5">
        {tab === 'progress' && (
          <ProgressTab
            inquiry={inquiry}
            customerEmail={customerEmail}
            onLightbox={onLightbox}
            onViewModel={onViewModel}
          />
        )}
        {tab === 'files' && (
          <FilesTab
            contract={inquiry.contract}
            onLightbox={onLightbox}
            onViewModel={onViewModel}
          />
        )}
        {tab === 'review' && (
          <ReviewTab
            contract={inquiry.contract}
            reviewerEmail={customerEmail}
          />
        )}
      </div>
    </div>
  );
}

// ─── 메인 포털 내용 (useSearchParams 사용) ───────────────────────────────

function PortalContent() {
  const lang = useClientLocale();
  const L = createCommercialLocalizer(lang);
  const searchParams = useSearchParams();
  const urlContractId = searchParams.get('contractId');
  const urlEmail = searchParams.get('email');

  const [inputValue, setInputValue] = useState(urlEmail || '');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [selectedInquiryId, setSelectedInquiryId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [resolvedEmail, setResolvedEmail] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [viewingModel, setViewingModel] = useState<{ url: string; filename: string } | null>(null);

  // contractId URL 파라미터로 바로 조회
  useEffect(() => {
    if (urlContractId) {
      fetchByContractId(urlContractId);
    } else if (urlEmail) {
      fetchByEmail(urlEmail);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchByContractId(contractId: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/portal?contractId=${encodeURIComponent(contractId)}`);
      if (!res.ok) throw new Error(L('조회 실패', 'Lookup failed.'));
      const data = await res.json();
      const inqs: Inquiry[] = data.inquiries || [];
      setInquiries(inqs);
      setSearched(true);
      // contractId가 일치하는 문의 자동 선택
      const matched = inqs.find(i => i.contract?.id === contractId);
      if (matched) setSelectedInquiryId(matched.id);
      setResolvedEmail(inqs[0]?.email || '');
    } catch {
      setError(L('조회 중 오류가 발생했습니다.', 'An error occurred while looking up the portal.'));
    } finally {
      setLoading(false);
    }
  }

  async function fetchByEmail(email: string) {
    setLoading(true);
    setError('');
    setSearched(false);
    try {
      const res = await fetch(`/api/portal?email=${encodeURIComponent(email)}`);
      if (!res.ok) throw new Error(L('조회 실패', 'Lookup failed.'));
      const data = await res.json();
      const inqs: Inquiry[] = data.inquiries || [];
      setInquiries(inqs);
      setResolvedEmail(email);
      setSearched(true);
      // 문의가 하나면 자동 선택
      if (inqs.length === 1) setSelectedInquiryId(inqs[0].id);
      else setSelectedInquiryId(null);
    } catch {
      setError(L('조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', 'An error occurred while looking up the portal. Please try again shortly.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    await fetchByEmail(trimmed);
  }

  const selectedInquiry = inquiries.find(i => i.id === selectedInquiryId) || null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-3">
        <Link href="/" prefetch={false} className="text-sm font-bold text-gray-800 hover:text-blue-600 transition-colors">
          NexyFab
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-500">{L('고객 포털', 'Customer portal')}</span>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        {/* 제목 */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-black text-gray-900">{L('프로젝트 포털', 'Project portal')}</h1>
          <p className="text-sm text-gray-500 mt-2">
            {L('이메일 또는 계약 ID로 진행 현황, 파일, 리뷰를 확인하세요.', 'Use your email or contract ID to view progress, files, and reviews.')}
          </p>
        </div>

        {/* 조회 폼 */}
        {!urlContractId && (
          <form onSubmit={handleSearch} className="flex gap-2 mb-8">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={L('이메일 주소 입력', 'Enter email address')}
              required
              className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <button
              type="submit"
              disabled={loading || !inputValue.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? L('조회 중...', 'Looking up...') : L('조회', 'Look up')}
            </button>
          </form>
        )}

        {/* contractId 조회 중 로딩 */}
        {urlContractId && loading && (
          <div className="text-center py-12 text-gray-400 text-sm">{L('조회 중...', 'Looking up...')}</div>
        )}

        {/* 에러 */}
        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
            {error}
          </div>
        )}

        {/* 결과 */}
        {searched && !loading && (
          <>
            {inquiries.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-4xl mb-3">📭</p>
                <p className="text-gray-400 text-sm">{L('해당 이메일로 접수된 문의가 없습니다.', 'No inquiries were found for this email.')}</p>
                <p className="text-gray-300 text-xs mt-2">{L('이메일 주소가 정확한지 확인해 주세요.', 'Please check that the email address is correct.')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 여러 문의가 있는 경우 선택 목록 */}
                {inquiries.length > 1 && !selectedInquiryId && (
                  <div>
                    <p className="text-xs text-gray-500 font-semibold mb-3">
                      {L(`총 ${inquiries.length}건의 문의가 확인되었습니다. 확인할 프로젝트를 선택하세요.`, `${inquiries.length} inquiries found. Select a project to view.`)}
                    </p>
                    <div className="space-y-2">
                      {inquiries.map(inq => (
                        <button
                          key={inq.id}
                          onClick={() => setSelectedInquiryId(inq.id)}
                          className="w-full text-left px-4 py-3 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold text-gray-800">
                                {inq.company || inq.name || L('이름 없음', 'Unnamed')}
                                {inq.request_field ? ` · ${inq.request_field}` : ''}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">{formatDate(inq.date, lang)} {L('접수', 'received')}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${INQUIRY_STATUS_COLORS[inq.status || 'new'] || 'bg-gray-100 text-gray-500'}`}>
                                {displayLabel(L, INQUIRY_STATUS_LABELS[inq.status || 'new'], inq.status)}
                              </span>
                              {inq.contract && (
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${CONTRACT_STATUS_COLORS[inq.contract.status] || 'bg-gray-100 text-gray-500'}`}>
                                  {displayLabel(L, CONTRACT_STATUS_LABELS[inq.contract.status], inq.contract.status)}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 선택된 문의 탭 뷰 */}
                {selectedInquiry && (
                  <div>
                    {inquiries.length > 1 && (
                      <button
                        onClick={() => setSelectedInquiryId(null)}
                        className="text-xs text-blue-500 hover:underline mb-3 flex items-center gap-1"
                      >
                        ← {L('전체 목록으로', 'Back to all inquiries')}
                      </button>
                    )}
                    <PortalTabs
                      inquiry={selectedInquiry}
                      customerEmail={resolvedEmail}
                      onLightbox={setLightboxUrl}
                      onViewModel={(url, filename) => setViewingModel({ url, filename })}
                    />
                  </div>
                )}

                {/* 단일 문의는 selectedInquiry 블록에서 이미 처리됨 */}
              </div>
            )}
          </>
        )}
      </main>

      {/* 라이트박스 */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <Image
            src={lightboxUrl}
            alt={L('원본 이미지', 'Original image')}
            width={1600}
            height={1200}
            className="max-h-[90vh] w-auto max-w-full object-contain rounded-xl shadow-2xl"
            unoptimized
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-2xl font-bold hover:text-gray-300"
            onClick={() => setLightboxUrl(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* 3D 모델 뷰어 */}
      {viewingModel && (
        <ModelViewer
          url={viewingModel.url}
          filename={viewingModel.filename}
          onClose={() => setViewingModel(null)}
        />
      )}
    </div>
  );
}

// ─── 메인 페이지 (Suspense 래퍼) ─────────────────────────────────────────

export default function PortalPage() {
  const lang = useClientLocale();
  const L = createCommercialLocalizer(lang);
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">{L('로딩 중...', 'Loading...')}</div>
      </div>
    }>
      <PortalContent />
    </Suspense>
  );
}
