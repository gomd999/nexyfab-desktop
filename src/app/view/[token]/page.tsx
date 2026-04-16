'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ToastProvider';
import dynamic from 'next/dynamic';

const ModelViewer = dynamic(() => import('./ModelViewer'), { ssr: false });

interface ShareMetadata {
  name: string;
  material?: string;
  bbox?: { w: number; h: number; d: number };
  watermark?: string;
  allowDownload?: boolean;
}

interface Annotation {
  id: string;
  x: number; // percentage from left
  y: number; // percentage from top
  text: string;
  createdAt: number;
}

// Simple language detection from browser
function detectLang(): 'ko' | 'en' | 'ja' | 'cn' {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language?.toLowerCase() || '';
  if (lang.startsWith('ko')) return 'ko';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('zh')) return 'cn';
  return 'en';
}

const i18n = {
  ko: { viewOnly: '읽기 전용', openEditor: 'Shape Generator에서 열기 →', submitRfq: '⚡ 이 모델로 RFQ 제출', expires: '만료', loading: '불러오는 중...', expired: '링크가 만료되었습니다', notFound: '링크를 찾을 수 없습니다', goHome: 'NexyFab으로 이동', specs: '스펙', size: '크기', material: '소재', tooLarge: '모델 데이터가 너무 큽니다.', download: 'STEP 다운로드', version: '버전', versionHistory: '버전 이력', annotate: '메모', addNote: '클릭하여 메모 추가', notePlaceholder: '메모 입력...', save: '저장', cancel: '취소', deleteNote: '삭제' },
  en: { viewOnly: 'View-only', openEditor: 'Open in Shape Generator →', expires: 'Expires', loading: 'Loading...', expired: 'Link has expired', notFound: 'Link not found', goHome: 'Go to NexyFab', specs: 'Specs', size: 'Size', material: 'Material', tooLarge: 'Model data is too large.', download: 'Download STEP', version: 'Version', versionHistory: 'Version History', annotate: 'Annotate', addNote: 'Click to add a note', notePlaceholder: 'Enter note...', save: 'Save', cancel: 'Cancel', deleteNote: 'Delete' },
  ja: { viewOnly: '閲覧専用', openEditor: 'Shape Generatorで開く →', expires: '期限', loading: '読み込み中...', expired: 'リンクが期限切れです', notFound: 'リンクが見つかりません', goHome: 'NexyFabへ移動', specs: 'スペック', size: 'サイズ', material: '素材', tooLarge: 'モデルデータが大きすぎます。', download: 'STEPダウンロード', version: 'バージョン', versionHistory: 'バージョン履歴', annotate: '注釈', addNote: 'クリックしてメモを追加', notePlaceholder: 'メモを入力...', save: '保存', cancel: 'キャンセル', deleteNote: '削除' },
  cn: { viewOnly: '仅查看', openEditor: '在 Shape Generator 中打开 →', expires: '到期', loading: '加载中...', expired: '链接已过期', notFound: '找不到链接', goHome: '转到 NexyFab', specs: '规格', size: '尺寸', material: '材料', tooLarge: '模型数据太大。', download: '下载 STEP', version: '版本', versionHistory: '版本历史', annotate: '批注', addNote: '点击添加批注', notePlaceholder: '输入批注...', save: '保存', cancel: '取消', deleteNote: '删除' },
};

