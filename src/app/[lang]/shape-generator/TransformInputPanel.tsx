'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';

const dict = {
  ko: { pos: '위치', rot: '회전', scl: '크기', reset: '초기화', noSel: '(선택 없음)' },
  en: { pos: 'Pos', rot: 'Rot', scl: 'Scl', reset: 'Reset', noSel: '(no selection)' },
  ja: { pos: '位置', rot: '回転', scl: 'スケール', reset: 'リセット', noSel: '(選択なし)' },
  zh: { pos: '位置', rot: '旋转', scl: '缩放', reset: '重置', noSel: '(未选择)' },
  es: { pos: 'Pos', rot: 'Rot', scl: 'Esc', reset: 'Restablecer', noSel: '(sin selección)' },
  ar: { pos: 'الموضع', rot: 'الدوران', scl: 'الحجم', reset: 'إعادة تعيين', noSel: '(لا يوجد تحديد)' },
};

interface TransformInputPanelProps {
  transformMatrix: number[] | null;          // 16-element column-major array (THREE.Matrix4.toArray())
  onMatrixChange: (matrix: number[]) => void;
  lang?: string;
}

interface XYZ { x: number; y: number; z: number }

const LABEL_COLORS = { x: '#ef4444', y: '#22c55e', z: '#3b82f6' } as const;

const inputStyle: React.CSSProperties = {
  background: '#0d1117',
  color: '#c9d1d9',
  border: '1px solid #30363d',
  borderRadius: 4,
  fontSize: 11,
  padding: '2px 6px',
  width: 56,
  textAlign: 'right',
  outline: 'none',
  fontFamily: 'monospace',
};

function AxisInput({
  axis, value, disabled, onChange,
}: {
  axis: 'x' | 'y' | 'z';
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const [localVal, setLocalVal] = useState(value.toFixed(2));

  useEffect(() => {
    setLocalVal(value.toFixed(2));
  }, [value]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <span style={{ color: LABEL_COLORS[axis], fontSize: 10, fontWeight: 800, fontFamily: 'monospace', width: 10, textAlign: 'center' }}>
        {axis.toUpperCase()}
      </span>
      <input
        type="number"
        step="0.1"
        value={localVal}
        disabled={disabled}
        style={{ ...inputStyle, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'text' }}
        onChange={e => setLocalVal(e.target.value)}
        onBlur={() => {
          const n = parseFloat(localVal);
          if (!isNaN(n)) onChange(n);
          else setLocalVal(value.toFixed(2));
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            const n = parseFloat(localVal);
            if (!isNaN(n)) onChange(n);
            else setLocalVal(value.toFixed(2));
          }
        }}
      />
    </div>
  );
}

function decomposeMatrix(arr: number[]): { pos: XYZ; rot: XYZ; scale: XYZ } {
  const m = new THREE.Matrix4().fromArray(arr);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  m.decompose(pos, quat, scl);
  const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
  const toDeg = (r: number) => r * (180 / Math.PI);
  return {
    pos: { x: pos.x, y: pos.y, z: pos.z },
    rot: { x: toDeg(euler.x), y: toDeg(euler.y), z: toDeg(euler.z) },
    scale: { x: scl.x, y: scl.y, z: scl.z },
  };
}

function composeMatrix(pos: XYZ, rot: XYZ, scale: XYZ): number[] {
  const toRad = (d: number) => d * (Math.PI / 180);
  const euler = new THREE.Euler(toRad(rot.x), toRad(rot.y), toRad(rot.z), 'XYZ');
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(pos.x, pos.y, pos.z),
    quat,
    new THREE.Vector3(scale.x, scale.y, scale.z),
  );
  return m.toArray();
}

export default function TransformInputPanel({ transformMatrix, onMatrixChange, lang = 'en' }: TransformInputPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  const disabled = transformMatrix === null;

  const [pos, setPos] = useState<XYZ>({ x: 0, y: 0, z: 0 });
  const [rot, setRot] = useState<XYZ>({ x: 0, y: 0, z: 0 });
  const [scale, setScale] = useState<XYZ>({ x: 1, y: 1, z: 1 });

  // Sync from props
  useEffect(() => {
    if (!transformMatrix) return;
    const decomposed = decomposeMatrix(transformMatrix);
    setPos(decomposed.pos);
    setRot(decomposed.rot);
    setScale(decomposed.scale);
  }, [transformMatrix]);

  const handleChange = useCallback((
    field: 'pos' | 'rot' | 'scale',
    axis: 'x' | 'y' | 'z',
    value: number,
  ) => {
    setPos(p => {
      const newPos = field === 'pos' ? { ...p, [axis]: value } : p;
      setRot(r => {
        const newRot = field === 'rot' ? { ...r, [axis]: value } : r;
        setScale(s => {
          const newScale = field === 'scale' ? { ...s, [axis]: value } : s;
          onMatrixChange(composeMatrix(newPos, newRot, newScale));
          return newScale;
        });
        return newRot;
      });
      return newPos;
    });
  }, [onMatrixChange]);

  const handleReset = useCallback(() => {
    const newPos = { x: 0, y: 0, z: 0 };
    const newRot = { x: 0, y: 0, z: 0 };
    const newScale = { x: 1, y: 1, z: 1 };
    setPos(newPos);
    setRot(newRot);
    setScale(newScale);
    onMatrixChange(composeMatrix(newPos, newRot, newScale));
  }, [onMatrixChange]);

  const rows: Array<{
    label: string;
    field: 'pos' | 'rot' | 'scale';
    unit: string;
    values: XYZ;
  }> = [
    { label: t.pos, field: 'pos', unit: 'mm', values: pos },
    { label: t.rot, field: 'rot', unit: '°', values: rot },
    { label: t.scl, field: 'scale', unit: '×', values: scale },
  ];

  return (
    <div style={{
      background: '#161b22',
      border: '1px solid #30363d',
      padding: 10,
      borderRadius: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      {disabled ? (
        <div style={{ color: '#484f58', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', padding: '4px 0' }}>
          {t.noSel}
        </div>
      ) : (
        <>
          {rows.map(({ label, field, unit, values }) => (
            <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 4, height: 22 }}>
              <span style={{ width: 50, color: '#6e7681', fontSize: 10, fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>
                {label}<span style={{ color: '#484f58', fontSize: 9, marginLeft: 2 }}>{unit}</span>
              </span>
              {(['x', 'y', 'z'] as const).map(axis => (
                <AxisInput
                  key={axis}
                  axis={axis}
                  value={values[axis]}
                  disabled={disabled}
                  onChange={v => handleChange(field, axis, v)}
                />
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
            <button
              onClick={handleReset}
              style={{
                padding: '2px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                border: '1px solid #30363d', background: '#21262d', color: '#8b949e',
                cursor: 'pointer', fontFamily: 'monospace', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; e.currentTarget.style.borderColor = '#8b949e'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.borderColor = '#30363d'; }}
            >
              {t.reset}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
