'use client';

import { useEffect, useState, useRef, useCallback, use } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

// ─── i18n ────────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '파일 관리',
    upload: '파일 업로드',
    dropHint: '파일을 드래그하거나 클릭하여 업로드',
    dropFormats: 'STEP, STL, OBJ, PDF, DWG, 이미지 등 · 최대 100MB',
    allFiles: '전체',
    cad: 'CAD 파일',
    image: '이미지',
    document: '문서',
    general: '기타',
    noFiles: '업로드된 파일이 없습니다',
    noFilesDesc: '위 영역에 파일을 드래그하거나 클릭하여 업로드하세요',
    download: '다운로드',
    delete: '삭제',
    deleteConfirm: '이 파일을 삭제하시겠습니까?',
    storageUsed: '저장공간 사용량',
    of: '/',
    upgradeHint: '용량이 부족하면 플랜을 업그레이드하세요',
    uploading: '업로드 중...',
    uploadError: '업로드 실패',
    quotaError: '저장공간이 부족합니다. 플랜을 업그레이드하세요.',
    retentionTitle: '파일 보관 정책',
    retentionItems: [
      '견적 요청 미연결 파일: 30일 후 자동 삭제',
      'RFQ만 있고 계약 미체결: 90일 후 자동 삭제',
      '계약 완료 후: 180일간 보관',
      '진행 중인 계약 파일: 계약 기간 동안 보관',
    ],
    loginRequired: '로그인이 필요합니다',
  },
  en: {
    title: 'File Manager',
    upload: 'Upload File',
    dropHint: 'Drag & drop or click to upload',
    dropFormats: 'STEP, STL, OBJ, PDF, DWG, images, etc. · Max 100MB',
    allFiles: 'All',
    cad: 'CAD',
    image: 'Images',
    document: 'Documents',
    general: 'Other',
    noFiles: 'No files uploaded',
    noFilesDesc: 'Drag files above or click to upload',
    download: 'Download',
    delete: 'Delete',
    deleteConfirm: 'Delete this file?',
    storageUsed: 'Storage Used',
    of: '/',
    upgradeHint: 'Upgrade your plan for more storage',
    uploading: 'Uploading...',
    uploadError: 'Upload failed',
    quotaError: 'Storage quota exceeded. Upgrade your plan.',
    retentionTitle: 'File Retention Policy',
    retentionItems: [
      'Files without RFQ: auto-deleted after 30 days',
      'RFQ only, no contract: auto-deleted after 90 days',
      'Completed contracts: retained 180 days',
      'Active contract files: retained during contract',
    ],
    loginRequired: 'Login required',
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileItem {
  id: string;
  storage_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  category: string;
  ref_type: string | null;
  ref_id: string | null;
  created_at: number;
}

interface StorageInfo {
  used_bytes: number;
  used_gb: number;
  limit_gb: number;
  usage_percent: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const CATEGORY_ICONS: Record<string, string> = {
  cad: '🔧', image: '🖼️', document: '📄', general: '📎',
};

const CATEGORY_COLORS: Record<string, string> = {
  cad: '#388bfd', image: '#a371f7', document: '#d29922', general: '#6e7681',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function FilesPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const t = lang === 'ko' ? dict.ko : dict.en;
  const { user } = useAuthStore();

  const [files, setFiles] = useState<FileItem[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState<string>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showRetention, setShowRetention] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch files ────────────────────────────────────────────────────────────
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '30' });
      if (category) params.set('category', category);
      const res = await fetch(`/api/nexyfab/files?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setFiles(data.files);
      setStorage(data.storage);
      setTotal(data.pagination.total);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [page, category]);

  useEffect(() => {
    if (user) fetchFiles();
  }, [user, fetchFiles]);

  // ── Upload ─────────────────────────────────────────────────────────────────
  async function handleUpload(fileList: FileList | File[]) {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    setUploading(true);
    setUploadError('');

    for (const file of arr) {
      const formData = new FormData();
      formData.append('file', file);
      // Auto-detect category from extension
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (['step', 'stp', 'stl', 'obj', 'blend'].includes(ext)) {
        formData.append('category', 'cad');
      } else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        formData.append('category', 'image');
      } else if (['pdf', 'doc', 'docx', 'dwg', 'dxf'].includes(ext)) {
        formData.append('category', 'document');
      }

      try {
        const res = await fetch('/api/nexyfab/files', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.code === 'STORAGE_QUOTA_EXCEEDED') {
            setUploadError(t.quotaError);
          } else {
            setUploadError(data.error || t.uploadError);
          }
          break;
        }
      } catch {
        setUploadError(t.uploadError);
        break;
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    fetchFiles();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete(fileId: string) {
    if (!confirm(t.deleteConfirm)) return;
    setDeleting(fileId);
    try {
      await fetch(`/api/nexyfab/files?id=${fileId}`, { method: 'DELETE' });
      fetchFiles();
    } catch { /* ignore */ }
    finally { setDeleting(null); }
  }

  // ── Login guard ────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b949e', fontSize: '15px' }}>
        {t.loginRequired}
      </div>
    );
  }

  const totalPages = Math.ceil(total / 30);
  const categories = ['', 'cad', 'image', 'document', 'general'];
  const categoryLabels: Record<string, string> = {
    '': t.allFiles, cad: t.cad, image: t.image, document: t.document, general: t.general,
  };

  return (
    <div style={{ padding: '32px', maxWidth: 960, margin: '0 auto', color: '#c9d1d9' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#e6edf3' }}>{t.title}</h1>
        <button
          onClick={() => setShowRetention(!showRetention)}
          style={{ fontSize: 12, color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          {t.retentionTitle}
        </button>
      </div>

      {/* Retention notice (collapsible) */}
      {showRetention && (
        <div style={{
          marginBottom: 16, padding: '12px 16px', background: '#161b22',
          border: '1px solid #30363d', borderRadius: 10, fontSize: 12, color: '#8b949e', lineHeight: 1.7,
        }}>
          <div style={{ fontWeight: 700, color: '#c9d1d9', marginBottom: 4 }}>{t.retentionTitle}</div>
          {t.retentionItems.map((item, i) => (
            <div key={i}>• {item}</div>
          ))}
        </div>
      )}

      {/* Storage usage bar */}
      {storage && (
        <div style={{
          marginBottom: 20, padding: '14px 18px', background: '#161b22',
          border: '1px solid #30363d', borderRadius: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>{t.storageUsed}</span>
            <span style={{ fontSize: 13, color: '#8b949e' }}>
              {storage.used_gb.toFixed(2)} GB {t.of} {storage.limit_gb} GB
              <span style={{ marginLeft: 6, fontSize: 11, color: storage.usage_percent > 90 ? '#f85149' : '#8b949e' }}>
                ({storage.usage_percent}%)
              </span>
            </span>
          </div>
          <div style={{ height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, transition: 'width 0.3s',
              width: `${Math.min(100, storage.usage_percent)}%`,
              background: storage.usage_percent > 90 ? '#f85149'
                : storage.usage_percent > 70 ? '#d29922' : '#388bfd',
            }} />
          </div>
          {storage.usage_percent > 80 && (
            <div style={{ fontSize: 11, color: '#d29922', marginTop: 6 }}>{t.upgradeHint}</div>
          )}
        </div>
      )}

      {/* Upload dropzone */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false); handleUpload(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          marginBottom: 20, padding: '28px 20px', textAlign: 'center', cursor: 'pointer',
          borderRadius: 12, border: `2px dashed ${isDragging ? '#388bfd' : '#30363d'}`,
          background: isDragging ? 'rgba(56,139,253,0.08)' : '#0d1117',
          transition: 'all 0.2s',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={e => e.target.files && handleUpload(e.target.files)}
          style={{ display: 'none' }}
          accept=".step,.stp,.stl,.obj,.blend,.pdf,.doc,.docx,.dwg,.dxf,.jpg,.jpeg,.png,.webp,.gif,.zip,.rar,.7z"
        />
        {uploading ? (
          <div style={{ color: '#388bfd', fontSize: 14, fontWeight: 600 }}>{t.uploading}</div>
        ) : (
          <>
            <div style={{ fontSize: 28, marginBottom: 6 }}>{isDragging ? '📂' : '📤'}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3' }}>{t.dropHint}</div>
            <div style={{ fontSize: 12, color: '#6e7681', marginTop: 4 }}>{t.dropFormats}</div>
          </>
        )}
      </div>

      {/* Upload error */}
      {uploadError && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', background: 'rgba(248,81,73,0.1)',
          border: '1px solid rgba(248,81,73,0.3)', borderRadius: 8,
          fontSize: 13, color: '#f85149',
        }}>
          {uploadError}
        </div>
      )}

      {/* Category filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => { setCategory(cat); setPage(1); }}
            style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: `1px solid ${category === cat ? '#388bfd' : '#30363d'}`,
              background: category === cat ? 'rgba(56,139,253,0.15)' : 'transparent',
              color: category === cat ? '#388bfd' : '#8b949e',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {cat && CATEGORY_ICONS[cat]} {categoryLabels[cat]}
          </button>
        ))}
      </div>

      {/* File list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6e7681' }}>Loading...</div>
      ) : files.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#8b949e' }}>{t.noFiles}</div>
          <div style={{ fontSize: 12, color: '#6e7681', marginTop: 4 }}>{t.noFilesDesc}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map(file => (
            <div key={file.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', borderRadius: 10,
              background: '#161b22', border: '1px solid #21262d',
              transition: 'border-color 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#30363d')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#21262d')}
            >
              {/* Icon */}
              <div style={{
                width: 36, height: 36, borderRadius: 8, display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 18,
                background: `${CATEGORY_COLORS[file.category] ?? '#6e7681'}22`,
                flexShrink: 0,
              }}>
                {CATEGORY_ICONS[file.category] ?? '📎'}
              </div>

              {/* File info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: '#e6edf3',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {file.filename}
                </div>
                <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                  {formatBytes(file.size_bytes)} · {formatDate(file.created_at)}
                  {file.ref_type && (
                    <span style={{
                      marginLeft: 6, padding: '1px 6px', borderRadius: 4,
                      background: '#21262d', fontSize: 10,
                    }}>
                      {file.ref_type}{file.ref_id ? ` #${file.ref_id.slice(0, 8)}` : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <a
                  href={`/api/nexyfab/files/${file.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    border: '1px solid #30363d', background: '#21262d', color: '#c9d1d9',
                    textDecoration: 'none', cursor: 'pointer',
                  }}
                >
                  {t.download}
                </a>
                <button
                  onClick={() => handleDelete(file.id)}
                  disabled={deleting === file.id}
                  style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    border: '1px solid rgba(248,81,73,0.3)', background: 'rgba(248,81,73,0.1)',
                    color: '#f85149', cursor: 'pointer', opacity: deleting === file.id ? 0.5 : 1,
                  }}
                >
                  {t.delete}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).slice(
            Math.max(0, page - 3), page + 2
          ).map(p => (
            <button
              key={p}
              onClick={() => setPage(p)}
              style={{
                width: 32, height: 32, borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: `1px solid ${p === page ? '#388bfd' : '#30363d'}`,
                background: p === page ? 'rgba(56,139,253,0.15)' : 'transparent',
                color: p === page ? '#388bfd' : '#8b949e',
                cursor: 'pointer',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
