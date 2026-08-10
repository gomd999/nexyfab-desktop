import { describe, expect, it } from 'vitest';
import {
  buildArchitectureDrawingSemanticGraph,
  architectureReconstructionUnifiedProject,
  reconstructArchitectureDrawing,
  type ArchitectureDrawingInput,
  type ArchitectureReconstructionRequirements,
  type AuthoritativeNumber,
} from './architectureDrawingReconstruction';

const authoritative = (value: number): AuthoritativeNumber => ({ value, authoritative: true, sourceRef: 'user-confirmed:test' });
const requirements: ArchitectureReconstructionRequirements = {
  storeyHeightMm: authoritative(3000), wallThicknessMm: authoritative(200), slabThicknessMm: authoritative(150),
  ceilingElevationMm: authoritative(2700), doorHeightMm: authoritative(2100), windowHeightMm: authoritative(1200),
  windowSillMm: authoritative(900), openingHostToleranceMm: authoritative(300), wallEvidenceToleranceMm: authoritative(300),
};

function validInput(): ArchitectureDrawingInput {
  return {
    drawingId: 'sheet-1', widthPx: 200, heightPx: 150, minimumConfidence: 0.8, reprojectionTolerancePx: 2,
    scale: { pixelDistance: 100, realDistanceMm: 10000, authoritative: true, sourceRef: 'dimension:10000' },
    annotations: [
      { id: 'space-a', track: 'SPA', category: '공간_거실', confidence: 0.99, sourceRef: 'spa.json', polygonPx: [[20, 20], [120, 20], [120, 100], [20, 100]] },
      { id: 'wall-top', track: 'STR', category: '구조_벽체', confidence: 0.99, sourceRef: 'str.json', bboxPx: [20, 18, 100, 4] },
      { id: 'wall-right', track: 'STR', category: '구조_벽체', confidence: 0.99, sourceRef: 'str.json', bboxPx: [118, 20, 4, 80] },
      { id: 'wall-bottom', track: 'STR', category: '구조_벽체', confidence: 0.99, sourceRef: 'str.json', bboxPx: [20, 98, 100, 4] },
      { id: 'wall-left', track: 'STR', category: '구조_벽체', confidence: 0.99, sourceRef: 'str.json', bboxPx: [18, 20, 4, 80] },
      { id: 'door-a', track: 'STR', category: '구조_출입문', confidence: 0.98, sourceRef: 'str.json', bboxPx: [60, 96, 12, 8] },
      { id: 'fixture-a', track: 'OBJ', category: '객체_싱크대', confidence: 0.96, sourceRef: 'obj.json', bboxPx: [30, 30, 10, 10] },
      { id: 'text-a', track: 'OCR', category: 'OCR', confidence: 0.95, sourceRef: 'ocr.json', bboxPx: [40, 40, 10, 5], text: '거실' },
    ],
  };
}

describe('architecture drawing reconstruction', () => {
  it('combines four tracks into a provenance-carrying semantic graph', () => {
    const graph = buildArchitectureDrawingSemanticGraph(validInput());
    expect(graph.gates.every(gate => gate.status === 'passed')).toBe(true);
    expect(graph.nodes).toHaveLength(8);
    expect(graph.relations).toEqual(expect.arrayContaining([
      { sourceId: 'fixture-a', targetId: 'space-a', kind: 'CONTAINS' },
      { sourceId: 'text-a', targetId: 'space-a', kind: 'CONTAINS' },
    ]));
  });

  it('requires authoritative scale instead of inventing dimensions', () => {
    const input = validInput(); delete input.scale;
    const result = reconstructArchitectureDrawing(input, requirements);
    expect(result.status).toBe('authoritative_input_required');
    expect(result.architecture).toBeNull();
    expect(result.gates.find(gate => gate.id === 'scale')?.status).toBe('not_run');
  });

  it('blocks quarantined audit inputs', () => {
    const input = validInput(); input.annotations[0]!.quarantined = true;
    const result = reconstructArchitectureDrawing(input, requirements);
    expect(result.status).toBe('blocked');
    expect(result.gates.find(gate => gate.id === 'quarantine')?.status).toBe('failed');
  });

  it('holds low-confidence nodes for review', () => {
    const input = validInput(); input.annotations[6]!.confidence = 0.5;
    const result = reconstructArchitectureDrawing(input, requirements);
    expect(result.status).toBe('review_required');
    expect(result.gates.find(gate => gate.id === 'confidence')?.status).toBe('not_run');
  });

  it('builds a validated architecture document and deterministic 3D solid plan', () => {
    const result = reconstructArchitectureDrawing(validInput(), requirements);
    expect(result.status).toBe('ready_for_exact_3d');
    expect(result.architecture).toMatchObject({ schema: 'nexyfab.architecture.v1' });
    expect(result.architecture?.walls).toHaveLength(4);
    expect(result.architecture?.openings).toHaveLength(1);
    expect(result.solidPlan?.walls).toHaveLength(4);
    expect(result.solidPlan?.cuts[0]?.cuts).toHaveLength(1);
    expect(result.reprojection?.maxErrorPx).toBeLessThanOrEqual(2);
    expect(result.gates.every(gate => gate.status === 'passed')).toBe(true);
    const canonical = architectureReconstructionUnifiedProject(result, 'project-1');
    expect(canonical.issues).toEqual([]);
    expect(canonical.project?.documents[0]?.semanticState?.status).toBe('deep_document_validated');
  });

  it('does not promote SPA-only outlines without STR wall evidence', () => {
    const input = validInput(); input.annotations = input.annotations.filter(annotation => annotation.category !== '구조_벽체');
    const result = reconstructArchitectureDrawing(input, requirements);
    expect(result.status).toBe('review_required');
    expect(result.solidPlan).toBeNull();
    expect(result.gates.find(gate => gate.id === 'wall-evidence')?.status).toBe('not_run');
  });

  it('rejects an opening that cannot be assigned to a host wall', () => {
    const input = validInput(); input.annotations.find(annotation => annotation.id === 'door-a')!.bboxPx = [160, 120, 10, 10];
    const result = reconstructArchitectureDrawing(input, { ...requirements, openingHostToleranceMm: authoritative(50) });
    expect(result.status).toBe('blocked');
    expect(result.gates.find(gate => gate.id === 'opening-host')?.status).toBe('failed');
  });
});
