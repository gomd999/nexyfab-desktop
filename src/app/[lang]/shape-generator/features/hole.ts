import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import { occtBoxBooleanWithPrimitive, hostBoxFromGeometry, resolveBrepHostHandle } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';
import { stampFaceFeatureIdAll, propagateFeatureIdMap } from './faceProvenance';
import { configureEvaluatorAttributes } from './meshMerge';
import { resolveUpToFacePlaneY, assertPlaneOnBody } from './cut';
import { appendPatternSeed } from './patternHelpers/featureSeed';
import { requireValidBrepResult } from './kernelOperationQuality';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

/** Resolve the first material boundary below the entry face at the authored
 * X/Z position. This gives `up to next` a geometric result instead of silently
 * treating it as through-all. */
function resolveUpToNextPlaneY(
  geometry: THREE.BufferGeometry,
  posX: number,
  posZ: number,
  topY: number,
): number {
  const ray = new THREE.Raycaster(
    new THREE.Vector3(posX, topY + 1, posZ),
    new THREE.Vector3(0, -1, 0),
    0,
    Infinity,
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const intersections = ray.intersectObject(mesh, false)
    .map(hit => hit.point.y)
    .filter(y => y < topY - 1e-5)
    .sort((a, b) => b - a);
  mesh.material.dispose();
  const next = intersections.find((y, index) => index === 0 || Math.abs(y - intersections[index - 1]!) > 1e-5);
  if (next == null) throw new Error('up_to_next rejected: no material boundary was found below the selected position');
  return next;
}

export const holeFeature: FeatureDefinition = {
  type: 'hole',
  icon: '🕳️',
  params: [
    {
      key: 'holeType',
      labelKey: 'paramHoleType',
      default: 0,
      min: 0,
      max: 5,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'holeThrough' },
        { value: 1, labelKey: 'holeCounterbore' },
        { value: 2, labelKey: 'holeCountersink' },
        { value: 3, labelKey: 'holeCounterdrill' },
        { value: 4, labelKey: 'holeTap' },
        { value: 5, labelKey: 'holePipeTap' },
      ],
    },
    { key: 'diameter', labelKey: 'paramHoleDiameter', default: 10, min: 1, max: 100, step: 0.5, unit: 'mm' },
    // Drill axis: legacy/default Y (top face).  X/Z are supported for
    // through-all and blind cuts; the in-plane coordinates remain the world
    // coordinates supplied by posX/posY/posZ.
    { key: 'axis', labelKey: 'paramHoleAxis', default: 1, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'axisX' },
        { value: 1, labelKey: 'axisY' },
        { value: 2, labelKey: 'axisZ' },
      ] },
    { key: 'posX', labelKey: 'paramHolePosX', default: 0, min: -200, max: 200, step: 1, unit: 'mm' },
    { key: 'posY', labelKey: 'paramHolePosY', default: 0, min: -200, max: 200, step: 1, unit: 'mm' },
    { key: 'posZ', labelKey: 'paramHolePosZ', default: 0, min: -200, max: 200, step: 1, unit: 'mm' },
    { key: 'depth', labelKey: 'paramHoleDepth', default: 999, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'endCondition', labelKey: 'paramEndCondition', default: 1, min: 0, max: 3, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'endConditionBlind' },
        { value: 1, labelKey: 'endConditionThroughAll' },
        { value: 2, labelKey: 'endConditionUpToFace' },
        { value: 3, labelKey: 'endConditionUpToNext' },
      ] },
    { key: 'counterboreDia', labelKey: 'paramCounterboreDia', default: 18, min: 1, max: 150, step: 0.5, unit: 'mm' },
    { key: 'counterboreDepth', labelKey: 'paramCounterboreDepth', default: 5, min: 1, max: 50, step: 0.5, unit: 'mm' },
    { key: 'countersinkDia', labelKey: 'paramCountersinkDia', default: 20, min: 1, max: 150, step: 0.5, unit: 'mm' },
    { key: 'countersinkAngle', labelKey: 'paramCountersinkAngle', default: 90, min: 60, max: 120, step: 1, unit: '°' },
    { key: 'middleDiameter', labelKey: 'paramMiddleDiameter', default: 14, min: 1, max: 150, step: 0.5, unit: 'mm' },
    { key: 'middleDepth', labelKey: 'paramMiddleDepth', default: 8, min: 1, max: 100, step: 0.5, unit: 'mm' },
    { key: 'threadPitch', labelKey: 'paramThreadPitch', default: 1, min: 0.1, max: 10, step: 0.05, unit: 'mm' },
    { key: 'threadDepth', labelKey: 'paramThreadDepth', default: 10, min: 0.1, max: 500, step: 0.5, unit: 'mm' },
    { key: 'taperAngle', labelKey: 'paramTaperAngle', default: 1.7833, min: 0, max: 10, step: 0.01, unit: '°' },
    {
      key: 'engine',
      labelKey: 'paramBoolEngine',
      default: 1,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'enumEngineMeshCsg' },
        { value: 1, labelKey: 'enumEngineOcct' },
      ],
    },
  ],
  apply(geometry, params, ctx) {
    const holeType = Math.round(params.holeType);
    // Param guards: a non-finite/≤0 diameter makes a degenerate cylinder (NaN
    // coords → invalid solid). Throw a clear error (the pipeline isolates it and
    // keeps the prior geometry) rather than silently corrupting the part. Note:
    // a hole *bigger than the part* is a legitimate user error handled downstream
    // — we don't auto-shrink the bore here.
    if (!Number.isFinite(params.diameter) || params.diameter <= 0) {
      throw new Error('Hole diameter must be a positive number');
    }
    const r = params.diameter / 2;
    const axis = Math.min(2, Math.max(0, Math.round(Number.isFinite(params.axis) ? params.axis : 1)));
    const posX = Number.isFinite(params.posX) ? params.posX : 0;
    const posY = Number.isFinite(params.posY) ? params.posY : 0;
    const posZ = Number.isFinite(params.posZ) ? params.posZ : 0;
    const depth = Number.isFinite(params.depth) ? params.depth : 999;

    // Compute bounding box once from the input geometry for accurate Y positioning
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const mins = [bb.min.x, bb.min.y, bb.min.z];
    const maxs = [bb.max.x, bb.max.y, bb.max.z];
    const top = maxs[axis]!;
    const bottom = mins[axis]!;
    const center = (top + bottom) / 2;
    // The hole's two in-plane coordinates are always world coordinates.  The
    // unused axial coordinate is intentionally ignored for through/blind
    // holes, which keeps the legacy Y-axis contract intact while allowing a
    // mounting hole on an upright X/Z flange.
    const crossA = axis === 0 ? posY : posX;
    const crossB = axis === 1 ? posZ : posY;

    // W5-D end conditions. Legacy contract (no endCondition param — e.g. an old
    // saved project): depth >= 999 → through, otherwise a bore of `depth` mm
    // CENTERED at mid-body (judgment 260721: a 12 mm "blind" hole on a 20 mm box
    // removed exactly the centered-slab theory 936.43 mm³ with ZERO opening on
    // either face — an internal floating cavity). That legacy behavior is kept
    // bit-for-bit when the param is absent; the new enum gives real semantics:
    //   0 blind       → advances from the TOP face down by `depth`
    //   1 through_all → spans the whole bbox (default; equals legacy depth=999)
    //   2 up_to_face  → depth auto-derived to the selected horizontal face
    const entryPad = 5; // overshoot above the entry face so the boolean is clean
    let boreMin: number;
    let boreMax: number;
    let resolvedUpToPlaneY: number | undefined;
    if (!Number.isFinite(params.endCondition)) {
      // Legacy sentinel path — unchanged.
      const legacyDepth = depth >= 999 ? (top - bottom) + 10 : depth;
      boreMin = center - legacyDepth / 2;
      boreMax = center + legacyDepth / 2;
    } else {
      const ec = Math.min(3, Math.max(0, Math.round(params.endCondition)));
      if (ec === 0) { // blind from the top face
        if (!Number.isFinite(depth) || depth <= 0 || depth >= 999) {
          throw new Error('Blind hole rejected: depth must be a positive mm value below the 999 through sentinel (got ' + String(params.depth) + ')');
        }
        boreMin = top - depth;
        boreMax = top + entryPad;
      } else if (ec === 2) { // up to face — plane from selection or a pre-resolved seed value
        const planeY = Number.isFinite(params.upToPlaneY)
          ? (assertPlaneOnBody(geometry, params.upToPlaneY), params.upToPlaneY)
          : resolveUpToFacePlaneY(geometry, ctx?.faceSelections);
        if (axis !== 1) {
          throw new Error('up_to_face is currently supported only for the legacy Y drill axis; select through-all or blind for X/Z');
        }
        if (planeY >= top - 1e-6) {
          throw new Error(`up_to_face rejected: target plane y=${planeY} is at/above the top face y=${top} — derived depth would be ≤ 0`);
        }
        resolvedUpToPlaneY = planeY;
        boreMin = planeY;
        boreMax = top + entryPad;
      } else if (ec === 3) { // up to next material boundary at authored X/Z
        if (axis !== 1) {
          throw new Error('up_to_next is currently supported only for the legacy Y drill axis; select through-all or blind for X/Z');
        }
        const planeY = resolveUpToNextPlaneY(geometry, crossA, crossB, top);
        boreMin = planeY;
        boreMax = top + entryPad;
      } else { // through_all
        boreMin = bottom - entryPad;
        boreMax = top + entryPad;
      }
    }
    const actualDepth = boreMax - boreMin;
    const boreCenter = (boreMin + boreMax) / 2;
    const centerPoint = axis === 0
      ? { x: boreCenter, y: crossA, z: crossB }
      : axis === 1
        ? { x: crossA, y: boreCenter, z: crossB }
        : { x: crossA, y: crossB, z: boreCenter };
    // makeCylinder in occtEngine is +Y by default. These rotations map +Y to
    // the selected positive world axis and are shared by every tool step.
    const toolRotation = axis === 0
      ? { rx: 0, ry: 0, rz: -90 }
      : axis === 2
        ? { rx: 90, ry: 0, rz: 0 }
        : { rx: 0, ry: 0, rz: 0 };
    const engine = Math.round(params.engine ?? 0);

    // W5-D feature-unit pattern: numeric spec snapshot logged onto the output
    // so a downstream pattern in feature mode can re-drill this hole per
    // instance. up_to_face carries the RESOLVED plane (re-checked against the
    // body at re-apply time) so no face-selection object is needed.
    const patternSeedParams: Record<string, number> = {
      holeType,
      diameter: params.diameter,
      axis,
      posX,
      posY,
      posZ,
      depth,
      ...(Number.isFinite(params.endCondition)
        ? { endCondition: Math.min(3, Math.max(0, Math.round(params.endCondition))) }
        : {}),
      ...(resolvedUpToPlaneY != null ? { upToPlaneY: resolvedUpToPlaneY } : {}),
      ...(Number.isFinite(params.counterboreDia) ? { counterboreDia: params.counterboreDia } : {}),
      ...(Number.isFinite(params.counterboreDepth) ? { counterboreDepth: params.counterboreDepth } : {}),
      ...(Number.isFinite(params.countersinkDia) ? { countersinkDia: params.countersinkDia } : {}),
      ...(Number.isFinite(params.countersinkAngle) ? { countersinkAngle: params.countersinkAngle } : {}),
      ...(Number.isFinite(params.middleDiameter) ? { middleDiameter: params.middleDiameter } : {}),
      ...(Number.isFinite(params.middleDepth) ? { middleDepth: params.middleDepth } : {}),
      ...(Number.isFinite(params.threadPitch) ? { threadPitch: params.threadPitch } : {}),
      ...(Number.isFinite(params.threadDepth) ? { threadDepth: params.threadDepth } : {}),
      ...(Number.isFinite(params.taperAngle) ? { taperAngle: params.taperAngle } : {}),
      engine,
    };

    // A tapered pipe-tap needs a frustum tool; the current synchronous OCCT
    // primitive bridge only exposes cylinder/full cone, so keep that one case
    // on the deterministic mesh boolean instead of misrepresenting it.
    if (shouldUseOcctEngine(engine) && holeType !== 5) {
      try {
        // Fail-clean host contract — throws for a handle-less non-box body
        // (→ mesh CSG fallback below) instead of drilling its bounding box.
        let currentHandle = resolveBrepHostHandle(geometry);
        let currentGeo = geometry;
        const host = hostBoxFromGeometry(geometry);

        // Main hole
        const res1 = requireValidBrepResult(occtBoxBooleanWithPrimitive('subtract', host, { shape: 'cylinder', w: r * 2, h: actualDepth, d: r * 2, cx: centerPoint.x, cy: centerPoint.y, cz: centerPoint.z, ...toolRotation }, undefined, currentHandle));
        if (!res1.handle) throw new Error('OCCT hole cut did not return a chainable B-rep handle');
        currentHandle = res1.handle;
        currentGeo = res1.geometry;

        if (holeType === 1 || holeType === 3) { // Counterbore / counterdrill head step
          const cbR = params.counterboreDia / 2;
          const cbDepth = params.counterboreDepth;
          if (cbR > 0 && cbDepth > 0) { // skip a degenerate counterbore
            const cbCenter = axis === 0
              ? { x: top - cbDepth / 2, y: crossA, z: crossB }
              : axis === 1
                ? { x: crossA, y: top - cbDepth / 2, z: crossB }
                : { x: crossA, y: crossB, z: top - cbDepth / 2 };
            const res2 = requireValidBrepResult(occtBoxBooleanWithPrimitive('subtract', host, { shape: 'cylinder', w: cbR * 2, h: cbDepth, d: cbR * 2, cx: cbCenter.x, cy: cbCenter.y, cz: cbCenter.z, ...toolRotation }, undefined, currentHandle));
            if (!res2.handle) throw new Error('OCCT counterbore cut did not return a chainable B-rep handle');
            currentHandle = res2.handle;
            currentGeo = res2.geometry;
          }
        }

        if (holeType === 3) { // Counterdrill middle step
          const midR = params.middleDiameter / 2;
          const midDepth = params.middleDepth;
          if (midR > r && midDepth > 0) {
            const midCenter = axis === 0
              ? { x: top - midDepth / 2, y: crossA, z: crossB }
              : axis === 1
                ? { x: crossA, y: top - midDepth / 2, z: crossB }
                : { x: crossA, y: crossB, z: top - midDepth / 2 };
            const res2 = requireValidBrepResult(occtBoxBooleanWithPrimitive('subtract', host, { shape: 'cylinder', w: midR * 2, h: midDepth, d: midR * 2, cx: midCenter.x, cy: midCenter.y, cz: midCenter.z, ...toolRotation }, undefined, currentHandle));
            if (!res2.handle) throw new Error('OCCT counterdrill middle cut did not return a chainable B-rep handle');
            currentHandle = res2.handle;
            currentGeo = res2.geometry;
          }
        }

        if (holeType === 2) { // Countersink — cut a cone (apex down) at the top.
          const csHalfAngle = (params.countersinkAngle * Math.PI) / 360;
          const csR = Math.max(r, params.countersinkDia / 2);
          // Guard tan() singularity (angle→0° or 180°): would give Infinity/NaN depth.
          const csTan = Math.tan(csHalfAngle);
          const csDepth = (Number.isFinite(csTan) && Math.abs(csTan) > 1e-6) ? csR / csTan : csR;
          const csCenter = axis === 0
            ? { x: top, y: crossA, z: crossB }
            : axis === 1
              ? { x: crossA, y: top, z: crossB }
              : { x: crossA, y: crossB, z: top };
          const res2 = requireValidBrepResult(occtBoxBooleanWithPrimitive('subtract', host, { shape: 'cone', w: csR * 2, h: csDepth, d: csR * 2, cx: csCenter.x, cy: csCenter.y, cz: csCenter.z, ...toolRotation }, undefined, currentHandle));
          if (!res2.handle) throw new Error('OCCT countersink cut did not return a chainable B-rep handle');
          currentHandle = res2.handle;
          currentGeo = res2.geometry;
        }

        currentGeo.userData.occtHandle = currentHandle;
        appendPatternSeed(currentGeo, geometry, {
          featureId: ctx?.featureId ?? null,
          type: 'hole',
          params: patternSeedParams,
        });
        return currentGeo;
      } catch (err) {
        console.warn('[hole] OCCT path failed, falling back to three-bvh-csg:', err);
      }
    }

    const evaluator = new Evaluator();
    const brushA = makeBrush(geometry);

    // Main hole cylinder — centered on geometry's actual Y center.
    // B1 deep: tag the tool with this feature's id so the bore wall in the
    // result resolves back to "this hole" via getFaceFeatureId, not the
    // most-recently-touched feature.
    const taperRad = holeType === 5 && Number.isFinite(params.taperAngle)
      ? THREE.MathUtils.degToRad(Math.max(0, params.taperAngle))
      : 0;
    const taperDelta = Math.tan(taperRad) * actualDepth / 2;
    const topRadius = holeType === 5 ? Math.max(0.01, r + taperDelta) : r;
    const bottomRadius = holeType === 5 ? Math.max(0.01, r - taperDelta) : r;
    const holeCyl = new THREE.CylinderGeometry(topRadius, bottomRadius, actualDepth, 32);
    if (axis === 0) holeCyl.rotateZ(-Math.PI / 2);
    else if (axis === 2) holeCyl.rotateX(Math.PI / 2);
    holeCyl.translate(centerPoint.x, centerPoint.y, centerPoint.z);
    if (ctx?.featureId) {
      stampFaceFeatureIdAll(holeCyl, ctx.featureId, { avoidIdsFrom: geometry });
    }
    configureEvaluatorAttributes(evaluator, geometry, holeCyl);
    const brushB = makeBrush(holeCyl);
    let result = evaluator.evaluate(brushA, brushB, SUBTRACTION);
    propagateFeatureIdMap(result.geometry, geometry, holeCyl);

    // Counterbore: subtract a wider, shallower cylinder at the top face.
    // Tool reuses this feature's id (lookup hit on the map) so a numeric
    // collision can't happen even across the chained subtractions.
    if (holeType === 1 || holeType === 3) {
      const cbR = params.counterboreDia / 2;
      const cbDepth = params.counterboreDepth;
      // Skip a degenerate counterbore (NaN/≤0 dia or depth) instead of cutting a
      // NaN cylinder — the main hole still applies.
      if (cbR > 0 && cbDepth > 0) {
        const cbCyl = new THREE.CylinderGeometry(cbR, cbR, cbDepth, 32);
        if (axis === 0) cbCyl.rotateZ(-Math.PI / 2);
        else if (axis === 2) cbCyl.rotateX(Math.PI / 2);
        const cbCenter = axis === 0
          ? { x: top - cbDepth / 2, y: crossA, z: crossB }
          : axis === 1
            ? { x: crossA, y: top - cbDepth / 2, z: crossB }
            : { x: crossA, y: crossB, z: top - cbDepth / 2 };
        cbCyl.translate(cbCenter.x, cbCenter.y, cbCenter.z);
        if (ctx?.featureId) {
          stampFaceFeatureIdAll(cbCyl, ctx.featureId, { avoidIdsFrom: result.geometry });
        }
        configureEvaluatorAttributes(evaluator, result.geometry, cbCyl);
        const brushCB = makeBrush(cbCyl);
        const prev = result.geometry;
        result = evaluator.evaluate(result, brushCB, SUBTRACTION);
        propagateFeatureIdMap(result.geometry, prev, cbCyl);
      }
    }


    // Counterdrill: subtract the intermediate shoulder after the head pocket.
    if (holeType === 3) {
      const midR = params.middleDiameter / 2;
      const midDepth = params.middleDepth;
      if (midR > r && midDepth > 0) {
        const midCyl = new THREE.CylinderGeometry(midR, midR, midDepth, 32);
        if (axis === 0) midCyl.rotateZ(-Math.PI / 2);
        else if (axis === 2) midCyl.rotateX(Math.PI / 2);
        const midCenter = axis === 0
          ? { x: top - midDepth / 2, y: crossA, z: crossB }
          : axis === 1
            ? { x: crossA, y: top - midDepth / 2, z: crossB }
            : { x: crossA, y: crossB, z: top - midDepth / 2 };
        midCyl.translate(midCenter.x, midCenter.y, midCenter.z);
        if (ctx?.featureId) stampFaceFeatureIdAll(midCyl, ctx.featureId, { avoidIdsFrom: result.geometry });
        configureEvaluatorAttributes(evaluator, result.geometry, midCyl);
        const previous = result.geometry;
        result = evaluator.evaluate(result, makeBrush(midCyl), SUBTRACTION);
        propagateFeatureIdMap(result.geometry, previous, midCyl);
      }
    }

    // Countersink: subtract a cone at the top face.
    if (holeType === 2) {
      const csHalfAngle = ((params.countersinkAngle) * Math.PI) / 360;
      const csR = Math.max(r, params.countersinkDia / 2);
      // Guard tan() singularity (angle→0° or 180°): would give Infinity/NaN depth.
      const csTan = Math.tan(csHalfAngle);
      const csDepth = (Number.isFinite(csTan) && Math.abs(csTan) > 1e-6) ? csR / csTan : csR;
      const cone = new THREE.ConeGeometry(csR, csDepth, 32);
      cone.rotateX(Math.PI);
      if (axis === 0) cone.rotateZ(-Math.PI / 2);
      else if (axis === 2) cone.rotateX(Math.PI / 2);
      const csCenter = axis === 0
        ? { x: top, y: crossA, z: crossB }
        : axis === 1
          ? { x: crossA, y: top, z: crossB }
          : { x: crossA, y: crossB, z: top };
      cone.translate(csCenter.x, csCenter.y, csCenter.z);
      if (ctx?.featureId) {
        stampFaceFeatureIdAll(cone, ctx.featureId, { avoidIdsFrom: result.geometry });
      }
      configureEvaluatorAttributes(evaluator, result.geometry, cone);
      const brushCS = makeBrush(cone);
      const prev = result.geometry;
      result = evaluator.evaluate(result, brushCS, SUBTRACTION);
      propagateFeatureIdMap(result.geometry, prev, cone);
    }

    // Block a hole that swallows the whole part (e.g. a default-diameter hole on
    // a sub-millimetre solid) rather than returning a silent empty body.
    if (!result.geometry.attributes.position || result.geometry.attributes.position.count === 0) {
      throw new Error('Hole is larger than the part — it would remove all material; reduce the diameter or depth');
    }
    appendPatternSeed(result.geometry, geometry, {
      featureId: ctx?.featureId ?? null,
      type: 'hole',
      params: patternSeedParams,
    });
    return noteMeshFallback(result.geometry, { op: 'Hole', engine, featureId: ctx?.featureId });
  },
};
