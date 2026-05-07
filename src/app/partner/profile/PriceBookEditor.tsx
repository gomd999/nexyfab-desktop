'use client';

import { useState } from 'react';
import {
  PROCESS_LABELS, PROCESS_CODES, DEFAULT_PRICEBOOK,
  type PriceBook, type ProcessCode, type VolumeTier,
} from '@/lib/partner-pricebook';

const MATERIAL_PRESETS = [
  { id: 'aluminum', label: '알루미늄' },
  { id: 'steel',    label: '강철' },
  { id: 'titanium', label: '티타늄' },
  { id: 'copper',   label: '구리' },
  { id: 'abs_white', label: 'ABS' },
  { id: 'nylon',    label: '나일론' },
];

interface Props {
  value: PriceBook;
  onChange: (v: PriceBook) => void;
  onSave: () => void;
  saving: boolean;
}

export default function PriceBookEditor({ value, onChange, onSave, saving }: Props) {
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
          <h2 className="font-bold text-gray-900">단가표</h2>
          <p className="text-xs text-gray-400 mt-0.5">고객 견적 자동 산출에 사용됩니다.</p>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      <div className="px-6 py-5 space-y-6">
        {/* 공통 ─────────────────── */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3">공통 설정</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">셋업 비용 (₩)</label>
              <input
                type="number"
                value={v.setupFeeKrw}
                onChange={e => setField('setupFeeKrw', Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">최소 주문 (₩)</label>
              <input
                type="number"
                value={v.minOrderKrw}
                onChange={e => setField('minOrderKrw', Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">긴급 배수 (×)</label>
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

        {/* 공정 단가 ─────────────── */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3">공정별 시간당 단가</h3>
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
                      <span className="text-xs text-gray-500">시간당</span>
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
                      <span className="text-xs text-gray-500">셋업</span>
                      <input
                        type="number"
                        step="0.1"
                        value={rate?.setupHours ?? ''}
                        disabled={!enabled}
                        onChange={e => setProcessRate(code, rate?.hourlyRateKrw ?? 0, Math.max(0, Number(e.target.value) || 0))}
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 disabled:bg-gray-100 disabled:text-gray-400"
                      />
                      <span className="text-xs text-gray-400">시간</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 재질 단가 ─────────────── */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3">재질별 단가 (kg)</h3>
          <div className="space-y-2">
            {Object.entries(v.materials).map(([id, mat]) => (
              <div key={id} className="flex items-center gap-2 p-2 rounded-xl border border-gray-200 bg-gray-50/50">
                <span className="w-32 shrink-0 text-sm font-semibold text-gray-700">
                  {MATERIAL_PRESETS.find(m => m.id === id)?.label || id}
                </span>
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-xs text-gray-500">단가</span>
                  <input
                    type="number"
                    value={mat.pricePerKgKrw}
                    onChange={e => setMaterial(id, Math.max(0, Number(e.target.value) || 0), mat.markupPct ?? 0)}
                    className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                  />
                  <span className="text-xs text-gray-400">₩/kg</span>
                </div>
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-xs text-gray-500">마진</span>
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
                  title="삭제"
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
              <option value="">+ 재질 추가</option>
              {MATERIAL_PRESETS.filter(m => !v.materials[m.id]).map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
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
              추가
            </button>
          </div>
        </section>

        {/* 수량 할인 ─────────────── */}
        <section>
          <h3 className="text-sm font-bold text-gray-800 mb-3">수량 할인 구간</h3>
          <div className="space-y-2">
            {v.volumeTiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-xl border border-gray-200 bg-gray-50/50">
                <span className="text-xs text-gray-500 w-12 shrink-0">최소수량</span>
                <input
                  type="number"
                  value={t.minQty}
                  onChange={e => setTier(i, { minQty: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-24 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                />
                <span className="text-xs text-gray-500 ml-3">할인</span>
                <input
                  type="number"
                  value={t.discountPct}
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
              + 할인 구간 추가
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