export default function ViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { toast } = useToast();
  const [data, setData] = useState<{ meshDataBase64: string; metadata: ShareMetadata; expiresAt: number; version?: number; versions?: { token: string; version: number; createdAt: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<'ko' | 'en' | 'ja' | 'cn'>('en');
  const t = i18n[lang];
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [selectedPin, setSelectedPin] = useState<string | null>(null);

  useEffect(() => { setLang(detectLang()); }, []);

  const [authToken, setAuthToken] = useState<string | null>(null);

  // Load auth token from localStorage
  useEffect(() => {
    try {
      const t = localStorage.getItem('nf_access_token') || localStorage.getItem('token');
      if (t) setAuthToken(t);
    } catch { /* ignore */ }
  }, []);

  // Load annotations: server-side first, fallback to localStorage
  useEffect(() => {
    fetch(`/api/nexyfab/annotations?token=${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.annotations?.length > 0) {
          setAnnotations(d.annotations.map((a: { id: string; position: { x: number; y: number; z?: number }; text: string; createdAt: string; authorName?: string; color?: string }) => ({
            id: a.id,
            x: a.position.x,
            y: a.position.y,
            text: a.text,
            createdAt: new Date(a.createdAt).getTime(),
            authorName: a.authorName,
            color: a.color,
          })));
        } else {
          // fallback to localStorage
          try {
            const saved = localStorage.getItem(`nf_annotations_${token}`);
            if (saved) setAnnotations(JSON.parse(saved));
          } catch { /* ignore */ }
        }
      })
      .catch(() => {
        try {
          const saved = localStorage.getItem(`nf_annotations_${token}`);
          if (saved) setAnnotations(JSON.parse(saved));
        } catch { /* ignore */ }
      });
  }, [token]);

  const saveAnnotations = (updated: Annotation[]) => {
    setAnnotations(updated);
    try { localStorage.setItem(`nf_annotations_${token}`, JSON.stringify(updated)); } catch { /* ignore */ }
  };

  const handleViewerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAnnotating) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPendingPin({ x, y });
    setNoteText('');
    setSelectedPin(null);
  };

  const handleSaveNote = () => {
    if (!pendingPin || !noteText.trim()) return;
    const newAnnotation: Annotation = {
      id: Date.now().toString(36),
      x: pendingPin.x, y: pendingPin.y,
      text: noteText.trim(),
      createdAt: Date.now(),
    };
    saveAnnotations([...annotations, newAnnotation]);
    setPendingPin(null);
    setNoteText('');
    // Save to server if authenticated
    if (authToken) {
      fetch('/api/nexyfab/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          shareToken: token,
          x: pendingPin.x, y: pendingPin.y, z: 0,
          text: noteText.trim(),
        }),
      }).catch(() => {});
    }
  };

  const handleDeleteNote = (id: string) => {
    saveAnnotations(annotations.filter(a => a.id !== id));
    setSelectedPin(null);
  };

  useEffect(() => {
    fetch(`/api/nexyfab/share?token=${token}`)
      .then(r => r.ok ? r.json() : r.json().then((d: { error: string }) => { throw new Error(d.error); }))
      .then((d: { meshDataBase64: string; metadata: ShareMetadata; expiresAt: number }) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [token]);

  const handleOpenEditor = () => {
    if (!data) return;
    try {
      sessionStorage.setItem('nexyfab_shared_mesh', data.meshDataBase64);
      sessionStorage.setItem('nexyfab_shared_meta', JSON.stringify(data.metadata));
      window.open(`/${lang === 'cn' ? 'cn' : lang === 'ja' ? 'ja' : lang === 'ko' ? 'kr' : 'en'}/shape-generator/?from=shared`, '_blank');
    } catch { toast('error', t.tooLarge); }
  };

  const bbox = data?.metadata.bbox;

  return (
    <div style={{
      minHeight: '100dvh', background: '#0d1117',
      fontFamily: 'system-ui, sans-serif', color: '#e6edf3',
      display: 'flex', flexDirection: 'column',
      userSelect: 'none',
    }}
      onContextMenu={e => e.preventDefault()}
      onDragStart={e => e.preventDefault()}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', borderBottom: '1px solid #21262d',
        background: '#161b22', flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>
            <span style={{ color: '#8b9cf4' }}>Nexy</span>Fab
          </span>
          <span style={{ fontSize: 11, color: '#6e7681', background: '#21262d', padding: '3px 8px', borderRadius: 6 }}>
            🔒 {t.viewOnly}
          </span>
        </div>
        {data && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => { setIsAnnotating(!isAnnotating); setPendingPin(null); setSelectedPin(null); }}
              style={{
                padding: '7px 16px', borderRadius: '10px', fontSize: '12px', fontWeight: 700,
                background: isAnnotating ? '#f59e0b' : '#30363d', color: '#fff', border: 'none', cursor: 'pointer',
                transition: 'background 0.15s', whiteSpace: 'nowrap',
              }}
            >
              📌 {t.annotate}
            </button>
            {authToken && (
              <a
                href={`/kr/nexyfab/rfq?from=view&token=${token}&name=${encodeURIComponent(data?.metadata?.name ?? '')}`}
                style={{
                  padding: '7px 16px', borderRadius: '10px', fontSize: '12px', fontWeight: 700,
                  background: 'linear-gradient(135deg, #388bfd, #8b5cf6)', color: '#fff',
                  border: 'none', cursor: 'pointer', textDecoration: 'none',
                  transition: 'opacity 0.15s', whiteSpace: 'nowrap', display: 'inline-block',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >
                {lang === 'ko' ? '⚡ 이 모델로 RFQ 제출' : '⚡ Submit RFQ'}
              </a>
            )}
            <button onClick={handleOpenEditor}
              style={{
                padding: '7px 16px', borderRadius: '10px', fontSize: '12px', fontWeight: 700,
                background: '#238636', color: '#fff', border: 'none', cursor: 'pointer',
                transition: 'background 0.15s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2ea043'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#238636'; }}
            >
              {t.openEditor}
            </button>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{data.metadata.name}</p>
              <p style={{ margin: 0, fontSize: 10, color: '#6e7681' }}>
                {t.expires}: {new Date(data.expiresAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
        {/* Viewer */}
        <div style={{ flex: 1, position: 'relative', cursor: isAnnotating ? 'crosshair' : 'default' }} onClick={handleViewerClick}>
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 32, height: 32, border: '3px solid #30363d', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                <div style={{ color: '#6e7681', fontSize: 13 }}>{t.loading}</div>
              </div>
            </div>
          )}
          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 36 }}>🔗</div>
              <p style={{ color: '#f85149', fontSize: 14 }}>
                {error === 'Link expired' ? t.expired : t.notFound}
              </p>
              <Link href="/" style={{ color: '#388bfd', fontSize: 12 }}>{t.goHome}</Link>
            </div>
          )}
          {data && <ModelViewer meshDataBase64={data.meshDataBase64} metadata={data.metadata} />}

          {/* Annotation mode hint */}
          {isAnnotating && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              background: '#f59e0b', color: '#000', padding: '6px 16px', borderRadius: 8,
              fontSize: 11, fontWeight: 700, zIndex: 10, pointerEvents: 'none',
            }}>
              📌 {t.addNote}
            </div>
          )}

          {/* Annotation pins */}
          {annotations.map(pin => (
            <div key={pin.id} style={{
              position: 'absolute', left: `${pin.x}%`, top: `${pin.y}%`,
              transform: 'translate(-50%, -100%)', zIndex: 10, cursor: 'pointer',
            }} onClick={e => { e.stopPropagation(); setSelectedPin(selectedPin === pin.id ? null : pin.id); }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50% 50% 50% 0', background: '#f59e0b',
                transform: 'rotate(-45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}>
                <span style={{ transform: 'rotate(45deg)', fontSize: 10, fontWeight: 800, color: '#000' }}>
                  {annotations.indexOf(pin) + 1}
                </span>
              </div>
              {selectedPin === pin.id && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4,
                  background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
                  padding: 12, minWidth: 180, zIndex: 20,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }} onClick={e => e.stopPropagation()}>
                  <p style={{ margin: 0, fontSize: 12, color: '#e6edf3', lineHeight: 1.5 }}>{pin.text}</p>
                  <p style={{ margin: '6px 0 0', fontSize: 9, color: '#6e7681' }}>
                    {new Date(pin.createdAt).toLocaleString()}
                  </p>
                  <button onClick={() => handleDeleteNote(pin.id)} style={{
                    marginTop: 8, padding: '3px 10px', fontSize: 10, fontWeight: 700,
                    background: '#da3633', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                  }}>
                    {t.deleteNote}
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Pending pin input */}
          {pendingPin && (
            <div style={{
              position: 'absolute', left: `${pendingPin.x}%`, top: `${pendingPin.y}%`,
              transform: 'translate(-50%, 8px)', zIndex: 20,
            }} onClick={e => e.stopPropagation()}>
              <div style={{
                background: '#161b22', border: '1px solid #f59e0b', borderRadius: 10,
                padding: 12, minWidth: 200,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}>
                <textarea
                  autoFocus
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder={t.notePlaceholder}
                  style={{
                    width: '100%', minHeight: 60, background: '#0d1117', border: '1px solid #30363d',
                    borderRadius: 6, color: '#e6edf3', fontSize: 12, padding: 8, resize: 'vertical',
                    fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button onClick={handleSaveNote} style={{
                    flex: 1, padding: '5px 10px', fontSize: 11, fontWeight: 700,
                    background: '#238636', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                  }}>{t.save}</button>
                  <button onClick={() => setPendingPin(null)} style={{
                    flex: 1, padding: '5px 10px', fontSize: 11, fontWeight: 700,
                    background: '#30363d', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
                  }}>{t.cancel}</button>
                </div>
              </div>
            </div>
          )}

          {/* Watermark */}
          <div style={{
            position: 'absolute', bottom: 12, right: 14,
            fontSize: 10, color: '#30363d', pointerEvents: 'none',
            fontWeight: 700, letterSpacing: '0.05em',
          }}>
            NexyFab · {t.viewOnly} · {data?.metadata.watermark ?? 'No Download'}
          </div>
        </div>

        {/* Spec Card — right sidebar */}
        {data && (bbox || data.metadata.material) && (
          <div style={{
            width: 220, background: '#161b22', borderLeft: '1px solid #21262d',
            padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16,
            overflowY: 'auto',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                {t.specs}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#e6edf3', marginBottom: 4 }}>{data.metadata.name}</div>
            </div>

            {bbox && (
              <div style={{ background: '#0d1117', borderRadius: 10, padding: 14, border: '1px solid #21262d' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', marginBottom: 8 }}>
                  📐 {t.size} (mm)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, textAlign: 'center' }}>
                  {[
                    { label: 'W', value: bbox.w },
                    { label: 'H', value: bbox.h },
                    { label: 'D', value: bbox.d },
                  ].map(d => (
                    <div key={d.label}>
                      <div style={{ fontSize: 9, color: '#6e7681', fontWeight: 600 }}>{d.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#e6edf3' }}>{d.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.metadata.material && (
              <div style={{ background: '#0d1117', borderRadius: 10, padding: 14, border: '1px solid #21262d' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', marginBottom: 6 }}>
                  🧱 {t.material}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>{data.metadata.material}</div>
              </div>
            )}

            {/* Version info */}
            {data.version && (
              <div style={{ background: '#0d1117', borderRadius: 10, padding: 14, border: '1px solid #21262d' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', marginBottom: 6 }}>
                  🔄 {t.version}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3', marginBottom: data.versions && data.versions.length > 1 ? 10 : 0 }}>
                  v{data.version}
                </div>
                {data.versions && data.versions.length > 1 && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', marginBottom: 6 }}>
                      {t.versionHistory}
                    </div>
                    {data.versions.map(v => (
                      <a
                        key={v.token}
                        href={`/view/${v.token}`}
                        style={{
                          display: 'block', padding: '4px 8px', borderRadius: 6, fontSize: 11,
                          color: v.token === token ? '#3b82f6' : '#8b949e',
                          fontWeight: v.token === token ? 700 : 400,
                          textDecoration: 'none', transition: 'color 0.15s',
                          background: v.token === token ? 'rgba(59,130,246,0.1)' : 'transparent',
                        }}
                      >
                        v{v.version} — {new Date(v.createdAt).toLocaleDateString()}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Download button (if allowed) */}
            {data.metadata.allowDownload && (
              <button
                onClick={() => {
                  try {
                    const json = atob(data.meshDataBase64);
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `${data.metadata.name || 'model'}.json`;
                    a.click(); URL.revokeObjectURL(url);
                  } catch { /* ignore */ }
                }}
                style={{
                  padding: '8px 16px', borderRadius: 10,
                  background: '#1f6feb', color: '#fff', border: 'none',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  transition: 'background 0.15s', textAlign: 'center',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#388bfd'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#1f6feb'; }}
              >
                💾 {t.download}
              </button>
            )}

            {/* Open in editor CTA */}
            <button onClick={handleOpenEditor}
              style={{
                marginTop: data.metadata.allowDownload ? '0' : 'auto', padding: '10px 16px', borderRadius: 10,
                background: '#238636', color: '#fff', border: 'none',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                transition: 'background 0.15s', textAlign: 'center',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2ea043'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#238636'; }}
            >
              {t.openEditor}
            </button>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
