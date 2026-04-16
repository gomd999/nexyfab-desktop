'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import PartnerNotificationBell from '@/app/components/PartnerNotificationBell';

// ─── helpers ─────────────────────────────────────────────────────────────────

function won(n: number | null | undefined) {
  if (n == null) return '-';
  return n.toLocaleString('ko-KR') + '원';
}
function formatDate(iso: string | null | undefined) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR');
}
function getDaysLeft(deadline: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(deadline); due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

// ─── types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  partner: { email: string; company: string; factoryId: string | null; factoryName: string };
  stats: {
    totalAssigned: number; pendingQuotes: number; activeContracts: number;
    completedContracts: number; avgResponseHours: number | null; winRate: number | null;
  };
  pendingRfqs: {
    id: string; shapeName: string; materialId: string; quantity: number;
    volume_cm3: number; dfmScore: number | null; note: string | null;
    assignedAt: string | null; createdAt: string;
  }[];
  activeContracts: {
    id: string; project_name: string; status: string;
    contract_amount: number | null; deadline: string | null;
    progress_percent: number; created_at: string; customer_email: string | null;
  }[];
  recentQuotes: {
    id: string; projectName: string; status: string;
    estimatedAmount: number | null; respondedAt: string | null; createdAt: string;
  }[];
}

const STATUS_LABELS: Record<string, string> = {
  contracted: '계약 완료', in_progress: '진행 중', quality_check: '품질 검수',
  delivered: '납품 완료', completed: '완료', cancelled: '취소됨',
};
const STATUS_COLORS: Record<string, string> = {
  contracted: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700',
  quality_check: 'bg-orange-100 text-orange-700', delivered: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-600',
};
const MATERIAL_LABELS: Record<string, string> = {
  pla: 'PLA', abs: 'ABS', petg: 'PETG', nylon: 'Nylon',
  aluminum: '알루미늄', steel: '스틸', titanium: '티타늄',
};

// ─── QuoteModal ───────────────────────────────────────────────────────────────

