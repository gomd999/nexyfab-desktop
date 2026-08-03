/**
 * 단면 특성 — **임의 폴리곤의 폐형 계산**(Green 정리). PBAS 0.7.3 `section-properties` 이식.
 *
 * ## 왜 필요한가
 * 우리에게는 `structural.SECTIONS` 규격 단면표(SHS·H형강 등)만 있었다. 표에 없는 단면
 * (사용자 프로파일·`extrude_profile`·비대칭 형강)은 **계산할 방법이 없었다.**
 * 그리고 `inertiaTensor` 의 분포 근사도 여기에 얹으면 중공·박판에서 정확해진다.
 *
 * ## 무엇이 정확하고 무엇이 아닌가 — **결과에 적어서 낸다**
 * ```
 *   면적·도심·Ix·Iy·Ixy·주축      폐형(Green 정리)          — 다각형이면 정확
 *   비틀림상수 J  원형·원환        폐형(Saint-Venant)        — 정확
 *                 사각             Roark 근사               — 근사
 *                 폐단면(각관)      Bredt-Batho(등두께 박벽)  — 얇을수록 정확
 *                 개단면(H·ㄷ·ㄱ)   Σbt³/3                  — 얇을수록 정확
 *   전단중심·뒤틀림상수 ㄷ·ㄱ형      **없다**(null)           — 2D Saint-Venant 필요
 * ```
 * ⚠ **없는 것을 0 으로 내지 않는다.** ㄷ형강 전단중심을 0 으로 주면 비대칭 단면의 비틀림을
 *   대칭인 것처럼 계산하게 된다 — `null` 로 두고 `advancedStatus` 로 사유를 적는다.
 *
 * ⚠ 단위는 **입력을 따른다**(우리 어휘는 mm). 면적 mm²·관성 mm⁴·비틀림상수 mm⁴.
 */

const EPS = 1e-15;

const finite = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new TypeError(`${name} 는 유한값이어야 한다(받은 것: ${v})`);
  return n;
};
const positive = (v, name) => {
  const n = finite(v, name);
  if (!(n > 0)) throw new RangeError(`${name} 는 0 보다 커야 한다(받은 것: ${n})`);
  return n;
};

/** 폐곡선 하나의 Green 적분. 외곽=CCW, 구멍=CW 이면 부호가 알아서 상쇄된다. */
function loopIntegrals(loop) {
  if (!Array.isArray(loop) || loop.length < 3) throw new TypeError('단면 루프는 점 3개 이상이 필요하다');
  const pts = loop.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) throw new TypeError(`점 ${i} 은 [x,y] 여야 한다`);
    return [finite(p[0], `점[${i}].x`), finite(p[1], `점[${i}].y`)];
  });
  let a2 = 0, mx = 0, my = 0, ixO = 0, iyO = 0, ixyO = 0, peri = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    a2 += cross;
    mx += (x0 + x1) * cross;
    my += (y0 + y1) * cross;
    ixO += (y0 * y0 + y0 * y1 + y1 * y1) * cross;
    iyO += (x0 * x0 + x0 * x1 + x1 * x1) * cross;
    ixyO += (2 * x0 * y0 + x0 * y1 + x1 * y0 + 2 * x1 * y1) * cross;
    peri += Math.hypot(x1 - x0, y1 - y0);
  }
  return { area: a2 / 2, mx: mx / 6, my: my / 6, ixO: ixO / 12, iyO: iyO / 12, ixyO: ixyO / 24, peri };
}

/**
 * 폴리곤(구멍 포함) 단면 특성 — **폐형**.
 * @param {number[][]|number[][][]} loops 단일 루프 또는 [외곽, 구멍…]. 외곽=CCW·구멍=CW.
 */
export function polygonSection(loops) {
  const list = Array.isArray(loops?.[0]?.[0]) ? loops : [loops];
  const t = list.map(loopIntegrals).reduce((s, x) => ({
    area: s.area + x.area, mx: s.mx + x.mx, my: s.my + x.my,
    ixO: s.ixO + x.ixO, iyO: s.iyO + x.iyO, ixyO: s.ixyO + x.ixyO, peri: s.peri + x.peri,
  }), { area: 0, mx: 0, my: 0, ixO: 0, iyO: 0, ixyO: 0, peri: 0 });
  if (t.area <= EPS) {
    throw new RangeError('순 면적이 0 이하다 — 외곽은 CCW, 구멍은 CW 로 줘야 한다(방향이 뒤집혔을 수 있다)');
  }
  const cx = t.mx / t.area, cy = t.my / t.area;
  const ix = t.ixO - t.area * cy ** 2;
  const iy = t.iyO - t.area * cx ** 2;
  const ixy = t.ixyO - t.area * cx * cy;
  const avg = (ix + iy) / 2;
  const r = Math.hypot((ix - iy) / 2, ixy);
  return {
    method: '폐형(Green 정리)',
    area: t.area, centroid: [cx, cy], ix, iy, ixy,
    polar: ix + iy,
    principal: { iMax: avg + r, iMin: avg - r, angleRad: 0.5 * Math.atan2(-2 * ixy, iy - ix) },
    perimeter: t.peri, loops: list.length,
  };
}

