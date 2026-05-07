import { useMemo } from 'react';
import * as THREE from 'three';
import type { FeatureType } from '../features/types';
import type { ManufacturingProcess } from './dfmAnalysis';

export interface ProcessRecommendation {
  process: ManufacturingProcess;
  /** 0–100, relative confidence vs top-ranked process */
  confidence: number;
  reasons: string[];
  emoji: string;
}

export const PROCESS_LABELS: Record<ManufacturingProcess, { ko: string; en: string }> = {
  cnc_milling:       { ko: 'CNC 밀링',    en: 'CNC Milling' },
  cnc_turning:       { ko: 'CNC 선반',    en: 'CNC Turning' },
  injection_molding: { ko: '사출 성형',   en: 'Injection Molding' },
  sheet_metal:       { ko: '판금 가공',   en: 'Sheet Metal' },
  casting:           { ko: '주조',        en: 'Casting' },
  '3d_printing':     { ko: '3D 프린팅',  en: '3D Printing' },
};

export const PROCESS_EMOJIS: Record<ManufacturingProcess, string> = {
  cnc_milling:       '🏭',
  cnc_turning:       '🔩',
  injection_molding: '💉',
  sheet_metal:       '📄',
  casting:           '🫗',
  '3d_printing':     '🖨️',
};

/**
 * Heuristic process recommendation based on:
 * 1. Feature types used in the design
 * 2. Geometry properties (aspect ratio, volume, complexity)
 *
 * Returns all 6 processes sorted by confidence (highest first).
 * Accepts either FeatureInstance[] (from useFeatureStack) or any array
 * with a `.type: FeatureType` field.
 */
export function useProcessRecommendation(
  features: Array<{ type: FeatureType }>,
  geometry: THREE.BufferGeometry | null,
): ProcessRecommendation[] {
  return useMemo(() => {
    const scores: Record<ManufacturingProcess, number> = {
      cnc_milling: 50,
      cnc_turning: 25,
      injection_molding: 30,
      sheet_metal: 10,
      casting: 20,
      '3d_printing': 40,
    };
    const reasons: Record<ManufacturingProcess, string[]> = {
      cnc_milling: [],
      cnc_turning: [],
      injection_molding: [],
      sheet_metal: [],
      casting: [],
      '3d_printing': [],
    };

    const types = features.map(f => f.type) as string[];

    // ── Sheet metal signals ──
    if (types.some(t => ['bend', 'flange', 'flatPattern'].includes(t))) {
      scores.sheet_metal += 70;
      reasons.sheet_metal.push('bend / flange / flatPattern 피처 감지');
    }
    if (types.includes('weldment')) {
      scores.sheet_metal += 25;
      reasons.sheet_metal.push('용접 피처 → 판금 구조재');
    }

    // ── Injection molding / casting ──
    if (types.includes('moldTools')) {
      scores.injection_molding += 60;
      reasons.injection_molding.push('moldTools 피처 → 사출 설계 의도 명확');
    }
    if (types.includes('draft')) {
      scores.injection_molding += 35;
      scores.casting += 30;
      reasons.injection_molding.push('draft 피처 → 금형 이형각 적용');
      reasons.casting.push('draft 피처 → 주조 이형각');
    }
    if (types.includes('shell')) {
      scores.injection_molding += 30;
      reasons.injection_molding.push('shell 피처 → 균일 벽두께 (사출에 최적)');
    }

    // ── CNC turning: rotational symmetry ──
    if (types.includes('revolve')) {
      scores.cnc_turning += 65;
      reasons.cnc_turning.push('revolve 피처 → 회전 대칭 형상 (선반 최적)');
    }
    if (types.includes('thread')) {
      scores.cnc_milling += 20;
      scores.cnc_turning += 20;
      reasons.cnc_milling.push('thread 피처 → CNC 탭핑');
      reasons.cnc_turning.push('thread 피처 → 선반 나사');
    }

    // ── CNC milling: standard prismatic ──
    if (types.some(t => ['hole', 'sketchExtrude'].includes(t))) {
      scores.cnc_milling += 15;
      reasons.cnc_milling.push('hole / sketchExtrude 피처 → 밀링 가공');
    }

    // ── 3D printing: complex freeform ──
    if (types.some(t => ['loft', 'sweep', 'boundarySurface'].includes(t))) {
      scores['3d_printing'] += 40;
      reasons['3d_printing'].push('loft / sweep / 자유곡면 → AM 친화 형상');
      scores.cnc_milling -= 15;
    }
    if (types.includes('variableFillet')) {
      scores['3d_printing'] += 15;
      reasons['3d_printing'].push('variable fillet → 복잡한 전환 형상');
    }

    // ── Geometry-based heuristics ──
    if (geometry) {
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      if (bb) {
        const size = new THREE.Vector3().subVectors(bb.max, bb.min);
        const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
        const aspect = dims[2] / Math.max(dims[0], 0.1);
        const volMm3 = size.x * size.y * size.z;

        // High aspect ratio: strong turning signal
        if (aspect > 5 && dims[2] / Math.max(dims[1], 0.1) > 3) {
          scores.cnc_turning += 35;
          reasons.cnc_turning.push(`세장비 ${aspect.toFixed(1)}:1 → 선반 후보`);
        }

        // Thin flat part: sheet metal
        if (dims[0] < 5 && dims[1] > 20 && dims[2] > 20) {
          scores.sheet_metal += 30;
          reasons.sheet_metal.push('얇고 평평한 형상 → 판금 후보');
        }

        // Very large: casting advantage
        if (volMm3 > 500_000) {
          scores.casting += 25;
          reasons.casting.push('대형 부품 → 주조 비용 효율적');
          scores['3d_printing'] = Math.max(0, scores['3d_printing'] - 20);
          reasons['3d_printing'].push('대형 부품 → AM 생산성 낮음');
        }

        // Small part: 3D printing or injection molding
        if (volMm3 < 5_000) {
          scores['3d_printing'] += 15;
          scores.injection_molding += 10;
          reasons['3d_printing'].push('소형 부품 → AM 적합');
        }
      }
    }

    // ── Normalize & build result ──
    const processes = Object.keys(scores) as ManufacturingProcess[];
    const maxScore = Math.max(...processes.map(p => scores[p]), 1);

    return processes
      .map(p => ({
        process: p,
        confidence: Math.min(100, Math.max(0, Math.round((scores[p] / maxScore) * 100))),
        reasons: reasons[p],
        emoji: PROCESS_EMOJIS[p],
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }, [features, geometry]);
}
