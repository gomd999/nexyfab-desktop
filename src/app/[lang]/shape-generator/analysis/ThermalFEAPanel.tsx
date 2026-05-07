'use client';
import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import { runThermalFEA, applyThermalColormap, THERMAL_MATERIALS, type ThermalBoundary, type ThermalResult } from './thermalFEA';

interface Props {
  geometry: THREE.BufferGeometry | null;
  lang: string;
  onResult: (coloredGeo: THREE.BufferGeometry, result: ThermalResult) => void;
  onClose: () => void;
}

/* ─── i18n ───────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    title: '열해석 (Thermal FEA)',
    material: '재질',
    ambientTemp: '주변 온도',
    boundaryConditions: '경계 조건',
    add: '추가',
    heatSource: '열원',
    fixedTemp: '고정 온도',
    convection: '대류',
    powerMw: '출력(mW)',
    tempC: '온도(°C)',
    ambientC: '주변(°C)',
    results: '결과',
    maxTemp: '최고 온도',
    minTemp: '최저 온도',
    hotspotsDetected: (n: number) => `핫스팟 ${n}개 감지`,
    running: '해석 중...',
    run: '열해석 실행',
    faces: ['하면(-Y)', '상면(+Y)', '전면(-Z)', '후면(+Z)', '좌면(-X)', '우면(+X)'],
  },
  en: {
    title: 'Thermal FEA',
    material: 'Material',
    ambientTemp: 'Ambient Temp',
    boundaryConditions: 'Boundary Conditions',
    add: 'Add',
    heatSource: 'Heat Source',
    fixedTemp: 'Fixed Temp',
    convection: 'Convection',
    powerMw: 'Power(mW)',
    tempC: 'Temp(°C)',
    ambientC: 'Ambient(°C)',
    results: 'Results',
    maxTemp: 'Max Temp',
    minTemp: 'Min Temp',
    hotspotsDetected: (n: number) => `${n} hotspot(s) detected`,
    running: 'Running...',
    run: 'Run Thermal FEA',
    faces: ['Bottom(-Y)', 'Top(+Y)', 'Front(-Z)', 'Back(+Z)', 'Left(-X)', 'Right(+X)'],
  },
  ja: {
    title: '熱解析 (Thermal FEA)',
    material: '材料',
    ambientTemp: '周囲温度',
    boundaryConditions: '境界条件',
    add: '追加',
    heatSource: '熱源',
    fixedTemp: '固定温度',
    convection: '対流',
    powerMw: '出力(mW)',
    tempC: '温度(°C)',
    ambientC: '周囲(°C)',
    results: '結果',
    maxTemp: '最高温度',
    minTemp: '最低温度',
    hotspotsDetected: (n: number) => `ホットスポット ${n}個検出`,
    running: '解析中...',
    run: '熱解析実行',
    faces: ['下面(-Y)', '上面(+Y)', '前面(-Z)', '背面(+Z)', '左面(-X)', '右面(+X)'],
  },
  zh: {
    title: '热分析 (Thermal FEA)',
    material: '材料',
    ambientTemp: '环境温度',
    boundaryConditions: '边界条件',
    add: '添加',
    heatSource: '热源',
    fixedTemp: '固定温度',
    convection: '对流',
    powerMw: '功率(mW)',
    tempC: '温度(°C)',
    ambientC: '环境(°C)',
    results: '结果',
    maxTemp: '最高温度',
    minTemp: '最低温度',
    hotspotsDetected: (n: number) => `检测到 ${n} 个热点`,
    running: '分析中...',
    run: '运行热分析',
    faces: ['底面(-Y)', '顶面(+Y)', '前面(-Z)', '后面(+Z)', '左面(-X)', '右面(+X)'],
  },
  es: {
    title: 'Análisis Térmico (Thermal FEA)',
    material: 'Material',
    ambientTemp: 'Temp. Ambiente',
    boundaryConditions: 'Condiciones de Contorno',
    add: 'Añadir',
    heatSource: 'Fuente de Calor',
    fixedTemp: 'Temp. Fija',
    convection: 'Convección',
    powerMw: 'Potencia(mW)',
    tempC: 'Temp(°C)',
    ambientC: 'Ambiente(°C)',
    results: 'Resultados',
    maxTemp: 'Temp. Máx',
    minTemp: 'Temp. Mín',
    hotspotsDetected: (n: number) => `${n} punto(s) caliente(s) detectado(s)`,
    running: 'Ejecutando...',
    run: 'Ejecutar Thermal FEA',
    faces: ['Inferior(-Y)', 'Superior(+Y)', 'Frontal(-Z)', 'Trasera(+Z)', 'Izquierda(-X)', 'Derecha(+X)'],
  },
  ar: {
    title: 'التحليل الحراري (Thermal FEA)',
    material: 'المادة',
    ambientTemp: 'درجة الحرارة المحيطة',
    boundaryConditions: 'الشروط الحدية',
    add: 'إضافة',
    heatSource: 'مصدر حراري',
    fixedTemp: 'درجة حرارة ثابتة',
    convection: 'الحمل الحراري',
    powerMw: 'الطاقة(mW)',
    tempC: 'الحرارة(°C)',
    ambientC: 'المحيط(°C)',
    results: 'النتائج',
    maxTemp: 'أقصى حرارة',
    minTemp: 'أدنى حرارة',
    hotspotsDetected: (n: number) => `تم اكتشاف ${n} نقطة ساخنة`,
    running: '...جاري التحليل',
    run: 'تشغيل التحليل الحراري',
    faces: ['السفلي(-Y)', 'العلوي(+Y)', 'الأمامي(-Z)', 'الخلفي(+Z)', 'اليسار(-X)', 'اليمين(+X)'],
  },
};

const C = { bg: '#0d1117', card: '#161b22', border: '#30363d', text: '#c9d1d9', muted: '#8b949e', accent: '#388bfd', hot: '#f85149', warn: '#f59e0b', ok: '#3fb950' };

type BoundaryEdit = ThermalBoundary & { id: string };

export default function ThermalFEAPanel({ geometry, lang, onResult, onClose }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  const isKo = (langMap[seg] ?? 'en') === 'ko';
  const faceNames = t.faces;

  const [materialId, setMaterialId] = useState<keyof typeof THERMAL_MATERIALS>('aluminum');
  const [ambientTemp, setAmbientTemp] = useState(25);
  const [boundaries, setBoundaries] = useState<BoundaryEdit[]>([
    { id: 'b1', type: 'heat_source', faceIndex: 0, value: 500 },
    { id: 'b2', type: 'fixed_temp', faceIndex: 1, value: 25 },
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<ThermalResult | null>(null);

  const addBoundary = () => {
    setBoundaries(prev => [...prev, { id: `b${Date.now()}`, type: 'heat_source', faceIndex: 0, value: 100 }]);
  };

  const removeBoundary = (id: string) => setBoundaries(prev => prev.filter(b => b.id !== id));

  const updateBoundary = (id: string, patch: Partial<BoundaryEdit>) => {
    setBoundaries(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  };

  const run = useCallback(async () => {
    if (!geometry || isRunning) return;
    setIsRunning(true);
    setResult(null);
    try {
      const mat = THERMAL_MATERIALS[materialId];
      const res = runThermalFEA(geometry, boundaries, mat, ambientTemp);
      setResult(res);
      const coloredGeo = applyThermalColormap(geometry, res);
      onResult(coloredGeo, res);
    } catch (err) {
      console.error('[ThermalFEA]', err);
    } finally {
      setIsRunning(false);
    }
  }, [geometry, boundaries, materialId, ambientTemp, isRunning, onResult]);

  const mat = THERMAL_MATERIALS[materialId];

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, width: 290, color: C.text, fontSize: 12, maxHeight: '85vh', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>🌡️ {t.title}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>

      {/* Material */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 5 }}>{t.material}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(Object.entries(THERMAL_MATERIALS) as [keyof typeof THERMAL_MATERIALS, typeof THERMAL_MATERIALS[keyof typeof THERMAL_MATERIALS]][]).map(([id, m]) => (
            <button key={id} onClick={() => setMaterialId(id)}
              style={{ padding: '3px 8px', borderRadius: 4, border: `1px solid ${materialId === id ? C.accent : C.border}`, background: materialId === id ? 'rgba(56,139,253,0.15)' : 'transparent', color: materialId === id ? C.accent : C.muted, fontSize: 10, cursor: 'pointer', fontWeight: materialId === id ? 700 : 400 }}>
              {isKo ? m.nameKo : m.name}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>
          k = {mat.conductivity} W/(m·K) · ρ = {mat.density} kg/m³
        </div>
      </div>

      {/* Ambient temp */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 30px', gap: 6, alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: C.muted }}>{t.ambientTemp}</span>
        <input type="range" min={-20} max={80} step={1} value={ambientTemp} onChange={e => setAmbientTemp(Number(e.target.value))} style={{ width: '100%' }} />
        <span style={{ fontSize: 10, textAlign: 'right' }}>{ambientTemp}°C</span>
      </div>

      {/* Boundary conditions */}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>{t.boundaryConditions}</span>
          <button onClick={addBoundary} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.accent, cursor: 'pointer' }}>+ {t.add}</button>
        </div>

        {boundaries.map(bc => (
          <div key={bc.id} style={{ background: C.card, borderRadius: 6, padding: '6px 8px', marginBottom: 5 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              {/* Type selector */}
              <select value={bc.type} onChange={e => updateBoundary(bc.id, { type: e.target.value as ThermalBoundary['type'] })}
                style={{ flex: 1, fontSize: 10, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px' }}>
                <option value="heat_source">{t.heatSource}</option>
                <option value="fixed_temp">{t.fixedTemp}</option>
                <option value="convection">{t.convection}</option>
              </select>
              {/* Face selector */}
              <select value={bc.faceIndex} onChange={e => updateBoundary(bc.id, { faceIndex: Number(e.target.value) })}
                style={{ flex: 1, fontSize: 10, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px' }}>
                {faceNames.map((name, i) => <option key={i} value={i}>{name}</option>)}
              </select>
              <button onClick={() => removeBoundary(bc.id)} style={{ background: 'none', border: 'none', color: C.hot, cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>×</button>
            </div>
            {/* Value input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: C.muted, width: 60 }}>
                {bc.type === 'heat_source' ? t.powerMw : bc.type === 'fixed_temp' ? t.tempC : 'h·A (W/K)'}
              </span>
              <input type="number" value={bc.value} min={0}
                onChange={e => updateBoundary(bc.id, { value: parseFloat(e.target.value) || 0 })}
                style={{ flex: 1, fontSize: 10, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 6px' }} />
            </div>
            {bc.type === 'convection' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <span style={{ fontSize: 9, color: C.muted, width: 60 }}>{t.ambientC}</span>
                <input type="number" value={bc.ambientTemp ?? ambientTemp}
                  onChange={e => updateBoundary(bc.id, { ambientTemp: parseFloat(e.target.value) || 0 })}
                  style={{ flex: 1, fontSize: 10, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 6px' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Results */}
      {result && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>{t.results}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{ background: C.card, borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: C.muted }}>{t.maxTemp}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.hot }}>{result.maxTemp.toFixed(1)}°C</div>
            </div>
            <div style={{ background: C.card, borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: C.muted }}>{t.minTemp}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{result.minTemp.toFixed(1)}°C</div>
            </div>
          </div>
          {/* Colorbar */}
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: C.accent }}>{result.minTemp.toFixed(0)}°C</span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)' }} />
            <span style={{ fontSize: 9, color: C.hot }}>{result.maxTemp.toFixed(0)}°C</span>
          </div>
          {result.hotspots.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 10, color: C.warn }}>
              🔥 {t.hotspotsDetected(result.hotspots.length)}
            </div>
          )}
        </div>
      )}

      {/* Run button */}
      <button onClick={run} disabled={!geometry || isRunning}
        style={{ width: '100%', padding: '8px 0', borderRadius: 6, border: 'none', background: isRunning ? C.card : C.hot, color: isRunning ? C.muted : '#fff', fontWeight: 700, fontSize: 12, cursor: geometry && !isRunning ? 'pointer' : 'default' }}>
        {isRunning ? `⏳ ${t.running}` : `🌡️ ${t.run}`}
      </button>
    </div>
  );
}
