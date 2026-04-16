import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

/**
 * Roller-chain sprocket generator.
 * Creates a 2D tooth profile based on chain pitch and tooth count, then extrudes.
 */

export const sprocketShape: ShapeConfig = {
  id: 'sprocket',
  tier: 2,
  icon: '🔗',
  params: [
    { key: 'teeth',        labelKey: 'paramTeeth',        default: 18,   min: 8,    max: 60,   step: 1,    unit: '개' },
    { key: 'pitch',        labelKey: 'paramPitch',        default: 12.7, min: 6.35, max: 50.8, step: 6.35, unit: 'mm' },
    { key: 'width',        labelKey: 'paramWidth',        default: 8,    min: 3,    max: 50,   step: 1,    unit: 'mm' },
    { key: 'boreDiameter', labelKey: 'paramBoreDiameter', default: 15,   min: 0,    max: 80,   step: 1,    unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const teeth = Math.round(p.teeth);
    const pitch = p.pitch;
    const width = p.width;
    const bore = p.boreDiameter;

    const toothAngle = (2 * Math.PI) / teeth;
    const pitchR = pitch / (2 * Math.sin(Math.PI / teeth));
    const rollerDia = pitch * 0.625;
    const rollerR = rollerDia / 2;
    const tipR = pitchR + 0.3 * pitch;
    const rootR = pitchR - rollerR;

    const shape = new THREE.Shape();
    const stepsPerCurve = 6;

    // Build sprocket profile tooth by tooth
    // Each tooth: roller seat arc (concave) at root, then rise to tip, arc at tip, descend
    shape.moveTo(rootR * Math.cos(0 - toothAngle / 4), rootR * Math.sin(0 - toothAngle / 4));

    for (let t = 0; t < teeth; t++) {
      const centerAngle = t * toothAngle;
      const halfTooth = toothAngle / 2;

      // Roller seat center is on the pitch circle at centerAngle
      const seatCx = pitchR * Math.cos(centerAngle);
      const seatCy = pitchR * Math.sin(centerAngle);

      // Roller seat arc: concave arc of radius rollerR centered on pitch circle
      // Arc from root-left to root-right of this tooth
      const seatStartAngle = centerAngle + Math.PI + halfTooth * 0.6;
      const seatEndAngle = centerAngle + Math.PI - halfTooth * 0.6;
      for (let i = 0; i <= stepsPerCurve; i++) {
        const a = seatStartAngle + (seatEndAngle - seatStartAngle) * (i / stepsPerCurve);
        const x = seatCx + rollerR * Math.cos(a);
        const y = seatCy + rollerR * Math.sin(a);
        shape.lineTo(x, y);
      }

      // Rise to tooth tip
      const tipStartAngle = centerAngle + halfTooth * 0.25;
      const tipEndAngle = centerAngle + toothAngle - halfTooth * 0.25;

      // Tip arc: sweep from tipStartAngle to tipEndAngle (forward direction)
      for (let i = 0; i <= stepsPerCurve; i++) {
        const a = tipStartAngle + (tipEndAngle - tipStartAngle) * (i / stepsPerCurve);
        const x = tipR * Math.cos(a);
        const y = tipR * Math.sin(a);
        shape.lineTo(x, y);
      }
    }

    // Close the shape
    shape.closePath();

    // Bore hole
    if (bore > 0) {
      const boreR = bore / 2;
      const holePath = new THREE.Path();
      holePath.absarc(0, 0, boreR, 0, Math.PI * 2, true);
      shape.holes.push(holePath);
    }

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: width,
      bevelEnabled: false,
      steps: 1,
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center();
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);

    // Volume from mesh (most accurate for complex profile)
    const volume_cm3 = meshVolume(geometry) / 1000;

    // Surface area from mesh
    const surface_area_cm2 = meshSurfaceArea(geometry) / 100;

    const bboxDia = Math.round(tipR * 2);
    const bbox = { w: bboxDia, h: Math.round(width), d: bboxDia };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
