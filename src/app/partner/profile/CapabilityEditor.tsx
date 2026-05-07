'use client';

import {
  PROCESS_LABELS, PROCESS_CODES,
  type ProcessCapability, type ProcessCapabilitySpec, type ProcessCode,
} from '@/lib/partner-pricebook';

interface Props {
  value: ProcessCapability;
  onChange: (v: ProcessCapability) => void;
  onSave: () => void;
  saving: boolean;
}

const DEFAULT_SPEC: ProcessCapabilitySpec = {
  enabled: true,
  maxBboxMm: { x: 500, y: 500, z: 300 },
  minWallMm: 1.0,
  minHoleMm: 1.0,
  minToleranceMm: 0.1,
  surfaceFinishRa: [1.6, 3.2],
  leadTimeDaysMin: 7,
  leadTimeDaysMax: 14,
};

export default function CapabilityEditor({ value, onChange, onSave, saving }: Props) {
  const v = value || {};

  function updateSpec(code: ProcessCode, patch: Partial<ProcessCapabilitySpec>) {
    const current = v[code] ?? DEFAULT_SPEC;
    onChange({ ...v, [code]: { ...current, ...patch } });
  }

  function toggle(code: ProcessCode, enabled: boolean) {
    if (enabled) {
      onChange({ ...v, [code]: v[code] ?? DEFAULT_SPEC });
    } else {
      const next = { ...v };
      delete next[code];
      onChange(next);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="font-bold text-gray-900">공정 능력표</h2>
          <p className="text-xs text-gray-400 mt-0.5">설비/툴링이 처리 가능한 한계를 등록합니다.</p>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      <div className="px-6 py-5 space-y-3">
        {PROCESS_CODES.map(code => {
          const spec = v[code];
          const enabled = !!spec?.enabled;
          return (
            <div key={code} className={`rounded-xl border ${enabled ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100 bg-gray-50/40'} overflow-hidden`}>
              <div className="flex items-center justify-between px-4 py-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => toggle(code, e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-bold text-gray-800">{PROCESS_LABELS[code]}</span>
                </label>
              </div>

              {enabled && spec && (
                <div className="px-4 pb-4 space-y-3 border-t border-blue-100">
                  {/* 최대 가공 크기 */}
                  <div className="pt-3">
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">최대 가공 크기 (mm)</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['x', 'y', 'z'] as const).map(axis => (
                        <div key={axis} className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400 uppercase w-3">{axis}</span>
                          <input
                            type="number"
                            value={spec.maxBboxMm[axis]}
                            onChange={e => updateSpec(code, {
                              maxBboxMm: { ...spec.maxBboxMm, [axis]: Math.max(1, Number(e.target.value) || 0) },
                            })}
                            className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 미세 한계 */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">최소 두께 (mm)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={spec.minWallMm ?? ''}
                        onChange={e => updateSpec(code, { minWallMm: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">최소 홀 (mm)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={spec.minHoleMm ?? ''}
                        onChange={e => updateSpec(code, { minHoleMm: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">최소 공차 (±mm)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={spec.minToleranceMm ?? ''}
                        onChange={e => updateSpec(code, { minToleranceMm: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                      />
                    </div>
                  </div>

                  {/* 표면조도 옵션 */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">표면조도 옵션 (Ra)</label>
                    <div className="flex flex-wrap gap-1.5">
                      {[0.4, 0.8, 1.6, 3.2, 6.3, 12.5].map(ra => {
                        const active = (spec.surfaceFinishRa ?? []).includes(ra);
                        return (
                          <button
                            key={ra}
                            onClick={() => {
                              const cur = spec.surfaceFinishRa ?? [];
                              const next = active ? cur.filter(x => x !== ra) : [...cur, ra].sort((a, b) => a - b);
                              updateSpec(code, { surfaceFinishRa: next });
                            }}
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors
                              ${active
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-500 border-gray-200 hover:bg-blue-50 hover:border-blue-200'}`}
                          >
                            {ra}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 리드타임 */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">리드타임 (영업일)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={spec.leadTimeDaysMin}
                        onChange={e => updateSpec(code, { leadTimeDaysMin: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-20 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                      />
                      <span className="text-xs text-gray-400">~</span>
                      <input
                        type="number"
                        value={spec.leadTimeDaysMax}
                        onChange={e => updateSpec(code, { leadTimeDaysMax: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-20 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                      />
                      <span className="text-xs text-gray-400">일</span>
                    </div>
                  </div>

                  {/* 메모 */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">메모</label>
                    <input
                      type="text"
                      value={spec.notes ?? ''}
                      onChange={e => updateSpec(code, { notes: e.target.value })}
                      placeholder="특수 옵션, 제약 등"
                      className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
