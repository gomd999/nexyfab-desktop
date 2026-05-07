'use client';
/**
 * IP 보호 공유 뷰어
 * - 3D 모델을 표시하지만 원본 파라미터는 노출하지 않음
 * - 치수 정보 일부(bbox) + 부피/표면적만 표시
 * - RFQ 요청 버튼 제공
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

const ShareCanvas = dynamic(() => import('./ShareCanvas'), { ssr: false });

interface ShareData {
  shapeId: string;
  shapeName?: string;
  bbox: { w: number; h: number; d: number };
  volume_cm3: number;
  surface_area_cm2: number;
  meshVertices?: string;
  createdAt: number;
}

interface ShareApiResponse {
  meshDataBase64: string;
  metadata: {
    name?: string;
    material?: string;
    bbox?: { w: number; h: number; d: number };
    volume_cm3?: number;
    surface_area_cm2?: number;
    watermark?: string;
  };
  createdAt: number;
  expiresAt: number;
  viewCount: number;
  version: number;
  error?: string;
}

const T = {
  ko: {
    loading: '불러오는 중...',
    notFound: '공유 링크가 만료되었거나 존재하지 않습니다.',
    ipNotice: '이 모델은 IP 보호 모드로 공유되었습니다. 설계 파라미터는 공개되지 않습니다.',
    bbox: '외형 치수',
    volume: '부피',
    surface: '표면적',
    requestRFQ: '이 모델로 견적 요청',
    backToApp: 'NexyFab으로 이동',
    shared: '공유된 3D 모델',
    sharedAt: '공유 일시',
  },
  en: {
    loading: 'Loading...',
    notFound: 'This share link has expired or does not exist.',
    ipNotice: 'This model is shared in IP-protected mode. Design parameters are not disclosed.',
    bbox: 'Bounding Box',
    volume: 'Volume',
    surface: 'Surface Area',
    requestRFQ: 'Request Quote for This Model',
    backToApp: 'Open NexyFab',
    shared: 'Shared 3D Model',
    sharedAt: 'Shared At',
  },
};

export default function ShareViewer({ token, lang }: { token: string; lang: string }) {
  const router = useRouter();
  const t = lang === 'ko' ? T.ko : T.en;
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/nexyfab/share?token=${token}`)
      .then(r => r.json() as Promise<ShareApiResponse>)
      .then(d => {
        if (d.error) { setError(d.error); return; }
        const m = d.metadata ?? {};
        const name = m.name ?? 'Shared Design';
        setData({
          shapeId:          name,
          shapeName:        name,
          bbox:             m.bbox ?? { w: 0, h: 0, d: 0 },
          volume_cm3:       m.volume_cm3 ?? 0,
          surface_area_cm2: m.surface_area_cm2 ?? 0,
          meshVertices:     d.meshDataBase64,
          createdAt:        d.createdAt,
        });
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117', color: '#c9d1d9' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12, animation: 'spin 1s linear infinite' }}>⟳</div>
          <div>{t.loading}</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117', color: '#c9d1d9' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <h2 style={{ color: '#e6edf3', marginBottom: 8 }}>{t.notFound}</h2>
          <Link prefetch href={`/${lang}/shape-generator`} style={{ color: '#58a6ff', textDecoration: 'none', fontSize: 14 }}>
            {t.backToApp} →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#c9d1d9', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#388bfd' }}>Nexy<span style={{ color: '#3fb950' }}>Fab</span></span>
          <span style={{ color: '#484f58', fontSize: 13 }}>/ {t.shared}</span>
        </div>
        <Link prefetch href={`/${lang}/shape-generator`}
          style={{ fontSize: 12, color: '#58a6ff', textDecoration: 'none', padding: '5px 12px', border: '1px solid #388bfd55', borderRadius: 6 }}>
          {t.backToApp} →
        </Link>
      </div>

      {/* Main layout */}
      <div style={{ display: 'flex', height: 'calc(100vh - 53px)' }}>
        {/* 3D Canvas */}
        <div style={{ flex: 1, background: '#161b22' }}>
          <ShareCanvas shapeId={data.shapeId} meshVertices={data.meshVertices} />
        </div>

        {/* Info panel */}
        <div style={{
          width: 280, padding: '20px 16px', borderLeft: '1px solid #30363d',
          display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto',
        }}>
          {/* Shape name */}
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#e6edf3', marginBottom: 4 }}>
              {data.shapeName || data.shapeId}
            </div>
            <div style={{ fontSize: 11, color: '#484f58' }}>
              {t.sharedAt}: {new Date(data.createdAt).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US')}
            </div>
          </div>

          {/* IP notice */}
          <div style={{ background: '#1c2128', border: '1px solid #30363d', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.5 }}>
              🔒 {t.ipNotice}
            </div>
          </div>

          {/* Metrics */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {t.bbox}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              {(['W', 'H', 'D'] as const).map((axis, i) => {
                const val = i === 0 ? data.bbox.w : i === 1 ? data.bbox.h : data.bbox.d;
                return (
                  <div key={axis} style={{ textAlign: 'center', background: '#161b22', borderRadius: 6, padding: '8px 4px' }}>
                    <div style={{ fontSize: 9, color: '#484f58', marginBottom: 2 }}>{axis}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3', fontFamily: 'monospace' }}>{val}</div>
                    <div style={{ fontSize: 9, color: '#484f58' }}>mm</div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #21262d' }}>
                <span style={{ fontSize: 11, color: '#8b949e' }}>{t.volume}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#58a6ff', fontFamily: 'monospace' }}>
                  {data.volume_cm3.toFixed(2)} cm³
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #21262d' }}>
                <span style={{ fontSize: 11, color: '#8b949e' }}>{t.surface}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#8b949e', fontFamily: 'monospace' }}>
                  {data.surface_area_cm2.toFixed(2)} cm²
                </span>
              </div>
            </div>
          </div>

          {/* RFQ button */}
          <button
            onClick={() => {
              const url = `/${lang}/shape-generator?rfq_shape=${data.shapeId}&rfq_vol=${data.volume_cm3.toFixed(2)}&rfq_bbox=${data.bbox.w}x${data.bbox.h}x${data.bbox.d}`;
              router.push(url);
            }}
            style={{
              padding: '12px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
              border: 'none', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            📋 {t.requestRFQ}
          </button>
        </div>
      </div>
    </div>
  );
}
