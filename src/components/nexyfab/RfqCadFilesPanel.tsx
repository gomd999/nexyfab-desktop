'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

type CadVersion = {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: number;
  cadVersion: number;
  replacesFileId: string | null;
  uploadedByRole: string;
  isUploaderYou: boolean;
};

type Thread = { rootId: string; versions: CadVersion[] };

interface RfqCadFilesPanelProps {
  rfqId: string;
  lang?: string;
  /** 파트너 포털 등 쿠키 대신 Bearer 세션을 쓸 때 */
  authToken?: string | null;
  compact?: boolean;
}

type RfqCopy = {
  accessDenied: string; loadFailed: string; networkError: string; invalidFile: string;
  uploadFailed: string; title: string; uploadNew: string; loading: string;
  empty: string; thread: string; ownRfq: string; partnerView: string;
  partner: string; customer: string; you: string; get: string; uploadVersion: string;
};

const COPY: Record<IsoLang, RfqCopy> = {
  ko: { accessDenied: '접근 권한이 없습니다.', loadFailed: '목록을 불러오지 못했습니다.', networkError: '네트워크 오류', invalidFile: 'STEP/STL/OBJ/BLEND 만 업로드할 수 있습니다.', uploadFailed: '업로드 실패', title: 'CAD 파일 (버전)', uploadNew: '새 파일 업로드', loading: '불러오는 중…', empty: '등록된 CAD 파일이 없습니다. STEP 등을 올리면 고객·파트너가 같은 RFQ에서 버전을 이어갈 수 있습니다.', thread: '버전 묶음', ownRfq: '내 RFQ', partnerView: '파트너 보기', partner: '파트너', customer: '고객', you: '·나', get: '받기', uploadVersion: 'v{version}로 수정본 올리기' },
  en: { accessDenied: 'Access denied.', loadFailed: 'Failed to load files.', networkError: 'Network error', invalidFile: 'Only STEP/STL/OBJ/BLEND are allowed.', uploadFailed: 'Upload failed', title: 'CAD files (versions)', uploadNew: 'Upload new', loading: 'Loading…', empty: 'No CAD files yet. Upload a STEP file to start a version chain visible to both sides.', thread: 'Thread', ownRfq: 'Your RFQ', partnerView: 'Partner view', partner: 'Partner', customer: 'Customer', you: '·you', get: 'Get', uploadVersion: 'Upload as v{version}' },
  ja: { accessDenied: 'アクセス権がありません。', loadFailed: 'ファイルを読み込めませんでした。', networkError: 'ネットワークエラー', invalidFile: 'STEP/STL/OBJ/BLEND のみアップロードできます。', uploadFailed: 'アップロードに失敗しました', title: 'CADファイル（バージョン）', uploadNew: '新しいファイルをアップロード', loading: '読み込み中…', empty: 'CADファイルはまだありません。STEPなどをアップロードすると、双方で同じRFQのバージョンを続けられます。', thread: 'バージョン', ownRfq: '自分のRFQ', partnerView: 'パートナー表示', partner: 'パートナー', customer: '顧客', you: '·自分', get: '取得', uploadVersion: 'v{version}としてアップロード' },
  zh: { accessDenied: '没有访问权限。', loadFailed: '无法加载文件列表。', networkError: '网络错误', invalidFile: '仅支持上传 STEP/STL/OBJ/BLEND 文件。', uploadFailed: '上传失败', title: 'CAD 文件（版本）', uploadNew: '上传新文件', loading: '加载中…', empty: '还没有 CAD 文件。上传 STEP 文件即可开始双方可见的版本链。', thread: '版本组', ownRfq: '我的 RFQ', partnerView: '合作伙伴视图', partner: '合作伙伴', customer: '客户', you: '·我', get: '获取', uploadVersion: '作为 v{version} 上传' },
  es: { accessDenied: 'Acceso denegado.', loadFailed: 'No se pudieron cargar los archivos.', networkError: 'Error de red', invalidFile: 'Solo se permiten archivos STEP/STL/OBJ/BLEND.', uploadFailed: 'Error al subir', title: 'Archivos CAD (versiones)', uploadNew: 'Subir nuevo', loading: 'Cargando…', empty: 'Aún no hay archivos CAD. Sube un STEP para iniciar una cadena de versiones visible para ambas partes.', thread: 'Hilo', ownRfq: 'Tu RFQ', partnerView: 'Vista del socio', partner: 'Socio', customer: 'Cliente', you: '·tú', get: 'Obtener', uploadVersion: 'Subir como v{version}' },
  ar: { accessDenied: 'ليس لديك إذن للوصول.', loadFailed: 'تعذر تحميل الملفات.', networkError: 'خطأ في الشبكة', invalidFile: 'يُسمح فقط بملفات STEP/STL/OBJ/BLEND.', uploadFailed: 'فشل الرفع', title: 'ملفات CAD (الإصدارات)', uploadNew: 'رفع ملف جديد', loading: 'جارٍ التحميل…', empty: 'لا توجد ملفات CAD بعد. ارفع ملف STEP لبدء سلسلة إصدارات يراها الطرفان.', thread: 'سلسلة الإصدارات', ownRfq: 'طلب الأسعار الخاص بك', partnerView: 'عرض الشريك', partner: 'الشريك', customer: 'العميل', you: '·أنت', get: 'تنزيل', uploadVersion: 'رفع كـ v{version}' },
};