interface QuoteModalProps {
  rfq: DashboardData['pendingRfqs'][0];
  session: string;
  onClose: () => void;
  onSubmitted: () => void;
}
function QuoteModal({ rfq, session, onClose, onSubmitted }: QuoteModalProps) {
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [validDays, setValidDays] = useState('14');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!amount) { setError('견적 금액을 입력하세요.'); return; }
    setLoading(true); setError('');
    try {
      const validUntil = new Date(Date.now() + Number(validDays) * 86_400_000).toISOString();
      const res = await fetch('/api/partner/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({
          rfqId: rfq.id, estimatedAmount: Number(amount),
          estimatedDays: days ? Number(days) : null, note, validUntil,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || '제출 실패'); return; }
      onSubmitted();
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">견적 제출</h3>
          <p className="text-xs text-gray-400 mt-1 truncate">{rfq.shapeName} · {MATERIAL_LABELS[rfq.materialId] ?? rfq.materialId} · {rfq.quantity}개</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">견적 금액 (원) *</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="예: 250000" min="0"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">납기 (일)</label>
              <input type="number" value={days} onChange={e => setDays(e.target.value)}
                placeholder="예: 7" min="1"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">견적 유효기간 (일)</label>
              <input type="number" value={validDays} onChange={e => setValidDays(e.target.value)}
                min="1" max="90"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">메모</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              rows={3} placeholder="추가 사항 (선택)"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} disabled={loading}
            className="flex-1 py-2 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
            취소
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-bold text-white transition disabled:opacity-50">
            {loading ? '제출 중...' : '견적 제출'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AvailabilityTab ──────────────────────────────────────────────────────────

function AvailabilityTab({
  mondays, savedData, loading, saving, onSave,
}: {
  mondays: string[];
  savedData: { weekStart: string; availableHours: number; notes: string | null }[];
  loading: boolean;
  saving: string | null;
  onSave: (weekStart: string, hours: number, notes: string) => void;
}) {
  const [edits, setEdits] = useState<Record<string, { hours: number; notes: string }>>({});

  // Initialize edits from savedData
  const getHours = (monday: string) => {
    if (edits[monday] !== undefined) return edits[monday].hours;
    return savedData.find(d => d.weekStart === monday)?.availableHours ?? 40;
  };
  const getNotes = (monday: string) => {
    if (edits[monday]?.notes !== undefined) return edits[monday].notes;
    return savedData.find(d => d.weekStart === monday)?.notes ?? '';
  };

  const setHours = (monday: string, hours: number) =>
    setEdits(prev => ({ ...prev, [monday]: { hours, notes: prev[monday]?.notes ?? getNotes(monday) } }));
  const setNotes = (monday: string, notes: string) =>
    setEdits(prev => ({ ...prev, [monday]: { hours: prev[monday]?.hours ?? getHours(monday), notes } }));

  const hoursColor = (h: number) =>
    h === 0 ? 'text-red-500' : h <= 20 ? 'text-amber-500' : h >= 40 ? 'text-green-600' : 'text-blue-600';

  return (
    <div className="px-5 py-4">
      <p className="text-xs text-gray-400 mb-4">
        주차별 가용 시간을 설정하면 RFQ 자동 배정 시 반영됩니다. (0 = 해당 주 불가)
      </p>
      {loading ? (
        <p className="text-center text-gray-400 text-sm py-8">불러오는 중...</p>
      ) : (
        <div className="space-y-4">
          {mondays.map(monday => {
            const h = getHours(monday);
            const n = getNotes(monday);
            const isSaving = saving === monday;
            const hasSaved = savedData.some(d => d.weekStart === monday);
            const isModified = edits[monday] !== undefined;

            return (
              <div key={monday} className={`rounded-xl border p-4 transition-colors ${
                h === 0 ? 'bg-red-50 border-red-200'
                : hasSaved ? 'bg-gray-50 border-gray-200'
                : 'bg-white border-gray-200'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-sm font-bold text-gray-800">{monday}</span>
                    <span className="text-xs text-gray-400 ml-2">
                      ({new Date(monday).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 주)
                    </span>
                  </div>
                  <div className={`text-lg font-black ${hoursColor(h)}`}>{h}h</div>
                </div>

                <input type="range" min="0" max="80" step="4"
                  value={h} onChange={e => setHours(monday, Number(e.target.value))}
                  className="w-full accent-blue-600 mb-2" />
                <div className="flex justify-between text-[10px] text-gray-400 mb-3">
                  <span>0h (불가)</span><span>20h</span><span>40h (풀타임)</span><span>80h</span>
                </div>

                <div className="flex gap-2">
                  <input value={n} onChange={e => setNotes(monday, e.target.value)}
                    placeholder="메모 (선택: 출장, 공휴일...)"
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 bg-white" />
                  <button
                    onClick={() => onSave(monday, h, n)}
                    disabled={isSaving || (!isModified && hasSaved)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      isSaving ? 'bg-gray-300 text-gray-500'
                      : isModified ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}>
                    {isSaving ? '저장 중' : hasSaved && !isModified ? '저장됨' : '저장'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── MilestoneModal ───────────────────────────────────────────────────────────

interface Milestone {
  id: string; title: string; description: string | null;
  status: string; dueDate: string | null; completedAt: string | null;
}

function MilestoneModal({
  contract, session, onClose,
}: {
  contract: DashboardData['activeContracts'][0];
  session: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/milestones`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      const d = await res.json();
      setItems(d.milestones ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [contract.id, session]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (ms: Milestone) => {
    const next = ms.status === 'completed' ? 'pending' : 'completed';
    await fetch(`/api/contracts/${contract.id}/milestones`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ milestoneId: ms.id, status: next }),
    });
    await load();
  };

  const addMilestone = async () => {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      await fetch(`/api/contracts/${contract.id}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ title: newTitle.trim(), dueDate: newDue || undefined }),
      });
      setNewTitle(''); setNewDue('');
      await load();
    } finally { setAdding(false); }
  };

  const doneCount = items.filter(m => m.status === 'completed').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[80vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">마일스톤 관리</h3>
          <p className="text-xs text-gray-400 mt-1 truncate">{contract.project_name}</p>
          {!loading && (
            <p className="text-xs text-blue-600 mt-1 font-semibold">{doneCount} / {items.length} 완료</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-center text-gray-400 text-sm py-8">불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">마일스톤이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {items.map(ms => (
                <div key={ms.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-blue-200 transition-colors">
                  <button onClick={() => toggle(ms)}
                    className={`w-5 h-5 rounded-[5px] border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      ms.status === 'completed'
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-gray-300 hover:border-blue-400'
                    }`}>
                    {ms.status === 'completed' && <span className="text-[10px]">✓</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${ms.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {ms.title}
                    </p>
                    {ms.dueDate && (
                      <p className="text-[10px] text-gray-400 mt-0.5">기한: {ms.dueDate}</p>
                    )}
                    {ms.completedAt && (
                      <p className="text-[10px] text-green-500 mt-0.5">완료: {new Date(ms.completedAt).toLocaleDateString('ko-KR')}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add form */}
        <div className="px-6 py-4 border-t border-gray-100 space-y-2">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder="새 마일스톤 제목..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
            onKeyDown={e => e.key === 'Enter' && addMilestone()} />
          <div className="flex gap-2">
            <input type="date" value={newDue} onChange={e => setNewDue(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition" />
            <button onClick={addMilestone} disabled={adding || !newTitle.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition disabled:opacity-50">
              {adding ? '...' : '추가'}
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-50">
          <button onClick={onClose}
            className="w-full py-2 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ProgressModal ────────────────────────────────────────────────────────────

interface ProgressModalProps {
  contract: DashboardData['activeContracts'][0];
  session: string;
  onClose: () => void;
  onUpdated: () => void;
}
function ProgressModal({ contract, session, onClose, onUpdated }: ProgressModalProps) {
  const [progress, setProgress] = useState(contract.progress_percent);
  const [status, setStatus] = useState(contract.status);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/partner/contracts/${contract.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ progressPercent: progress, status, note }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || '업데이트 실패'); return; }
      onUpdated();
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  const NEXT_STATUSES = ['in_progress', 'quality_check', 'delivered', 'completed'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">진행 상태 업데이트</h3>
          <p className="text-xs text-gray-400 mt-1 truncate">{contract.project_name}</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">진행률: {progress}%</label>
            <input type="range" min="0" max="100" step="5"
              value={progress} onChange={e => setProgress(Number(e.target.value))}
              className="w-full accent-blue-600" />
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">상태</label>
            <div className="grid grid-cols-2 gap-2">
              {NEXT_STATUSES.map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                    status === s
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-gray-200 text-gray-600 hover:border-blue-300'
                  }`}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">업데이트 메모</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              rows={3} placeholder="진행 상황 메모 (선택)"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} disabled={loading}
            className="flex-1 py-2 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
            취소
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-bold text-white transition disabled:opacity-50">
            {loading ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ email, company, onLogout }: { email: string; company: string; onLogout: () => void }) {
  const pathname = usePathname();
  const navItems = [
    { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
    { href: '/partner/projects', label: '프로젝트', icon: '📦' },
    { href: '/partner/quotes', label: '견적', icon: '📝' },
    { href: '/partner/portfolio', label: '포트폴리오', icon: '🏆' },
    { href: '/partner/profile', label: '프로필', icon: '🏭' },
  ];
  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 bg-white border-r border-gray-100 min-h-screen">
      <div className="px-5 py-5 border-b border-gray-100">
        <a href="/" className="text-lg font-black text-gray-900">NexyFab</a>
        <p className="text-xs text-gray-400 mt-0.5">파트너 포털</p>
      </div>
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-bold text-gray-800 truncate">{company || '파트너'}</div>
        <div className="text-xs text-gray-400 truncate">{email}</div>
      </div>
      <nav className="flex-1 px-3 py-3 space-y-1">
        {navItems.map(item => {
          const isActive = pathname === item.href;
          return (
            <a key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              <span>{item.icon}</span>{item.label}
            </a>
          );
        })}
      </nav>
      <div className="px-3 py-4 border-t border-gray-100">
        <button onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors">
          <span>🚪</span>로그아웃
        </button>
      </div>
    </aside>
  );
}

// ─── Demo data (module-level — stable reference, no stale closure) ─────────────

const DEMO_DATA: DashboardData = {
  partner: { email: 'demo-partner@nexyfab.com', company: 'Demo 제조사', factoryId: 'demo-factory-001', factoryName: 'Demo 제조사' },
  stats: { totalAssigned: 5, pendingQuotes: 2, activeContracts: 2, completedContracts: 3, avgResponseHours: 4.2, winRate: 72 },
  pendingRfqs: [
    { id: 'rfq-d1', shapeName: 'EV 배터리 브라켓', materialId: 'aluminum', quantity: 500, volume_cm3: 120, dfmScore: 88, note: '표면 처리 요청', assignedAt: new Date(Date.now() - 86400000).toISOString(), createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 'rfq-d2', shapeName: '스마트워치 하우징', materialId: 'abs', quantity: 1000, volume_cm3: 45, dfmScore: 94, note: null, assignedAt: new Date(Date.now() - 3600000).toISOString(), createdAt: new Date(Date.now() - 3600000).toISOString() },
  ],
  activeContracts: [
    { id: 'con-d1', project_name: 'IoT 모듈 PCB 조립', status: 'in_progress', contract_amount: 42000000, deadline: new Date(Date.now() + 14 * 86400000).toISOString(), progress_percent: 65, created_at: new Date(Date.now() - 30 * 86400000).toISOString(), customer_email: 'customer@nexyfab.com' },
    { id: 'con-d2', project_name: '의료기기 케이스 시제품', status: 'quality_check', contract_amount: 8500000, deadline: new Date(Date.now() + 3 * 86400000).toISOString(), progress_percent: 90, created_at: new Date(Date.now() - 20 * 86400000).toISOString(), customer_email: 'customer2@nexyfab.com' },
  ],
  recentQuotes: [
    { id: 'q-d1', projectName: 'EV 배터리 케이스 외주 제조', status: 'accepted', estimatedAmount: 28000000, respondedAt: new Date(Date.now() - 5 * 86400000).toISOString(), createdAt: new Date(Date.now() - 7 * 86400000).toISOString() },
    { id: 'q-d2', projectName: '다이캐스팅 하우징', status: 'pending', estimatedAmount: 15000000, respondedAt: new Date(Date.now() - 86400000).toISOString(), createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 'q-d3', projectName: '산업용 로봇팔 부품', status: 'rejected', estimatedAmount: 55000000, respondedAt: new Date(Date.now() - 10 * 86400000).toISOString(), createdAt: new Date(Date.now() - 12 * 86400000).toISOString() },
  ],
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PartnerDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState('');
  const [tab, setTab] = useState<'pending' | 'active' | 'quotes' | 'settlements' | 'availability'>('pending');
  const [settlements, setSettlements] = useState<{
    settlements: { contractId: string; projectName: string; contractAmount: number; commissionAmount: number; netAmount: number; completedAt: string; month: string }[];
    summary: { totalRevenue: number; totalCommission: number; netRevenue: number; count: number };
  } | null>(null);
  const [settlementsLoading, setSettlementsLoading] = useState(false);
  const [settlementMonth, setSettlementMonth] = useState('');
  const [availability, setAvailability] = useState<{ weekStart: string; availableHours: number; notes: string | null }[]>([]);
  const [availSaving, setAvailSaving] = useState<string | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [quoteTarget, setQuoteTarget] = useState<DashboardData['pendingRfqs'][0] | null>(null);
  const [progressTarget, setProgressTarget] = useState<DashboardData['activeContracts'][0] | null>(null);
  const [milestoneTarget, setMilestoneTarget] = useState<DashboardData['activeContracts'][0] | null>(null);

  const loadDashboard = useCallback(async (sess: string) => {
    if (sess === 'demo') { setData(DEMO_DATA); setLoading(false); return; }
    try {
      const res = await fetch('/api/partner/dashboard', {
        headers: { Authorization: `Bearer ${sess}` },
      });
      if (res.status === 401) { router.replace('/partner/login'); return; }
      const d: DashboardData = await res.json();
      setData(d);
    } catch {
      // keep existing data
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const sess = localStorage.getItem('partnerSession');
    if (!sess) { router.replace('/partner/login'); return; }
    setSession(sess);
    // Demo bypass — skip API entirely
    if (sess === 'demo') { setData(DEMO_DATA); setLoading(false); return; }
    loadDashboard(sess);
  }, [loadDashboard, router]);

  const logout = useCallback(() => {
    localStorage.removeItem('partnerSession');
    localStorage.removeItem('partnerInfo');
    router.push('/partner/login');
  }, [router]);

  // ── Availability / Settlement hooks — MUST be before any early return ────────
  const loadAvailability = useCallback(async () => {
    if (!data) return;
    setAvailLoading(true);
    try {
      const res = await fetch(`/api/partner/availability?email=${encodeURIComponent(data.partner.email)}&weeks=6`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (res.ok) {
        const d = await res.json();
        setAvailability(d.availability ?? []);
      }
    } catch { /* ignore */ } finally { setAvailLoading(false); }
  }, [data, session]);

  const loadSettlements = useCallback(async (month = '') => {
    setSettlementsLoading(true);
    try {
      const url = `/api/partner/settlements${month ? `?month=${month}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${session}` } });
      if (res.ok) setSettlements(await res.json());
    } catch { /* ignore */ } finally {
      setSettlementsLoading(false);
    }
  }, [session]);
  // ─────────────────────────────────────────────────────────────────────────────

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      </div>
    );
  }

  const { partner, stats, pendingRfqs, activeContracts, recentQuotes } = data;

  // ── Availability helpers ────────────────────────────────────────────────────
  const getNextMondays = (count = 6): string[] => {
    const mondays: string[] = [];
    const d = new Date();
    const day = d.getDay();
    const daysToMon = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
    d.setDate(d.getDate() + daysToMon);
    d.setHours(0, 0, 0, 0);
    for (let i = 0; i < count; i++) {
      mondays.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 7);
    }
    return mondays;
  };

  const saveAvailability = async (weekStart: string, hours: number, notes: string) => {
    setAvailSaving(weekStart);
    try {
      await fetch('/api/partner/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ weekStart, availableHours: hours, notes: notes || undefined }),
      });
      await loadAvailability();
    } catch { /* ignore */ } finally { setAvailSaving(null); }
  };

  // Deadline alerts
  const urgentContracts = activeContracts
    .filter(c => c.deadline && getDaysLeft(c.deadline) <= 7)
    .sort((a, b) => getDaysLeft(a.deadline!) - getDaysLeft(b.deadline!));

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar email={partner.email} company={partner.company} onLogout={logout} />

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 flex items-center justify-around py-2">
        {[
          { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
          { href: '/partner/projects', label: '프로젝트', icon: '📦' },
          { href: '/partner/quotes', label: '견적', icon: '📝' },
          { href: '/partner/profile', label: '프로필', icon: '🏭' },
        ].map(item => (
          <a key={item.href} href={item.href}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl ${item.href === '/partner/dashboard' ? 'text-blue-600' : 'text-gray-500'}`}>
            <span className="text-2xl leading-tight">{item.icon}</span>
            <span className="text-[10px] font-semibold">{item.label}</span>
          </a>
        ))}
      </nav>

      <main className="flex-1 p-6 overflow-auto pb-24 md:pb-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black text-gray-900">대시보드</h1>
              <p className="text-sm text-gray-500 mt-1">{partner.factoryName} 파트너 현황</p>
            </div>
            <PartnerNotificationBell session={session} />
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {[
              { label: '배정 RFQ', value: stats.totalAssigned + '건', color: 'text-gray-900' },
              { label: '견적 대기', value: stats.pendingQuotes + '건', color: 'text-blue-700' },
              { label: '진행 계약', value: stats.activeContracts + '건', color: 'text-yellow-600' },
              { label: '완료 계약', value: stats.completedContracts + '건', color: 'text-green-600' },
              {
                label: '평균 응답',
                value: stats.avgResponseHours != null ? stats.avgResponseHours + 'h' : '-',
                color: 'text-gray-900',
              },
              {
                label: '수주율',
                value: stats.winRate != null ? stats.winRate + '%' : '-',
                color: stats.winRate != null && stats.winRate >= 60 ? 'text-green-600' : 'text-gray-700',
              },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">{s.label}</p>
                <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Urgent deadline alerts */}
          {urgentContracts.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-bold text-red-600 uppercase tracking-widest mb-2">납기 임박 ({urgentContracts.length}건)</p>
              <div className="space-y-2">
                {urgentContracts.map(c => {
                  const d = getDaysLeft(c.deadline!);
                  return (
                    <div key={c.id}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border ${d < 0 ? 'bg-red-100 border-red-300' : d <= 3 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                      <div>
                        <p className={`text-sm font-bold ${d < 0 ? 'text-red-800' : 'text-amber-800'}`}>{c.project_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">납기: {formatDate(c.deadline)}</p>
                      </div>
                      <span className={`text-sm font-black ${d < 0 ? 'text-red-700' : d === 0 ? 'text-red-600' : d <= 3 ? 'text-red-500' : 'text-amber-600'}`}>
                        {d < 0 ? `D+${Math.abs(d)}` : d === 0 ? 'D-Day' : `D-${d}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-4 flex-wrap">
            {([
              { key: 'pending', label: `견적 대기 (${stats.pendingQuotes})` },
              { key: 'active', label: `진행 계약 (${stats.activeContracts})` },
              { key: 'quotes', label: `최근 견적 (${recentQuotes.length})` },
              { key: 'settlements', label: '정산 내역' },
              { key: 'availability', label: '가용성' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => {
                setTab(t.key);
                if (t.key === 'settlements' && !settlements) loadSettlements(settlementMonth);
                if (t.key === 'availability') loadAvailability();
              }}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-colors ${
                  tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

            {/* ── 견적 대기 탭 ── */}
            {tab === 'pending' && (
              pendingRfqs.length === 0 ? (
                <div className="py-16 text-center text-gray-400 text-sm">대기 중인 견적 요청이 없습니다.</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {pendingRfqs.map(rfq => (
                    <div key={rfq.id} className="px-5 py-4 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900 truncate">{rfq.shapeName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {MATERIAL_LABELS[rfq.materialId] ?? rfq.materialId}
                          {' · '}{rfq.quantity}개
                          {' · '}{rfq.volume_cm3.toFixed(1)} cm³
                          {rfq.dfmScore != null && ` · DFM ${rfq.dfmScore}`}
                        </p>
                        {rfq.note && <p className="text-xs text-gray-400 mt-1 truncate">{rfq.note}</p>}
                        <p className="text-[10px] text-gray-400 mt-1">
                          배정: {formatDate(rfq.assignedAt ?? rfq.createdAt)}
                        </p>
                      </div>
                      <button
                        onClick={() => setQuoteTarget(rfq)}
                        className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition">
                        견적 제출
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* ── 진행 계약 탭 ── */}
            {tab === 'active' && (
              activeContracts.length === 0 ? (
                <div className="py-16 text-center text-gray-400 text-sm">진행 중인 계약이 없습니다.</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {activeContracts.map(c => (
                    <div key={c.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-gray-900 truncate">{c.project_name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {won(c.contract_amount)}
                            {c.deadline && ` · 납기 ${formatDate(c.deadline)}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-500'}`}>
                            {STATUS_LABELS[c.status] || c.status}
                          </span>
                          <a
                            href={`/api/contracts/${c.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:border-gray-400 hover:text-gray-800 transition"
                          >
                            PDF
                          </a>
                          <button
                            onClick={() => setMilestoneTarget(c)}
                            className="px-3 py-1 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:border-purple-300 hover:text-purple-600 transition">
                            마일스톤
                          </button>
                          <button
                            onClick={() => setProgressTarget(c)}
                            className="px-3 py-1 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:border-blue-300 hover:text-blue-600 transition">
                            업데이트
                          </button>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${c.progress_percent}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400 font-semibold w-8 text-right">{c.progress_percent}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* ── 최근 견적 탭 ── */}
            {tab === 'quotes' && (
              recentQuotes.length === 0 ? (
                <div className="py-16 text-center text-gray-400 text-sm">제출된 견적이 없습니다.</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {recentQuotes.map(q => (
                    <div key={q.id} className="px-5 py-4 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{q.projectName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {q.estimatedAmount != null ? won(q.estimatedAmount) : '-'}
                          {q.respondedAt && ` · ${formatDate(q.respondedAt)} 응답`}
                        </p>
                      </div>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${
                        q.status === 'responded' ? 'bg-green-100 text-green-700'
                        : q.status === 'accepted' ? 'bg-blue-100 text-blue-700'
                        : q.status === 'rejected' ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-500'
                      }`}>
                        {q.status === 'responded' ? '응답 완료' : q.status === 'accepted' ? '채택됨'
                          : q.status === 'rejected' ? '미채택' : q.status}
                      </span>
                    </div>
                  ))}
                </div>
              )
            )}
            {/* ── 정산 내역 탭 ── */}
            {tab === 'settlements' && (
              <div className="px-5 py-4">
                {/* Month filter */}
                <div className="flex gap-2 mb-4">
                  <input type="month" value={settlementMonth}
                    onChange={e => { setSettlementMonth(e.target.value); loadSettlements(e.target.value); }}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
                  <button onClick={() => { setSettlementMonth(''); loadSettlements(''); }}
                    className="px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">
                    전체 기간
                  </button>
                  <a href={`/api/partner/settlement-pdf?partnerEmail=${encodeURIComponent(partner.email)}${settlementMonth ? `&month=${settlementMonth}` : ''}`}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-auto px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg text-gray-600 hover:border-gray-400">
                    PDF 내역서
                  </a>
                </div>

                {settlementsLoading ? (
                  <p className="text-center text-gray-400 text-sm py-8">불러오는 중...</p>
                ) : settlements ? (
                  <>
                    {/* Summary */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[
                        { label: '총 계약금', value: won(settlements.summary.totalRevenue), color: 'text-gray-900' },
                        { label: '플랫폼 수수료', value: won(settlements.summary.totalCommission), color: 'text-red-600' },
                        { label: '순 수입', value: won(settlements.summary.netRevenue), color: 'text-green-700' },
                      ].map(c => (
                        <div key={c.label} className="bg-gray-50 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-gray-400 mb-1">{c.label}</p>
                          <p className={`text-sm font-black ${c.color}`}>{c.value}</p>
                        </div>
                      ))}
                    </div>

                    {settlements.settlements.length === 0 ? (
                      <p className="text-center text-gray-400 text-sm py-8">정산 내역이 없습니다.</p>
                    ) : (
                      <div className="divide-y divide-gray-50 -mx-5">
                        {settlements.settlements.map(s => (
                          <div key={s.contractId} className="px-5 py-3 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{s.projectName}</p>
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                {s.month} · {s.contractId}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-green-700">{won(s.netAmount)}</p>
                              <p className="text-[10px] text-gray-400">계약 {won(s.contractAmount)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-center text-gray-400 text-sm py-8">데이터를 불러오지 못했습니다.</p>
                )}
              </div>
            )}
            {/* ── 가용성 탭 ── */}
            {tab === 'availability' && (
              <AvailabilityTab
                mondays={getNextMondays(6)}
                savedData={availability}
                loading={availLoading}
                saving={availSaving}
                onSave={saveAvailability}
              />
            )}
          </div>
        </div>
      </main>

      {/* Modals */}
      {milestoneTarget && (
        <MilestoneModal
          contract={milestoneTarget}
          session={session}
          onClose={() => setMilestoneTarget(null)}
        />
      )}
      {quoteTarget && (
        <QuoteModal
          rfq={quoteTarget}
          session={session}
          onClose={() => setQuoteTarget(null)}
          onSubmitted={() => { setQuoteTarget(null); loadDashboard(session); }}
        />
      )}
      {progressTarget && (
        <ProgressModal
          contract={progressTarget}
          session={session}
          onClose={() => setProgressTarget(null)}
          onUpdated={() => { setProgressTarget(null); loadDashboard(session); }}
        />
      )}
    </div>
  );
}
