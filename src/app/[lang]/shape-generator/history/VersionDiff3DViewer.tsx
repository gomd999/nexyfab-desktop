'use client';

/**
 * VersionDiff3DViewer
 * Shows two design versions overlaid in a Three.js canvas:
 *   - Version A (older) = semi-transparent blue
 *   - Version B (newer) = semi-transparent orange
 *   Overlapping regions show the "unchanged" volume visually.
 *   Also shows a side-by-side parameter/feature diff table.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DesignVersion } from './useVersionHistory';
import { buildShapeResult } from '../shapes';

const dict = {
  ko: {
    title: '버전 3D 비교', close: '닫기', noGeo: '형상 데이터 없음',
    oldLabel: '이전', newLabel: '새 버전',
    summary: '변경 요약', paramChanges: '파라미터 변경', noParamChanges: '파라미터 변경 없음',
    featureChanges: '피처 변경', parameters: '파라미터', param: '파라미터', features: '피처',
  },
  en: {
    title: '3D Version Diff', close: 'Close', noGeo: 'No geometry data',
    oldLabel: 'Old (A)', newLabel: 'New (B)',
    summary: 'Summary', paramChanges: 'param changes', noParamChanges: 'No param changes',
    featureChanges: 'feature changes', parameters: 'Parameters', param: 'Param', features: 'Features',
  },
  ja: {
    title: '3D バージョン差分', close: '閉じる', noGeo: '形状データなし',
    oldLabel: '旧 (A)', newLabel: '新 (B)',
    summary: '変更概要', paramChanges: 'パラメータ変更', noParamChanges: 'パラメータ変更なし',
    featureChanges: 'フィーチャー変更', parameters: 'パラメータ', param: 'パラメータ', features: 'フィーチャー',
  },
  zh: {
    title: '3D 版本对比', close: '关闭', noGeo: '无几何数据',
    oldLabel: '旧 (A)', newLabel: '新 (B)',
    summary: '变更概要', paramChanges: '参数变更', noParamChanges: '无参数变更',
    featureChanges: '特征变更', parameters: '参数', param: '参数', features: '特征',
  },
  es: {
    title: 'Comparación 3D de Versiones', close: 'Cerrar', noGeo: 'Sin datos de geometría',
    oldLabel: 'Antigua (A)', newLabel: 'Nueva (B)',
    summary: 'Resumen', paramChanges: 'cambios de parámetros', noParamChanges: 'Sin cambios',
    featureChanges: 'cambios de característica', parameters: 'Parámetros', param: 'Parám', features: 'Características',
  },
  ar: {
    title: 'مقارنة 3D للإصدارات', close: 'إغلاق', noGeo: 'لا توجد بيانات هندسية',
    oldLabel: 'قديم (A)', newLabel: 'جديد (B)',
    summary: 'الملخص', paramChanges: 'تغييرات المعلمة', noParamChanges: 'لا تغييرات في المعلمات',
    featureChanges: 'تغييرات الميزة', parameters: 'المعلمات', param: 'معلمة', features: 'الميزات',
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface VersionDiff3DViewerProps {
  versionA: DesignVersion; // older
  versionB: DesignVersion; // newer
  lang: string;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VersionDiff3DViewer({
  versionA,
  versionB,
  lang,
  onClose,
}: VersionDiff3DViewerProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  // Compute geometry for both versions
  const [geoA, geoB] = useMemo(() => {
    const rA = buildShapeResult(versionA.shapeId, versionA.params);
    const rB = buildShapeResult(versionB.shapeId, versionB.params);
    return [rA?.geometry ?? null, rB?.geometry ?? null];
  }, [versionA, versionB]);

  // Compute parameter diff
  const paramDiff = useMemo(() => {
    const rows: { key: string; valA: number | string; valB: number | string; changed: boolean }[] = [];
    const allKeys = new Set([...Object.keys(versionA.params), ...Object.keys(versionB.params)]);
    for (const key of allKeys) {
      const a = versionA.params[key];
      const b = versionB.params[key];
      rows.push({ key, valA: a ?? '—', valB: b ?? '—', changed: a !== b });
    }
    return rows.sort((r1, r2) => (r2.changed ? 1 : 0) - (r1.changed ? 1 : 0));
  }, [versionA, versionB]);

  // Compute feature diff
  const featureDiff = useMemo(() => {
    const aTypes = versionA.features.map(f => f.type);
    const bTypes = versionB.features.map(f => f.type);
    const all = [...new Set([...aTypes, ...bTypes])];
    return all.map(type => ({
      type,
      inA: aTypes.includes(type),
      inB: bTypes.includes(type),
    }));
  }, [versionA, versionB]);

  // Build Three.js scene
  useEffect(() => {
    if (!canvasRef.current || (!geoA && !geoB)) return;

    const container = canvasRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0d1117, 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 8, 5);
    scene.add(dirLight);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 2000);
    camera.position.set(0, 0, 5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const disposableGeometries: THREE.BufferGeometry[] = [];
    const disposableMaterials: THREE.Material[] = [];

    // ── Add mesh A (blue, older) ──────────────────────────────────────────────
    if (geoA) {
      const gClone = geoA.clone();
      disposableGeometries.push(gClone);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x388bfd,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      disposableMaterials.push(mat);
      const mesh = new THREE.Mesh(gClone, mat);
      scene.add(mesh);

      const edges = new THREE.EdgesGeometry(geoA, 15);
      disposableGeometries.push(edges);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x5aa8ff, opacity: 0.6, transparent: true });
      disposableMaterials.push(lineMat);
      scene.add(new THREE.LineSegments(edges, lineMat));
    }

    // ── Add mesh B (orange, newer) ────────────────────────────────────────────
    if (geoB) {
      const gClone = geoB.clone();
      disposableGeometries.push(gClone);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xf0883e,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      disposableMaterials.push(mat);
      const mesh = new THREE.Mesh(gClone, mat);
      scene.add(mesh);

      const edges = new THREE.EdgesGeometry(geoB, 15);
      disposableGeometries.push(edges);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffaa66, opacity: 0.6, transparent: true });
      disposableMaterials.push(lineMat);
      scene.add(new THREE.LineSegments(edges, lineMat));
    }

    // Fit camera to content
    const box = new THREE.Box3().setFromObject(scene);
    if (!box.isEmpty()) {
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      camera.position.copy(center).add(new THREE.Vector3(0, 0, maxDim * 1.6));
      controls.target.copy(center);
      controls.update();
    }

    let animId = 0;
    function animate() {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize observer
    const ro = new ResizeObserver(() => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      renderer.setSize(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      scene.clear();
      for (const g of disposableGeometries) g.dispose();
      for (const m of disposableMaterials) m.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [geoA, geoB]);

  const changedCount = paramDiff.filter(r => r.changed).length;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '90vw', maxWidth: 960,
        height: '85vh',
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 12,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: '1px solid #21262d', flexShrink: 0,
        }}>
          <span style={{ fontSize: 16 }}>🔄</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#e6edf3' }}>
              {t.title}
            </div>
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 1 }}>
              <span style={{ color: '#5aa8ff' }}>■ A</span>
              {' '}{versionA.label || versionA.autoLabel} ({formatTs(versionA.timestamp)})
              {' '}
              <span style={{ color: '#6e7681' }}>→</span>
              {' '}
              <span style={{ color: '#ffaa66' }}>■ B</span>
              {' '}{versionB.label || versionB.autoLabel} ({formatTs(versionB.timestamp)})
            </div>
          </div>
          <button onClick={onClose} style={{
            background: '#21262d', border: '1px solid #30363d',
            color: '#8b949e', borderRadius: 6, padding: '5px 10px',
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>
            {t.close}
          </button>
        </div>

        {/* Body: 3D canvas + diff table */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* 3D Canvas */}
          <div
            ref={canvasRef}
            style={{
              flex: '1 1 60%',
              position: 'relative',
              background: '#0d1117',
              minWidth: 0,
            }}
          >
            {!geoA && !geoB && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#6e7681', fontSize: 13,
              }}>
                {t.noGeo}
              </div>
            )}
            {/* Legend */}
            <div style={{
              position: 'absolute', bottom: 12, left: 12,
              display: 'flex', gap: 10, fontSize: 11,
              background: 'rgba(0,0,0,0.6)', padding: '5px 10px',
              borderRadius: 6, pointerEvents: 'none',
            }}>
              <span style={{ color: '#5aa8ff' }}>■ {t.oldLabel}</span>
              <span style={{ color: '#ffaa66' }}>■ {t.newLabel}</span>
            </div>
          </div>

          {/* Diff table */}
          <div style={{
            flex: '0 0 320px',
            borderLeft: '1px solid #21262d',
            overflowY: 'auto',
            padding: '12px 0',
            fontSize: 12,
          }}>
            {/* Summary */}
            <div style={{ padding: '0 14px 10px', borderBottom: '1px solid #21262d', marginBottom: 8 }}>
              <div style={{ color: '#8b949e', marginBottom: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t.summary}
              </div>
              <div style={{ color: changedCount > 0 ? '#f0883e' : '#3fb950', fontWeight: 700 }}>
                {changedCount > 0
                  ? `${changedCount} ${t.paramChanges}`
                  : t.noParamChanges
                }
              </div>
              {featureDiff.filter(f => !f.inA || !f.inB).length > 0 && (
                <div style={{ color: '#d29922', fontWeight: 600, marginTop: 2 }}>
                  {featureDiff.filter(f => !f.inA || !f.inB).length} {t.featureChanges}
                </div>
              )}
            </div>

            {/* Parameter diff */}
            {paramDiff.length > 0 && (
              <div>
                <div style={{ padding: '0 14px 4px', fontSize: 10, color: '#6e7681', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t.parameters}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: '#161b22', color: '#8b949e' }}>
                      <th style={{ textAlign: 'left', padding: '4px 14px', fontWeight: 600 }}>{t.param}</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, color: '#5aa8ff' }}>A</th>
                      <th style={{ textAlign: 'right', padding: '4px 14px', fontWeight: 600, color: '#ffaa66' }}>B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paramDiff.map(row => (
                      <tr key={row.key} style={{
                        borderBottom: '1px solid #161b22',
                        background: row.changed ? '#f0883e11' : 'transparent',
                      }}>
                        <td style={{ padding: '3px 14px', color: row.changed ? '#e6edf3' : '#8b949e', fontWeight: row.changed ? 600 : 400 }}>
                          {row.key}
                        </td>
                        <td style={{ padding: '3px 8px', textAlign: 'right', color: row.changed ? '#5aa8ff' : '#6e7681' }}>
                          {typeof row.valA === 'number' ? row.valA.toFixed(2) : row.valA}
                        </td>
                        <td style={{ padding: '3px 14px', textAlign: 'right', color: row.changed ? '#ffaa66' : '#6e7681', fontWeight: row.changed ? 700 : 400 }}>
                          {typeof row.valB === 'number' ? row.valB.toFixed(2) : row.valB}
                          {row.changed && typeof row.valA === 'number' && typeof row.valB === 'number' && (
                            <span style={{
                              marginLeft: 4, fontSize: 9,
                              color: (row.valB as number) > (row.valA as number) ? '#3fb950' : '#f85149',
                            }}>
                              {(row.valB as number) > (row.valA as number) ? '▲' : '▼'}
                              {Math.abs(((row.valB as number) - (row.valA as number))).toFixed(2)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Feature diff */}
            {featureDiff.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ padding: '0 14px 4px', fontSize: 10, color: '#6e7681', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t.features}
                </div>
                {featureDiff.map(f => (
                  <div key={f.type} style={{
                    padding: '3px 14px',
                    color: (!f.inA && f.inB) ? '#3fb950' : (f.inA && !f.inB) ? '#f85149' : '#8b949e',
                    fontSize: 11,
                  }}>
                    {!f.inA && f.inB ? '+ ' : f.inA && !f.inB ? '− ' : '  '}{f.type}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
