'use client';
/**
 * COTS 표준 사이즈 프리셋 드롭다운
 * 너트(M3~M48), 와셔(M3~M48), 베어링(6000번대 ~ 6200번대) 지원
 * 선택 시 해당 shape의 파라미터를 자동으로 채워 준다.
 */
import React from 'react';
import { usePathname } from 'next/navigation';

// ─── i18n dict ────────────────────────────────────────────────────────────────

const dict = {
  ko: { label: '표준 사이즈', placeholder: '— 규격 선택 —' },
  en: { label: 'Standard Size', placeholder: '— Select size —' },
  ja: { label: '標準サイズ', placeholder: '— サイズ選択 —' },
  zh: { label: '标准尺寸', placeholder: '— 选择尺寸 —' },
  es: { label: 'Tamaño Estándar', placeholder: '— Seleccionar tamaño —' },
  ar: { label: 'المقاس القياسي', placeholder: '— اختر المقاس —' },
} as const;

// ─── 프리셋 데이터 ─────────────────────────────────────────────────────────────

/** KS B 1012 / ISO 4032 — 육각 너트 */
const HEX_NUT_PRESETS: { label: string; nominalDia: number; acrossFlats: number; thickness: number }[] = [
  { label: 'M3',  nominalDia: 3,  acrossFlats: 5.5,  thickness: 2.4 },
  { label: 'M4',  nominalDia: 4,  acrossFlats: 7,    thickness: 3.2 },
  { label: 'M5',  nominalDia: 5,  acrossFlats: 8,    thickness: 4.7 },
  { label: 'M6',  nominalDia: 6,  acrossFlats: 10,   thickness: 5.2 },
  { label: 'M8',  nominalDia: 8,  acrossFlats: 13,   thickness: 6.8 },
  { label: 'M10', nominalDia: 10, acrossFlats: 17,   thickness: 8.4 },
  { label: 'M12', nominalDia: 12, acrossFlats: 19,   thickness: 10.8 },
  { label: 'M14', nominalDia: 14, acrossFlats: 22,   thickness: 12.8 },
  { label: 'M16', nominalDia: 16, acrossFlats: 24,   thickness: 14.8 },
  { label: 'M20', nominalDia: 20, acrossFlats: 30,   thickness: 18.0 },
  { label: 'M24', nominalDia: 24, acrossFlats: 36,   thickness: 21.5 },
  { label: 'M30', nominalDia: 30, acrossFlats: 46,   thickness: 25.6 },
  { label: 'M36', nominalDia: 36, acrossFlats: 55,   thickness: 31.0 },
  { label: 'M42', nominalDia: 42, acrossFlats: 65,   thickness: 34.0 },
  { label: 'M48', nominalDia: 48, acrossFlats: 75,   thickness: 38.0 },
];

/** KS B 1326 / ISO 7089 — 평 와셔 */
const WASHER_PRESETS: { label: string; innerDia: number; outerDia: number; thickness: number }[] = [
  { label: 'M3',  innerDia: 3.2,  outerDia: 7,    thickness: 0.5 },
  { label: 'M4',  innerDia: 4.3,  outerDia: 9,    thickness: 0.8 },
  { label: 'M5',  innerDia: 5.3,  outerDia: 10,   thickness: 1.0 },
  { label: 'M6',  innerDia: 6.4,  outerDia: 12,   thickness: 1.6 },
  { label: 'M8',  innerDia: 8.4,  outerDia: 16,   thickness: 1.6 },
  { label: 'M10', innerDia: 10.5, outerDia: 20,   thickness: 2.0 },
  { label: 'M12', innerDia: 13.0, outerDia: 24,   thickness: 2.5 },
  { label: 'M14', innerDia: 15.0, outerDia: 28,   thickness: 2.5 },
  { label: 'M16', innerDia: 17.0, outerDia: 30,   thickness: 3.0 },
  { label: 'M20', innerDia: 21.0, outerDia: 37,   thickness: 3.0 },
  { label: 'M24', innerDia: 25.0, outerDia: 44,   thickness: 4.0 },
  { label: 'M30', innerDia: 31.0, outerDia: 56,   thickness: 4.0 },
  { label: 'M36', innerDia: 37.0, outerDia: 66,   thickness: 5.0 },
];

