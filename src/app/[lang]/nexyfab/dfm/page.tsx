'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';
import { useAuthStore } from '@/hooks/useAuth';
import type { DfmCheckItem } from '@/lib/dfm-rules';

type DfmAction = 'proceed_to_match' | 'request_expert' | 'revise';

interface PageProps {
  params: Promise<{ lang: string }>;
}

interface ParamField {
  key:    string;
  labelKo: string;
  labelEn: string;
  unit:   string;
  step:   number;
  hint?:  string;
}

const FIELDS: ParamField[] = [
  { key: 'wallThickness', labelKo: '벽 두께',     labelEn: 'Wall thickness',  unit: 'mm', step: 0.1 },
  { key: 'holeDiameter',  labelKo: '홀 직경',     labelEn: 'Hole diameter',   unit: 'mm', step: 0.1 },
  { key: 'draftAngle',    labelKo: '구배각',      labelEn: 'Draft angle',     unit: '°',  step: 0.5 },
  { key: 'radius',        labelKo: '모서리 반경', labelEn: 'Corner radius',   unit: 'mm', step: 0.1 },
  { key: 'height',        labelKo: '높이',        labelEn: 'Height',          unit: 'mm', step: 1 },
  { key: 'width',         labelKo: '폭',          labelEn: 'Width',           unit: 'mm', step: 1 },
  { key: 'pitch',         labelKo: '나사 피치',   labelEn: 'Thread pitch',    unit: 'mm', step: 0.05 },
];

interface DfmResponse {
  id?:      string;
  issues:   number;
  warnings: number;
  items:    DfmCheckItem[];
}

const LEVEL_COLORS: Record<DfmCheckItem['level'], { bg: string; fg: string; label: string }> = {
  error:   { bg: '#fee2e2', fg: '#991b1b', label: '오류' },
  warning: { bg: '#fef3c7', fg: '#92400e', label: '경고' },
  info:    { bg: '#dbeafe', fg: '#1e40af', label: '정보' },
};

