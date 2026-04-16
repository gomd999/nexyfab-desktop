'use client';
import React, { useState, useCallback, useRef } from 'react';
import { parseKicadPCB, parseComponentCSV, type PCBBoard, type PCBComponent } from './ecadImport';
import { runThermalFEA, applyThermalColormap, THERMAL_MATERIALS } from './thermalFEA';
import * as THREE from 'three';

interface Props {
  geometry: THREE.BufferGeometry | null;
  lang: string;
  onThermalResult: (geo: THREE.BufferGeometry) => void;
  onClose: () => void;
}

const C = {
  bg: '#0d1117',
  card: '#161b22',
  border: '#30363d',
  text: '#c9d1d9',
  muted: '#8b949e',
  accent: '#388bfd',
  warn: '#f59e0b',
  hot: '#f85149',
};

export default function ECADImportPanel({ geometry, lang, onThermalResult, onClose }: Props) {
  const isKo = lang === 'ko';
  const [board, setBoard] = useState<PCBBoard | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingComponents, setEditingComponents] = useState<PCBComponent[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      try {
        let parsed: PCBBoard;
        if (file.name.endsWith('.kicad_pcb')) {
          parsed = parseKicadPCB(text);
        } else if (file.name.endsWith('.csv')) {
          parsed = parseComponentCSV(text);
        } else {
          setError(isKo ? '지원 형식: .kicad_pcb, .csv' : 'Supported: .kicad_pcb, .csv');
          return;
        }
        if (parsed.components.length === 0) {
          setError(isKo ? '컴포넌트를 찾을 수 없습니다' : 'No components found');
          return;
        }
        setBoard(parsed);
        setEditingComponents(parsed.components);
      } catch {
        setError(isKo ? '파일 파싱 오류' : 'File parse error');
      }
    };
    reader.readAsText(file);
  }, [isKo]);

  const totalPower = editingComponents.reduce((s, c) => s + c.powerWatts, 0);

  const runAnalysis = useCallback(async () => {
    if (!geometry || !board || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      if (!bb) return;

      // Build boundaries from edited component power values
      const boundaries: Parameters<typeof runThermalFEA>[1] = editingComponents
        .filter(c => c.powerWatts > 0.01)
        .map((c, i) => ({
          type: 'heat_source' as const,
          faceIndex: i % 6,
          value: c.powerWatts * 500,
        }));
      boundaries.push({ type: 'fixed_temp' as const, faceIndex: 5, value: 25 });

      const result = await Promise.resolve(
        runThermalFEA(geometry, boundaries, THERMAL_MATERIALS.aluminum, 25),
      );
      const coloredGeo = applyThermalColormap(geometry, result);
      onThermalResult(coloredGeo);
    } catch (err) {
      console.error('[ECAD Thermal]', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [geometry, board, editingComponents, isAnalyzing, onThermalResult]);

  const updatePower = useCallback((index: number, value: number) => {
    setEditingComponents(prev =>
      prev.map((c, j) => (j === index ? { ...c, powerWatts: value } : c)),
    );
  }, []);

  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 14,
        width: 300,
        color: C.text,
        fontSize: 12,
        maxHeight: '80vh',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>
          🔌 {isKo ? 'PCB 열 매핑' : 'PCB Thermal Mapping'}
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}
        >
          ×
        </button>
      </div>

      {/* Description */}
      <div style={{ fontSize: 10, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
        {isKo
          ? 'KiCad PCB 파일을 가져와 발열 분포를 3D 모델에 매핑합니다.'
          : 'Import KiCad PCB file to map heat distribution onto 3D model.'}
      </div>

      {/* File drop zone */}
      <div
        style={{
          border: `2px dashed ${C.border}`,
          borderRadius: 8,
          padding: 12,
          textAlign: 'center',
          marginBottom: 10,
          cursor: 'pointer',
        }}
        onClick={() => fileRef.current?.click()}
      >
        <div style={{ fontSize: 20, marginBottom: 4 }}>📁</div>
        <div style={{ fontSize: 11, color: C.muted }}>
          {isKo ? '.kicad_pcb 또는 .csv 파일' : '.kicad_pcb or .csv file'}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".kicad_pcb,.csv"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
      </div>

      {/* CSV template hint */}
      <div
        style={{
          fontSize: 9,
          color: C.muted,
          marginBottom: 10,
          fontFamily: 'monospace',
          background: C.card,
          padding: '4px 8px',
          borderRadius: 4,
        }}
      >
        CSV: ref,value,x_mm,y_mm,power_w
        <br />
        U1,ESP32,10,20,0.5
        <br />
        U2,LDO,30,15,1.2
      </div>

      {/* Error display */}
      {error && (
        <div style={{ color: C.hot, fontSize: 10, marginBottom: 8 }}>⚠️ {error}</div>
      )}

      {/* Component list + run button */}
      {board && (
        <>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: C.muted, fontSize: 10, textTransform: 'uppercase' }}>
                {isKo ? '컴포넌트' : 'Components'} ({editingComponents.length})
              </span>
              <span style={{ color: C.warn, fontSize: 10 }}>∑ {totalPower.toFixed(2)}W</span>
            </div>

            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
              {editingComponents.map((comp, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 0',
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <span
                    style={{
                      color:
                        comp.powerWatts > 1 ? C.hot : comp.powerWatts > 0.3 ? C.warn : C.muted,
                      fontSize: 10,
                      width: 28,
                      fontWeight: 700,
                    }}
                  >
                    {comp.ref}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      color: C.muted,
                      fontSize: 9,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {comp.value}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={comp.powerWatts}
                    onChange={e => updatePower(i, parseFloat(e.target.value) || 0)}
                    style={{
                      width: 44,
                      fontSize: 10,
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      color: C.text,
                      borderRadius: 3,
                      padding: '2px 4px',
                      textAlign: 'right',
                    }}
                  />
                  <span style={{ fontSize: 9, color: C.muted }}>W</span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={runAnalysis}
            disabled={!geometry || isAnalyzing}
            style={{
              width: '100%',
              padding: '8px 0',
              borderRadius: 6,
              border: 'none',
              background: isAnalyzing ? C.card : '#f59e0b',
              color: isAnalyzing ? C.muted : '#000',
              fontWeight: 700,
              fontSize: 12,
              cursor: geometry && !isAnalyzing ? 'pointer' : 'default',
            }}
          >
            {isAnalyzing
              ? `⏳ ${isKo ? '열해석 중...' : 'Analyzing...'}`
              : `🌡️ ${isKo ? '열분포 매핑' : 'Map Heat Distribution'}`}
          </button>
        </>
      )}
    </div>
  );
}
