'use client';

/**
 * 제조(판재 레이저) 패널 — 완벽화 Pillar ⑤.
 *
 * 정직 분리: 명세(절단길이·피어싱·중량 = 정확) + 예상비용(편집 단가 × 명세 = 추정, "예상" 라벨)
 * + DXF 내보내기(평판 절단용) + 실제 견적 요청(RFQ 연결). intent 바뀔 때 재계산.
 * 판재 대상 아닌 형상(각관·용기)은 정직하게 "대상 아님 → RFQ" 안내.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { isKorean } from '@/lib/i18n/normalize';

interface Spec {
  applicable: boolean; kind?: string; note?: string; thicknessMm?: number; cutLengthMm?: number; cutLengthM?: number;
  pierces?: number; footprintMm2?: number; netAreaMm2?: number; weightKg?: number; bends?: number;
  // steel_member
  lengthMm?: number; sectionAreaMm2?: number; unitWeightKgM?: number; cuts?: number;
  // bent
  flat?: { lengthMm: number; widthMm: number; bendLines?: { angle: number; BA: number; BD: number }[] };
  // concrete / timber
  volumeM3?: number; formworkM2?: number; rebarKg?: number; concreteWeightKg?: number; rebarBasis?: string;
  // steel_assembly
  members?: { id: string; kind: string; lengthMm: number; weightKg: number }[]; memberCount?: number; totalLengthMm?: number;
}

const KIND_TITLE: Record<string, [string, string]> = {
  steel_member: ['제조 (강재 부재)', 'Manufacture (steel member)'],
  steel_assembly: ['제조 (강재 어셈블리)', 'Manufacture (steel assembly)'],
  bent: ['제조 (판금 절곡)', 'Manufacture (bent sheet)'],
  concrete: ['제조 (콘크리트 물량)', 'Manufacture (concrete BOQ)'],
  timber: ['제조 (목재 부재)', 'Manufacture (timber)'],
};
interface Estimate {
  applicable: boolean; currency?: string; estimate?: boolean;
  breakdown?: Record<string, number>; subtotal?: number; margin?: number; total?: number;
  disclaimer?: string; note?: string;
}
interface FabResp { ok: boolean; spec?: Spec; estimate?: Estimate; dxf?: string | null; error?: string }

type RateField = { key: string; ko: string; unit: string };
const RATE_FIELDS_METAL: RateField[] = [
  { key: 'materialPerKg', ko: '소재', unit: '₩/kg' },
  { key: 'cutPerM', ko: '절단', unit: '₩/m' },
  { key: 'piercePerHole', ko: '피어싱', unit: '₩/개' },
  { key: 'bendPerOp', ko: '절곡', unit: '₩/회' },
  { key: 'setup', ko: '셋업', unit: '₩' },
  { key: 'marginPct', ko: '마진', unit: '%' },
];
const RATE_FIELDS_CONCRETE: RateField[] = [
  { key: 'concretePerM3', ko: '콘크리트', unit: '₩/m³' },
  { key: 'rebarPerKg', ko: '철근', unit: '₩/kg' },
  { key: 'formworkPerM2', ko: '거푸집', unit: '₩/m²' },
  { key: 'rebarKgPerM3', ko: '철근량', unit: 'kg/m³' },
  { key: 'setup', ko: '셋업', unit: '₩' },
  { key: 'marginPct', ko: '마진', unit: '%' },
];
const RATE_FIELDS_TIMBER: RateField[] = [
  { key: 'timberPerM3', ko: '목재', unit: '₩/m³' },
  { key: 'setup', ko: '셋업', unit: '₩' },
  { key: 'marginPct', ko: '마진', unit: '%' },
];
function rateFieldsFor(kind?: string): RateField[] {
  if (kind === 'concrete') return RATE_FIELDS_CONCRETE;
  if (kind === 'timber') return RATE_FIELDS_TIMBER;
  return RATE_FIELDS_METAL;
}
const BREAKDOWN_KO: Record<string, string> = {
  material: '소재', cut: '절단', pierce: '피어싱', bend: '절곡', setup: '셋업',
  concrete: '콘크리트', rebar: '철근', formwork: '거푸집',
};

const won = (n?: number) => (typeof n === 'number' ? '₩' + n.toLocaleString() : '—');

export default function FabPanel({ intent, name, lang }: { intent: unknown; name?: string; lang: string }) {
  const ko = isKorean(lang);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [res, setRes] = useState<FabResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [rebarAs, setRebarAs] = useState<string>(''); // 설계 As(mm²) — 입력 시 철근 정밀화

  // 기본 단가 로드
  useEffect(() => {
    let alive = true;
    fetch('/api/nexyfab/drawing/fab/').then((r) => r.json()).then((d: { ok: boolean; rates?: Record<string, number> }) => {
      if (alive && d.ok && d.rates) setRates(d.rates);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const compute = useCallback(async (r: Record<string, number>) => {
    if (!intent) return;
    setBusy(true);
    try {
      const As = Number(rebarAs);
      const data = (await fetch('/api/nexyfab/drawing/fab/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, rates: r, rebarAreaMm2: Number.isFinite(As) && As > 0 ? As : undefined }),
      }).then((x) => x.json())) as FabResp;
      setRes(data);
    } catch { /* noop */ } finally { setBusy(false); }
  }, [intent, rebarAs]);

  useEffect(() => { if (rates) compute(rates); }, [rates, compute]);

  const downloadDxf = () => {
    if (!res?.dxf) return;
    const blob = new Blob([res.dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${name ?? 'part'}.dxf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  if (!rates) return null;
  const spec = res?.spec;
  const est = res?.estimate;

  return (
    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--nx-border, #dfe3e8)', paddingTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
        {(() => { const t = spec?.kind && KIND_TITLE[spec.kind]; return t ? (ko ? t[0] : t[1]) : ko ? '제조 (판재 레이저)' : 'Manufacture (sheet laser)'; })()}
      </div>

      {spec && !spec.applicable ? (
        <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)', lineHeight: 1.5 }}>
          {spec.note}
        </div>
      ) : spec ? (
        <>
          {/* 명세(결정론) — kind별 */}
          <div style={{ fontSize: 11.5, marginBottom: 8 }}>
            <div style={{ color: 'var(--nx-text-3, #6b7684)', marginBottom: 3 }}>{ko ? '제조 명세 (정확)' : 'Spec (exact)'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
              {spec.kind === 'steel_assembly' ? (
                <>
                  <Row k={ko ? '부재 수' : 'Members'} v={`${spec.memberCount}`} />
                  <Row k={ko ? '총 길이' : 'Total len'} v={`${spec.totalLengthMm} mm`} />
                  <Row k={ko ? '총 중량' : 'Weight'} v={`${spec.weightKg} kg`} />
                  <Row k={ko ? '절단' : 'Cuts'} v={`${spec.cuts}`} />
                </>
              ) : spec.kind === 'steel_member' ? (
                <>
                  <Row k={ko ? '부재 길이' : 'Length'} v={`${spec.lengthMm} mm`} />
                  <Row k={ko ? '단면적' : 'Section'} v={`${spec.sectionAreaMm2} mm²`} />
                  <Row k={ko ? '단위 중량' : 'Unit wt'} v={`${spec.unitWeightKgM} kg/m`} />
                  <Row k={ko ? '총 중량' : 'Weight'} v={`${spec.weightKg} kg`} />
                  <Row k={ko ? '절단' : 'Cuts'} v={`${spec.cuts}`} />
                </>
              ) : spec.kind === 'concrete' ? (
                <>
                  <Row k={ko ? '콘크리트량' : 'Volume'} v={`${spec.volumeM3} m³`} />
                  <Row k={ko ? '거푸집' : 'Formwork'} v={`${spec.formworkM2} m²`} />
                  <Row k={spec.rebarBasis === 'design' ? (ko ? '철근(배근)' : 'Rebar (design)') : ko ? '철근(추정)' : 'Rebar (est)'} v={`${spec.rebarKg} kg`} />
                  <Row k={ko ? '콘크리트 중량' : 'Conc. weight'} v={`${spec.concreteWeightKg} kg`} />
                </>
              ) : spec.kind === 'timber' ? (
                <>
                  <Row k={ko ? '목재량' : 'Volume'} v={`${spec.volumeM3} m³`} />
                  <Row k={ko ? '중량' : 'Weight'} v={`${spec.weightKg} kg`} />
                </>
              ) : (
                <>
                  <Row k={ko ? '절단 길이' : 'Cut length'} v={`${spec.cutLengthM} m`} />
                  <Row k={ko ? '피어싱' : 'Pierces'} v={`${spec.pierces}`} />
                  <Row k={ko ? '중량' : 'Weight'} v={`${spec.weightKg} kg`} />
                  <Row k={ko ? '절곡' : 'Bends'} v={`${spec.bends}`} />
                  <Row k={ko ? '두께' : 'Thickness'} v={`${spec.thicknessMm} mm`} />
                  {spec.kind === 'bent' && spec.flat
                    ? <Row k={ko ? '전개 길이' : 'Flat length'} v={`${spec.flat.lengthMm} mm`} />
                    : <Row k={ko ? '순면적' : 'Net area'} v={`${spec.netAreaMm2} mm²`} />}
                </>
              )}
            </div>
            {/* 부재 스케줄(BOM) */}
            {spec.kind === 'steel_assembly' && spec.members && (
              <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
                <div style={{ fontSize: 10, color: 'var(--nx-text-3, #6b7684)', marginBottom: 2 }}>{ko ? '부재 스케줄' : 'Member schedule'}</div>
                {spec.members.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                    <span>{m.id} · {m.kind} · L{m.lengthMm}</span>
                    <span style={{ fontWeight: 600 }}>{m.weightKg} kg</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 단가표(편집) */}
          <div style={{ fontSize: 11, marginBottom: 6 }}>
            <div style={{ color: 'var(--nx-text-3, #6b7684)', marginBottom: 3 }}>{ko ? '단가표 (편집 가능)' : 'Rate card (editable)'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
              {rateFieldsFor(spec.kind).map((f) => (
                <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>{f.ko} ({f.unit})</span>
                  <input
                    type="number" value={rates[f.key] ?? ''}
                    onChange={(e) => setRates((r) => ({ ...(r ?? {}), [f.key]: Number(e.target.value) }))}
                    style={{ padding: '3px 5px', borderRadius: 5, fontSize: 11, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box' }}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* 철근 정밀화(#4): 설계 As 입력 시 배근 기반, 없으면 부피율 추정 */}
          {spec.kind === 'concrete' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 6 }}>
              <span style={{ color: 'var(--nx-text-3, #6b7684)', whiteSpace: 'nowrap' }}>{ko ? '설계 철근 As (mm²)' : 'Design As (mm²)'}</span>
              <input
                type="number" inputMode="decimal" value={rebarAs}
                placeholder={ko ? '미입력=부피율 추정' : 'blank = est by volume'}
                onChange={(e) => setRebarAs(e.target.value)}
                style={{ flex: 1, padding: '4px 6px', borderRadius: 5, fontSize: 11, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', boxSizing: 'border-box' }}
              />
              {spec.rebarBasis === 'design' && <span style={{ fontSize: 9, color: '#067647' }}>{ko ? '배근 기반' : 'design'}</span>}
            </label>
          )}

          {/* 예상 비용 */}
          {est && est.applicable && (
            <div style={{ padding: 8, borderRadius: 6, background: 'var(--nx-accent-soft, #eef4ff)', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700 }}>{ko ? '예상 비용' : 'Estimated cost'}
                  <span style={{ marginLeft: 4, fontSize: 9, color: '#a15c00' }}>{ko ? '· 참고' : '· est.'}</span>
                </span>
                <span style={{ fontSize: 15, fontWeight: 800 }}>{won(est.total)}{busy ? '…' : ''}</span>
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)', marginTop: 3 }}>
                {Object.entries(est.breakdown ?? {}).map(([k, v]) => `${ko ? (BREAKDOWN_KO[k] ?? k) : k} ${won(v)}`).join(' · ')}
                {` · ${ko ? '마진' : 'margin'} ${won(est.margin)}`}
              </div>
              <div style={{ fontSize: 9, color: '#a15c00', marginTop: 3, fontStyle: 'italic' }}>{est.disclaimer}</div>
            </div>
          )}

          {/* 산출물 */}
          <div style={{ display: 'flex', gap: 8 }}>
            {res?.dxf && (
              <button type="button" onClick={downloadDxf} style={btn}>
                {ko ? '절단 DXF' : 'Cut DXF'}
              </button>
            )}
            <Link href={`/${lang}/nexyfab/rfq`} style={{ ...btn, textAlign: 'center', textDecoration: 'none', background: 'var(--nx-accent, #2563eb)', color: '#fff', border: 'none', flex: 1 }}>
              {ko ? '실제 견적 요청 →' : 'Real quote →'}
            </Link>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)' }}>{ko ? '계산 중…' : 'Computing…'}</div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
      <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'var(--nx-text, #1a2230)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
};
