/**
 * i18n.test.ts — Wave 2 Phase 2 Track D4 ref-geom localisation smoke.
 *
 * Asserts the 6-lang dict pattern works as expected:
 *   - Every supported lang code returns a fully-populated dict
 *   - Unknown / undefined lang falls back to English
 *   - 'kr' and 'cn' alias to 'ko' / 'zh' (route segment normalisation)
 *   - The Korean dict carries the canonical CAD terminology
 *     ("기준 평면" / "기준 축" / "기준 점" / "좌표계" per KS B 0001)
 *   - Method-label helpers translate every method in each kind's catalogue
 *
 * No React. The dialog/tree integration is exercised by their own
 * component tests where added.
 */

import { describe, it, expect } from 'vitest';
import {
  pickRefGeomDict,
  planeMethodLabel,
  axisMethodLabel,
  pointMethodLabel,
  csysMethodLabel,
  errorCodeLabel,
  REF_GEOM_DICT_EN,
  REF_GEOM_DICT_KO,
} from '../i18n';
import type {
  AxisMethod,
  CsysMethod,
  PlaneMethod,
  PointMethod,
} from '../types';

describe('pickRefGeomDict (6-lang dict selector)', () => {
  it('returns the English dict when lang is undefined', () => {
    expect(pickRefGeomDict(undefined)).toBe(REF_GEOM_DICT_EN);
  });

  it('returns the English dict for unknown lang codes', () => {
    expect(pickRefGeomDict('xx')).toBe(REF_GEOM_DICT_EN);
  });

  it('returns each canonical lang for the 6 supported codes', () => {
    for (const code of ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const) {
      const d = pickRefGeomDict(code);
      expect(d.groupLabel).toBeTruthy();
      expect(d.insert).toBeTruthy();
      expect(d.cancel).toBeTruthy();
    }
  });

  it('aliases kr → ko and cn → zh', () => {
    expect(pickRefGeomDict('kr')).toBe(REF_GEOM_DICT_KO);
    expect(pickRefGeomDict('cn').groupLabel).toBe('参考几何');
  });
});

describe('Korean canonical strings (spec §13.4)', () => {
  it('top-level group label is "참조 형상"', () => {
    expect(REF_GEOM_DICT_KO.groupLabel).toBe('참조 형상');
  });

  it('kind labels follow the spec §13.4 canon', () => {
    expect(REF_GEOM_DICT_KO.kindPlane).toBe('참조 평면');
    expect(REF_GEOM_DICT_KO.kindAxis).toBe('참조 축');
    expect(REF_GEOM_DICT_KO.kindPoint).toBe('참조 점');
    expect(REF_GEOM_DICT_KO.kindCsys).toBe('좌표계');
  });

  it('plane methods follow the spec §13.4 list', () => {
    expect(REF_GEOM_DICT_KO.planeStandard).toBe('표준');
    expect(REF_GEOM_DICT_KO.planeOffset).toBe('오프셋');
    expect(REF_GEOM_DICT_KO.planeAngle).toBe('각도');
    expect(REF_GEOM_DICT_KO.planeThrough3Points).toBe('세 점');
    expect(REF_GEOM_DICT_KO.planeMidBetween).toBe('중간 평면');
    expect(REF_GEOM_DICT_KO.planeThroughLineAndPoint).toBe('선과 점');
    expect(REF_GEOM_DICT_KO.planeTangentToCylinder).toBe('원통 접면');
  });

  it('PlaneRef kind labels follow the project policy (참조/표준/면/직접 입력)', () => {
    expect(REF_GEOM_DICT_KO.planeRefStandard).toBe('표준');
    expect(REF_GEOM_DICT_KO.planeRefReference).toBe('참조');
    expect(REF_GEOM_DICT_KO.planeRefFace).toBe('면');
    expect(REF_GEOM_DICT_KO.planeRefInline).toBe('직접 입력');
  });

  it('dialog button labels are localised', () => {
    expect(REF_GEOM_DICT_KO.insert).toBe('삽입');
    expect(REF_GEOM_DICT_KO.cancel).toBe('취소');
    expect(REF_GEOM_DICT_KO.close).toBe('닫기');
  });
});

describe('Method-label helpers translate every method', () => {
  const planeMethods: readonly PlaneMethod[] = [
    'standard',
    'offset',
    'angle',
    'through3Points',
    'parallelThroughPoint',
    'midBetween',
    'throughLineAndPoint',
    'tangentToCylinder',
  ];

  const axisMethods: readonly AxisMethod[] = [
    'standard',
    'through2Points',
    'alongEdge',
    'twoPlaneIntersect',
    'normalToPlaneAtPoint',
    'cylinderConeAxis',
  ];

  const pointMethods: readonly PointMethod[] = [
    'byCoordinates',
    'vertex',
    'midOfEdge',
    'centerOfFace',
    'intersectLineAndPlane',
    'intersectThreePlanes',
    'projectPointOntoPlane',
  ];

  const csysMethods: readonly CsysMethod[] = [
    'world',
    'originAndTwoAxes',
    'originAndPlane',
    'byFaceVertex',
  ];

  it('plane methods all map to a non-empty Korean label', () => {
    for (const m of planeMethods) {
      const label = planeMethodLabel(REF_GEOM_DICT_KO, m);
      expect(label).toBeTruthy();
      expect(typeof label).toBe('string');
    }
  });

  it('axis methods all map to a non-empty Korean label', () => {
    for (const m of axisMethods) {
      const label = axisMethodLabel(REF_GEOM_DICT_KO, m);
      expect(label).toBeTruthy();
    }
  });

  it('point methods all map to a non-empty Korean label', () => {
    for (const m of pointMethods) {
      const label = pointMethodLabel(REF_GEOM_DICT_KO, m);
      expect(label).toBeTruthy();
    }
  });

  it('csys methods all map to a non-empty Korean label', () => {
    for (const m of csysMethods) {
      const label = csysMethodLabel(REF_GEOM_DICT_KO, m);
      expect(label).toBeTruthy();
    }
  });

  it('English labels match the existing UI (regression check)', () => {
    // These strings appear in the pre-W4 dialogs / dropdown; if any change
    // it could break a test or visual regression.
    expect(planeMethodLabel(REF_GEOM_DICT_EN, 'standard')).toBe('Standard');
    expect(planeMethodLabel(REF_GEOM_DICT_EN, 'offset')).toBe('Offset');
    expect(axisMethodLabel(REF_GEOM_DICT_EN, 'standard')).toBe('Standard');
    expect(csysMethodLabel(REF_GEOM_DICT_EN, 'world')).toBe('World');
    expect(REF_GEOM_DICT_EN.groupLabel).toBe('Reference geometry');
    expect(REF_GEOM_DICT_EN.dialogTitlePlane).toBe('New Reference Plane');
    expect(REF_GEOM_DICT_EN.insert).toBe('Insert');
    expect(REF_GEOM_DICT_EN.cancel).toBe('Cancel');
  });
});

describe('errorCodeLabel (spec §7.4)', () => {
  it('translates each error code', () => {
    expect(errorCodeLabel(REF_GEOM_DICT_KO, 'parent_missing')).toBe('상위 참조 누락');
    expect(errorCodeLabel(REF_GEOM_DICT_KO, 'cycle')).toBe('순환 의존');
    expect(errorCodeLabel(REF_GEOM_DICT_EN, 'degenerate')).toBe('Degenerate');
    expect(errorCodeLabel(REF_GEOM_DICT_EN, 'unsupported')).toBe('Unsupported');
  });
});
