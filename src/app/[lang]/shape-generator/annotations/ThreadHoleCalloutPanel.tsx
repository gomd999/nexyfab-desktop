'use client';

import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  type ThreadCallout, type HoleCallout, type ThreadStandard, type ThreadType,
  type HoleType, METRIC_COARSE_PITCHES, formatThreadCallout, formatHoleCallout,
} from './GDTTypes';

// ─── i18n ─────────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '나사산 / 홀 콜아웃',
    threadTab: '나사산',
    holeTab: '홀',
    addThreadCallout: '나사산 콜아웃 추가',
    addHoleCallout: '홀 콜아웃 추가',
    standard: '규격',
    internalFemale: '내나사 (암)',
    externalMale: '외나사 (수)',
    nominalDia: '호칭경',
    nominal: '호칭경',
    pitch: '피치',
    threadDepthOpt: '나사 깊이 (선택)',
    fit: '끼워맞춤',
    add: '추가',
    diameterMm: '직경 (mm)',
    depthMm: '깊이 (mm)',
    cbDiameter: 'CB 직경',
    cbDepth: 'CB 깊이',
    csDiameter: 'CS 직경',
    csAngle: 'CS 각도 (°)',
    includeThread: '나사산 포함',
    threadSize: '나사경',
    pitchMm: '피치 (mm)',
    holeThru: '관통',
    holeBlind: '막힘',
    holeCounterbore: '카운터보어',
    holeCountersink: '카운터싱크',
    holeSpotface: '스팟페이스',
  },
  en: {
    title: 'Thread & Hole Callout',
    threadTab: 'Thread',
    holeTab: 'Hole',
    addThreadCallout: 'Add Thread Callout',
    addHoleCallout: 'Add Hole Callout',
    standard: 'Standard',
    internalFemale: 'Internal (F)',
    externalMale: 'External (M)',
    nominalDia: 'Nominal Dia.',
    nominal: 'Nominal',
    pitch: 'Pitch',
    threadDepthOpt: 'Thread Depth (opt.)',
    fit: 'Fit',
    add: 'Add',
    diameterMm: 'Diameter (mm)',
    depthMm: 'Depth (mm)',
    cbDiameter: 'CB Diameter',
    cbDepth: 'CB Depth',
    csDiameter: 'CS Diameter',
    csAngle: 'CS Angle (°)',
    includeThread: 'Include thread',
    threadSize: 'Thread size',
    pitchMm: 'Pitch (mm)',
    holeThru: 'Thru',
    holeBlind: 'Blind',
    holeCounterbore: 'Counterbore',
    holeCountersink: 'Countersink',
    holeSpotface: 'Spotface',
  },
  ja: {
    title: 'ねじ / 穴コールアウト',
    threadTab: 'ねじ',
    holeTab: '穴',
    addThreadCallout: 'ねじコールアウト追加',
    addHoleCallout: '穴コールアウト追加',
    standard: '規格',
    internalFemale: 'めねじ (内)',
    externalMale: 'おねじ (外)',
    nominalDia: '呼び径',
    nominal: '呼び径',
    pitch: 'ピッチ',
    threadDepthOpt: 'ねじ深さ (任意)',
    fit: '嵌合',
    add: '追加',
    diameterMm: '直径 (mm)',
    depthMm: '深さ (mm)',
    cbDiameter: 'CB 直径',
    cbDepth: 'CB 深さ',
    csDiameter: 'CS 直径',
    csAngle: 'CS 角度 (°)',
    includeThread: 'ねじを含む',
    threadSize: 'ねじサイズ',
    pitchMm: 'ピッチ (mm)',
    holeThru: '貫通',
    holeBlind: '止まり',
    holeCounterbore: 'カウンターボア',
    holeCountersink: 'カウンターシンク',
    holeSpotface: 'スポットフェース',
  },
  zh: {
    title: '螺纹 / 孔标注',
    threadTab: '螺纹',
    holeTab: '孔',
    addThreadCallout: '添加螺纹标注',
    addHoleCallout: '添加孔标注',
    standard: '规格',
    internalFemale: '内螺纹 (阴)',
    externalMale: '外螺纹 (阳)',
    nominalDia: '公称直径',
    nominal: '公称直径',
    pitch: '螺距',
    threadDepthOpt: '螺纹深度 (可选)',
    fit: '配合',
    add: '添加',
    diameterMm: '直径 (mm)',
    depthMm: '深度 (mm)',
    cbDiameter: '沉头孔直径',
    cbDepth: '沉头孔深度',
    csDiameter: '锥孔直径',
    csAngle: '锥孔角度 (°)',
    includeThread: '包含螺纹',
    threadSize: '螺纹尺寸',
    pitchMm: '螺距 (mm)',
    holeThru: '通孔',
    holeBlind: '盲孔',
    holeCounterbore: '沉头孔',
    holeCountersink: '锥孔',
    holeSpotface: '平底孔',
  },
  es: {
    title: 'Anotación de Rosca y Agujero',
    threadTab: 'Rosca',
    holeTab: 'Agujero',
    addThreadCallout: 'Añadir Anotación de Rosca',
    addHoleCallout: 'Añadir Anotación de Agujero',
    standard: 'Norma',
    internalFemale: 'Interna (H)',
    externalMale: 'Externa (M)',
    nominalDia: 'Diámetro Nominal',
    nominal: 'Nominal',
    pitch: 'Paso',
    threadDepthOpt: 'Profundidad de Rosca (opc.)',
    fit: 'Ajuste',
    add: 'Añadir',
    diameterMm: 'Diámetro (mm)',
    depthMm: 'Profundidad (mm)',
    cbDiameter: 'Diámetro CB',
    cbDepth: 'Profundidad CB',
    csDiameter: 'Diámetro CS',
    csAngle: 'Ángulo CS (°)',
    includeThread: 'Incluir rosca',
    threadSize: 'Tamaño de rosca',
    pitchMm: 'Paso (mm)',
    holeThru: 'Pasante',
    holeBlind: 'Ciego',
    holeCounterbore: 'Contrataladro',
    holeCountersink: 'Avellanado',
    holeSpotface: 'Refrentado',
  },
  ar: {
    title: 'تعليق الخيط / الفتحة',
    threadTab: 'خيط',
    holeTab: 'فتحة',
    addThreadCallout: 'إضافة تعليق خيط',
    addHoleCallout: 'إضافة تعليق فتحة',
    standard: 'معيار',
    internalFemale: 'داخلي (أنثى)',
    externalMale: 'خارجي (ذكر)',
    nominalDia: 'القطر الاسمي',
    nominal: 'الاسمي',
    pitch: 'الخطوة',
    threadDepthOpt: 'عمق الخيط (اختياري)',
    fit: 'الملاءمة',
    add: 'إضافة',
    diameterMm: 'القطر (مم)',
    depthMm: 'العمق (مم)',
    cbDiameter: 'قطر CB',
    cbDepth: 'عمق CB',
    csDiameter: 'قطر CS',
    csAngle: 'زاوية CS (°)',
    includeThread: 'تضمين الخيط',
    threadSize: 'حجم الخيط',
    pitchMm: 'الخطوة (مم)',
    holeThru: 'نافذ',
    holeBlind: 'أعمى',
    holeCounterbore: 'تجويف',
    holeCountersink: 'تشطيب مخروطي',
    holeSpotface: 'مسطح',
  },
};

