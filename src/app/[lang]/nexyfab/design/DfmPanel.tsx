'use client';

/**
 * 제조성(DFM) 상시 패널 — 기계·판금 완벽화 Pillar ②.
 *
 * 설계 형상(intent)이 바뀔 때마다 POST /dfm로 판금·절삭 제조 규칙(최소 홀·홀-엣지·간격·두께·
 * 얇은 벽)을 검사해 상시 경고를 띄운다. 프로세스(레이저/펀칭) 토글로 임계가 달라진다.
 * 형상 파라미터 직독이라 정확하며, "비법정 참고(샵 관행값)"를 명시한다.
 */

import { useEffect, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

interface Check { rule: string; severity: 'pass' | 'warn' | 'fail'; title: string; message: string; ref: string }
interface DfmResult { ok: boolean; checks?: Check[]; summary?: string; worst?: string; recognized?: boolean; thickness?: number; process?: string; error?: string }

const dot = { pass: '#12b76a', warn: '#f79009', fail: '#f04438' } as const;

export default function DfmPanel({ intent, lang }: { intent: unknown; lang: string }) {
  const ko = isKorean(lang);
  const [proc, setProc] = useState<'laser' | 'punch'>('laser');
  const [res, setRes] = useState<DfmResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!intent) return;
    let alive = true;
    setBusy(true);
    fetch('/api/nexyfab/drawing/dfm/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent, process: proc }),
    })
      .then((r) => r.json())
      .then((d: DfmResult) => { if (alive) setRes(d); })
      .catch(() => { if (alive) setRes(null); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [intent, proc]);

  if (!intent) return null;

  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>
          {ko ? '제조성 (DFM · 상시)' : 'Manufacturability (DFM · always-on)'}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['laser', 'punch'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProc(p)}
              style={{
                padding: '3px 8px', borderRadius: 5, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                border: '1px solid var(--nx-border, #dfe3e8)',
                background: proc === p ? 'var(--nx-accent, #2563eb)' : 'transparent',
                color: proc === p ? '#fff' : 'var(--nx-text-2, #46505e)',
              }}
            >
              {p === 'laser' ? (ko ? '레이저' : 'Laser') : ko ? '펀칭' : 'Punch'}
            </button>
          ))}
        </div>
      </div>

      {busy && !res ? (
        <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)' }}>{ko ? '검사 중…' : 'Checking…'}</div>
      ) : res && res.ok ? (
        !res.recognized ? (
          <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)' }}>
            {ko ? '치수를 인식하지 못해 DFM 생략(자유형상). 파라메트릭 프리셋에서 정확 검사.' : 'Dimensions not recognized — DFM skipped (freeform).'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {(res.checks ?? []).map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, fontSize: 11.5, lineHeight: 1.4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 8px', marginTop: 4, background: dot[c.severity] }} />
                <span>
                  <b style={{ color: c.severity === 'fail' ? '#b42318' : c.severity === 'warn' ? '#a15c00' : 'var(--nx-text, #1a2230)' }}>{c.title}</b>
                  {c.severity !== 'pass' && <> — {c.message}</>}
                </span>
              </div>
            ))}
            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>
              {(res.checks?.[0]?.ref) ?? (ko ? '비법정 참고' : 'Reference only')}
            </div>
          </div>
        )
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)' }}>{res?.error ?? '—'}</div>
      )}
    </div>
  );
}
