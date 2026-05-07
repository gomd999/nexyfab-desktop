import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

export const flangeShape: ShapeConfig = {
  id: 'flange',
  tier: 1,
  icon: '⚙️',
  params: [
    { key: 'outerDiameter', labelKey: 'paramOuterDiameter', default: 120, min: 10, max: 500, step: 1, unit: 'mm' },
    { key: 'boreDiameter',  labelKey: 'paramBoreDiameter',  default: 30,  min: 1,  max: 400, step: 1, unit: 'mm' },
    { key: 'thickness',     labelKey: 'paramThickness',     default: 15,  min: 1,  max: 100, step: 1, unit: 'mm' },
    { key: 'boltCount',     labelKey: 'paramBoltCount',     default: 6,   min: 0,  max: 24,  step: 1, unit: 'ea' },
    { key: 'boltDiameter',  labelKey: 'paramBoltDiameter',  default: 10,  min: 1,  max: 50,  step: 1, unit: 'mm' },
    { key: 'pcd',           labelKey: 'paramPCD',           default: 80,  min: 10, max: 480, step: 1, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const R = p.outerDiameter / 2;
    const r = p.boreDiameter / 2;
    const t = p.thickness;
    const boltCount = Math.round(p.boltCount);
    const boltR = p.boltDiameter / 2;
    const pcdR = p.pcd / 2;
    const segments = 48;
    const halfT = t / 2;

    // Main disc with bore hole — LatheGeometry with rectangular profile
    const mainProfile = [
      new THREE.Vector2(r,  halfT),   // inner top
      new THREE.Vector2(R,  halfT),   // outer top
      new THREE.Vector2(R, -halfT),   // outer bottom
      new THREE.Vector2(r, -halfT),   // inner bottom
    ];
    const mainGeo = new THREE.LatheGeometry(mainProfile, segments);

    // Bolt hole cylinders for visual representation
    const geoList: THREE.BufferGeometry[] = [mainGeo];

    if (boltCount > 0 && boltR > 0) {
      for (let i = 0; i < boltCount; i++) {
        const angle = (2 * Math.PI * i) / boltCount;
        const cx = Math.cos(angle) * pcdR;
        const cz = Math.sin(angle) * pcdR;
        const boltGeo = new THREE.CylinderGeometry(boltR, boltR, t + 0.2, 24);
        boltGeo.translate(cx, 0, cz);
        geoList.push(boltGeo);
      }
    }

    const geometry = geoList.length > 1
      ? mergeGeometries(geoList) ?? mainGeo
      : mainGeo;

    geometry.computeVertexNormals();
    const edgeGeometry = makeEdges(geometry);

    const PI = Math.PI;

    // Volume: annular disc minus bolt holes
    const discVolume = PI * (R * R - r * r) * t;
    const boltHoleVolume = boltCount * PI * boltR * boltR * t;
    const volume_cm3 = (discVolume - boltHoleVolume) / 1000;

    // Surface area: outer lateral + inner bore lateral + 2 annular faces
    // + bolt holes (each hole adds inner lateral and removes 2 circles from faces)
    const outerLateral = 2 * PI * R * t;
    const innerLateral = 2 * PI * r * t;
    const annularFaces = 2 * PI * (R * R - r * r);
    const boltHoleLateral = boltCount * 2 * PI * boltR * t;
    const boltHoleCircles = boltCount * 2 * PI * boltR * boltR;
    const surface_area_mm2 = outerLateral + innerLateral + annularFaces + boltHoleLateral - boltHoleCircles;
    const surface_area_cm2 = surface_area_mm2 / 100;

    const bboxW = Math.round(p.outerDiameter);
    const bbox = { w: bboxW, h: Math.round(t), d: bboxW };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