/** ISO 15 — 깊은 홈 볼 베어링 6000·6200·6300번대 */
const BEARING_PRESETS: { label: string; boreDia: number; outerDia: number; width: number; ballCount: number }[] = [
  // 6000 series
  { label: '6000', boreDia: 10, outerDia: 26, width: 8,  ballCount: 7 },
  { label: '6001', boreDia: 12, outerDia: 28, width: 8,  ballCount: 7 },
  { label: '6002', boreDia: 15, outerDia: 32, width: 9,  ballCount: 8 },
  { label: '6003', boreDia: 17, outerDia: 35, width: 10, ballCount: 8 },
  { label: '6004', boreDia: 20, outerDia: 42, width: 12, ballCount: 9 },
  { label: '6005', boreDia: 25, outerDia: 47, width: 12, ballCount: 9 },
  { label: '6006', boreDia: 30, outerDia: 55, width: 13, ballCount: 10 },
  { label: '6007', boreDia: 35, outerDia: 62, width: 14, ballCount: 10 },
  { label: '6008', boreDia: 40, outerDia: 68, width: 15, ballCount: 10 },
  // 6200 series
  { label: '6200', boreDia: 10, outerDia: 30, width: 9,  ballCount: 7 },
  { label: '6201', boreDia: 12, outerDia: 32, width: 10, ballCount: 7 },
  { label: '6202', boreDia: 15, outerDia: 35, width: 11, ballCount: 8 },
  { label: '6203', boreDia: 17, outerDia: 40, width: 12, ballCount: 8 },
  { label: '6204', boreDia: 20, outerDia: 47, width: 14, ballCount: 9 },
  { label: '6205', boreDia: 25, outerDia: 52, width: 15, ballCount: 9 },
  { label: '6206', boreDia: 30, outerDia: 62, width: 16, ballCount: 10 },
  { label: '6207', boreDia: 35, outerDia: 72, width: 17, ballCount: 10 },
  { label: '6208', boreDia: 40, outerDia: 80, width: 18, ballCount: 10 },
  // 6300 series
  { label: '6300', boreDia: 10, outerDia: 35, width: 11, ballCount: 7 },
  { label: '6301', boreDia: 12, outerDia: 37, width: 12, ballCount: 7 },
  { label: '6302', boreDia: 15, outerDia: 42, width: 13, ballCount: 8 },
  { label: '6303', boreDia: 17, outerDia: 47, width: 14, ballCount: 8 },
  { label: '6304', boreDia: 20, outerDia: 52, width: 15, ballCount: 9 },
  { label: '6305', boreDia: 25, outerDia: 62, width: 17, ballCount: 9 },
  { label: '6306', boreDia: 30, outerDia: 72, width: 19, ballCount: 10 },
  { label: '6307', boreDia: 35, outerDia: 80, width: 21, ballCount: 10 },
  { label: '6308', boreDia: 40, outerDia: 90, width: 23, ballCount: 10 },
];

// ─── COTS Preset Map ──────────────────────────────────────────────────────────

interface PresetEntry {
  label: string;
  [key: string]: number | string;
}

const COTS_PRESETS: Record<string, PresetEntry[]> = {
  hexNut:  HEX_NUT_PRESETS as PresetEntry[],
  washer:  WASHER_PRESETS  as PresetEntry[],
  bearing: BEARING_PRESETS as PresetEntry[],
};

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  shapeId: string;
  onSelect: (params: Record<string, number>) => void;
  isKo?: boolean;
}

export default function CotsSizePreset({ shapeId, onSelect, isKo }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? (isKo ? 'ko' : 'en')];

  const presets = COTS_PRESETS[shapeId];
  if (!presets || presets.length === 0) return null;

  const label = t.label;
  const placeholder = t.placeholder;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (!val) return;
    const preset = presets.find(p => p.label === val);
    if (!preset) return;
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(preset)) {
      if (k !== 'label') params[k] = v as number;
    }
    onSelect(params);
    e.target.value = '';  // reset dropdown
  }

  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">{label}</span>
      <select
        onChange={handleChange}
        defaultValue=""
        className="flex-1 text-xs bg-[#1a1a2e] border border-white/10 rounded px-2 py-1
                   text-gray-200 focus:outline-none focus:border-blue-500 cursor-pointer"
      >
        <option value="" disabled>{placeholder}</option>
        {presets.map(p => (
          <option key={p.label} value={p.label}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}
