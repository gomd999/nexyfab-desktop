import { useState } from 'react';
import type { EditMode } from '../editing/types';
import type { MeasureMode } from '../MeasureTool';
import type { UnitSystem } from '../units';

/**
 * 뷰포트 인터랙션 state (측정, 단면, 편집, 스냅, 단위계)를 관리합니다.
 * page.tsx에서 분리된 훅입니다.
 */
export function useViewportState() {
  const [showDimensions, setShowDimensions] = useState(false);
  const [measureActive, setMeasureActive] = useState(false);
  const [measureMode, setMeasureMode] = useState<MeasureMode>('distance');
  const [sectionActive, setSectionActive] = useState(false);
  const [sectionAxis, setSectionAxis] = useState<'x' | 'y' | 'z'>('y');
  const [sectionOffset, setSectionOffset] = useState(0.5);
  const [editMode, setEditMode] = useState<EditMode>('none');
  const [transformMode, setTransformMode] = useState<'off' | 'translate' | 'rotate' | 'scale'>('off');
  const [transformMatrix, setTransformMatrix] = useState<number[] | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapSize, setSnapSize] = useState(1);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('mm');

  return {
    showDimensions, setShowDimensions,
    measureActive, setMeasureActive,
    measureMode, setMeasureMode,
    sectionActive, setSectionActive,
    sectionAxis, setSectionAxis,
    sectionOffset, setSectionOffset,
    editMode, setEditMode,
    transformMode, setTransformMode,
    transformMatrix, setTransformMatrix,
    snapEnabled, setSnapEnabled,
    snapSize, setSnapSize,
    unitSystem, setUnitSystem,
  };
}
