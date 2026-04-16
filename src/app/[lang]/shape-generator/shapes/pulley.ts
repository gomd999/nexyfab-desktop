import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

/**
 * V-belt pulley generator.
 * Creates a lathe profile with V-grooves (38-degree standard angle) and a central bore.
 */

export const pulleyShape: ShapeConfig = {
  id: 'pulley',
  tier: 2,
  icon: '🔄',
  params: [
    { key: 'outerDiameter', labelKey: 'paramOuterDiameter', default: 100, min: 20,  max: 500, step: 1, unit: 'mm' },
    { key: 'width',         labelKey: 'paramWidth',         default: 25,  min: 5,   max: 100, step: 1, unit: 'mm' },
    { key: 'boreDiameter',  labelKey: 'paramBoreDiameter',  default: 15,  min: 5,   max: 100, step: 1, unit: 'mm' },
    { key: 'grooveCount',   labelKey: 'paramGrooveCount',   default: 1,   min: 1,   max: 6,   step: 1, unit: '개' },
    { key: 'grooveDepth',   labelKey: 'paramGrooveDepth',   default: 8,   min: 2,   max: 30,  step: 1, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const outerR = p.outerDiameter / 2;
    const boreR = p.boreDiameter / 2;
    const width = p.width;
    const grooveCount = Math.round(p.grooveCount);
    const grooveDepth = p.grooveDepth;

    // V-belt standard groove angle: 38 degrees (half angle = 19 degrees)
    const halfAngle = (38 / 2) * Math.PI / 180; // 19 degrees
    const grooveTopWidth = 2 * grooveDepth * Math.tan(halfAngle);

    // Total groove zone width
    const grooveSpacing = grooveTopWidth * 1.3; // spacing between groove centers
    const totalGrooveZone = grooveCount > 1
      ? (grooveCount - 1) * grooveSpacing + grooveTopWidth
      : grooveTopWidth;

    // Rim width (flanges on either side)
    const rimWidth = Math.max((width - totalGrooveZone) / 2, 2);
    const halfW = width / 2;

    // Build lathe profile as Vector2 array (x = radius, y = axial position)
    // LatheGeometry rotates around Y axis, so x = distance from axis, y = height
    const points: THREE.Vector2[] = [];

    // Start at bore, bottom
    points.push(new THREE.Vector2(boreR, -halfW));

    // Bottom outer edge
    points.push(new THREE.Vector2(outerR, -halfW));

    // Walk along the outer surface top-to-bottom creating grooves
    const grooveStartY = -halfW + rimWidth;

    for (let g = 0; g < grooveCount; g++) {
      const grooveCenterY = grooveStartY + grooveTopWidth / 2 + g * grooveSpacing;
      const gTopLeft = grooveCenterY - grooveTopWidth / 2;
      const gTopRight = grooveCenterY + grooveTopWidth / 2;
      const grooveBottomR = outerR - grooveDepth;

      // Flat rim leading to groove
      points.push(new THREE.Vector2(outerR, gTopLeft));

      // V-groove: go down to bottom center, then back up
      points.push(new THREE.Vector2(grooveBottomR, grooveCenterY));

      // Back up to outer radius
      points.push(new THREE.Vector2(outerR, gTopRight));
    }

    // Top outer edge
    points.push(new THREE.Vector2(outerR, halfW));

    // Back to bore at top
    points.push(new THREE.Vector2(boreR, halfW));

    // Close at bore bottom (close the profile)
    points.push(new THREE.Vector2(boreR, -halfW));

    const segments = 48;
    const geometry = new THREE.LatheGeometry(points, segments);
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);

    // Volume and surface area from mesh for accuracy with grooves
    const volume_cm3 = meshVolume(geometry) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geometry) / 100;

    const bboxDia = Math.round(p.outerDiameter);
    const bbox = { w: bboxDia, h: Math.round(width), d: bboxDia };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
