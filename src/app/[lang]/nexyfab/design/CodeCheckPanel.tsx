'use client';

/**
 * CodeCheckPanel — 코드체크 / 감리 보조(결정론) UI.
 *
 * 차별화: 학습모델 감리가 아니라 실제 공개 법령 조항을 인용하는 결정론 규칙. 사용자가 측정한
 * 설계 피처(주차면 폭·경사·경사로·계단·난간·복도·출입구·화장실)를 입력하면 POST
 * /api/nexyfab/codecheck 가 룰별 PASS/FAIL/NA + 인용 조항 + 실측 vs 요구를 반환한다.
 *
 * 도면에서 불러오기(260723): DWG/DXF 를 올리면 기존 dwg-convert / dxf-seed 경로가 도면의
 * 측정값(치수·원·범위)을 뽑고, featuresFromDrawing 이 이를 후보 픽리스트로 제시한다. 도면은
 * 의미 라벨을 스스로 갖지 않으므로 자동배정은 "치수 텍스트가 카테고리+역할을 확정하고 단위가
 * 선언된" 명백한 경우로 한정하고(편집 가능), 나머지는 사람이 슬롯에 배정한다 — 맹목 자동배정으로
 * 인한 거짓 PASS/FAIL 을 막는다.
 *
 * 정직성: 피처 미입력 = NA(준수로 가정하지 않음). 위반(FAIL)을 먼저 나열하고 각 지적에 인용
 * 조항을 붙인다. 비법정 감리 보조 disclaimer를 항상 노출한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';
import {
  suggestFeaturesFromIr2d,
  suggestFeaturesFromSeed,
  type DrawingFeatureSuggestion,
  type DrawingFeatureCandidate,
} from '@/lib/eng-domain/codecheck/featuresFromDrawing';
import type { CodeCheckFeatures } from '@/lib/eng-domain/codecheck/rules';

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
  {
    titleKo: '주차단위구획 / 진입로 (주차장법)',
    fields: [
      {
        key: 'parkingStallType',
        labelKo: '직각주차 구획 유형',
        kind: 'select',
        options: [
          { value: 'general', labelKo: '일반형(2.5×5.0)' },
          { value: 'expanded', labelKo: '확장형(2.6×5.2)' },
          { value: 'compact', labelKo: '경형(2.0×3.6)' },
        ],
      },
      { key: 'parkingStallWidth_m', labelKo: '주차구획 폭', unit: 'm', kind: 'number' },
      { key: 'parkingStallLength_m', labelKo: '주차구획 길이', unit: 'm', kind: 'number' },
      { key: 'parkingRampLaneWidth_m', labelKo: '진입로 차로 너비', unit: 'm', kind: 'number' },
      { key: 'parkingRampLaneCurved', labelKo: '진입로 곡선형', kind: 'bool' },
      { key: 'parkingRampTwoWay', labelKo: '진입로 2차로', kind: 'bool' },
    ],
  },
  {
    titleKo: '피난·방화 (피난방화규칙 / 건축법 시행령)',
    fields: [
      { key: 'stairLandingRiseInterval_m', labelKo: '계단참 사이 수직높이', unit: 'm', kind: 'number' },
      { key: 'stairLandingWidth_m', labelKo: '계단참 유효너비', unit: 'm', kind: 'number' },
      { key: 'outdoorEscapeStairWidth_m', labelKo: '옥외피난계단 유효너비', unit: 'm', kind: 'number' },
      { key: 'travelDistanceToStair_m', labelKo: '직통계단 보행거리', unit: 'm', kind: 'number' },
      { key: 'mainStructureFireResistant', labelKo: '주요구조부 내화/불연', kind: 'bool' },
      { key: 'fireCompartmentArea_m2', labelKo: '방화구획 면적', unit: '㎡', kind: 'number' },
      { key: 'fireCompartmentFloorAbove11', labelKo: '11층 이상 층', kind: 'bool' },
      { key: 'fireCompartmentSprinklered', labelKo: '스프링클러 설치', kind: 'bool' },
      { key: 'hydrantHorizontalDistance_m', labelKo: '옥내소화전 수평거리', unit: 'm', kind: 'number' },
    ],
  },
  {
    titleKo: '건축 (반자·채광·환기·건폐율·용적률)',
    fields: [
      { key: 'ceilingHeight_m', labelKo: '거실 반자높이', unit: 'm', kind: 'number' },
      { key: 'roomFloorArea_m2', labelKo: '거실 바닥면적', unit: '㎡', kind: 'number' },
      { key: 'daylightWindowArea_m2', labelKo: '채광 창면적', unit: '㎡', kind: 'number' },
      { key: 'ventilationWindowArea_m2', labelKo: '환기 창면적', unit: '㎡', kind: 'number' },
      { key: 'buildingArea_m2', labelKo: '건축면적', unit: '㎡', kind: 'number' },
      { key: 'siteArea_m2', labelKo: '대지면적', unit: '㎡', kind: 'number' },
      { key: 'coverageRatioLimit_pct', labelKo: '건폐율 한도', unit: '%', kind: 'number' },
      { key: 'totalFloorArea_m2', labelKo: '연면적', unit: '㎡', kind: 'number' },
      { key: 'floorAreaRatioLimit_pct', labelKo: '용적률 한도', unit: '%', kind: 'number' },
    ],
  },
  {
    titleKo: '접근로 / 경사로 / 승강기 (장애인편의 별표1)',
    fields: [
      { key: 'approachPathWidth_m', labelKo: '접근로 유효폭', unit: 'm', kind: 'number' },
      { key: 'approachPathSlope', labelKo: '접근로 종단기울기', unit: 'rise/run', kind: 'number' },
      { key: 'rampLandingRiseInterval_m', labelKo: '경사로 참 사이 수직높이', unit: 'm', kind: 'number' },
      { key: 'handrailHeight_m', labelKo: '손잡이 높이', unit: 'm', kind: 'number' },
      { key: 'elevatorInternalWidth_m', labelKo: '승강기 내부 유효폭', unit: 'm', kind: 'number' },
      { key: 'elevatorInternalDepth_m', labelKo: '승강기 내부 유효깊이', unit: 'm', kind: 'number' },
      { key: 'elevatorDoorWidth_m', labelKo: '승강기 출입문 통과폭', unit: 'm', kind: 'number' },
    ],
  },
  {
    titleKo: '실내건축: 다중이용업소 비상구 (별표2)',
    fields: [
      { key: 'emergencyExitWidth_m', labelKo: '비상구 가로(폭)', unit: 'm', kind: 'number' },
      { key: 'emergencyExitHeight_m', labelKo: '비상구 세로(높이)', unit: 'm', kind: 'number' },
      { key: 'emergencyExitCount', labelKo: '비상구 개수', unit: '개', kind: 'number' },
    ],
  },
];

// Metre-length numeric slots a drawing measurement can be assigned to (reuse existing labels).
const METRE_FIELDS: Array<{ key: string; labelKo: string }> = GROUPS.flatMap((g) => g.fields)
  .filter((f) => f.kind === 'number' && f.unit === 'm')
  .map((f) => ({ key: f.key, labelKo: f.labelKo }));
const FIELD_LABEL: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.fields).map((f) => [f.key, f.labelKo]),
);

const STATUS_COLOR: Record<Status, string> = { pass: '#12b76a', fail: '#f04438', na: '#9aa4b0' };
const STATUS_LABEL_KO: Record<Status, string> = { pass: '적합', fail: '위반', na: '해당없음' };
const STATUS_LABEL_EN: Record<Status, string> = { pass: 'PASS', fail: 'FAIL', na: 'NA' };
const SOURCE_LABEL_KO: Record<DrawingFeatureCandidate['source'], string> = { extent: '범위', dimension: '치수', circle: '원' };

export default function CodeCheckPanel({ lang }: { lang: string }) {
  const ko = isKorean(lang);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // ── 도면에서 불러오기 상태 ──────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<DrawingFeatureSuggestion | null>(null);
  // per-candidate slot assignment (index → feature key or '' = 무시). Seeded from guessedKey.
  const [assign, setAssign] = useState<Record<number, string>>({});
  // when a drawing declares NO units, the user picks one to convert candidates (honest opt-in, no guess).
  const [unitOverride, setUnitOverride] = useState<'' | 'mm' | 'in'>('');

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

  // convert a candidate to metres, honouring a user unit-override when the drawing declared none.
  const candMeters = useCallback((c: DrawingFeatureCandidate): number | null => {
    if (c.meters !== null) return c.meters;
    if (unitOverride === 'mm') return Math.round((c.value / 1000) * 10000) / 10000;
    if (unitOverride === 'in') return Math.round(((c.value * 25.4) / 1000) * 10000) / 10000;
    return null;
  }, [unitOverride]);

  const onPickDrawing = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setSuggestion(null); setAssign({}); setUnitOverride(''); setImportErr(null);

    const apply = (s: DrawingFeatureSuggestion) => {
      setSuggestion(s);
      // pre-seed slot assignment from each candidate's guessedKey (user confirms / edits)
      const seed: Record<number, string> = {};
      s.candidates.forEach((c, i) => { if (c.guessedKey && !c.autoFilled) seed[i] = String(c.guessedKey); });
      setAssign(seed);
    };

    if (/\.dwg$/i.test(f.name)) {
      if (f.size > 60_000_000) { setImportErr(ko ? 'DWG 60MB 초과' : 'DWG over 60MB'); return; }
      void (async () => {
        setImportBusy(true);
        try {
          const buf = new Uint8Array(await f.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          const r = await fetch('/api/nexyfab/drawing/dwg-convert/', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dwgBase64: btoa(bin) }),
          });
          const j = (await r.json()) as { ok?: boolean; ir2d?: Parameters<typeof suggestFeaturesFromIr2d>[0]; error?: string };
          if (!j.ok || !j.ir2d) { setImportErr(j.error ?? (ko ? 'DWG에서 측정값을 찾지 못했어요.' : 'No measurements found in DWG.')); return; }
          apply(suggestFeaturesFromIr2d(j.ir2d));
        } catch (err2) {
          setImportErr(err2 instanceof Error ? err2.message : String(err2));
        } finally { setImportBusy(false); }
      })();
      return;
    }
    if (/\.dxf$/i.test(f.name)) {
      const tr = new FileReader();
      tr.onload = () => {
        void (async () => {
          setImportBusy(true);
          try {
            const r = await fetch('/api/nexyfab/drawing/dxf-seed/', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dxfText: String(tr.result ?? '') }),
            });
            const j = (await r.json()) as { ok?: boolean; seed?: Parameters<typeof suggestFeaturesFromSeed>[0]; error?: string };
            if (!j.ok || !j.seed) { setImportErr(j.error ?? (ko ? 'DXF에서 측정값을 찾지 못했어요.' : 'No measurements found in DXF.')); return; }
            apply(suggestFeaturesFromSeed(j.seed));
          } catch (err2) {
            setImportErr(err2 instanceof Error ? err2.message : String(err2));
          } finally { setImportBusy(false); }
        })();
      };
      tr.readAsText(f);
      return;
    }
    setImportErr(ko ? 'DWG 또는 DXF 파일만 지원합니다.' : 'DWG or DXF files only.');
  }, [ko]);

  // apply auto-filled slots + user-assigned candidates into the measured-feature form
  const applyImported = useCallback(() => {
    if (!suggestion) return;
    setValues((prev) => {
      const next = { ...prev };
      // 1) auto-filled (unambiguous + unit-safe) metre values
      for (const [k, v] of Object.entries(suggestion.autoFilled)) {
        if (typeof v === 'number' && Number.isFinite(v)) next[k] = String(v);
      }
      // 2) user-assigned candidates (only when a metre value is resolvable — never a unit guess)
      suggestion.candidates.forEach((c, i) => {
        const key = assign[i];
        if (!key) return;
        const m = candMeters(c);
        if (m !== null) next[key] = String(m);
      });
      return next;
    });
  }, [suggestion, assign, candMeters]);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setReport(null);
    const features: Record<string, number | string | boolean> = {};
    for (const [k, v] of Object.entries(values)) {
      if (typeof v === 'boolean') { features[k] = v; continue; }
      if (typeof v === 'string' && v.trim() !== '') {
        // enum keys stay string; numeric keys parse
        if (k === 'stairCategory' || k === 'corridorCategory' || k === 'parkingStallType') features[k] = v;
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

  const autoFilledKeys = useMemo(
    () => (suggestion ? (Object.keys(suggestion.autoFilled) as Array<keyof CodeCheckFeatures>) : []),
    [suggestion],
  );

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

      {/* ── 도면에서 불러오기 (후보 제안 — 사람이 슬롯 배정 확인) ─────────────── */}
      <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, border: '1px dashed var(--nx-accent, #2563eb)', background: 'var(--nx-panel-2, #f6f9ff)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept=".dxf,.dwg" onChange={onPickDrawing} style={{ display: 'none' }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importBusy} style={importBtnStyle}>
            {importBusy ? (ko ? '도면 읽는 중…' : 'Reading…') : ko ? '도면에서 불러오기 (DWG/DXF)' : 'Load from drawing (DWG/DXF)'}
          </button>
          <span style={{ fontSize: 10, color: '#a15c00', fontWeight: 700 }}>
            {ko ? '도면 추출은 후보 제안 — 사람이 슬롯 배정 확인' : 'extraction suggests candidates — you confirm slot assignment'}
          </span>
        </div>
        {importErr && <div style={{ marginTop: 6, fontSize: 11, color: '#b42318' }}>{importErr}</div>}

        {suggestion && (
          <div style={{ marginTop: 10 }}>
            {/* units + notes */}
            <div style={{ fontSize: 10.5, color: 'var(--nx-text-2, #46505e)', marginBottom: 6 }}>
              <span style={{ fontWeight: 700 }}>
                {ko ? '도면 단위' : 'Drawing units'}: {suggestion.units ?? (ko ? '미선언' : 'undeclared')}
              </span>
              {suggestion.units === null && (
                <span style={{ marginLeft: 8 }}>
                  {ko ? '환산 단위 선택(추측 아님): ' : 'pick unit to convert (not a guess): '}
                  <select value={unitOverride} onChange={(ev) => setUnitOverride(ev.target.value as '' | 'mm' | 'in')} style={miniSel}>
                    <option value="">{ko ? '선택 안 함' : 'none'}</option>
                    <option value="mm">mm</option>
                    <option value="in">in</option>
                  </select>
                </span>
              )}
            </div>
            {suggestion.notes.map((n, i) => (
              <div key={i} style={{ fontSize: 10, color: '#a15c00', lineHeight: 1.5, marginBottom: 3 }}>⚠ {n}</div>
            ))}

            {/* auto-filled (unambiguous + unit-safe) */}
            {autoFilledKeys.length > 0 && (
              <div style={{ marginTop: 6, marginBottom: 6 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#067647', marginBottom: 3 }}>
                  {ko ? '자동배정(명백·편집 가능)' : 'Auto-filled (unambiguous, editable)'}
                </div>
                {autoFilledKeys.map((k) => (
                  <div key={String(k)} style={{ fontSize: 10.5, color: 'var(--nx-text-2, #46505e)' }}>
                    <span style={{ display: 'inline-block', fontSize: 8.5, fontWeight: 700, padding: '0 3px', borderRadius: 3, marginRight: 4, background: '#dcfae6', color: '#067647' }}>자동</span>
                    {FIELD_LABEL[String(k)] ?? String(k)} = {String(suggestion.autoFilled[k])} m
                  </div>
                ))}
              </div>
            )}

            {/* candidate pick-list — user maps each measured value to a slot (or 무시) */}
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--nx-text-2, #46505e)', margin: '6px 0 4px' }}>
              {ko ? '측정값 후보 — 슬롯 배정' : 'Measured-value candidates — assign a slot'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
              {suggestion.candidates.map((c, i) => {
                const m = candMeters(c);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5 }}>
                    <span style={{ minWidth: 30, fontSize: 9, fontWeight: 700, color: 'var(--nx-text-3, #6b7684)' }}>{SOURCE_LABEL_KO[c.source]}</span>
                    <span style={{ minWidth: 96 }}>
                      {c.value}{c.unit ? c.unit : ''}
                      {m !== null ? <span style={{ color: '#067647' }}> = {m}m</span> : <span style={{ color: '#a15c00' }}> ({ko ? 'm환산 불가' : 'no m'})</span>}
                      {c.label ? <span style={{ color: 'var(--nx-text-3, #6b7684)' }}> · {c.label}</span> : null}
                    </span>
                    <select
                      value={c.autoFilled ? '' : (assign[i] ?? '')}
                      disabled={c.autoFilled}
                      onChange={(ev) => setAssign((p) => ({ ...p, [i]: ev.target.value }))}
                      style={{ ...miniSel, flex: 1 }}
                    >
                      <option value="">{c.autoFilled ? (ko ? '자동배정됨' : 'auto-filled') : (ko ? '— 무시 —' : '— ignore —')}</option>
                      {METRE_FIELDS.map((mf) => <option key={mf.key} value={mf.key}>{mf.labelKo}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>

            <button type="button" onClick={applyImported} style={{ ...importBtnStyle, marginTop: 8, width: '100%' }}>
              {ko ? '선택한 값을 입력폼에 적용' : 'Apply selected values to the form'}
            </button>
          </div>
        )}
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
const importBtnStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid var(--nx-accent, #2563eb)',
  background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
};
const miniSel: React.CSSProperties = {
  padding: '3px 5px', borderRadius: 5, fontSize: 10.5, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'inherit', boxSizing: 'border-box',
};
