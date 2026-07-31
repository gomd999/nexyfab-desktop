'use client';

/**
 * RoutingPanel.tsx — Edit cable / pipe / hose routes.
 *
 * Side panel that lists existing routes, lets the user pick one
 * to edit, and surfaces validation issues. Through-point editing
 * is delegated to the viewport (caller wires onPickInViewport).
 */

import React, { useMemo, useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import type { RoutingPath, RoutePoint, RoutingKind } from './routingPath';
import { validateBendRadius } from './routingValidate';

interface RoutingPanelProps {
  lang: string;
  routes: RoutingPath[];
  onRoutesChange: (routes: RoutingPath[]) => void;
  onClose?: () => void;
  /** When the user clicks "Add point", the viewport handles the
   *  3D pick and reports the chosen position back here. */
  onPickInViewport?: (callback: (point: [number, number, number]) => void) => void;
}

const COPY = {
  ko: {
    title: '라우팅',
    addRoute: '+ 새 경로',
    kind: '종류',
    diameter: '직경 (mm)',
    bendRadius: '벤드 반경',
    points: '경유점',
    addPoint: '+ 경유점 추가',
    delete: '삭제',
    cable: '케이블', pipe: '파이프', 'wire-bundle': '와이어 다발', hose: '호스',
    issues: '문제',
  },
  en: {
    title: 'Routing',
    addRoute: '+ New Route',
    kind: 'Kind',
    diameter: 'Diameter (mm)',
    bendRadius: 'Bend Radius',
    points: 'Through Points',
    addPoint: '+ Add Point',
    delete: 'Delete',
    cable: 'Cable', pipe: 'Pipe', 'wire-bundle': 'Wire Bundle', hose: 'Hose',
    issues: 'Issues',
  },
  ja: {
    title: 'ルーティング',
    addRoute: '+ 新規経路',
    kind: '種類',
    diameter: '直径 (mm)',
    bendRadius: 'ベンド半径',
    points: '経由点',
    addPoint: '+ 経由点を追加',
    delete: '削除',
    cable: 'ケーブル', pipe: 'パイプ', 'wire-bundle': 'ワイヤーハーネス', hose: 'ホース',
    issues: '問題',
  },
  zh: {
    title: '布线/布管',
    addRoute: '+ 新建路径',
    kind: '类型',
    diameter: '直径 (mm)',
    bendRadius: '弯曲半径',
    points: '途经点',
    addPoint: '+ 添加途经点',
    delete: '删除',
    cable: '电缆', pipe: '管道', 'wire-bundle': '线束', hose: '软管',
    issues: '问题',
  },
  es: {
    title: 'Enrutado',
    addRoute: '+ Nueva ruta',
    kind: 'Tipo',
    diameter: 'Diámetro (mm)',
    bendRadius: 'Radio de curvatura',
    points: 'Puntos de paso',
    addPoint: '+ Añadir punto',
    delete: 'Eliminar',
    cable: 'Cable', pipe: 'Tubería', 'wire-bundle': 'Mazo de cables', hose: 'Manguera',
    issues: 'Incidencias',
  },
  ar: {
    title: 'التوجيه',
    addRoute: '+ مسار جديد',
    kind: 'النوع',
    diameter: 'القطر (مم)',
    bendRadius: 'نصف قطر الثني',
    points: 'نقاط المرور',
    addPoint: '+ إضافة نقطة',
    delete: 'حذف',
    cable: 'كابل', pipe: 'أنبوب', 'wire-bundle': 'ضفيرة أسلاك', hose: 'خرطوم',
    issues: 'المشكلات',
  },
} as const;

export default function RoutingPanel({
  lang, routes, onRoutesChange, onClose, onPickInViewport,
}: RoutingPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;
  const [selectedId, setSelectedId] = useState<string | null>(routes[0]?.id ?? null);
  const selected = routes.find(r => r.id === selectedId) ?? null;

  const issues = useMemo(() => (selected ? validateBendRadius(selected) : []), [selected]);

  const addRoute = () => {
    const id = `route_${Date.now()}`;
    const newRoute: RoutingPath = {
      id, kind: 'cable', diameterMm: 5, defaultBendRadiusMm: 25,
      points: [{ position: [0, 0, 0] }],
    };
    onRoutesChange([...routes, newRoute]);
    setSelectedId(id);
  };

  const updateRoute = (patch: Partial<RoutingPath>) => {
    if (!selected) return;
    onRoutesChange(routes.map(r => r.id === selected.id ? { ...r, ...patch } : r));
  };

  const removeRoute = (id: string) => {
    onRoutesChange(routes.filter(r => r.id !== id));
    if (selectedId === id) setSelectedId(routes[0]?.id ?? null);
  };

  const addPoint = () => {
    if (!selected) return;
    if (!onPickInViewport) {
      updateRoute({
        points: [...selected.points, { position: [0, 0, 0] }],
      });
      return;
    }
    onPickInViewport((point) => {
      updateRoute({
        points: [...selected.points, { position: point }],
      });
    });
  };

  const updatePoint = (idx: number, patch: Partial<RoutePoint>) => {
    if (!selected) return;
    const pts = selected.points.slice();
    pts[idx] = { ...pts[idx]!, ...patch };
    updateRoute({ points: pts });
  };

  return (
    <div style={{
      // right: 336 clears the 320px right property pane (2026-06-12)
      position: 'fixed', top: 80, right: 340, zIndex: 700, width: 320,
      background: 'var(--nx-panel)', color: 'var(--nx-text)',
      borderRadius: 10, padding: '14px 16px',
      boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && (
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer' }}>✕</button>
        )}
      </div>

      <select
        value={selectedId ?? ''}
        onChange={e => setSelectedId(e.target.value)}
        style={{ width: '100%', marginBottom: 8, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 6, padding: '6px 8px', fontSize: 12 }}
      >
        {routes.length === 0 && <option>—</option>}
        {routes.map(r => <option key={r.id} value={r.id}>{r.id} ({r.kind})</option>)}
      </select>

      <button onClick={addRoute} style={primaryBtn()}>{t.addRoute}</button>

      {selected && (
        <div style={{ marginTop: 12, fontSize: 12 }}>
          <Row label={t.kind}>
            <select
              value={selected.kind}
              onChange={e => updateRoute({ kind: e.target.value as RoutingKind })}
              style={fieldStyle()}
            >
              {(['cable', 'pipe', 'wire-bundle', 'hose'] as const).map(k => (
                <option key={k} value={k}>{t[k as keyof typeof t]}</option>
              ))}
            </select>
          </Row>
          <Row label={t.diameter}>
            <input type="number" value={selected.diameterMm}
              onChange={e => updateRoute({ diameterMm: Number(e.target.value) })}
              style={fieldStyle()} />
          </Row>
          <Row label={t.bendRadius}>
            <input type="number" value={selected.defaultBendRadiusMm}
              onChange={e => updateRoute({ defaultBendRadiusMm: Number(e.target.value) })}
              style={fieldStyle()} />
          </Row>

          <div style={{ marginTop: 8, marginBottom: 4, fontSize: 10, color: 'var(--nx-text-2)' }}>
            {t.points} ({selected.points.length})
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 160, overflowY: 'auto' }}>
            {selected.points.map((p, i) => (
              <li key={i} style={{ fontSize: 10, color: 'var(--nx-text-2)', padding: '3px 0' }}>
                #{i + 1}: ({p.position[0].toFixed(1)}, {p.position[1].toFixed(1)}, {p.position[2].toFixed(1)})
              </li>
            ))}
          </ul>
          <button onClick={addPoint} style={{ ...primaryBtn(), marginTop: 6 }}>{t.addPoint}</button>

          {issues.length > 0 && (
            <div style={{ marginTop: 10, padding: 8, background: '#f59e0b22', border: '1px solid #f59e0b', borderRadius: 6, fontSize: 11 }}>
              <strong>{t.issues}: {issues.length}</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                {issues.slice(0, 3).map((iss, i) => <li key={i}>{iss.message}</li>)}
              </ul>
            </div>
          )}

          <button onClick={() => removeRoute(selected.id)} style={dangerBtn()}>{t.delete}</button>
        </div>
      )}
    </div>
  );
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
    <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{label}</span>
    <span style={{ flex: 1, marginLeft: 8 }}>{children}</span>
  </div>
);

function fieldStyle(): React.CSSProperties {
  return { width: '100%', background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '3px 6px', fontSize: 11 };
}
function primaryBtn(): React.CSSProperties {
  return { width: '100%', background: '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' };
}
function dangerBtn(): React.CSSProperties {
  return { width: '100%', marginTop: 10, background: 'transparent', color: '#f87171', border: '1px solid #ef4444', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer' };
}
