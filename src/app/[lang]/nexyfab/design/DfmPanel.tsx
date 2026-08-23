'use client';

/**
 * 제조성(DFM) 상시 패널 — 기계·판금 완벽화 Pillar ②.
 *
 * 설계 형상(intent)이 바뀔 때마다 POST /dfm로 판금·절삭 제조 규칙(최소 홀·홀-엣지·간격·두께·
 * 얇은 벽)을 검사해 상시 경고를 띄운다. 프로세스(레이저/펀칭) 토글로 임계가 달라진다.
 * 형상 파라미터 직독이라 정확하며, "비법정 참고(샵 관행값)"를 명시한다.
 */

import { useEffect, useState } from 'react';
import { designLoc } from './designI18n';

interface Check { rule: string; severity: 'pass' | 'warn' | 'fail'; title: string; message: string; ref: string }
interface DfmResult { ok: boolean; checks?: Check[]; summary?: string; worst?: string; recognized?: boolean; thickness?: number; process?: string; error?: string }

const dot = { pass: '#12b76a', warn: '#f79009', fail: '#f04438' } as const;

export default function DfmPanel({ intent, lang }: { intent: unknown; lang: string }) {
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
          {designLoc(lang, { ko: '제조성 (DFM · 상시)', en: 'Manufacturability (DFM · always-on)', ja: '製造性 (DFM・常時)', zh: '可制造性 (DFM・持续)', es: 'Fabricabilidad (DFM · siempre activo)', ar: 'قابلية التصنيع (DFM · دائمًا)' })}
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
              {p === 'laser' ? designLoc(lang, { ko: '레이저', en: 'Laser', ja: 'レーザー', zh: '激光', es: 'Láser', ar: 'ليزر' }) : designLoc(lang, { ko: '펀칭', en: 'Punch', ja: 'パンチ', zh: '冲压', es: 'Punzonado', ar: 'تثقيب' })}
            </button>
          ))}
        </div>
      </div>

      {busy && !res ? (
        <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)' }}>{designLoc(lang, { ko: '검사 중…', en: 'Checking…', ja: '確認中…', zh: '检查中…', es: 'Comprobando…', ar: 'جارٍ التحقق…' })}</div>
      ) : res && res.ok ? (
        !res.recognized ? (
          <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)' }}>
            {designLoc(lang, { ko: '치수를 인식하지 못해 DFM 생략(자유형상). 파라메트릭 프리셋에서 정확 검사.', en: 'Dimensions not recognized — DFM skipped (freeform).', ja: '寸法を認識できないためDFMを省略（自由形状）。パラメトリックプリセットで正確に確認してください。', zh: '无法识别尺寸，跳过DFM（自由形状）。请在参数预设中精确检查。', es: 'Dimensiones no reconocidas: DFM omitido (forma libre). Compruébalo en los preajustes paramétricos.', ar: 'تعذر التعرف على الأبعاد — تم تخطي DFM (شكل حر). تحقق بدقة من الإعداد المعياري.' })}
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
              {(res.checks?.[0]?.ref) ?? designLoc(lang, { ko: '비법정 참고', en: 'Reference only', ja: '参考情報', zh: '仅供参考', es: 'Solo referencia', ar: 'مرجع فقط' })}
            </div>
          </div>
        )
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)' }}>{res?.error ?? '—'}</div>
      )}
    </div>
  );
}