type Lang = keyof typeof dict;
const langMap: Record<string, Lang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

const HOLE_TYPE_LABEL_KEYS: Record<HoleType, keyof typeof dict.en> = {
  thru: 'holeThru',
  blind: 'holeBlind',
  counterbore: 'holeCounterbore',
  countersink: 'holeCountersink',
  spotface: 'holeSpotface',
};

// ─── Thread Creator ───────────────────────────────────────────────────────────

interface ThreadCreatorProps {
  onAdd: (t: Omit<ThreadCallout, 'id' | 'position'>) => void;
  tt: typeof dict[Lang];
}

const METRIC_SIZES = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24, 30, 36, 42, 48];

function ThreadCreator({ onAdd, tt }: ThreadCreatorProps) {
  const [standard, setStandard] = useState<ThreadStandard>('metric');
  const [type, setType] = useState<ThreadType>('internal');
  const [diameter, setDiameter] = useState(8);
  const [pitch, setPitch] = useState(METRIC_COARSE_PITCHES[8]);
  const [depth, setDepth] = useState<number | undefined>(undefined);
  const [fit, setFit] = useState<string>('6H');

  const handleDiameterChange = (d: number) => {
    setDiameter(d);
    if (standard === 'metric') setPitch(METRIC_COARSE_PITCHES[d] ?? 1.0);
  };

  const preview = formatThreadCallout({ standard, type, nominalDiameter: diameter, pitch, depth, fit: fit as any });

  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid #21262d' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        {tt.addThreadCallout}
      </div>

      {/* Standard */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 10, color: '#8b949e', display: 'block', marginBottom: 3 }}>{tt.standard}</label>
        <select
          value={standard}
          onChange={e => setStandard(e.target.value as ThreadStandard)}
          style={selectStyle}
        >
          <option value="metric">ISO Metric (M)</option>
          <option value="inch_unc">UNC (inch)</option>
          <option value="inch_unf">UNF (inch)</option>
          <option value="bsp">BSP (G)</option>
          <option value="npt">NPT</option>
        </select>
      </div>

      {/* Type */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {(['internal', 'external'] as ThreadType[]).map(tv => (
          <button key={tv} onClick={() => setType(tv)} style={{
            flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${type === tv ? '#388bfd' : '#30363d'}`,
            background: type === tv ? '#388bfd22' : 'transparent',
            color: type === tv ? '#388bfd' : '#8b949e',
          }}>
            {tv === 'internal' ? tt.internalFemale : tt.externalMale}
          </button>
        ))}
      </div>

      {/* Diameter */}
      {standard === 'metric' ? (
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 10, color: '#8b949e', display: 'block', marginBottom: 3 }}>{tt.nominalDia}</label>
          <select value={diameter} onChange={e => handleDiameterChange(Number(e.target.value))} style={selectStyle}>
            {METRIC_SIZES.map(s => <option key={s} value={s}>M{s}</option>)}
          </select>
        </div>
      ) : (
        <InputRow label={tt.nominal} value={diameter} onChange={setDiameter} min={0.1} step={0.1} />
      )}

      <InputRow label={tt.pitch} value={pitch} onChange={setPitch} min={0.1} step={0.05}
        note={standard === 'metric' ? 'mm' : 'TPI'} />
      <InputRow label={tt.threadDepthOpt} value={depth ?? 0}
        onChange={v => setDepth(v > 0 ? v : undefined)} min={0} step={1} />

      {/* Fit */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 10, color: '#8b949e', display: 'block', marginBottom: 3 }}>{tt.fit}</label>
        <select value={fit} onChange={e => setFit(e.target.value)} style={selectStyle}>
          {['6H', '7H', '5H', '6g', '5g6g', '4h', '6e', '6f'].map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Preview */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 5, padding: '6px 10px', marginBottom: 10, fontFamily: 'monospace', fontSize: 12, color: '#c9d1d9' }}>
        {preview}
      </div>

      <button
        onClick={() => onAdd({ standard, type, nominalDiameter: diameter, pitch, depth, fit: fit as any, label: preview })}
        style={{ width: '100%', padding: '7px 0', borderRadius: 6, border: 'none', background: '#388bfd', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
      >
        {tt.add}
      </button>
    </div>
  );
}

// ─── Hole Creator ─────────────────────────────────────────────────────────────

interface HoleCreatorProps {
  onAdd: (h: Omit<HoleCallout, 'id' | 'position'>) => void;
  tt: typeof dict[Lang];
}

function HoleCreator({ onAdd, tt }: HoleCreatorProps) {
  const [holeType, setHoleType] = useState<HoleType>('thru');
  const [diameter, setDiameter] = useState(10);
  const [depth, setDepth] = useState(20);
  const [cbDia, setCbDia] = useState(16);
  const [cbDepth, setCbDepth] = useState(8);
  const [csDia, setCsDia] = useState(18);
  const [csAngle, setCsAngle] = useState(90);
  const [addThread, setAddThread] = useState(false);
  const [threadDia, setThreadDia] = useState(8);
  const [threadPitch, setThreadPitch] = useState(METRIC_COARSE_PITCHES[8]);

  const buildHole = (): Omit<HoleCallout, 'id' | 'position'> => ({
    holeType,
    diameter,
    depth: holeType !== 'thru' ? depth : undefined,
    cbDiameter: (holeType === 'counterbore' || holeType === 'spotface') ? cbDia : undefined,
    cbDepth: (holeType === 'counterbore' || holeType === 'spotface') ? cbDepth : undefined,
    csDiameter: holeType === 'countersink' ? csDia : undefined,
    csAngle: holeType === 'countersink' ? csAngle : undefined,
    thread: addThread ? { standard: 'metric', type: 'internal', nominalDiameter: threadDia, pitch: threadPitch } : undefined,
  });

  const preview = formatHoleCallout({ ...buildHole(), id: '', position: [0, 0, 0] });

  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        {tt.addHoleCallout}
      </div>

      {/* Hole type tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {(['thru', 'blind', 'counterbore', 'countersink', 'spotface'] as HoleType[]).map(htv => (
          <button key={htv} onClick={() => setHoleType(htv)} style={{
            padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${holeType === htv ? '#388bfd' : '#30363d'}`,
            background: holeType === htv ? '#388bfd22' : 'transparent',
            color: holeType === htv ? '#388bfd' : '#8b949e',
          }}>
            {tt[HOLE_TYPE_LABEL_KEYS[htv]]}
          </button>
        ))}
      </div>

      <InputRow label={tt.diameterMm} value={diameter} onChange={setDiameter} min={0.5} step={0.5} />
      {holeType !== 'thru' && <InputRow label={tt.depthMm} value={depth} onChange={setDepth} min={1} step={1} />}
      {(holeType === 'counterbore' || holeType === 'spotface') && <>
        <InputRow label={tt.cbDiameter} value={cbDia} onChange={setCbDia} min={diameter} step={0.5} />
        <InputRow label={tt.cbDepth} value={cbDepth} onChange={setCbDepth} min={0.5} step={0.5} />
      </>}
      {holeType === 'countersink' && <>
        <InputRow label={tt.csDiameter} value={csDia} onChange={setCsDia} min={diameter} step={0.5} />
        <InputRow label={tt.csAngle} value={csAngle} onChange={setCsAngle} min={60} max={120} step={1} />
      </>}

      {/* Optional thread */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#8b949e', cursor: 'pointer', marginBottom: addThread ? 8 : 12 }}>
        <input type="checkbox" checked={addThread} onChange={e => setAddThread(e.target.checked)} style={{ accentColor: '#388bfd' }} />
        {tt.includeThread}
      </label>
      {addThread && (
        <div style={{ paddingLeft: 12, borderLeft: '2px solid #388bfd33', marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 10, color: '#8b949e', display: 'block', marginBottom: 3 }}>{tt.threadSize}</label>
            <select value={threadDia} onChange={e => { const d = Number(e.target.value); setThreadDia(d); setThreadPitch(METRIC_COARSE_PITCHES[d] ?? 1.0); }} style={selectStyle}>
              {[2,3,4,5,6,8,10,12,16,20,24].map(s => <option key={s} value={s}>M{s}</option>)}
            </select>
          </div>
          <InputRow label={tt.pitchMm} value={threadPitch} onChange={setThreadPitch} min={0.1} step={0.05} />
        </div>
      )}

      {/* Preview */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 5, padding: '6px 10px', marginBottom: 10, fontFamily: 'monospace', fontSize: 11, color: '#c9d1d9', lineHeight: 1.6 }}>
        {preview}
      </div>

      <button
        onClick={() => onAdd({ ...buildHole(), label: preview })}
        style={{ width: '100%', padding: '7px 0', borderRadius: 6, border: 'none', background: '#388bfd', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
      >
        {tt.add}
      </button>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export interface ThreadHoleCalloutPanelProps {
  threadCallouts?: ThreadCallout[];
  holeCallouts?: HoleCallout[];
  onAddThread?: (t: Omit<ThreadCallout, 'id' | 'position'>) => void;
  onAddHole?: (h: Omit<HoleCallout, 'id' | 'position'>) => void;
  onDeleteThread?: (id: string) => void;
  onDeleteHole?: (id: string) => void;
  lang?: string;
}

export default function ThreadHoleCalloutPanel({
  threadCallouts = [], holeCallouts = [],
  onAddThread, onAddHole, onDeleteThread, onDeleteHole, lang,
}: ThreadHoleCalloutPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const t = dict[langMap[seg] ?? langMap[lang ?? 'en'] ?? 'en'];
  const [tab, setTab] = useState<'thread' | 'hole'>('thread');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1117', color: '#c9d1d9', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 14 }}>🔩</span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{t.title}</span>
      </div>

      {/* Tab */}
      <div style={{ display: 'flex', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
        {(['thread', 'hole'] as const).map(tv => (
          <button key={tv} onClick={() => setTab(tv)} style={{
            flex: 1, padding: '7px 0', fontSize: 11, fontWeight: tab === tv ? 700 : 400, cursor: 'pointer',
            border: 'none', borderBottom: tab === tv ? '2px solid #388bfd' : '2px solid transparent',
            background: 'transparent', color: tab === tv ? '#388bfd' : '#6e7681',
          }}>
            {tv === 'thread' ? t.threadTab : t.holeTab}
            <span style={{ marginLeft: 4, fontSize: 9, background: '#388bfd33', color: '#388bfd', borderRadius: 8, padding: '0 4px' }}>
              {tv === 'thread' ? threadCallouts.length : holeCallouts.length}
            </span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'thread' ? (
          <>
            {onAddThread && <ThreadCreator onAdd={onAddThread} tt={t} />}
            {/* Existing callouts */}
            {threadCallouts.length > 0 && (
              <div style={{ borderTop: '1px solid #21262d' }}>
                {threadCallouts.map(tc => (
                  <div key={tc.id} style={{ padding: '8px 14px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#c9d1d9', flex: 1 }}>
                      {tc.label ?? formatThreadCallout(tc)}
                    </span>
                    {onDeleteThread && (
                      <button onClick={() => onDeleteThread(tc.id)} style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 12, padding: 0 }}>×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {onAddHole && <HoleCreator onAdd={onAddHole} tt={t} />}
            {holeCallouts.length > 0 && (
              <div style={{ borderTop: '1px solid #21262d' }}>
                {holeCallouts.map(h => (
                  <div key={h.id} style={{ padding: '8px 14px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#c9d1d9', flex: 1 }}>
                      {h.label ?? formatHoleCallout(h)}
                    </span>
                    {onDeleteHole && (
                      <button onClick={() => onDeleteHole(h.id)} style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 12, padding: 0 }}>×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '4px 8px', background: '#161b22',
  border: '1px solid #30363d', borderRadius: 5, color: '#c9d1d9',
  fontSize: 11, outline: 'none',
};

function InputRow({ label, value, onChange, min, max, step, note }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; note?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 10, color: '#8b949e', flex: 1 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={e => onChange(Number(e.target.value))}
          style={{ width: 64, padding: '3px 6px', background: '#161b22', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 11, outline: 'none' }}
        />
        {note && <span style={{ fontSize: 9, color: '#6e7681' }}>{note}</span>}
      </div>
    </div>
  );
}
