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
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

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
  // ffe (interior)
  items?: { id: string; name: string; count: number; seats: number; priceEach: number; subtotal: number }[];
  itemTypes?: number; itemCount?: number; seatTotal?: number; floorAreaM2?: number | null;
}

const KIND_TITLE: Record<string, { ko: string; en: string }> = {
  steel_member: { ko: '제조 (강재 부재)', en: 'Manufacture (steel member)' },
  steel_assembly: { ko: '제조 (강재 어셈블리)', en: 'Manufacture (steel assembly)' },
  bent: { ko: '제조 (판금 절곡)', en: 'Manufacture (bent sheet)' },
  concrete: { ko: '제조 (콘크리트 물량)', en: 'Manufacture (concrete BOQ)' },
  timber: { ko: '제조 (목재 부재)', en: 'Manufacture (timber)' },
  ffe: { ko: '산출 (FF&E 가구)', en: 'Deliverable (FF&E)' },
};
interface Estimate {
  applicable: boolean; currency?: string; estimate?: boolean;
  breakdown?: Record<string, number>; subtotal?: number; margin?: number; total?: number;
  disclaimer?: string; note?: string;
}
interface FabResp { ok: boolean; spec?: Spec; estimate?: Estimate; dxf?: string | null; error?: string }

// NOTE: this panel follows the directory's binary ko/en convention (isKorean gate) — every rate
// field must carry both `ko` and `en` labels, or non-ko users (en/ja/cn/es/ar, all routed
// through the `en` fallback here) see raw Korean regardless of the page's own localization.
// `unit` is shown for both languages verbatim (it's already a currency/physical-unit token like
// "₩/kg" or "%" with no Korean word inside) — except the two counter-word units below ("개" =
// piece, "회" = time/occurrence), which get a `unitEn` override so they don't leak Korean either.
type RateField = { key: string; ko: string; en: string; unit: string; unitEn?: string };
const RATE_FIELDS_METAL: RateField[] = [
  { key: 'materialPerKg', ko: '소재', en: 'Material', unit: '₩/kg' },
  { key: 'cutPerM', ko: '절단', en: 'Cut', unit: '₩/m' },
  { key: 'piercePerHole', ko: '피어싱', en: 'Pierce', unit: '₩/개', unitEn: '₩/pierce' },
  { key: 'bendPerOp', ko: '절곡', en: 'Bend', unit: '₩/회', unitEn: '₩/bend' },
  { key: 'setup', ko: '셋업', en: 'Setup', unit: '₩' },
  { key: 'marginPct', ko: '마진', en: 'Margin', unit: '%' },
];
const RATE_FIELDS_CONCRETE: RateField[] = [
  { key: 'concretePerM3', ko: '콘크리트', en: 'Concrete', unit: '₩/m³' },
  { key: 'rebarPerKg', ko: '철근', en: 'Rebar', unit: '₩/kg' },
  { key: 'formworkPerM2', ko: '거푸집', en: 'Formwork', unit: '₩/m²' },
  { key: 'rebarKgPerM3', ko: '철근량', en: 'Rebar ratio', unit: 'kg/m³' },
  { key: 'setup', ko: '셋업', en: 'Setup', unit: '₩' },
  { key: 'marginPct', ko: '마진', en: 'Margin', unit: '%' },
];
const RATE_FIELDS_TIMBER: RateField[] = [
  { key: 'timberPerM3', ko: '목재', en: 'Timber', unit: '₩/m³' },
  { key: 'setup', ko: '셋업', en: 'Setup', unit: '₩' },
  { key: 'marginPct', ko: '마진', en: 'Margin', unit: '%' },
];
const RATE_FIELDS_FFE: RateField[] = [
  { key: 'setup', ko: '설치/셋업', en: 'Install/setup', unit: '₩' },
  { key: 'marginPct', ko: '마진', en: 'Margin', unit: '%' },
];
function rateFieldsFor(kind?: string): RateField[] {
  if (kind === 'concrete') return RATE_FIELDS_CONCRETE;
  if (kind === 'timber') return RATE_FIELDS_TIMBER;
  if (kind === 'ffe') return RATE_FIELDS_FFE;
  return RATE_FIELDS_METAL;
}
const BREAKDOWN_KO: Record<string, string> = {
  material: '소재', cut: '절단', pierce: '피어싱', bend: '절곡', setup: '셋업',
  concrete: '콘크리트', rebar: '철근', formwork: '거푸집', furniture: '가구', install: '설치',
};
const BREAKDOWN_EN: Record<string, string> = {
  material: 'Material', cut: 'Cut', pierce: 'Pierce', bend: 'Bend', setup: 'Setup',
  concrete: 'Concrete', rebar: 'Rebar', formwork: 'Formwork', furniture: 'Furniture', install: 'Install',
};