const rectLoop = (b, h, cx = 0, cy = 0) => [
  [cx - b / 2, cy - h / 2], [cx + b / 2, cy - h / 2], [cx + b / 2, cy + h / 2], [cx - b / 2, cy + h / 2],
];

export function rectangleSection(width, height) {
  const b = positive(width, 'width'), h = positive(height, 'height');
  const lo = Math.max(b, h), sh = Math.min(b, h);
  return {
    ...polygonSection(rectLoop(b, h)), shape: 'rectangle',
    // Roark 근사 — 정사각에 가까울수록 오차가 작다. 폐형이 아니므로 방법을 적는다.
    torsionJ: lo * sh ** 3 * (1 / 3 - 0.21 * (sh / lo) * (1 - sh ** 4 / (12 * lo ** 4))),
    torsionMethod: 'Roark 사각 근사',
    shearCenter: [0, 0], warpingCw: null, advancedStatus: null,
  };
}

export function circleSection(radius) {
  const r = positive(radius, 'radius');
  const i = Math.PI * r ** 4 / 4;
  return {
    method: '폐형(해석)', shape: 'circle', area: Math.PI * r ** 2, centroid: [0, 0],
    ix: i, iy: i, ixy: 0, polar: 2 * i,
    torsionJ: 2 * i, torsionMethod: '폐형(Saint-Venant 원형)',
    principal: { iMax: i, iMin: i, angleRad: 0 }, perimeter: 2 * Math.PI * r,
    shearCenter: [0, 0], warpingCw: 0, advancedStatus: null,
  };
}

export function annulusSection(outerR, innerR) {
  const ro = positive(outerR, 'outerR');
  const ri = Math.max(0, finite(innerR, 'innerR'));
  if (!(ri < ro)) throw new RangeError('innerR 는 outerR 보다 작아야 한다');
  const i = Math.PI * (ro ** 4 - ri ** 4) / 4;
  return {
    method: '폐형(해석)', shape: 'annulus', area: Math.PI * (ro ** 2 - ri ** 2), centroid: [0, 0],
    ix: i, iy: i, ixy: 0, polar: 2 * i,
    torsionJ: 2 * i, torsionMethod: '폐형(Saint-Venant 원환)',
    principal: { iMax: i, iMin: i, angleRad: 0 }, perimeter: 2 * Math.PI * (ro + ri),
    shearCenter: [0, 0], warpingCw: 0, advancedStatus: null,
  };
}

export function rectTubeSection(width, height, thk) {
  const b = positive(width, 'width'), h = positive(height, 'height'), t = positive(thk, 'thk');
  if (2 * t >= Math.min(b, h)) throw new RangeError('두께가 커서 내부 공간이 없다');
  const res = polygonSection([rectLoop(b, h), [...rectLoop(b - 2 * t, h - 2 * t)].reverse()]);
  const bm = b - t, hm = h - t;
  return {
    ...res, shape: 'rect-tube',
    // Bredt-Batho: 폐단면 등두께 박벽. 두꺼우면 과대평가된다.
    torsionJ: 4 * (bm * hm) ** 2 * t / (2 * (bm + hm)),
    torsionMethod: 'Bredt-Batho(폐단면 등두께 박벽)',
    shearCenter: [0, 0], warpingCw: null, advancedStatus: null,
  };
}

export function iSection({ depth, flangeWidth, flangeThk, webThk }) {
  const d = positive(depth, 'depth'), bf = positive(flangeWidth, 'flangeWidth');
  const tf = positive(flangeThk, 'flangeThk'), tw = positive(webThk, 'webThk');
  if (2 * tf >= d || tw >= bf) throw new RangeError('H형강 치수가 성립하지 않는다');
  const x1 = -bf / 2, x2 = -tw / 2, x3 = tw / 2, x4 = bf / 2;
  const y0 = -d / 2, y1 = y0 + tf, y2 = d / 2 - tf, y3 = d / 2;
  const loop = [[x1, y0], [x4, y0], [x4, y1], [x3, y1], [x3, y2], [x4, y2], [x4, y3], [x1, y3], [x1, y2], [x2, y2], [x2, y1], [x1, y1]];
  return {
    ...polygonSection(loop), shape: 'I',
    torsionJ: (2 * bf * tf ** 3 + (d - 2 * tf) * tw ** 3) / 3,
    torsionMethod: '개단면 Σbt³/3(박벽)',
    // 이중대칭이라 전단중심 = 도심. 이건 **아는 값**이므로 null 이 아니다.
    shearCenter: [0, 0], warpingCw: null, advancedStatus: null,
  };
}

