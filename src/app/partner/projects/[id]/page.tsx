'use client';

import { useState, useEffect, useCallback, useRef, use } from 'react';
import ErrorBoundary from '@/app/components/ErrorBoundary';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import ModelViewer from '../../../components/ModelViewer';

interface Partner {
  partnerId: string;
  email: string;
  company: string;
}

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
  version?: number;
  previousVersionId?: string;
}

interface CustomerContact {
  name?: string;
  email?: string;
  phone?: string;
}

interface Contract {
  id: string;
  projectName: string;
  factoryName?: string;
  contractAmount: number;
  status: string;
  contractDate?: string;
  partnerEmail?: string;
  progressNotes?: ProgressNote[];
  attachments?: Attachment[];
  deadline?: string;
  customerContact?: CustomerContact;
  completionRequested?: boolean;
  progressPercent?: number;
}

interface Message {
  id: string;
  contractId: string;
  sender: string;
  senderType: 'admin' | 'partner' | 'customer';
  text: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  contracted: '계약 완료', in_progress: '진행 중', quality_check: '품질 검수',
  delivered: '납품 완료', completed: '완료', cancelled: '취소됨',
};

const STATUS_COLORS: Record<string, string> = {
  contracted: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  quality_check: 'bg-orange-100 text-orange-700',
  delivered: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const NEXT_STATUS: Record<string, { status: string; label: string } | null> = {
  contracted: { status: 'in_progress', label: '진행 시작' },
  in_progress: { status: 'quality_check', label: '품질검사 시작' },
  quality_check: { status: 'delivered', label: '납품 완료' },
  delivered: null, completed: null, cancelled: null,
};

const MODEL_EXTS = ['stl', 'step', 'stp', 'obj', '3ds', 'iges', 'igs'];
const DOCUMENT_EXTS = ['pdf', 'dwg', 'dxf'];

function won(n: number) { return n?.toLocaleString('ko-KR') + '원'; }

function formatDateTime(iso: string) {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function getDdayInfo(deadline: string): { label: string; color: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(deadline); due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: `D+${Math.abs(diff)} (기한 초과)`, color: 'text-red-600 font-bold' };
  if (diff === 0) return { label: 'D-Day', color: 'text-red-600 font-bold' };
  if (diff <= 7) return { label: `D-${diff}`, color: 'text-red-500 font-semibold' };
  if (diff <= 14) return { label: `D-${diff}`, color: 'text-amber-500 font-semibold' };
  return { label: `D-${diff}`, color: 'text-green-600 font-semibold' };
}

function getFileIcon(att: Attachment) {
  const ext = att.originalName.split('.').pop()?.toLowerCase() || '';
  if (MODEL_EXTS.includes(ext)) return '🧊';
  if (DOCUMENT_EXTS.includes(ext)) return '📐';
  return null;
}

function getFileType(filename: string): 'image' | 'model' | 'document' {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (MODEL_EXTS.includes(ext)) return 'model';
  return 'document';
}

function groupByName(attachments: Attachment[]): Map<string, Attachment[]> {
  const groups = new Map<string, Attachment[]>();
  for (const att of attachments) {
    if (!groups.has(att.originalName)) groups.set(att.originalName, []);
    groups.get(att.originalName)!.push(att);
  }
  return groups;
}

function uploadWithProgress(file: File, contractId: string, session: string, onProgress: (pct: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('contractId', contractId);
    formData.append('type', getFileType(file.name));
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status === 413) { reject(new Error(body.error || '저장 공간이 부족합니다.')); return; }
        if (xhr.status >= 400) { reject(new Error(body.error || '업로드 실패')); return; }
        resolve(body);
      } catch { reject(new Error('parse error')); }
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.open('POST', '/api/partner/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${session}`);
    xhr.send(formData);
  });
}

