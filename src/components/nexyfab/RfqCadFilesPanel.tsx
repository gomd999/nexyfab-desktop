'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

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
  isKo?: boolean;
  /** 파트너 포털 등 쿠키 대신 Bearer 세션을 쓸 때 */
  authToken?: string | null;
  compact?: boolean;
}

function authHeaders(token: string | null | undefined): HeadersInit {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export default function RfqCadFilesPanel({
  rfqId,
  isKo = true,
  authToken,
  compact = false,
}: RfqCadFilesPanelProps) {
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
        setErr(res.status === 403 ? (isKo ? '접근 권한이 없습니다.' : 'Access denied.') : (isKo ? '목록을 불러오지 못했습니다.' : 'Failed to load files.'));
        setThreads([]);
        return;
      }
      const data = await res.json() as { threads?: Thread[]; role?: string };
      setThreads(data.threads ?? []);
      setRole(data.role ?? null);
    } catch {
      setErr(isKo ? '네트워크 오류' : 'Network error');
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [rfqId, bearer, isKo]);

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
      setErr(isKo ? 'STEP/STL/OBJ/BLEND 만 업로드할 수 있습니다.' : 'Only STEP/STL/OBJ/BLEND are allowed.');
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
        setErr(j.error ?? (isKo ? '업로드 실패' : 'Upload failed'));
        return;
      }
      await load();
    } catch {
      setErr(isKo ? '업로드 실패' : 'Upload failed');
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
      border: '1px solid #30363d',
      borderRadius: 8,
      background: '#161b22',
      padding: pad,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#8b949e' }}>
          {isKo ? 'CAD 파일 (버전)' : 'CAD files (versions)'}
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
            background: uploading ? '#21262d' : '#388bfd22',
            color: '#58a6ff',
            cursor: uploading ? 'not-allowed' : 'pointer',
          }}
        >
          {uploading ? '…' : (isKo ? '새 파일 업로드' : 'Upload new')}
        </button>
      </div>
      {err && <p style={{ margin: '0 0 8px', fontSize: 11, color: '#f85149' }}>{err}</p>}
      {loading ? (
        <p style={{ margin: 0, fontSize: 12, color: '#6e7681' }}>{isKo ? '불러오는 중…' : 'Loading…'}</p>
      ) : threads.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: '#6e7681' }}>
          {isKo
            ? '등록된 CAD 파일이 없습니다. STEP 등을 올리면 고객·파트너가 같은 RFQ에서 버전을 이어갈 수 있습니다.'
            : 'No CAD files yet. Upload a STEP file to start a version chain visible to both sides.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {threads.map(thread => {
            const latest = thread.versions[thread.versions.length - 1];
            return (
              <div key={thread.rootId} style={{ background: '#0d1117', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: '#484f58', marginBottom: 6 }}>
                  {isKo ? '버전 묶음' : 'Thread'} · v1–v{thread.versions.length}
                  {role && (
                    <span style={{ marginLeft: 8 }}>
                      ({role === 'owner' ? (isKo ? '내 RFQ' : 'Your RFQ') : (isKo ? '파트너 보기' : 'Partner view')})
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
                        color: '#e6edf3',
                        padding: '4px 0',
                        borderBottom: '1px solid #21262d',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: '#58a6ff', minWidth: 28 }}>v{v.cadVersion}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.filename}
                      </span>
                      <span style={{ fontSize: 10, color: '#8b949e' }}>
                        {v.uploadedByRole === 'partner' ? (isKo ? '파트너' : 'Partner') : (isKo ? '고객' : 'Customer')}
                        {v.isUploaderYou ? (isKo ? '·나' : '·you') : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => void download(v.id)}
                        style={{
                          fontSize: 10,
                          padding: '2px 8px',
                          borderRadius: 4,
                          border: '1px solid #30363d',
                          background: 'transparent',
                          color: '#8b9cf4',
                          cursor: 'pointer',
                        }}
                      >
                        {isKo ? '받기' : 'Get'}
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
                  {isKo ? `v${(latest?.cadVersion ?? 0) + 1}로 수정본 올리기` : `Upload as v${(latest?.cadVersion ?? 0) + 1}`}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
