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

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
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
      max: 2,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'holeThrough' },
        { value: 1, labelKey: 'holeCounterbore' },
        { value: 2, labelKey: 'holeCountersink' },
      ],
    },
    { key: 'diameter', labelKey: 'paramHoleDiameter', default: 10, min: 1, max: 100, step: 0.5, unit: 'mm' },
    { key: 'posX', labelKey: 'paramHolePosX', default: 0, min: -200, max: 200, step: 1, unit: 'mm' },
    { key: 'posZ', labelKey: 'paramHolePosZ', default: 0, min: -200, max: 200, step: 1, unit: 'mm' },
    { key: 'depth', labelKey: 'paramHoleDepth', default: 999, min: 1, max: 500, step: 1, unit: 'mm' },
    { key: 'endCondition', labelKey: 'paramEndCondition', default: 1, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'endConditionBlind' },
        { value: 1, labelKey: 'endConditionThroughAll' },
        { value: 2, labelKey: 'endConditionUpToFace' },
      ] },
    { key: 'counterboreDia', labelKey: 'paramCounterboreDia', default: 18, min: 1, max: 150, step: 0.5, unit: 'mm' },
    { key: 'counterboreDepth', labelKey: 'paramCounterboreDepth', default: 5, min: 1, max: 50, step: 0.5, unit: 'mm' },
    { key: 'countersinkAngle', labelKey: 'paramCountersinkAngle', default: 90, min: 60, max: 120, step: 1, unit: '°' },
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
    const posX = Number.isFinite(params.posX) ? params.posX : 0;
    const posZ = Number.isFinite(params.posZ) ? params.posZ : 0;
    const depth = Number.isFinite(params.depth) ? params.depth : 999;

    // Compute bounding box once from the input geometry for accurate Y positioning
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const topY = bb.max.y;
    const bottomY = bb.min.y;
    const centerY = (topY + bottomY) / 2;

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
    let boreMinY: number;
    let boreMaxY: number;
    let resolvedUpToPlaneY: number | undefined;
    if (!Number.isFinite(params.endCondition)) {
      // Legacy sentinel path — unchanged.
      const legacyDepth = depth >= 999 ? (topY - bottomY) + 10 : depth;
      boreMinY = centerY - legacyDepth / 2;
      boreMaxY = centerY + legacyDepth / 2;
    } else {
      const ec = Math.min(2, Math.max(0, Math.round(params.endCondition)));
      if (ec === 0) { // blind from the top face
        if (!Number.isFinite(depth) || depth <= 0 || depth >= 999) {
          throw new Error('Blind hole rejected: depth must be a positive mm value below the 999 through sentinel (got ' + String(params.depth) + ')');
        }
        boreMinY = topY - depth;
        boreMaxY = topY + entryPad;
      } else if (ec === 2) { // up to face — plane from selection or a pre-resolved seed value
        const planeY = Number.isFinite(params.upToPlaneY)
          ? (assertPlaneOnBody(geometry, params.upToPlaneY), params.upToPlaneY)
          : resolveUpToFacePlaneY(geometry, ctx?.faceSelections);
        if (planeY >= topY - 1e-6) {
          throw new Error(`up_to_face rejected: target plane y=${planeY} is at/above the top face y=${topY} — derived depth would be ≤ 0`);
        }
        resolvedUpToPlaneY = planeY;
        boreMinY = planeY;
        boreMaxY = topY + entryPad;
      } else { // through_all
        boreMinY = bottomY - entryPad;
        boreMaxY = topY + entryPad;
      }
    }
    const actualDepth = boreMaxY - boreMinY;
    const boreCenterY = (boreMinY + boreMaxY) / 2;
    const engine = Math.round(params.engine ?? 0);

    // W5-D feature-unit pattern: numeric spec snapshot logged onto the output
    // so a downstream pattern in feature mode can re-drill this hole per
    // instance. up_to_face carries the RESOLVED plane (re-checked against the
    // body at re-apply time) so no face-selection object is needed.
    const patternSeedParams: Record<string, number> = {
      holeType,
      diameter: params.diameter,
      posX,
      posZ,
      depth,
      ...(Number.isFinite(params.endCondition)
        ? { endCondition: Math.min(2, Math.max(0, Math.round(params.endCondition))) }
        : {}),
      ...(resolvedUpToPlaneY != null ? { upToPlaneY: resolvedUpToPlaneY } : {}),
      ...(Number.isFinite(params.counterboreDia) ? { counterboreDia: params.counterboreDia } : {}),
      ...(Number.isFinite(params.counterboreDepth) ? { counterboreDepth: params.counterboreDepth } : {}),
      ...(Number.isFinite(params.countersinkAngle) ? { countersinkAngle: params.countersinkAngle } : {}),
      engine,
    };

    if (shouldUseOcctEngine(engine)) {
      try {
        // Fail-clean host contract — throws for a handle-less non-box body
        // (→ mesh CSG fallback below) instead of drilling its bounding box.
        let currentHandle = resolveBrepHostHandle(geometry);
        let currentGeo = geometry;
        const host = hostBoxFromGeometry(geometry);

        // Main hole
        const res1 = occtBoxBooleanWithPrimitive('subtract', host, { shape: 'cylinder', w: r * 2, h: actualDepth, d: r * 2, cx: posX, cy: boreCenterY, cz: posZ, rx: 0, ry: 0, rz: 0 }, undefined, currentHandle);
        currentHandle = res1.handle ?? currentHandle;
        currentGeo = res1.geometry;

        if (holeType === 1) { // Counterbore
          const cbR = params.counterboreDia / 2;
          const cbDepth = params.counterboreDepth;
          if (cbR > 0 && cbDepth > 0) { // skip a degenerate counterbore
            const res2 = occtBoxBooleanWithPrimitive('subtract', host, { shape: 'cylinder', w: cbR * 2, h: cbDepth, d: cbR * 2, cx: posX, cy: topY - cbDepth / 2, cz: posZ, rx: 0, ry: 0, rz: 0 }, undefined, currentHandle);
            currentHandle = res2.handle ?? currentHandle;
            currentGeo = res2.geometry;
          }
        }

        if (holeType === 2) { // Countersink — cut a cone (apex down) at the top.
          const csHalfAngle = (params.countersinkAngle * Math.PI) / 360;
          const csR = r * 2;
          // Guard tan() singularity (angle→0° or 180°): would give Infinity/NaN depth.
          const csTan = Math.tan(csHalfAngle);
          const csDepth = (Number.isFinite(csTan) && Math.abs(csTan) > 1e-6) ? csR / csTan : csR;
          const res2 = occtBoxBooleanWithPrimitive('subtract', host, { shape: 'cone', w: csR * 2, h: csDepth, d: csR * 2, cx: posX, cy: topY, cz: posZ, rx: 0, ry: 0, rz: 0 }, undefined, currentHandle);
          currentHandle = res2.handle ?? currentHandle;
          currentGeo = res2.geometry;
        }

        if (currentHandle) currentGeo.userData.occtHandle = currentHandle;
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
    const holeCyl = new THREE.CylinderGeometry(r, r, actualDepth, 32);
    holeCyl.translate(posX, boreCenterY, posZ);
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
    if (holeType === 1) {
      const cbR = params.counterboreDia / 2;
      const cbDepth = params.counterboreDepth;
      // Skip a degenerate counterbore (NaN/≤0 dia or depth) instead of cutting a
      // NaN cylinder — the main hole still applies.
      if (cbR > 0 && cbDepth > 0) {
        const cbCyl = new THREE.CylinderGeometry(cbR, cbR, cbDepth, 32);
        cbCyl.translate(posX, topY - cbDepth / 2, posZ);
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

    // Countersink: subtract a cone at the top face.
    if (holeType === 2) {
      const csHalfAngle = ((params.countersinkAngle) * Math.PI) / 360;
      const csR = r * 2;
      // Guard tan() singularity (angle→0° or 180°): would give Infinity/NaN depth.
      const csTan = Math.tan(csHalfAngle);
      const csDepth = (Number.isFinite(csTan) && Math.abs(csTan) > 1e-6) ? csR / csTan : csR;
      const cone = new THREE.ConeGeometry(csR, csDepth, 32);
      cone.rotateX(Math.PI);
      cone.translate(posX, topY, posZ);
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