// ── VersionedFileRow ─────────────────────────────────────────────────────────
function VersionedFileRow({ group, onView, onDelete, deleting }: {
  group: Attachment[];
  onView: (url: string, filename: string) => void;
  onDelete: (id: string) => void;
  deleting: string | null;
}) {
  const [showOld, setShowOld] = useState(false);
  const sorted = [...group].sort((a, b) => (b.version || 1) - (a.version || 1));
  const latest = sorted[0];
  const older = sorted.slice(1);
  const icon = getFileIcon(latest);
  const maxV = latest.version || 1;

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 bg-gray-50">
        <span className="text-lg shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold text-gray-700 truncate">{latest.originalName}</p>
            <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${maxV >= 2 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              v{maxV}{maxV >= 2 ? ' (최신)' : ''}
            </span>
          </div>
          <p className="text-xs text-gray-400">{latest.type === 'model' ? '3D 모델' : '도면'} · {formatBytes(latest.size)} · {formatDateTime(latest.uploadedAt)}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          {latest.type === 'model' && (
            <button onClick={() => onView(latest.url, latest.originalName)}
              className="px-2 py-1 text-xs font-semibold rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-100 transition">
              🧊 3D 보기
            </button>
          )}
          <a href={latest.url} download={latest.originalName}
            className="px-2 py-1 text-xs font-semibold rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 transition">
            다운로드
          </a>
          <button onClick={() => onDelete(latest.id)} disabled={deleting === latest.id}
            className="px-2 py-1 text-xs font-semibold rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition disabled:opacity-50">
            {deleting === latest.id ? '...' : '삭제'}
          </button>
          {older.length > 0 && (
            <button onClick={() => setShowOld(v => !v)}
              className="px-2 py-1 text-xs font-semibold rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 transition">
              {showOld ? '▲' : '▼'} 이전 버전
            </button>
          )}
        </div>
      </div>
      {showOld && older.map(att => (
        <div key={att.id} className="flex items-center gap-3 px-3 py-1.5 bg-white border-t border-gray-100">
          <span className="text-xs text-gray-300 pl-5 shrink-0">└</span>
          <div className="flex-1 min-w-0">
            <span className="text-[9px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">v{att.version || 1}</span>
            <span className="text-xs text-gray-400 ml-1.5">{formatDateTime(att.uploadedAt)}</span>
          </div>
          <div className="flex gap-1 shrink-0">
            <a href={att.url} download={att.originalName} className="px-2 py-1 text-xs font-semibold rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-blue-50 transition">다운로드</a>
            <button onClick={() => onDelete(att.id)} disabled={deleting === att.id} className="px-2 py-1 text-xs font-semibold rounded-lg bg-red-50 border border-red-200 text-red-500 hover:bg-red-100 transition disabled:opacity-50">
              {deleting === att.id ? '...' : '삭제'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── FileUploadSection ────────────────────────────────────────────────────────
function FileUploadSection({ contract, session, onAttachmentsChange }: {
  contract: Contract;
  session: string;
  onAttachmentsChange: (attachments: Attachment[]) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; pct: number } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [viewingModel, setViewingModel] = useState<{ url: string; filename: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const attachments = contract.attachments || [];
  const images = attachments.filter(a => a.type === 'image');
  const others = attachments.filter(a => a.type !== 'image');
  const otherGroups = groupByName(others);

  async function handleFilesArray(fileArr: File[]) {
    setUploading(true);
    let updatedAttachments = [...attachments];
    for (const file of fileArr) {
      setUploadProgress({ name: file.name, pct: 0 });
      try {
        const data = await uploadWithProgress(file, contract.id, session, pct => setUploadProgress({ name: file.name, pct }));
        if (data.error) { toast('error', `파일 업로드 실패: ${data.error || file.name}`); continue; }
        updatedAttachments = [...updatedAttachments, data.attachment];
      } catch { toast('error', `업로드 중 오류: ${file.name}`); }
    }
    onAttachmentsChange(updatedAttachments);
    setUploading(false);
    setUploadProgress(null);
    setImagePreview(null);
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  }

  async function handleFiles(files: FileList) {
    const fileArr = Array.from(files);
    if (fileArr.length === 1 && fileArr[0].type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => { setImagePreview(e.target?.result as string); setPendingFile(fileArr[0]); };
      reader.readAsDataURL(fileArr[0]);
      return;
    }
    await handleFilesArray(fileArr);
  }

  async function handleDelete(attId: string) {
    if (!confirm('파일을 삭제하시겠습니까?')) return;
    setDeleting(attId);
    try {
      const res = await fetch(`/api/partner/upload?id=${attId}&contractId=${contract.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) { const err = await res.json(); toast('error', `삭제 실패: ${err.error}`); return; }
      onAttachmentsChange(attachments.filter(a => a.id !== attId));
    } catch { toast('error', '삭제 중 오류가 발생했습니다.'); }
    finally { setDeleting(null); }
  }

  return (
    <div>
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false); handleFilesArray(Array.from(e.dataTransfer.files)); }}
        className={`border-2 border-dashed rounded-xl p-4 text-center transition-colors mb-3 ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}
      >
        <div className="text-2xl mb-1">{isDragging ? '📂' : '📎'}</div>
        <p className="text-xs text-gray-500">파일을 드래그하거나 아래 버튼을 클릭하세요</p>
        <p className="text-xs text-gray-400 mt-0.5">이미지, STL, STEP, PDF, DWG 지원</p>
        <p className="text-xs text-sky-600 mt-1.5" style={{ lineHeight: 1.4 }}>
          계약 완료 후 180일간 파일이 보관됩니다. 중요한 파일은 로컬에 백업해 주세요.
        </p>
      </div>

      {/* Image preview */}
      {imagePreview && pendingFile && !uploading && (
        <div className="mb-3 flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
          <img src={imagePreview} alt="미리보기" className="w-16 h-16 object-cover rounded-lg border border-blue-200" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-blue-800 truncate">{pendingFile.name}</p>
            <p className="text-xs text-blue-500">업로드 전 미리보기</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => handleFilesArray([pendingFile])} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">업로드</button>
            <button onClick={() => { setImagePreview(null); setPendingFile(null); }} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 transition">취소</button>
          </div>
        </div>
      )}

      {/* Upload progress */}
      {uploading && uploadProgress && (
        <div className="mb-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
          <p className="text-xs font-semibold text-gray-700 mb-1.5 truncate">업로드 중: {uploadProgress.name}</p>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-blue-600 h-2 rounded-full transition-all duration-150" style={{ width: `${uploadProgress.pct}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-1 text-right">{uploadProgress.pct}%</p>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => cameraInputRef.current?.click()} disabled={uploading}
          className="flex-1 px-3 py-2 text-xs font-bold bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition disabled:opacity-50">
          📷 사진 촬영
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          className="flex-1 px-3 py-2 text-xs font-bold bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition disabled:opacity-50">
          📎 파일 선택
        </button>
      </div>

      <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.stl,.step,.stp,.obj,.3ds,.iges,.igs,.pdf,.dwg,.dxf" className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />

      {/* Image thumbnails */}
      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {images.map(att => (
            <div key={att.id} className="relative group">
              <img src={att.url} alt={att.originalName} className="w-full h-20 object-cover rounded-lg cursor-pointer border border-gray-100 hover:border-blue-300 transition" onClick={() => setLightboxUrl(att.url)} />
              {att.version && att.version > 1 && <span className="absolute top-1 right-1 text-[9px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded-full">v{att.version}</span>}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition flex items-end justify-center pb-1 gap-1 opacity-0 group-hover:opacity-100">
                <a href={att.url} download={att.originalName} className="px-2 py-1 bg-white text-xs font-semibold rounded text-gray-700 hover:bg-blue-50" onClick={e => e.stopPropagation()}>↓</a>
                <button onClick={e => { e.stopPropagation(); handleDelete(att.id); }} disabled={deleting === att.id} className="px-2 py-1 bg-red-500 text-xs font-semibold rounded text-white hover:bg-red-600 disabled:opacity-50">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Other files */}
      {otherGroups.size > 0 && (
        <div className="space-y-2">
          {Array.from(otherGroups.values()).map(group => (
            <VersionedFileRow key={group[0].originalName} group={group} onView={(url, filename) => setViewingModel({ url, filename })} onDelete={handleDelete} deleting={deleting} />
          ))}
        </div>
      )}

      {attachments.length === 0 && !uploading && !imagePreview && (
        <p className="text-xs text-gray-400 py-2">첨부된 파일이 없습니다.</p>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="원본 이미지" className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} />
          <button className="absolute top-4 right-4 text-white text-2xl font-bold hover:text-gray-300" onClick={() => setLightboxUrl(null)}>✕</button>
        </div>
      )}

      {/* 3D Model Viewer */}
      {viewingModel && <ModelViewer url={viewingModel.url} filename={viewingModel.filename} onClose={() => setViewingModel(null)} />}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
type ProjectTab = 'overview' | 'files' | 'messages';

export default function PartnerProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ProjectTab>('overview');
  const [updating, setUpdating] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [requestingCompletion, setRequestingCompletion] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [msgCount, setMsgCount] = useState(0);
  const [progressInput, setProgressInput] = useState<number | null>(null);
  const [savingProgress, setSavingProgress] = useState(false);
  const [attachUploading, setAttachUploading] = useState(false);
  const msgRef = useRef<HTMLDivElement>(null);
  const msgFileInputRef = useRef<HTMLInputElement>(null);

  const getSession = () => localStorage.getItem('partnerSession') || '';

  const logout = () => {
    localStorage.removeItem('partnerSession');
    localStorage.removeItem('partnerInfo');
    router.push('/partner/login');
  };

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace('/partner/login'); return; }

    fetch(`/api/partner/auth?session=${session}`)
      .then(r => r.json())
      .then(d => {
        if (!d.valid) { router.replace('/partner/login'); return; }
        setPartner(d.partner);
        return fetch('/api/partner/contracts', { headers: { Authorization: `Bearer ${session}` } });
      })
      .then(r => r?.json())
      .then(data => {
        if (!data) return;
        const found = (data.contracts || []).find((c: Contract) => c.id === id);
        setContract(found || null);
      })
      .catch(() => router.replace('/partner/login'))
      .finally(() => setLoading(false));
  }, [router, id]);

  // Fetch message count for badge
  useEffect(() => {
    if (!id) return;
    fetch(`/api/messages?contractId=${id}`)
      .then(r => r.ok ? r.json() : { messages: [] })
      .then(d => setMsgCount((d.messages || []).length))
      .catch(() => {});
  }, [id]);

  // Load messages when switching to messages tab, auto-poll every 10s
  useEffect(() => {
    if (tab !== 'messages' || !id) return;
    const load = () => fetch(`/api/messages?contractId=${id}`)
      .then(r => r.ok ? r.json() : { messages: [] })
      .then(d => setMessages(d.messages || []))
      .catch(() => {});
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [tab, id]);

  useEffect(() => {
    if (msgRef.current) msgRef.current.scrollTop = msgRef.current.scrollHeight;
  }, [messages]);

  async function updateStatus(status: string) {
    setUpdating(true);
    try {
      const res = await fetch('/api/partner/contracts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSession()}` },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setContract(data.contract);
    } catch { toast('error', '상태 변경에 실패했습니다.'); }
    finally { setUpdating(false); }
  }

  async function saveNote() {
    const note = noteInput.trim();
    if (!note) return;
    setSavingNote(true);
    try {
      const res = await fetch('/api/partner/contracts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSession()}` },
        body: JSON.stringify({ id, note }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setContract(data.contract);
      setNoteInput('');
    } catch { toast('error', '메모 저장에 실패했습니다.'); }
    finally { setSavingNote(false); }
  }

  async function requestCompletion() {
    setRequestingCompletion(true);
    try {
      const res = await fetch('/api/partner/contracts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSession()}` },
        body: JSON.stringify({ id, completionRequested: true }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setContract(data.contract);
      toast('success', '완료 확인 요청이 전송되었습니다.');
    } catch { toast('error', '완료 요청에 실패했습니다.'); }
    finally { setRequestingCompletion(false); }
  }

  async function saveProgress() {
    if (progressInput === null) return;
    setSavingProgress(true);
    try {
      const res = await fetch('/api/partner/contracts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSession()}` },
        body: JSON.stringify({ id, progressPercent: progressInput }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setContract(data.contract);
      setProgressInput(null);
    } catch { toast('error', '진행률 저장에 실패했습니다.'); }
    finally { setSavingProgress(false); }
  }

  async function sendMessage() {
    const text = msgInput.trim();
    if (!text || !partner) return;
    setSendingMsg(true);
    const tempId = `TEMP-${Date.now()}`;
    const tempMsg: Message = { id: tempId, contractId: id, sender: partner.company || partner.email, senderType: 'partner', text, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, tempMsg]);
    setMsgInput('');
    setTimeout(() => { if (msgRef.current) msgRef.current.scrollTop = msgRef.current.scrollHeight; }, 50);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: id, sender: partner.company || partner.email, senderType: 'partner', text }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMessages(prev => prev.map(m => m.id === tempId ? data.message : m));
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setMsgInput(text);
      toast('error', '메시지 전송에 실패했습니다.');
    }
    finally { setSendingMsg(false); }
  }

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400 text-sm">불러오는 중...</p></div>;
  if (!contract) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center flex-col gap-3">
      <p className="text-gray-500">계약을 찾을 수 없습니다.</p>
      <a href="/partner/projects" className="text-sm font-bold text-blue-600 hover:underline">← 프로젝트 목록으로</a>
    </div>
  );

  const nextAction = NEXT_STATUS[contract.status];
  const ddayInfo = contract.deadline ? getDdayInfo(contract.deadline) : null;
  const daysLeft: number | null = contract.deadline ? (() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(contract.deadline!); due.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  })() : null;

  const navItems: { id: ProjectTab; label: string; icon: string; badge?: number }[] = [
    { id: 'overview', label: '프로젝트 개요', icon: '📋' },
    { id: 'files', label: '파일 관리', icon: '📁' },
    { id: 'messages', label: '메시지', icon: '💬', badge: msgCount > 0 ? msgCount : undefined },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* ⑧ Sidebar — hidden on mobile */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 bg-white border-r border-gray-100 min-h-screen">
        <div className="px-5 py-5 border-b border-gray-100">
          <a href="/" className="text-lg font-black text-gray-900">NexyFab</a>
          <p className="text-xs text-gray-400 mt-0.5">파트너 포털</p>
        </div>
        {partner && (
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="text-sm font-bold text-gray-800 truncate">{partner.company || '파트너'}</div>
            <div className="text-xs text-gray-400 truncate">{partner.email}</div>
          </div>
        )}

        {/* Back */}
        <div className="px-3 pt-3 pb-1">
          <a href="/partner/projects" className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50 rounded-xl transition">
            ← 프로젝트 목록
          </a>
        </div>

        {/* Project nav */}
        <nav className="flex-1 px-3 py-1 space-y-1">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 pb-1">이 프로젝트</p>
          {navItems.map(item => (
            <button key={item.id} onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${tab === item.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge !== undefined && (
                <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-4">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Status */}
        <div className="px-5 py-4 border-t border-gray-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">현재 상태</p>
          <span className={`text-xs font-bold px-2.5 py-1.5 rounded-full ${STATUS_COLORS[contract.status] || 'bg-gray-100 text-gray-500'}`}>
            {STATUS_LABELS[contract.status] || contract.status}
          </span>
        </div>

        <div className="px-3 py-4 border-t border-gray-100">
          <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors">
            <span>🚪</span>로그아웃
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 flex items-center justify-around py-2 px-2">
        {navItems.map(item => (
          <button key={item.id} onClick={() => setTab(item.id)} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl relative ${tab === item.id ? 'text-blue-600' : 'text-gray-500'}`}>
            <span className="text-2xl leading-tight">{item.icon}</span>
            <span className="text-[10px] font-semibold">{item.label}</span>
            {item.badge !== undefined && <span className="absolute top-0.5 right-0.5 bg-red-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">{item.badge}</span>}
          </button>
        ))}
      </nav>

      {/* Main */}
      <main className="flex-1 p-6 overflow-auto pb-20 md:pb-6">
        <div className="max-w-3xl mx-auto">
          <ErrorBoundary>

          {/* ── Overview Tab ─── */}
          {tab === 'overview' && (
            <div>
              {/* ⑦ Deadline urgency banner */}
              {daysLeft !== null && daysLeft <= 7 && (
                <div className={`mb-4 px-4 py-3 border rounded-2xl flex items-center gap-3 ${daysLeft < 0 ? 'bg-red-100 border-red-300' : daysLeft <= 3 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                  <span className="text-2xl shrink-0">{daysLeft < 0 ? '🚨' : daysLeft === 0 ? '⚠️' : '⏰'}</span>
                  <div>
                    <p className={`text-sm font-bold ${daysLeft < 0 ? 'text-red-700' : daysLeft <= 3 ? 'text-red-600' : 'text-amber-700'}`}>
                      {daysLeft < 0 ? `납기 ${Math.abs(daysLeft)}일 초과!` : daysLeft === 0 ? '오늘이 납기일입니다!' : `납기까지 ${daysLeft}일 남았습니다`}
                    </p>
                    <p className={`text-xs mt-0.5 ${daysLeft < 0 ? 'text-red-400' : 'text-amber-500'}`}>납기일: {contract.deadline}</p>
                  </div>
                </div>
              )}

              <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h1 className="text-2xl font-black text-gray-900">{contract.projectName}</h1>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[contract.status] || 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABELS[contract.status] || contract.status}
                    </span>
                    {contract.completionRequested && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">완료 확인 요청 중</span>}
                  </div>
                </div>
                <button onClick={async () => {
                  const res = await fetch(`/api/contracts/${contract.id}/pdf`);
                  const html = await res.text();
                  const win = window.open('', '_blank');
                  win?.document.write(html); win?.document.close(); win?.print();
                }} className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition">
                  🖨️ 계약서 출력
                </button>
              </div>

              {/* Contract details */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">계약 금액</p>
                    <p className="text-lg font-black text-gray-900">{won(contract.contractAmount)}</p>
                  </div>
                  {contract.contractDate && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">계약일</p>
                      <p className="text-sm font-semibold text-gray-700">{contract.contractDate}</p>
                    </div>
                  )}
                  {contract.factoryName && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">공장명</p>
                      <p className="text-sm font-semibold text-gray-700">{contract.factoryName}</p>
                    </div>
                  )}
                  {contract.deadline && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">납기일</p>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-700">{contract.deadline}</p>
                        {ddayInfo && <span className={`text-xs ${ddayInfo.color}`}>{ddayInfo.label}</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Customer contact */}
              {contract.customerContact && (contract.customerContact.name || contract.customerContact.email || contract.customerContact.phone) && (
                <div className="bg-blue-50 rounded-2xl px-5 py-4 mb-4">
                  <p className="text-xs font-semibold text-blue-600 mb-2">고객 담당자</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-800">
                    {contract.customerContact.name && <span>👤 {contract.customerContact.name}</span>}
                    {contract.customerContact.email && <a href={`mailto:${contract.customerContact.email}`} className="hover:underline">✉️ {contract.customerContact.email}</a>}
                    {contract.customerContact.phone && <a href={`tel:${contract.customerContact.phone}`} className="hover:underline">📞 {contract.customerContact.phone}</a>}
                  </div>
                </div>
              )}

              {/* Status actions */}
              {(nextAction || contract.status === 'delivered') && (
                <div className="flex gap-2 flex-wrap mb-4">
                  {nextAction && (
                    <button onClick={() => updateStatus(nextAction.status)} disabled={updating}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition disabled:opacity-50">
                      {updating ? '처리 중...' : `${nextAction.label} →`}
                    </button>
                  )}
                  {contract.status === 'delivered' && !contract.completionRequested && (
                    <button onClick={requestCompletion} disabled={requestingCompletion}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg transition disabled:opacity-50">
                      {requestingCompletion ? '요청 중...' : '✅ 완료 확인 요청'}
                    </button>
                  )}
                </div>
              )}

              {/* Progress percent slider */}
              {contract.status !== 'completed' && contract.status !== 'cancelled' && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">제조 진행률</p>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl font-black text-blue-600 w-12 text-center shrink-0">
                      {progressInput !== null ? progressInput : (contract.progressPercent ?? 0)}%
                    </span>
                    <input type="range" min={0} max={100} step={5}
                      value={progressInput !== null ? progressInput : (contract.progressPercent ?? 0)}
                      onChange={e => setProgressInput(Number(e.target.value))}
                      className="flex-1 accent-blue-600" />
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                    <div className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progressInput !== null ? progressInput : (contract.progressPercent ?? 0)}%` }} />
                  </div>
                  {progressInput !== null && progressInput !== (contract.progressPercent ?? 0) && (
                    <button onClick={saveProgress} disabled={savingProgress}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition disabled:opacity-50">
                      {savingProgress ? '저장 중...' : '진행률 저장'}
                    </button>
                  )}
                </div>
              )}

              {/* Progress notes input */}
              {contract.status !== 'completed' && contract.status !== 'cancelled' && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">진행 메모 추가</p>
                  <div className="flex gap-2">
                    <input value={noteInput} onChange={e => setNoteInput(e.target.value)}
                      placeholder="진행 상황 메모 입력..."
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
                    <button onClick={saveNote} disabled={savingNote || !noteInput.trim()}
                      className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                      {savingNote ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>
              )}

              {/* Progress timeline */}
              {contract.progressNotes && contract.progressNotes.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">진행 기록</p>
                  <div className="space-y-3">
                    {[...contract.progressNotes].reverse().map((pn, idx) => (
                      <div key={idx} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                          {idx < contract.progressNotes!.length - 1 && <div className="w-0.5 flex-1 bg-gray-200 mt-1" />}
                        </div>
                        <div className="flex-1 pb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-gray-700">{pn.updatedBy}</span>
                            <span className="text-xs text-gray-400">{formatDateTime(pn.date)}</span>
                          </div>
                          <p className="text-sm text-gray-700 mt-1 bg-gray-50 rounded-lg px-3 py-2">{pn.note}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Files Tab ─── */}
          {tab === 'files' && (
            <div>
              <div className="mb-5">
                <h1 className="text-2xl font-black text-gray-900">파일 관리</h1>
                <p className="text-sm text-gray-500 mt-1">{contract.projectName} · {STATUS_LABELS[contract.status]}</p>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  📎 파일 / 결과물 {(contract.attachments || []).length > 0 && `(${(contract.attachments || []).length}개)`}
                </p>
                <FileUploadSection
                  contract={contract}
                  session={getSession()}
                  onAttachmentsChange={(attachments) => setContract(prev => prev ? { ...prev, attachments } : prev)}
                />
              </div>
            </div>
          )}

          {/* ── Messages Tab ─── */}
          {tab === 'messages' && (
            <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
              <div className="mb-4 shrink-0">
                <h1 className="text-2xl font-black text-gray-900">메시지</h1>
                <p className="text-sm text-gray-500 mt-1">{contract.projectName}</p>
              </div>
              <div ref={msgRef} className="flex-1 overflow-y-auto bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-3 space-y-2">
                {messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">메시지가 없습니다.</div>
                ) : messages.map(msg => {
                  const isPartner = msg.senderType === 'partner';
                  const isCustomer = msg.senderType === 'customer';
                  const isFile = msg.text?.startsWith('📎 파일:');
                  const fileUrl = isFile ? msg.text.replace('📎 파일:', '').trim() : null;
                  const fileName = fileUrl ? decodeURIComponent(fileUrl.split('/').pop() || '파일') : null;
                  return (
                    <div key={msg.id} className={`flex ${isPartner ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] px-3 py-2 rounded-xl text-xs ${isPartner ? 'bg-blue-600 text-white' : isCustomer ? 'bg-green-100 text-green-800' : 'bg-white border border-gray-200 text-gray-700'}`}>
                        <div className={`text-[10px] font-semibold mb-0.5 ${isPartner ? 'text-blue-100' : isCustomer ? 'text-green-600' : 'text-gray-400'}`}>{msg.sender}</div>
                        {isFile && fileUrl ? (
                          <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                            className={`flex items-center gap-1.5 font-semibold underline ${isPartner ? 'text-blue-100' : 'text-blue-600'}`}>
                            <span>📎</span><span>{fileName}</span>
                          </a>
                        ) : (
                          <p className="leading-relaxed break-words">{msg.text}</p>
                        )}
                        <div className={`text-[10px] mt-1 ${isPartner ? 'text-blue-200' : 'text-gray-400'}`}>
                          {new Date(msg.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 shrink-0 items-center">
                <input ref={msgFileInputRef} type="file" className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file || !partner) return;
                    setAttachUploading(true);
                    try {
                      const fd = new FormData(); fd.append('file', file);
                      const res = await fetch('/api/quick-quote/upload', { method: 'POST', body: fd });
                      const data = await res.json();
                      if (res.status === 413) { toast('error', data.error || '저장 공간이 부족합니다.'); return; }
                      if (!res.ok) { toast('error', data.error || '파일 업로드에 실패했습니다.'); return; }
                      if (data.url) {
                        const msgRes = await fetch('/api/messages', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ contractId: id, sender: partner.company || partner.email, senderType: 'partner', text: `📎 파일:${data.url}` }),
                        });
                        if (msgRes.ok) {
                          const d = await msgRes.json();
                          setMessages(prev => [...prev, d.message]);
                          setTimeout(() => { if (msgRef.current) msgRef.current.scrollTop = msgRef.current.scrollHeight; }, 50);
                        }
                      }
                    } catch { /* silent */ } finally { setAttachUploading(false); if (msgFileInputRef.current) msgFileInputRef.current.value = ''; }
                  }} />
                <button onClick={() => msgFileInputRef.current?.click()} disabled={attachUploading} title="파일 첨부"
                  className="p-2.5 rounded-xl bg-gray-100 border border-gray-200 text-lg hover:bg-gray-200 transition disabled:opacity-50 shrink-0">
                  {attachUploading ? '⏳' : '📎'}
                </button>
                <input value={msgInput} onChange={e => setMsgInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="메시지 입력... (Enter로 전송)"
                  className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
                <button onClick={sendMessage} disabled={sendingMsg || !msgInput.trim()}
                  className="px-5 py-2.5 text-sm font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition">
                  {sendingMsg ? '...' : '전송'}
                </button>
              </div>
            </div>
          )}

          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
