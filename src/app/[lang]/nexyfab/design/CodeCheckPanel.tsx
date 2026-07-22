'use client';

/**
 * CodeCheckPanel — 코드체크 / 감리 보조(결정론) UI.
 *
 * 차별화: 학습모델 감리가 아니라 실제 공개 법령 조항을 인용하는 결정론 규칙. 사용자가 측정한
 * 설계 피처(주차면 폭·경사·경사로·계단·난간·복도·출입구·화장실)를 입력하면 POST
 * /api/nexyfab/codecheck 가 룰별 PASS/FAIL/NA + 인용 조항 + 실측 vs 요구를 반환한다.
 *
 * 정직성: 피처 미입력 = NA(준수로 가정하지 않음). 위반(FAIL)을 먼저 나열하고 각 지적에 인용
 * 조항을 붙인다. 비법정 감리 보조 disclaimer를 항상 노출한다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

type Status = 'pass' | 'fail' | 'na';
interface RuleResult {
  id: string;
  category: string;
  clause: string;
  source: string;
  status: Status;
  actual?: number;
  required: string;
  message: string;
}
interface Report {
  ok: boolean;
  results?: RuleResult[];
  passCount?: number;
  failCount?: number;
  naCount?: number;
  violations?: RuleResult[];
  disclaimer?: string;
  error?: string;
}

type FieldKind = 'number' | 'select' | 'bool';
interface Field {
  key: string;
  labelKo: string;
  unit?: string;
  kind: FieldKind;
  options?: Array<{ value: string; labelKo: string }>;
}
interface Group {
  titleKo: string;
  fields: Field[];
}

// Measured-feature form spec — mirrors CodeCheckFeatures (semantic slots the user assigns).
const GROUPS: Group[] = [
  {
    titleKo: '장애인전용 주차구역',
    fields: [
      { key: 'parkingDisabledStallWidth_m', labelKo: '주차면 폭', unit: 'm', kind: 'number' },
      { key: 'parkingDisabledStallLength_m', labelKo: '주차면 길이', unit: 'm', kind: 'number' },
      { key: 'parkingDisabledStallSlope', labelKo: '바닥 기울기', unit: 'rise/run', kind: 'number' },
    ],
  },
  {
    titleKo: '경사로 / 주차 램프',
    fields: [
      { key: 'rampEffectiveWidth_m', labelKo: '경사로 유효폭', unit: 'm', kind: 'number' },
      { key: 'rampSlope', labelKo: '경사로 종단경사', unit: 'rise/run', kind: 'number' },
      { key: 'rampSideSlope', labelKo: '경사로 측면경사', unit: 'rise/run', kind: 'number' },
      { key: 'parkingRampSlopeStraight', labelKo: '주차램프(직선) 경사', unit: 'rise/run', kind: 'number' },
      { key: 'parkingRampSlopeCurved', labelKo: '주차램프(곡선) 경사', unit: 'rise/run', kind: 'number' },
    ],
  },
  {
    titleKo: '계단',
    fields: [
      {
        key: 'stairCategory',
        labelKo: '계단 용도',
        kind: 'select',
        options: [
          { value: 'other', labelKo: '그 밖의 계단' },
          { value: 'elementary', labelKo: '초등학교' },
          { value: 'secondary', labelKo: '중·고등학교' },
          { value: 'assembly', labelKo: '문화·집회·판매 등' },
        ],
      },
      { key: 'stairEffectiveWidth_m', labelKo: '계단 유효너비', unit: 'm', kind: 'number' },
      { key: 'stairRiser_m', labelKo: '단높이', unit: 'm', kind: 'number' },
      { key: 'stairTread_m', labelKo: '단너비', unit: 'm', kind: 'number' },
    ],
  },
  {
    titleKo: '난간 / 복도 / 출입구 / 화장실',
    fields: [
      { key: 'railingHeight_m', labelKo: '난간 높이', unit: 'm', kind: 'number' },
      {
        key: 'corridorCategory',
        labelKo: '복도 용도',
        kind: 'select',
        options: [
          { value: 'general', labelKo: '일반(면적조건)' },
          { value: 'school', labelKo: '학교' },
          { value: 'residential', labelKo: '공동주택·오피스텔' },
        ],
      },
      { key: 'corridorBothSidesRooms', labelKo: '양옆 거실 복도', kind: 'bool' },
      { key: 'corridorWidth_m', labelKo: '복도 유효너비', unit: 'm', kind: 'number' },
      { key: 'doorEffectiveWidth_m', labelKo: '출입구 통과유효폭', unit: 'm', kind: 'number' },
      { key: 'disabledToiletActivityWidth_m', labelKo: '장애인화장실 활동폭', unit: 'm', kind: 'number' },
      { key: 'disabledToiletActivityDepth_m', labelKo: '장애인화장실 활동깊이', unit: 'm', kind: 'number' },
      { key: 'curbBoundaryHeight_m', labelKo: '접근로 경계 높이', unit: 'm', kind: 'number' },
    ],
  },
];

const STATUS_COLOR: Record<Status, string> = { pass: '#12b76a', fail: '#f04438', na: '#9aa4b0' };
const STATUS_LABEL_KO: Record<Status, string> = { pass: '적합', fail: '위반', na: '해당없음' };
const STATUS_LABEL_EN: Record<Status, string> = { pass: 'PASS', fail: 'FAIL', na: 'NA' };

export default function CodeCheckPanel({ lang }: { lang: string }) {
  const ko = isKorean(lang);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // warm the catalog once (traceability preview; also proves the endpoint is up)
  useEffect(() => {
    let alive = true;
    fetch('/api/nexyfab/codecheck')
      .then((r) => r.json())
      .then((d: { ok: boolean }) => { if (alive && d?.ok) setOpen(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const setField = useCallback((key: string, v: string | boolean) => {
    setValues((p) => ({ ...p, [key]: v }));
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setReport(null);
    const features: Record<string, number | string | boolean> = {};
    for (const [k, v] of Object.entries(values)) {
      if (typeof v === 'boolean') { features[k] = v; continue; }
      if (typeof v === 'string' && v.trim() !== '') {
        // enum keys stay string; numeric keys parse
        if (k === 'stairCategory' || k === 'corridorCategory') features[k] = v;
        else {
          const n = Number(v);
          if (Number.isFinite(n)) features[k] = n;
        }
      }
    }
    try {
      const res = await fetch('/api/nexyfab/codecheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features }),
      });
      const data = (await res.json()) as Report;
      if (!data.ok) setErr(data.error ?? 'error');
      else setReport(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [values]);

  // order results: violations first, then pass, then na
  const ordered = useMemo(() => {
    if (!report?.results) return [];
    const rank: Record<Status, number> = { fail: 0, pass: 1, na: 2 };
    return [...report.results].sort((a, b) => rank[a.status] - rank[b.status]);
  }, [report]);

  return (
    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--nx-border, #dfe3e8)', paddingTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
        {ko ? '코드체크 / 감리 (결정론)' : 'Code-check / design-review (deterministic)'}
        <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
          {ko ? '실제 법령 조항 인용 — 학습모델 감리가 아님' : 'cites real 법령 clauses — not a learned model'}
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', marginBottom: 10, lineHeight: 1.5 }}>
        {ko
          ? '측정한 설계 피처를 입력하면 룰별 적합/위반/해당없음 + 인용 조항 + 실측 vs 요구를 반환합니다. 미입력 항목은 준수로 가정하지 않고 해당없음(NA)으로 둡니다.'
          : 'Enter measured design features. Each rule returns PASS/FAIL/NA with the cited clause and actual-vs-required. Absent inputs are NA (never assumed compliant).'}
      </div>

      {open && GROUPS.map((g) => (
        <div key={g.titleKo} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nx-text-2, #46505e)', marginBottom: 4 }}>{g.titleKo}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {g.fields.map((fld) => (
              <label key={fld.key} style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{fld.labelKo}{fld.unit ? ` (${fld.unit})` : ''}</span>
                {fld.kind === 'number' && (
                  <input
                    type="number" inputMode="decimal"
                    value={(values[fld.key] as string) ?? ''}
                    onChange={(e) => setField(fld.key, e.target.value)}
                    style={inpStyle}
                  />
                )}
                {fld.kind === 'select' && (
                  <select value={(values[fld.key] as string) ?? fld.options?.[0].value ?? ''} onChange={(e) => setField(fld.key, e.target.value)} style={inpStyle}>
                    {fld.options?.map((o) => <option key={o.value} value={o.value}>{o.labelKo}</option>)}
                  </select>
                )}
                {fld.kind === 'bool' && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28 }}>
                    <input type="checkbox" checked={Boolean(values[fld.key])} onChange={(e) => setField(fld.key, e.target.checked)} />
                    <span style={{ color: 'var(--nx-text-3, #6b7684)', fontSize: 10.5 }}>{ko ? '예/아니오' : 'yes/no'}</span>
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
      ))}

      <button type="button" onClick={run} disabled={loading} style={runStyle}>
        {loading ? (ko ? '검사 중…' : 'Checking…') : ko ? '코드체크 실행' : 'Run code-check'}
      </button>

      {err && <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#fdecec', color: '#b42318', fontSize: 11.5 }}>{err}</div>}

      {report && report.ok && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 11.5, fontWeight: 700 }}>
            <span style={{ color: '#f04438' }}>{ko ? '위반' : 'FAIL'} {report.failCount ?? 0}</span>
            <span style={{ color: '#12b76a' }}>{ko ? '적합' : 'PASS'} {report.passCount ?? 0}</span>
            <span style={{ color: '#9aa4b0' }}>{ko ? '해당없음' : 'NA'} {report.naCount ?? 0}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ordered.map((r) => (
              <div key={r.id} style={{ padding: 8, borderRadius: 6, border: '1px solid var(--nx-border, #dfe3e8)', background: r.status === 'fail' ? '#fef3f2' : 'var(--nx-panel, #fff)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 800, color: '#fff', background: STATUS_COLOR[r.status] }}>
                    {ko ? STATUS_LABEL_KO[r.status] : STATUS_LABEL_EN[r.status]}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{r.category}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)' }}>{r.required}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--nx-text-2, #46505e)', lineHeight: 1.5 }}>{r.message}</div>
                <div style={{ fontSize: 10, color: 'var(--nx-text-3, #6b7684)', marginTop: 2 }}>
                  <span style={{ display: 'inline-block', fontSize: 8.5, fontWeight: 700, padding: '0 3px', borderRadius: 3, marginRight: 4, background: '#dcfae6', color: '#067647' }}>법령</span>
                  {r.clause} · {r.source}
                </div>
              </div>
            ))}
          </div>

          {report.disclaimer && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)', fontSize: 10.5, color: '#a15c00', fontWeight: 600, lineHeight: 1.5 }}>
              ⚠ {report.disclaimer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inpStyle: React.CSSProperties = {
  padding: '5px 7px', borderRadius: 6, fontSize: 12, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
};
const runStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--nx-accent, #2563eb)',
  background: 'transparent', color: 'var(--nx-accent, #2563eb)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
};
