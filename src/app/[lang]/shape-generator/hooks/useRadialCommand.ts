import { useCallback } from 'react';
import type { ShapeResult } from '../shapes';
import type { EditMode } from '../editing/types';

/**
 * Step 5.3 of the MainWorkspace decomposition plan.
 *
 * Encapsulates the radial-menu command handler so the canvas can dispatch
 * sketch/extrude/fillet/cancel commands without ShapeGeneratorInner.tsx
 * having to thread the 6+ state setters into the JSX.
 */
export type RadialCommand =
  | 'sketch_start'
  | 'sketch_finish'
  | 'cancel'
  | 'extrude'
  | 'sketch_line'
  | 'sketch_rect'
  | 'sketch_circle'
  | 'fillet';

export interface UseRadialCommandArgs {
  isSketchMode: boolean;
  setIsSketchMode: (value: boolean) => void;
  setSketchResult: (result: ShapeResult | null) => void;
  setEditMode: (mode: EditMode) => void;
  setSketchTool: (tool: 'line' | 'rect' | 'circle') => void;
  handleSketchGenerate: () => void;
}

export interface UseRadialCommandResult {
  // ShapePreview's prop type is `(cmd: string) => void` so we accept any
  // string and ignore commands we don't recognise. Inside the hook we
  // narrow to `RadialCommand` via the switch — unknown values fall through.
  onRadialCommand: (cmd: string) => void;
}

export function useRadialCommand(args: UseRadialCommandArgs): UseRadialCommandResult {
  const {
    isSketchMode,
    setIsSketchMode,
    setSketchResult,
    setEditMode,
    setSketchTool,
    handleSketchGenerate,
  } = args;

  const onRadialCommand = useCallback((cmd: string) => {
    switch (cmd as RadialCommand) {
      case 'sketch_start':
        setIsSketchMode(true);
        setSketchResult(null);
        setEditMode('none');
        return;
      case 'sketch_finish':
        handleSketchGenerate();
        return;
      case 'cancel':
        setIsSketchMode(false);
        setEditMode('none');
        return;
      case 'extrude':
        if (isSketchMode) {
          handleSketchGenerate();
        } else {
          setIsSketchMode(true);
          setSketchResult(null);
          setEditMode('none');
        }
        return;
      case 'sketch_line':
        setIsSketchMode(true);
        setSketchTool('line');
        return;
      case 'sketch_rect':
        setIsSketchMode(true);
        setSketchTool('rect');
        return;
      case 'sketch_circle':
        setIsSketchMode(true);
        setSketchTool('circle');
        return;
      case 'fillet':
        setEditMode('face');
        return;
    }
  }, [isSketchMode, setIsSketchMode, setSketchResult, setEditMode, setSketchTool, handleSketchGenerate]);

  return { onRadialCommand };
}