function authHeaders(token: string | null | undefined): HeadersInit {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export default function RfqCadFilesPanel({
  rfqId,
  lang,
  authToken,
  compact = false,
}: RfqCadFilesPanelProps) {
  const copy = COPY[toIsoLang(lang)];
  const storeToken = useAuthStore(s => s.token);
  const bearer = authToken ?? storeToken;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/nexyfab/rfq/${encodeURIComponent(rfqId)}/cad-files`, {
        credentials: 'include',
        headers: { ...authHeaders(bearer) },
      });
      if (!res.ok) {
        setErr(res.status === 403 ? copy.accessDenied : copy.loadFailed);
        setThreads([]);
        return;
      }
      const data = await res.json() as { threads?: Thread[]; role?: string };
      setThreads(data.threads ?? []);
      setRole(data.role ?? null);
    } catch {
      setErr(copy.networkError);
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [rfqId, bearer, copy]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (fileId: string) => {
    try {
      const res = await fetch(
        `/api/nexyfab/rfq/${encodeURIComponent(rfqId)}/cad-files/${encodeURIComponent(fileId)}/download`,
        { credentials: 'include', headers: { ...authHeaders(bearer) } },
      );
      if (!res.ok) return;
      const { url, filename } = await res.json() as { url?: string; filename?: string };
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      if (filename) a.download = filename;
      a.click();
    } catch { /* ignore */ }
  };

  const uploadNewVersion = async (replacesFileId: string | undefined, file: File) => {
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    const cad = ['.step', '.stp', '.stl', '.obj', '.blend'].includes(ext);
    if (!cad) {
      setErr(copy.invalidFile);
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('rfqId', rfqId);
      if (replacesFileId) fd.append('replacesFileId', replacesFileId);
      const res = await fetch('/api/quick-quote/upload', {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { ...authHeaders(bearer) },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setErr(j.error ?? copy.uploadFailed);
        return;
      }
      await load();
    } catch {
      setErr(copy.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = (replacesLatestId: string | undefined) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.step,.stp,.stl,.obj,.blend';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void uploadNewVersion(replacesLatestId, f);
    };
    input.click();
  };

  const pad = compact ? '10px 12px' : '12px 14px';

  return (
    <div style={{
      border: '1px solid var(--nx-border)',
      borderRadius: 8,
      background: 'var(--nx-panel)',
      padding: pad,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-text-2)' }}>
          {copy.title}
        </span>
        <button
          type="button"
          disabled={uploading}
          onClick={() => onPickFile(undefined)}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid #388bfd55',
            background: uploading ? 'var(--nx-panel-2)' : '#388bfd22',
            color: '#58a6ff',
            cursor: uploading ? 'not-allowed' : 'pointer',
          }}
        >
          {uploading ? '…' : copy.uploadNew}
        </button>
      </div>
      {err && <p style={{ margin: '0 0 8px', fontSize: 11, color: '#f85149' }}>{err}</p>}
      {loading ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--nx-text-3)' }}>{copy.loading}</p>
      ) : threads.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--nx-text-3)' }}>
          {copy.empty}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {threads.map(thread => {
            const latest = thread.versions[thread.versions.length - 1];
            return (
              <div key={thread.rootId} style={{ background: 'var(--nx-bg)', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: 'var(--nx-text-3)', marginBottom: 6 }}>
                  {copy.thread} · v1–v{thread.versions.length}
                  {role && (
                    <span style={{ marginLeft: 8 }}>
                      ({role === 'owner' ? copy.ownRfq : copy.partnerView})
                    </span>
                  )}
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {thread.versions.map(v => (
                    <li
                      key={v.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        fontSize: 12,
                        color: 'var(--nx-text)',
                        padding: '4px 0',
                        borderBottom: '1px solid var(--nx-panel-2)',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: '#58a6ff', minWidth: 28 }}>v{v.cadVersion}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.filename}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>
                        {v.uploadedByRole === 'partner' ? copy.partner : copy.customer}
                        {v.isUploaderYou ? copy.you : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => void download(v.id)}
                        style={{
                          fontSize: 10,
                          padding: '2px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--nx-border)',
                          background: 'transparent',
                          color: '#8b9cf4',
                          cursor: 'pointer',
                        }}
                      >
                        {copy.get}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => onPickFile(latest?.id)}
                  style={{
                    marginTop: 8,
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid #3fb95044',
                    background: '#3fb95014',
                    color: '#3fb950',
                    cursor: uploading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {copy.uploadVersion.replace('{version}', String((latest?.cadVersion ?? 0) + 1))}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
