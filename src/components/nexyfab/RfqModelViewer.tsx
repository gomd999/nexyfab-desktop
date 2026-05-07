'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import DfmScoreBadge from './DfmScoreBadge';

interface ModelMeta {
  name?: string;
  material?: string;
  bbox?: { w: number; h: number; d: number };
}

interface RfqModelViewerProps {
  rfqId?: string;
  shareToken?: string | null;
  dfmScore?: number | null;
  dfmProcess?: string | null;
  shapeName?: string | null;
  materialId?: string | null;
  bbox?: { w: number; h: number; d: number } | null;
  /** compact = small card, expanded = taller */
  variant?: 'compact' | 'expanded';
  /** If true, auto-fetch model info from /api/nexyfab/rfq/[rfqId]/model */
  autoFetch?: boolean;
  /** 3D 설계기 진입 경로 (파트너 포털 등 [lang] 밖에서도 사용) */
  studioHref?: string;
}

export default function RfqModelViewer({
  rfqId,
  shareToken: initialShareToken,
  dfmScore: initialDfmScore,
  dfmProcess: initialDfmProcess,
  shapeName,
  materialId,
  bbox,
  variant = 'compact',
  autoFetch = false,
  studioHref = '/kr/shape-generator',
}: RfqModelViewerProps) {
  const [shareToken, setShareToken] = useState(initialShareToken ?? null);
  const [dfmScore, setDfmScore] = useState(initialDfmScore ?? null);
  const [dfmProcess, setDfmProcess] = useState(initialDfmProcess ?? null);
  const [loading, setLoading] = useState(autoFetch && !!rfqId && !initialShareToken);
  const [showIframe, setShowIframe] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Auto-fetch model info from API
  useEffect(() => {
    if (!autoFetch || !rfqId || initialShareToken) return;
    setLoading(true);
    fetch(`/api/nexyfab/rfq/${rfqId}/model`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.shareToken) setShareToken(data.shareToken);
        if (data?.dfmScore != null) setDfmScore(data.dfmScore);
        if (data?.dfmProcess) setDfmProcess(data.dfmProcess);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [autoFetch, rfqId, initialShareToken]);

  const height = variant === 'expanded' ? 320 : 200;
  const bboxStr = bbox ? `${Math.round(bbox.w)}×${Math.round(bbox.h)}×${Math.round(bbox.d)} mm` : null;

  // No model at all
  if (!shareToken && !loading) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height, background: '#0d1117', border: '1px dashed #30363d', borderRadius: 8,
        gap: 8, color: '#484f58',
      }}>
        <span style={{ fontSize: 28 }}>⬡</span>
        <p style={{ margin: 0, fontSize: 12, textAlign: 'center', lineHeight: 1.4 }}>
          3D 모델 없음
          {rfqId && (
            <>
              <br />
              <Link
                prefetch
                href={studioHref}
                style={{ color: '#8b9cf4', textDecoration: 'none', fontSize: 11 }}
              >
                설계 시작 →
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div style={{
      position: 'relative', background: '#0d1117',
      border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid #21262d',
        background: '#161b22',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 12 }}>⬡</span>
          <span style={{
            fontSize: 12, fontWeight: 600, color: '#e6edf3',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {shapeName ?? '3D 모델'}
          </span>
          {materialId && (
            <span style={{ fontSize: 10, color: '#8b949e', flexShrink: 0 }}>{materialId}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <DfmScoreBadge score={dfmScore} process={dfmProcess} size="sm" showLabel={false} />
          {shareToken && (
            <a
              href={`/view/${shareToken}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 10, color: '#8b9cf4', textDecoration: 'none',
                background: '#8b9cf41a', border: '1px solid #8b9cf433',
                borderRadius: 4, padding: '2px 7px', fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              전체 화면 ↗
            </a>
          )}
        </div>
      </div>

      {/* 3D Viewer area */}
      <div
        style={{ height, position: 'relative', cursor: 'pointer' }}
        onClick={() => { if (!showIframe && shareToken) setShowIframe(true); }}
      >
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#484f58', fontSize: 12,
          }}>
            <span>모델 로딩 중...</span>
          </div>
        )}

        {shareToken && !showIframe && !loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10,
            background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
          }}>
            {/* Decorative 3D-ish hex icon */}
            <div style={{
              width: 64, height: 64, borderRadius: 16,
              background: 'linear-gradient(135deg, #8b9cf422, #388bfd22)',
              border: '1px solid #30363d',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, color: '#8b9cf4',
            }}>
              ⬡
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>
                3D 뷰어 열기
              </p>
              {bboxStr && (
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8b949e' }}>{bboxStr}</p>
              )}
            </div>
            <div style={{
              fontSize: 11, color: '#8b9cf4', background: '#8b9cf41a',
              border: '1px solid #8b9cf433', borderRadius: 20,
              padding: '4px 14px', fontWeight: 600,
            }}>
              클릭하여 인터랙티브 3D 보기
            </div>
          </div>
        )}

        {shareToken && showIframe && (
          <>
            {!iframeLoaded && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#484f58', fontSize: 12, zIndex: 1,
              }}>
                3D 렌더링 중...
              </div>
            )}
            <iframe
              src={`/view/${shareToken}?embed=1`}
              style={{
                width: '100%', height: '100%', border: 'none',
                opacity: iframeLoaded ? 1 : 0, transition: 'opacity 0.3s',
              }}
              onLoad={() => setIframeLoaded(true)}
              title="3D Model Viewer"
              sandbox="allow-scripts allow-same-origin"
            />
          </>
        )}
      </div>

      {/* Footer: DFM detail */}
      {dfmScore != null && (
        <div style={{
          padding: '6px 12px', borderTop: '1px solid #21262d',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#0d1117',
        }}>
          <span style={{ fontSize: 10, color: '#8b949e' }}>DFM 분석</span>
          <DfmScoreBadge score={dfmScore} process={dfmProcess} size="sm" showLabel />
        </div>
      )}
    </div>
  );
}
