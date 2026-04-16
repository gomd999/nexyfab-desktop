'use client';

// Returns CSS cursor style based on the current active tool/mode

export function getToolCursor(
  isSketchMode: boolean,
  sketchTool: string | null,
  editMode: string,
  isDragging: boolean,
  measureActive: boolean,
): string {
  if (isDragging) return 'grabbing';
  if (measureActive) return 'crosshair';

  if (isSketchMode) {
    switch (sketchTool) {
      case 'line': return 'crosshair';
      case 'rect': return 'crosshair';
      case 'circle': return 'crosshair';
      case 'arc': return 'crosshair';
      case 'polygon': return 'crosshair';
      case 'spline': return 'crosshair';
      case 'trim': return 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' fill=\'none\' stroke=\'%23ff6b6b\' stroke-width=\'2\'%3E%3Cline x1=\'4\' y1=\'4\' x2=\'20\' y2=\'20\'/%3E%3Cline x1=\'10\' y1=\'4\' x2=\'20\' y2=\'14\'/%3E%3C/svg%3E") 12 12, crosshair';
      case 'offset': return 'copy';
      case 'mirror': return 'col-resize';
      case 'fillet': return 'cell';
      case 'chamfer': return 'cell';
      case 'dimension': return 'text';
      case 'constraint': return 'pointer';
      case 'select': return 'default';
      default: return 'crosshair';
    }
  }

  switch (editMode) {
    case 'vertex': return 'cell';
    case 'edge': return 'cell';
    case 'face': return 'cell';
    case 'translate': return 'move';
    case 'rotate': return 'alias';
    case 'scale': return 'nwse-resize';
    default: return 'default';
  }
}
