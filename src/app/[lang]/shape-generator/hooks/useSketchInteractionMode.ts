'use client';

/**
 * useSketchInteractionMode — owns the sketch interaction enums: the active line
 * style (normal / construction / centerline) and the pick filter (all /
 * segments / points), plus the pick-filter cycle action and the reset that
 * fires when the user leaves sketch mode.
 *
 * The i18n hint string for the pick filter stays in the host (it depends on the
 * locale dictionary); everything else lifts cleanly out of the monolith.
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export type SketchLineStyle = 'normal' | 'construction' | 'centerline';
export type SketchPickFilter = 'all' | 'segments' | 'points';

export interface SketchInteractionMode {
  lineStyle: SketchLineStyle;
  setLineStyle: Dispatch<SetStateAction<SketchLineStyle>>;
  pickFilter: SketchPickFilter;
  setPickFilter: Dispatch<SetStateAction<SketchPickFilter>>;
  cyclePickFilter: () => void;
}

export function useSketchInteractionMode(isSketchMode: boolean): SketchInteractionMode {
  const [lineStyle, setLineStyle] = useState<SketchLineStyle>('normal');
  const [pickFilter, setPickFilter] = useState<SketchPickFilter>('all');

  const cyclePickFilter = useCallback(() => {
    setPickFilter(f => (f === 'all' ? 'segments' : f === 'segments' ? 'points' : 'all'));
  }, []);

  // Leaving sketch mode resets the pick filter to "all".
  useEffect(() => {
    if (!isSketchMode) setPickFilter('all');
  }, [isSketchMode]);

  return { lineStyle, setLineStyle, pickFilter, setPickFilter, cyclePickFilter };
}
