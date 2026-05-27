'use client';

import { useState } from 'react';
import {
  PROCESS_LABELS, PROCESS_CODES, DEFAULT_PRICEBOOK,
  type PriceBook, type ProcessCode, type VolumeTier,
} from '@/lib/partner-pricebook';
import { usePartnerLang } from '../_lib/partnerLang';
import { profileEditorsDict, type ProfileEditorsDict } from '../_lib/dicts/profileEditors';

const MATERIAL_PRESET_IDS = ['aluminum', 'steel', 'titanium', 'copper', 'abs_white', 'nylon'] as const;
function materialLabel(id: string, t: ProfileEditorsDict): string {
  const key = `pbMat_${id}` as keyof ProfileEditorsDict;
  const v = t[key];
  return typeof v === 'string' ? v : id;
}

interface Props {
  value: PriceBook;
  onChange: (v: PriceBook) => void;
  onSave: () => void;
  saving: boolean;
}

export default function PriceBookEditor({ value, onChange, onSave, saving }: Props) {
  const lang = usePartnerLang();
  const t = profileEditorsDict(lang);
  const v = value || DEFAULT_PRICEBOOK;
  const [newMaterial, setNewMaterial] = useState('');

  function setField<K extends keyof PriceBook>(key: K, val: PriceBook[K]) {
    onChange({ ...v, [key]: val });
  }

  function setProcessRate(code: ProcessCode, hourlyRateKrw: number, setupHours: number) {
    onChange({
      ...v,
      processes: {
        ...v.processes,
        [code]: { hourlyRateKrw, setupHours },
      },
    });
  }

  function removeProcess(code: ProcessCode) {
    const next = { ...v.processes };
    delete next[code];
    onChange({ ...v, processes: next });
  }

  function setMaterial(id: string, pricePerKgKrw: number, markupPct: number) {
    onChange({
      ...v,
      materials: { ...v.materials, [id]: { pricePerKgKrw, markupPct } },
    });
  }

  function removeMaterial(id: string) {
    const next = { ...v.materials };
    delete next[id];
    onChange({ ...v, materials: next });
  }

  function setTier(idx: number, patch: Partial<VolumeTier>) {
    const tiers = [...v.volumeTiers];
    tiers[idx] = { ...tiers[idx], ...patch };
    onChange({ ...v, volumeTiers: tiers });
  }

  function addTier() {
    onChange({ ...v, volumeTiers: [...v.volumeTiers, { minQty: 50, discountPct: 10 }] });
  }

  function removeTier(idx: number) {
    onChange({ ...v, volumeTiers: v.volumeTiers.filter((_, i) => i !== idx) });
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="font-bold text-gray-900">{t.pbTitle}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{t.pbSubtitle}</p>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50"
        >
          {saving ? t.savingBtn : t.saveBtn}
        </button>
      </div>

      <div className="px-6 py-5 space-y-6">
        {/* Common */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3">{t.pbCommonSection}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">{t.pbSetupFee}</label>
              <input
                type="number"
                value={v.setupFeeKrw}
                onChange={e => setField('setupFeeKrw', Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">{t.pbMinOrder}</label>
              <input
                type="number"
                value={v.minOrderKrw}
                onChange={e => setField('minOrderKrw', Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">{t.pbExpressMultiplier}</label>
              <input
                type="number"
                step="0.1"
                value={v.expressMultiplier}
                onChange={e => setField('expressMultiplier', Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
        </section>

        {/* Process rates */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3">{t.pbProcessSection}</h3>
          <div className="space-y-2">
            {PROCESS_CODES.map(code => {
              const rate = v.processes[code];
              const enabled = !!rate;
              return (
                <div key={code} className={`flex items-center gap-2 p-2 rounded-xl border ${enabled ? 'border-blue-200 bg-blue-50/40' : 'border-gray-100 bg-gray-50/50'}`}>
                  <label className="flex items-center gap-2 w-40 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={e => {
                        if (e.target.checked) setProcessRate(code, 50_000, 0.3);
                        else removeProcess(code);
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-semibold text-gray-700">{PROCESS_LABELS[code]}</span>
                  </label>
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-500">{t.pbHourly}</span>
                      <input
                        type="number"
                        value={rate?.hourlyRateKrw ?? ''}
                        disabled={!enabled}
                        onChange={e => setProcessRate(code, Math.max(0, Number(e.target.value) || 0), rate?.setupHours ?? 0)}
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 disabled:bg-gray-100 disabled:text-gray-400"
                      />
                      <span className="text-xs text-gray-400">₩</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-500">{t.pbSetup}</span>
                      <input
                        type="number"
                        step="0.1"
                        value={rate?.setupHours ?? ''}
                        disabled={!enabled}
                        onChange={e => setProcessRate(code, rate?.hourlyRateKrw ?? 0, Math.max(0, Number(e.target.value) || 0))}
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 disabled:bg-gray-100 disabled:text-gray-400"
                      />
                      <span className="text-xs text-gray-400">{t.hours}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Material rates */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3">{t.pbMaterialSection}</h3>
          <div className="space-y-2">
            {Object.entries(v.materials).map(([id, mat]) => (
              <div key={id} className="flex items-center gap-2 p-2 rounded-xl border border-gray-200 bg-gray-50/50">
                <span className="w-32 shrink-0 text-sm font-semibold text-gray-700">
                  {materialLabel(id, t)}
                </span>
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-xs text-gray-500">{t.pbMaterialPrice}</span>
                  <input
                    type="number"
                    value={mat.pricePerKgKrw}
                    onChange={e => setMaterial(id, Math.max(0, Number(e.target.value) || 0), mat.markupPct ?? 0)}
                    className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                  <span className="text-xs text-gray-400">₩/kg</span>
                </div>
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-xs text-gray-500">{t.pbMaterialMargin}</span>
                  <input
                    type="number"
                    value={mat.markupPct ?? 0}
                    onChange={e => setMaterial(id, mat.pricePerKgKrw, Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                    className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                  <span className="text-xs text-gray-400">%</span>
                </div>
                <button
                  onClick={() => removeMaterial(id)}
                  className="text-xs text-red-500 hover:text-red-700 font-semibold px-2 py-1"
                  title={t.deleteTitle}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <select
              value={newMaterial}
              onChange={e => setNewMaterial(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400"
            >
              <option value="">{t.pbAddMaterialPlaceholder}</option>
              {MATERIAL_PRESET_IDS.filter(id => !v.materials[id]).map(id => (
                <option key={id} value={id}>{materialLabel(id, t)}</option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!newMaterial) return;
                setMaterial(newMaterial, 5_000, 30);
                setNewMaterial('');
              }}
              disabled={!newMaterial}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl disabled:opacity-50 transition"
            >
              {t.addBtn}
            </button>
          </div>
        </section>

        {/* Volume tiers */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3">{t.pbVolumeSection}</h3>
          <div className="space-y-2">
            {v.volumeTiers.map((tier, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-xl border border-gray-200 bg-gray-50/50">
                <span className="text-xs text-gray-500 w-12 shrink-0">{t.pbMinQty}</span>
                <input
                  type="number"
                  value={tier.minQty}
                  onChange={e => setTier(i, { minQty: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-24 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                />
                <span className="text-xs text-gray-500 ml-3">{t.pbDiscount}</span>
                <input
                  type="number"
                  value={tier.discountPct}
                  onChange={e => setTier(i, { discountPct: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })}
                  className="w-20 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                />
                <span className="text-xs text-gray-400">%</span>
                <div className="flex-1" />
                <button
                  onClick={() => removeTier(i)}
                  className="text-xs text-red-500 hover:text-red-700 font-semibold px-2 py-1"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={addTier}
              className="w-full px-3 py-2 border-2 border-dashed border-gray-200 hover:border-blue-300 text-gray-500 hover:text-blue-600 text-sm font-semibold rounded-xl transition"
            >
              {t.pbAddTier}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
