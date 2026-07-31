'use client';

/**
 * MechanismPicker.tsx — Quick-insert mechanism presets.
 *
 * Grid of cards (gear / cam / 4-bar / slider-crank). Click → param
 * slider dialog → preview 2D profile → "Insert" creates a sketch
 * feature with the resulting profile.
 */

import React, { useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import { spurGearProfile, camProfile, type SpurGearParams, type CamParams } from './mechanismLibrary';

interface MechanismPickerProps {
  lang: string;
  onClose?: () => void;
  /** Caller renders the resulting 2D profile as a sketch feature. */
  onInsertProfile?: (profile: Array<[number, number]>, name: string) => void;
}

type Kind = 'spur-gear' | 'cam' | 'four-bar' | 'slider-crank';

const COPY = {
  ko: {
    title: '메커니즘',
    pick: '선택',
    spurGear: '스퍼 기어',
    cam: '캠',
    fourBar: '4절 링크',
    sliderCrank: '슬라이더 크랭크',
    module: '모듈',
    teeth: '잇수',
    angle: '압력각 (°)',
    baseR: '베이스 반경',
    lift: '리프트',
    camType: '캠 타입',
    insert: '삽입',
    cancel: '취소',
  },
  en: {
    title: 'Mechanisms',
    pick: 'Pick',
    spurGear: 'Spur Gear',
    cam: 'Cam',
    fourBar: '4-bar linkage',
    sliderCrank: 'Slider-crank',
    module: 'Module',
    teeth: 'Teeth',
    angle: 'Pressure ° ',
    baseR: 'Base R',
    lift: 'Lift',
    camType: 'Cam type',
    insert: 'Insert',
    cancel: 'Cancel',
  },
  ja: {
    title: 'メカニズム',
    pick: '選択',
    spurGear: '平歯車',
    cam: 'カム',
    fourBar: '4節リンク',
    sliderCrank: 'スライダクランク',
    module: 'モジュール',
    teeth: '歯数',
    angle: '圧力角 (°)',
    baseR: '基礎円半径',
    lift: 'リフト',
    camType: 'カム形式',
    insert: '挿入',
    cancel: 'キャンセル',
  },
  zh: {
    title: '机构',
    pick: '选择',
    spurGear: '直齿轮',
    cam: '凸轮',
    fourBar: '四杆机构',
    sliderCrank: '曲柄滑块',
    module: '模数',
    teeth: '齿数',
    angle: '压力角 (°)',
    baseR: '基圆半径',
    lift: '升程',
    camType: '凸轮类型',
    insert: '插入',
    cancel: '取消',
  },
  es: {
    title: 'Mecanismo',
    pick: 'Seleccionar',
    spurGear: 'Engranaje recto',
    cam: 'Leva',
    fourBar: 'Cuadrilátero articulado',
    sliderCrank: 'Biela-manivela',
    module: 'Módulo',
    teeth: 'Número de dientes',
    angle: 'Ángulo de presión (°)',
    baseR: 'Radio base',
    lift: 'Elevación',
    camType: 'Tipo de leva',
    insert: 'Insertar',
    cancel: 'Cancelar',
  },
  ar: {
    title: 'الآلية',
    pick: 'اختيار',
    spurGear: 'ترس مستقيم',
    cam: 'كامة',
    fourBar: 'رباعي الوصلات',
    sliderCrank: 'مرفق ومنزلق',
    module: 'المعامل',
    teeth: 'عدد الأسنان',
    angle: 'زاوية الضغط (°)',
    baseR: 'نصف القطر الأساسي',
    lift: 'الارتفاع',
    camType: 'نوع الكامة',
    insert: 'إدراج',
    cancel: 'إلغاء',
  },
} as const;

export default function MechanismPicker({
  lang, onClose, onInsertProfile,
}: MechanismPickerProps) {
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;
  const [kind, setKind] = useState<Kind | null>(null);

  // Spur gear params.
  const [gearParams, setGearParams] = useState<SpurGearParams>({
    module: 2, teethCount: 20, pressureAngleDeg: 20, faceWidthMm: 10,
  });
  // Cam params.
  const [camParams, setCamParams] = useState<CamParams>({
    type: 'harmonic', baseRadiusMm: 30, liftMm: 10, samples: 36,
  });

  const handleInsert = () => {
    if (!onInsertProfile) return;
    if (kind === 'spur-gear') {
      onInsertProfile(spurGearProfile(gearParams).profile, `Spur gear M${gearParams.module} Z${gearParams.teethCount}`);
    } else if (kind === 'cam') {
      onInsertProfile(camProfile(camParams), `${camParams.type} cam`);
    }
    onClose?.();
  };

  if (!kind) {
    return (
      <div style={panelStyle()}>
        <div style={headerStyle()}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
          {onClose && <button onClick={onClose} style={xBtnStyle()}>✕</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {([['spur-gear', '⚙️', t.spurGear], ['cam', '🌀', t.cam], ['four-bar', '◇', t.fourBar], ['slider-crank', '⟶', t.sliderCrank]] as const)
            .map(([k, icon, label]) => (
              <button key={k} onClick={() => setKind(k as Kind)} style={cardStyle()}>
                <div style={{ fontSize: 24 }}>{icon}</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>{label}</div>
              </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={headerStyle()}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title} · {t[kind === 'spur-gear' ? 'spurGear' : kind === 'cam' ? 'cam' : kind === 'four-bar' ? 'fourBar' : 'sliderCrank']}</h3>
        {onClose && <button onClick={onClose} style={xBtnStyle()}>✕</button>}
      </div>

      {kind === 'spur-gear' && (
        <>
          <SliderRow label={t.module} value={gearParams.module} min={0.5} max={10} step={0.5}
            onChange={v => setGearParams({ ...gearParams, module: v })} />
          <SliderRow label={t.teeth} value={gearParams.teethCount} min={6} max={120} step={1}
            onChange={v => setGearParams({ ...gearParams, teethCount: v })} />
          <SliderRow label={t.angle} value={gearParams.pressureAngleDeg} min={14.5} max={25} step={0.5}
            onChange={v => setGearParams({ ...gearParams, pressureAngleDeg: v })} />
        </>
      )}
      {kind === 'cam' && (
        <>
          <SliderRow label={t.baseR} value={camParams.baseRadiusMm} min={10} max={100} step={1}
            onChange={v => setCamParams({ ...camParams, baseRadiusMm: v })} />
          <SliderRow label={t.lift} value={camParams.liftMm} min={1} max={50} step={1}
            onChange={v => setCamParams({ ...camParams, liftMm: v })} />
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{t.camType}: </span>
            <select value={camParams.type} onChange={e => setCamParams({ ...camParams, type: e.target.value as CamParams['type'] })} style={fieldStyle()}>
              <option value="eccentric">eccentric</option>
              <option value="harmonic">harmonic</option>
              <option value="dwell-rise-dwell-fall">dwell-rise</option>
            </select>
          </div>
        </>
      )}
      {(kind === 'four-bar' || kind === 'slider-crank') && (
        <p style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>UI for {kind} parameters coming in next iteration.</p>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button onClick={() => setKind(null)} style={secondaryBtn()}>{t.cancel}</button>
        <button onClick={handleInsert} style={primaryBtn()}>{t.insert}</button>
      </div>
    </div>
  );
}

const SliderRow: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }> = ({ label, value, min, max, step, onChange }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
      <span style={{ color: 'var(--nx-text-2)' }}>{label}</span>
      <span style={{ color: 'var(--nx-text)' }}>{value}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%' }} />
  </div>
);

// right: 336 clears the 320px right property pane (2026-06-12)
function panelStyle(): React.CSSProperties { return { position: 'fixed', top: 80, right: 340, zIndex: 700, width: 300, background: 'var(--nx-panel)', color: 'var(--nx-text)', borderRadius: 10, padding: '14px 16px', boxShadow: '0 12px 24px rgba(0,0,0,0.35)', fontFamily: 'system-ui, sans-serif' }; }
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 16 }; }
function fieldStyle(): React.CSSProperties { return { background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '3px 6px', fontSize: 11 }; }
function cardStyle(): React.CSSProperties { return { background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)', borderRadius: 8, padding: '14px 8px', cursor: 'pointer', color: 'var(--nx-text)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }; }
function primaryBtn(): React.CSSProperties { return { flex: 1, background: '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }; }
function secondaryBtn(): React.CSSProperties { return { flex: 1, background: 'transparent', color: 'var(--nx-text-2)', border: '1px solid var(--nx-border)', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }; }