export default function DfmCheckPage({ params }: PageProps) {
  const { lang } = use(params);
  const isKo = isKorean(lang);
  const router = useRouter();
  const { token } = useAuthStore();

  const [values, setValues] = useState<Record<string, string>>({});
  const [fileId, setFileId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DfmResponse | null>(null);
  const [actionPending, setActionPending] = useState<DfmAction | null>(null);
  const [actionDone, setActionDone] = useState<DfmAction | null>(null);

  async function chooseAction(action: DfmAction) {
    if (!result?.id || !token) return;
    setActionPending(action);
    try {
      const res = await fetch(`/api/nexyfab/dfm-check/${result.id}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setError(`Action failed: HTTP ${res.status}`);
        return;
      }
      setActionDone(action);
      if (action === 'proceed_to_match') {
        router.push(`/${lang}/nexyfab/rfq?dfmCheckId=${result.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionPending(null);
    }
  }

  function setVal(key: string, raw: string) {
    setValues(prev => ({ ...prev, [key]: raw }));
  }

  async function runCheck() {
    setLoading(true);
    setError('');
    setResult(null);
    setActionDone(null);
    try {
      const numericParams: Record<string, number> = {};
      for (const [k, v] of Object.entries(values)) {
        const n = Number(v);
        if (Number.isFinite(n) && v.trim() !== '') numericParams[k] = n;
      }
      if (Object.keys(numericParams).length === 0) {
        setError(isKo ? '최소 1개 이상의 파라미터를 입력하세요.' : 'Enter at least one parameter.');
        return;
      }

      const res = await fetch('/api/nexyfab/dfm-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          params: numericParams,
          ...(fileId.trim() ? { fileId: fileId.trim() } : {}),
        }),
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setResult(await res.json() as DfmResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '32px 20px', color: '#0f172a' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        {isKo ? '제조 적합성 자동 검증 (DFM)' : 'DFM Auto-Check'}
      </h1>
      <p style={{ fontSize: 14, color: '#475569', marginBottom: 24 }}>
        {isKo
          ? '도면 파라미터를 입력하면 가공 시 발생할 수 있는 문제를 즉시 감지합니다. 경고는 제조 가능하나 위험, 오류는 수정 권장입니다.'
          : 'Enter your design parameters — we surface manufacturability issues instantly. Warnings = risky but possible, Errors = revise recommended.'}
      </p>

      <section style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {FIELDS.map(f => (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: '#334155' }}>
                {isKo ? f.labelKo : f.labelEn} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({f.unit})</span>
              </span>
              <input
                type="number"
                step={f.step}
                value={values[f.key] ?? ''}
                onChange={e => setVal(f.key, e.target.value)}
                placeholder="—"
                style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 }}
              />
            </label>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: '#334155' }}>
              {isKo ? 'CAD 파일 ID (선택)' : 'CAD File ID (optional)'}
            </span>
            <input
              type="text"
              value={fileId}
              onChange={e => setFileId(e.target.value)}
              placeholder={isKo ? '파일 함에서 복사한 ID' : 'ID copied from your files'}
              style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 }}
            />
          </label>
        </div>

        <button
          onClick={runCheck}
          disabled={loading}
          style={{
            marginTop: 16, padding: '10px 20px', background: loading ? '#94a3b8' : '#2563eb',
            color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? (isKo ? '검증 중…' : 'Checking…') : (isKo ? 'DFM 검증 실행' : 'Run DFM Check')}
        </button>
        {error && (
          <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{error}</div>
        )}
      </section>

      {result && (
        <section>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 14 }}>
            <Stat label={isKo ? '오류' : 'Errors'}   value={result.issues}   color="#dc2626" />
            <Stat label={isKo ? '경고' : 'Warnings'} value={result.warnings} color="#d97706" />
            {result.id && (
              <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12 }}>
                {isKo ? '저장됨: ' : 'Saved as '}<code>{result.id}</code>
              </span>
            )}
          </div>

          {result.items.length === 0 ? (
            <div style={{ padding: 20, background: '#dcfce7', color: '#166534', borderRadius: 10, fontSize: 14 }}>
              {isKo ? '✓ 감지된 이슈 없음 — 제조 적합성 양호합니다.' : '✓ No issues found — design looks manufacturable.'}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {result.items.map((it, i) => {
                const c = LEVEL_COLORS[it.level];
                return (
                  <li key={i} style={{
                    background: c.bg, color: c.fg, padding: '12px 14px',
                    borderRadius: 10, fontSize: 14, display: 'flex', gap: 12, alignItems: 'baseline',
                  }}>
                    <strong style={{ minWidth: 48 }}>{c.label}</strong>
                    <span style={{ flex: 1 }}>{it.message}</span>
                    <code style={{ fontSize: 12, opacity: 0.7 }}>{it.param}</code>
                  </li>
                );
              })}
            </ul>
          )}

          {result.id && token && (
            <ActionPanel
              isKo={isKo}
              issues={result.issues}
              warnings={result.warnings}
              pending={actionPending}
              done={actionDone}
              onChoose={chooseAction}
            />
          )}
          {result.id && !token && (
            <div style={{ marginTop: 16, padding: 12, background: '#f1f5f9', color: '#475569', borderRadius: 10, fontSize: 13 }}>
              {isKo
                ? '로그인하면 검증 결과를 저장하고 매칭/전문가 요청으로 바로 이어갈 수 있습니다.'
                : 'Sign in to save this check and continue to matching or an expert review.'}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

interface ActionPanelProps {
  isKo:     boolean;
  issues:   number;
  warnings: number;
  pending:  DfmAction | null;
  done:     DfmAction | null;
  onChoose: (a: DfmAction) => void;
}

function ActionPanel({ isKo, issues, warnings, pending, done, onChoose }: ActionPanelProps) {
  // 결과 등급에 따라 버튼 구성을 분기.
  // PASS: 매칭이 primary, 다른 옵션은 노출 안 함 (의사결정 단순화).
  // WARN: 매칭/수정 둘 다 합리적, 매칭이 primary.
  // FAIL: 전문가 요청이 primary, 사용자가 직접 수정도 허용.
  const grade: 'pass' | 'warn' | 'fail' =
    issues > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass';

  const choices: Array<{ action: DfmAction; primary: boolean; label: string }> = [];
  if (grade === 'pass') {
    choices.push({
      action: 'proceed_to_match', primary: true,
      label: isKo ? '매칭 의뢰 →' : 'Proceed to Matching →',
    });
  } else if (grade === 'warn') {
    choices.push({
      action: 'proceed_to_match', primary: true,
      label: isKo ? '그대로 매칭 의뢰 →' : 'Match as-is →',
    });
    choices.push({
      action: 'revise', primary: false,
      label: isKo ? '수정 후 재검증' : 'Revise & re-check',
    });
  } else {
    choices.push({
      action: 'request_expert', primary: true,
      label: isKo ? '전문가에게 수정 요청' : 'Request expert review',
    });
    choices.push({
      action: 'revise', primary: false,
      label: isKo ? '직접 수정 후 재검증' : 'Revise myself',
    });
  }

  if (done && done !== 'proceed_to_match') {
    return (
      <div style={{ marginTop: 16, padding: 14, background: '#ecfdf5', color: '#065f46', borderRadius: 10, fontSize: 14 }}>
        {done === 'request_expert'
          ? (isKo ? '✓ 전담자가 24시간 내 연락드립니다.' : '✓ Our expert team will contact you within 24h.')
          : (isKo ? '✓ 의사가 기록되었습니다. 도면 수정 후 다시 검증해 주세요.' : '✓ Noted. Revise your design and re-run the check.')}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {choices.map(c => (
        <button
          key={c.action}
          onClick={() => onChoose(c.action)}
          disabled={pending !== null}
          style={{
            padding: '10px 18px',
            background: c.primary
              ? (pending === c.action ? '#94a3b8' : '#2563eb')
              : '#fff',
            color: c.primary ? '#fff' : '#334155',
            border: c.primary ? 'none' : '1px solid #cbd5e1',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: c.primary ? 700 : 500,
            cursor: pending !== null ? 'wait' : 'pointer',
          }}
        >
          {pending === c.action ? (isKo ? '처리 중…' : 'Working…') : c.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}
