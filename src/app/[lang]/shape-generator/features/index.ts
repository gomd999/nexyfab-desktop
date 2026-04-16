import * as THREE from 'three';
import type { FeatureDefinition, FeatureInstance, FeatureType } from './types';
import { runPipeline, runPipelineAsync, type PipelineResult, type PipelineOptions } from './pipelineManager';

// ─── Import actual feature implementations ───────────────────────────────────

import { filletFeature } from './fillet';
import { chamferFeature } from './chamfer';
import { shellFeature } from './shell';
import { holeFeature } from './hole';
import { linearPatternFeature } from './linearPattern';
import { circularPatternFeature } from './circularPattern';
import { mirrorFeature } from './mirror';
import { booleanFeature } from './boolean';
import { draftFeature } from './draft';
import { scaleFeature } from './scale';
import { moveCopyFeature } from './moveCopy';
import { splitBodyFeature } from './splitBody';
import { bendFeature, flangeFeature, flatPatternFeature } from './sheetMetal';
import { variableFilletFeature } from './variableFillet';
import { boundarySurfaceFeature } from './boundarySurface';
import { revolveFeature } from './revolve';
import { sweepFeature } from './sweep';
import { loftFeature } from './loft';
import { threadFeature } from './thread';
import { moldToolsFeature } from './moldTools';
import { weldmentFeature } from './weldment';

// ─── Registry ────────────────────────────────────────────────────────────────

export const FEATURE_DEFS: FeatureDefinition[] = [
  filletFeature,
  chamferFeature,
  shellFeature,
  holeFeature,
  linearPatternFeature,
  circularPatternFeature,
  mirrorFeature,
  booleanFeature,
  draftFeature,
  scaleFeature,
  moveCopyFeature,
  splitBodyFeature,
  bendFeature,
  flangeFeature,
  flatPatternFeature,
  variableFilletFeature,
  boundarySurfaceFeature,
  revolveFeature,
  sweepFeature,
  loftFeature,
  threadFeature,
  moldToolsFeature,
  weldmentFeature,
];

export const FEATURE_MAP: Record<FeatureType, FeatureDefinition> =
  Object.fromEntries(FEATURE_DEFS.map(d => [d.type, d])) as Record<FeatureType, FeatureDefinition>;

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export interface FeatureDiagnostic {
  code: 'empty' | 'nonManifold' | 'nan' | 'paramRange' | 'emptySketch' | 'unknown';
  message: string;
  hintKo: string;
  hintEn: string;
}

export function classifyFeatureError(
  featureType: FeatureType | 'sketchExtrude',
  rawMessage: string,
): FeatureDiagnostic {
  const msg = rawMessage.toLowerCase();

  if (msg.includes('empty') && (msg.includes('sketch') || featureType === 'sketchExtrude')) {
    return {
      code: 'emptySketch',
      message: rawMessage,
      hintKo: '스케치가 닫혀있는지 확인하세요. K 키로 프로파일을 닫을 수 있습니다.',
      hintEn: 'Check that the sketch profile is closed. Press K to close.',
    };
  }
  if (msg.includes('empty') || msg.includes('교차하지 않')) {
    return {
      code: 'empty',
      message: rawMessage,
      hintKo: '도구가 본체와 교차하도록 위치/크기를 조정하세요. 필렛/챔퍼는 반경이 너무 크면 실패합니다.',
      hintEn: 'Adjust tool position/size so it intersects the body. Fillets fail if radius is too large.',
    };
  }
  if (msg.includes('nan') || msg.includes('infinity')) {
    return {
      code: 'nan',
      message: rawMessage,
      hintKo: '메시에 유효하지 않은 정점이 있습니다. 이전 피처를 확인하세요.',
      hintEn: 'Mesh contains invalid vertices. Check upstream features.',
    };
  }
  if (msg.includes('non-manifold') || msg.includes('manifold')) {
    return {
      code: 'nonManifold',
      message: rawMessage,
      hintKo: 'Non-manifold 입력입니다. 이전 피처가 깨진 기하를 만들고 있는지 확인하세요.',
      hintEn: 'Non-manifold input. An upstream feature may be producing broken geometry.',
    };
  }
  if (msg.includes('radius') || msg.includes('thickness') || msg.includes('diameter')) {
    return {
      code: 'paramRange',
      message: rawMessage,
      hintKo: '파라미터 값을 줄여보세요 (예: 필렛 반경을 인접 엣지 길이의 절반 이하로).',
      hintEn: 'Reduce parameter value (e.g. fillet radius < half of adjacent edge).',
    };
  }
  return {
    code: 'unknown',
    message: rawMessage,
    hintKo: '피처를 일시 중지(Suppress)하거나 파라미터를 조정해 보세요.',
    hintEn: 'Try suppressing the feature or adjusting its parameters.',
  };
}

// ─── Pipeline executor ───────────────────────────────────────────────────────

export type { PipelineResult, PipelineOptions };

export function applyFeaturePipeline(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
): THREE.BufferGeometry {
  return applyFeaturePipelineDetailed(baseGeometry, features).geometry;
}

export function applyFeaturePipelineDetailedAsync(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  return runPipelineAsync(baseGeometry, features, FEATURE_MAP, opts);
}

export function applyFeaturePipelineDetailed(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
): PipelineResult {
  return runPipeline(baseGeometry, features, FEATURE_MAP);
}

// Re-export types
export type { FeatureDefinition, FeatureInstance, FeatureParam, FeatureType } from './types';