export function channelSection({ depth, flangeWidth, flangeThk, webThk }) {
  const d = positive(depth, 'depth'), bf = positive(flangeWidth, 'flangeWidth');
  const tf = positive(flangeThk, 'flangeThk'), tw = positive(webThk, 'webThk');
  if (2 * tf >= d || tw >= bf) throw new RangeError('ㄷ형강 치수가 성립하지 않는다');
  const y0 = -d / 2, y1 = y0 + tf, y2 = d / 2 - tf, y3 = d / 2;
  const loop = [[0, y0], [bf, y0], [bf, y1], [tw, y1], [tw, y2], [bf, y2], [bf, y3], [0, y3]];
  return {
    ...polygonSection(loop), shape: 'channel',
    torsionJ: (2 * bf * tf ** 3 + (d - 2 * tf) * tw ** 3) / 3,
    torsionMethod: '개단면 Σbt³/3(박벽)',
    /**
     * ⚠ **0 을 주지 않는다.** ㄷ형강은 전단중심이 도심 밖에 있어서, 0 으로 주면 비대칭 단면을
     *   대칭인 것처럼 계산하게 된다 — 편심 비틀림을 통째로 놓친다.
     */
    shearCenter: null, warpingCw: null,
    advancedStatus: '전단중심·뒤틀림상수는 2D Saint-Venant 또는 박벽 sectorial 해석이 필요하다(미구현)',
  };
}

export function angleSection({ legX, legY, thk }) {
  const bx = positive(legX, 'legX'), by = positive(legY, 'legY'), t = positive(thk, 'thk');
  if (t >= Math.min(bx, by)) throw new RangeError('ㄱ형강 치수가 성립하지 않는다');
  const loop = [[0, 0], [bx, 0], [bx, t], [t, t], [t, by], [0, by]];
  return {
    ...polygonSection(loop), shape: 'angle',
    torsionJ: (bx * t ** 3 + (by - t) * t ** 3) / 3,
    torsionMethod: '개단면 Σbt³/3(박벽)',
    shearCenter: null, warpingCw: null,
    advancedStatus: '전단중심·뒤틀림상수는 2D Saint-Venant 또는 박벽 sectorial 해석이 필요하다(미구현)',
  };
}

/**
 * ★우리 어휘 → 단면 특성. **표에 없는 단면도 계산된다**는 것이 이식의 요점이다.
 * @returns {object|null} 단면 개념이 없는 어휘는 null(억지로 만들지 않는다)
 */
export function sectionOfPart(type, p = {}) {
  switch (type) {
    case 'cylinder': return p.diameter > 0 ? circleSection(p.diameter / 2) : null;
    case 'tube': return p.outerDia > 0 && p.innerDia >= 0 ? annulusSection(p.outerDia / 2, p.innerDia / 2) : null;
    case 'rect_tube': return rectTubeSection(p.width, p.height, p.wallThk);
    case 'h_section': case 'i_girder':
      return iSection({ depth: p.H, flangeWidth: p.B, flangeThk: p.tf, webThk: p.tw });
    case 'c_channel': return channelSection({ depth: p.H, flangeWidth: p.B, flangeThk: p.tf, webThk: p.tw });
    case 'angle': return angleSection({ legX: p.legA, legY: p.legB, thk: p.thickness });
    case 'box': return rectangleSection(p.width, p.depth);
    case 'plate_with_holes': return rectangleSection(p.width, p.thickness);
    // 임의 프로파일 — 이식의 진짜 값어치가 여기다(표에 없는 단면).
    case 'extrude_profile': case 'revolve':
      return Array.isArray(p.profile) && p.profile.length >= 3 ? polygonSection(p.profile) : null;
    default: return null;
  }
}

/** 무엇이 나왔고 무엇이 안 나왔는지 — 값만 주면 「다 계산됐다」로 읽힌다. */
export function sectionCapability(r) {
  return {
    area: Number.isFinite(r?.area),
    inertia: [r?.ix, r?.iy, r?.ixy].every(Number.isFinite),
    torsion: Number.isFinite(r?.torsionJ),
    shearCenter: Array.isArray(r?.shearCenter),
    warping: Number.isFinite(r?.warpingCw),
    openSectionTorsionReady: Array.isArray(r?.shearCenter) && Number.isFinite(r?.warpingCw),
  };
}