const won = (n?: number) => (typeof n === 'number' ? '₩' + n.toLocaleString() : '—');

export default function FabPanel({ intent, name, lang }: { intent: unknown; name?: string; lang: string }) {
  const L = createCommercialLocalizer(lang);
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
        {(() => { const t = spec?.kind && KIND_TITLE[spec.kind]; return t ? L(t.ko, t.en) : L('제조 (판재 레이저)', 'Manufacture (sheet laser)'); })()}
      </div>

      {spec && !spec.applicable ? (
        <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)', lineHeight: 1.5 }}>
          {spec.note}
        </div>
      ) : spec ? (
        <>
          {/* 명세(결정론) — kind별 */}
          <div style={{ fontSize: 11.5, marginBottom: 8 }}>
            <div style={{ color: 'var(--nx-text-3, #6b7684)', marginBottom: 3 }}>{L('제조 명세 (정확)', 'Spec (exact)')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
              {spec.kind === 'ffe' ? (
                <>
                  <Row k={L('바닥면적', 'Floor area')} v={`${spec.floorAreaM2 ?? '—'} m²`} />
                  <Row k={L('좌석 수', 'Seats')} v={`${spec.seatTotal}`} />
                  <Row k={L('품목 종류', 'Item types')} v={`${spec.itemTypes}`} />
                  <Row k={L('가구 수', 'Items')} v={`${spec.itemCount}`} />
                </>
              ) : spec.kind === 'steel_assembly' ? (
                <>
                  <Row k={L('부재 수', 'Members')} v={`${spec.memberCount}`} />
                  <Row k={L('총 길이', 'Total len')} v={`${spec.totalLengthMm} mm`} />
                  <Row k={L('총 중량', 'Weight')} v={`${spec.weightKg} kg`} />
                  <Row k={L('절단', 'Cuts')} v={`${spec.cuts}`} />
                </>
              ) : spec.kind === 'steel_member' ? (
                <>
                  <Row k={L('부재 길이', 'Length')} v={`${spec.lengthMm} mm`} />
                  <Row k={L('단면적', 'Section')} v={`${spec.sectionAreaMm2} mm²`} />
                  <Row k={L('단위 중량', 'Unit wt')} v={`${spec.unitWeightKgM} kg/m`} />
                  <Row k={L('총 중량', 'Weight')} v={`${spec.weightKg} kg`} />
                  <Row k={L('절단', 'Cuts')} v={`${spec.cuts}`} />
                </>
              ) : spec.kind === 'concrete' ? (
                <>
                  <Row k={L('콘크리트량', 'Volume')} v={`${spec.volumeM3} m³`} />
                  <Row k={L('거푸집', 'Formwork')} v={`${spec.formworkM2} m²`} />
                  <Row k={spec.rebarBasis === 'design' ? (L('철근(배근)', 'Rebar (design)')) : L('철근(추정)', 'Rebar (est)')} v={`${spec.rebarKg} kg`} />
                  <Row k={L('콘크리트 중량', 'Conc. weight')} v={`${spec.concreteWeightKg} kg`} />
                </>
              ) : spec.kind === 'timber' ? (
                <>
                  <Row k={L('목재량', 'Volume')} v={`${spec.volumeM3} m³`} />
                  <Row k={L('중량', 'Weight')} v={`${spec.weightKg} kg`} />
                </>
              ) : (
                <>
                  <Row k={L('절단 길이', 'Cut length')} v={`${spec.cutLengthM} m`} />
                  <Row k={L('피어싱', 'Pierces')} v={`${spec.pierces}`} />
                  <Row k={L('중량', 'Weight')} v={`${spec.weightKg} kg`} />
                  <Row k={L('절곡', 'Bends')} v={`${spec.bends}`} />
                  <Row k={L('두께', 'Thickness')} v={`${spec.thicknessMm} mm`} />
                  {spec.kind === 'bent' && spec.flat
                    ? <Row k={L('전개 길이', 'Flat length')} v={`${spec.flat.lengthMm} mm`} />
                    : <Row k={L('순면적', 'Net area')} v={`${spec.netAreaMm2} mm²`} />}
                </>
              )}
            </div>
            {/* 부재 스케줄(BOM) */}
            {spec.kind === 'steel_assembly' && spec.members && (
              <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
                <div style={{ fontSize: 10, color: 'var(--nx-text-3, #6b7684)', marginBottom: 2 }}>{L('부재 스케줄', 'Member schedule')}</div>
                {spec.members.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                    <span>{m.id} · {m.kind} · L{m.lengthMm}</span>
                    <span style={{ fontWeight: 600 }}>{m.weightKg} kg</span>
                  </div>
                ))}
              </div>
            )}
            {/* FF&E 스케줄 */}
            {spec.kind === 'ffe' && spec.items && (
              <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
                <div style={{ fontSize: 10, color: 'var(--nx-text-3, #6b7684)', marginBottom: 2 }}>{L('가구 스케줄 (FF&E)', 'FF&E schedule')}</div>
                {spec.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
                    <span>{it.name} × {it.count}{it.seats > 0 ? (L(` · ${it.seats}석`, ` · ${it.seats} seats`)) : ''}</span>
                    <span style={{ fontWeight: 600 }}>{won(it.subtotal)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 단가표(편집) */}
          <div style={{ fontSize: 11, marginBottom: 6 }}>
            <div style={{ color: 'var(--nx-text-3, #6b7684)', marginBottom: 3 }}>{L('단가표 (편집 가능)', 'Rate card (editable)')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
              {rateFieldsFor(spec.kind).map((f) => (
                <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>{L(f.ko, f.en)} ({L(f.unit, f.unitEn ?? f.unit)})</span>
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
              <span style={{ color: 'var(--nx-text-3, #6b7684)', whiteSpace: 'nowrap' }}>{L('설계 철근 As (mm²)', 'Design As (mm²)')}</span>
              <input
                type="number" inputMode="decimal" value={rebarAs}
                placeholder={L('미입력=부피율 추정', 'blank = est by volume')}
                onChange={(e) => setRebarAs(e.target.value)}
                style={{ flex: 1, padding: '4px 6px', borderRadius: 5, fontSize: 11, border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit', boxSizing: 'border-box' }}
              />
              {spec.rebarBasis === 'design' && <span style={{ fontSize: 9, color: '#067647' }}>{L('배근 기반', 'design')}</span>}
            </label>
          )}

          {/* 예상 비용 */}
          {est && est.applicable && (
            <div style={{ padding: 8, borderRadius: 6, background: 'var(--nx-accent-soft, #eef4ff)', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700 }}>{L('예상 비용', 'Estimated cost')}
                  <span style={{ marginLeft: 4, fontSize: 9, color: '#a15c00' }}>{L('· 참고', '· est.')}</span>
                </span>
                <span style={{ fontSize: 15, fontWeight: 800 }}>{won(est.total)}{busy ? '…' : ''}</span>
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)', marginTop: 3 }}>
                {Object.entries(est.breakdown ?? {}).map(([k, v]) => {
                  const field = [...RATE_FIELDS_METAL, ...RATE_FIELDS_CONCRETE, ...RATE_FIELDS_TIMBER, ...RATE_FIELDS_FFE].find((item) => item.key === k);
                  const breakdownEn = BREAKDOWN_EN[k];
                  const label = field
                    ? L(field.ko, field.en)
                    : breakdownEn
                      ? L(BREAKDOWN_KO[k], breakdownEn)
                      : k;
                  return `${label} ${won(v)}`;
                }).join(' · ')}
                {` · ${L('마진', 'margin')} ${won(est.margin)}`}
              </div>
              <div style={{ fontSize: 9, color: '#a15c00', marginTop: 3, fontStyle: 'italic' }}>{est.disclaimer}</div>
            </div>
          )}

          {/* 산출물 */}
          <div style={{ display: 'flex', gap: 8 }}>
            {res?.dxf && (
              <button type="button" onClick={downloadDxf} style={btn}>
                {L('절단 DXF', 'Cut DXF')}
              </button>
            )}
            <Link href={`/${lang}/nexyfab/rfq`} style={{ ...btn, textAlign: 'center', textDecoration: 'none', background: 'var(--nx-accent, #2563eb)', color: '#fff', border: 'none', flex: 1 }}>
              {L('실제 견적 요청 →', 'Real quote →')}
            </Link>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)' }}>{L('계산 중…', 'Computing…')}</div>
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
