import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume as _meshVolume, meshSurfaceArea } from './index';
import { buildSpurGearProfile, spurGearDimensions } from './gearProfile';

/**
 * Involute spur gear generator.
 * Creates a 2D involute tooth profile, extrudes it, and optionally cuts a bore hole.
 */

export const gearShape: ShapeConfig = {
  id: 'gear',
  tier: 2,
  icon: '⚙️',
  params: [
    { key: 'teeth',         labelKey: 'paramTeeth',         default: 24,   min: 8,    max: 120,  step: 1,   unit: '개' },
    { key: 'module',        labelKey: 'paramModule',        default: 2.0,  min: 0.5,  max: 10,   step: 0.5, unit: 'mm' },
    { key: 'width',         labelKey: 'paramWidth',         default: 15,   min: 3,    max: 100,  step: 1,   unit: 'mm' },
    { key: 'boreDiameter',  labelKey: 'paramBoreDiameter',  default: 10,   min: 0,    max: 80,   step: 1,   unit: 'mm' },
    { key: 'pressureAngle', labelKey: 'paramPressureAngle', default: 20,   min: 14.5, max: 25,   step: 0.5, unit: '°' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const teeth = Math.round(p.teeth);
    const mod = p.module;
    const width = p.width;
    const bore = p.boreDiameter;
    const profileParams = {
      teeth,
      module: mod,
      boreDiameter: bore,
      pressureAngle: p.pressureAngle,
    };
    const shape = buildSpurGearProfile(profileParams);
    const { addendumRadius: addendumR } = spurGearDimensions(profileParams);

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: width,
      bevelEnabled: false,
      steps: 1,
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center();
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);

    // Volume approximation: full annular area * tooth fill factor
    const boreR = bore > 0 ? bore / 2 : 0;
    const volume_mm3 = Math.PI * (addendumR ** 2 - boreR ** 2) * width * 0.85;
    const volume_cm3 = volume_mm3 / 1000;

    // Surface area from mesh
    const surface_area_cm2 = meshSurfaceArea(geometry) / 100;

    const bboxDia = Math.round(addendumR * 2);
    const bbox = { w: bboxDia, h: Math.round(width), d: bboxDia };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
