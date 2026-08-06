/**
 * stepImport.orientation.test.ts — 면 방향·경계 선언을 **파일대로 읽는가** (260801g).
 *
 * ## 왜 필요한가
 * 코퍼스로만 확인한 개선은 **CI 에서 skip 된다**(참고 파일은 로컬 전용·재배포 불가).
 * skip 은 통과가 아니므로, 코퍼스 없이도 잡히는 합성 회귀를 함께 둔다.
 *
 * ## 무엇을 고정하는가
 *  ① `ADVANCED_FACE(..., .F.)` — sense 플래그가 `.F.` 면 면 법선은 곡면 법선의 **반대**다.
 *    무시하면 판재의 위·아래 캡이 둘 다 +Z 로 나와 두께를 정하지 못한다(실측: 코퍼스 3건).
 *  ② `FACE_OUTER_BOUND` 가 없고 `FACE_BOUND` **하나뿐**이면 그것이 외곽일 수밖에 없다.
 *  ③ 그런데 `FACE_BOUND` 가 **여럿**이면 고르지 않는다 — 면적 최대를 외곽으로 보는 관례가
 *    있지만 그건 추정이고, 틀리면 형상이 안팎으로 뒤집힌다. **거부가 정답이다.**
 */

import { describe, expect, it } from "vitest";
import {
  ARC_CHORD_TOL_MM,
  arcChordPoints,
  importStep,
  parseEntities,
} from "./stepImport";

/** 직육면체 판재 STEP — 캡·측면의 sense 플래그와 경계 엔티티명을 시험용으로 바꿀 수 있다. */
function makePlate(opts: {
  /** 아래 캡의 sense. `.F.` 가 실물 CAD 에서 흔한 형태다(PLANE 방향은 +Z 그대로). */
  bottomSense: "T" | "F";
  /** 경계 엔티티명 — `FACE_BOUND` 로 바꾸면 외곽 표시가 없는 파일이 된다. */
  boundName?: "FACE_OUTER_BOUND" | "FACE_BOUND";
  /** 위 캡에 **두 번째** `FACE_BOUND` 를 덧붙인다(어느 것이 외곽인지 모호해진다). */
  extraBoundOnTop?: boolean;
}): string {
  const W = 100,
    D = 60,
    H = 10;
  const lines: string[] = [];
  let id = 100;
  const emit = (s: string): number => {
    lines.push(`#${id}=${s};`);
    return id++;
  };
  const pt = (x: number, y: number, z: number): number =>
    emit(`CARTESIAN_POINT('',(${x}.,${y}.,${z}.))`);
  const dir = (x: number, y: number, z: number): number =>
    emit(`DIRECTION('',(${x}.,${y}.,${z}.))`);

  /** 평면 면 하나 — 정점 4개를 순서대로 잇는 닫힌 루프. */
  const face = (
    quad: Array<[number, number, number]>,
    normal: [number, number, number],
    refDir: [number, number, number],
    sense: "T" | "F",
    bound: string,
    extra = false,
  ): number => {
    const vs = quad.map((q) =>
      emit(`VERTEX_POINT('',#${pt(q[0], q[1], q[2])})`),
    );
    const oes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = quad[i]!,
        b = quad[(i + 1) % 4]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const d = dir(
        (b[0] - a[0]) / len,
        (b[1] - a[1]) / len,
        (b[2] - a[2]) / len,
      );
      const vec = emit(`VECTOR('',#${d},${len}.)`);
      const ln = emit(`LINE('',#${pt(a[0], a[1], a[2])},#${vec})`);
      const ec = emit(
        `EDGE_CURVE('',#${vs[i]},#${vs[(i + 1) % 4]},#${ln},.T.)`,
      );
      oes.push(emit(`ORIENTED_EDGE('',*,*,#${ec},.T.)`));
    }
    const loop = emit(`EDGE_LOOP('',(#${oes.join(",#")}))`);
    const bnd = emit(`${bound}('',#${loop},.T.)`);
    const org = pt(quad[0]![0], quad[0]![1], quad[0]![2]);
    const ax = emit(
      `AXIS2_PLACEMENT_3D('',#${org},#${dir(...normal)},#${dir(...refDir)})`,
    );
    const pl = emit(`PLANE('',#${ax})`);
    // 모호한 경우를 만들기 위한 두 번째 경계 — 같은 루프를 다시 가리킨다.
    const second = extra ? `,#${emit(`FACE_BOUND('',#${loop},.T.)`)}` : "";
    return emit(`ADVANCED_FACE('',(#${bnd}${second}),#${pl},.${sense}.)`);
  };

  const bn = opts.boundName ?? "FACE_OUTER_BOUND";
  const faces = [
    // 아래 캡 — PLANE 방향은 **+Z 그대로**, sense 로만 뒤집는다(실물 CAD 의 형태).
    face(
      [
        [0, 0, 0],
        [W, 0, 0],
        [W, D, 0],
        [0, D, 0],
      ],
      [0, 0, 1],
      [1, 0, 0],
      opts.bottomSense,
      bn,
    ),
    face(
      [
        [0, 0, H],
        [W, 0, H],
        [W, D, H],
        [0, D, H],
      ],
      [0, 0, 1],
      [1, 0, 0],
      "T",
      bn,
      opts.extraBoundOnTop,
    ),
    face(
      [
        [0, 0, 0],
        [W, 0, 0],
        [W, 0, H],
        [0, 0, H],
      ],
      [0, -1, 0],
      [1, 0, 0],
      "T",
      bn,
    ),
    face(
      [
        [0, D, 0],
        [W, D, 0],
        [W, D, H],
        [0, D, H],
      ],
      [0, 1, 0],
      [1, 0, 0],
      "T",
      bn,
    ),
    face(
      [
        [0, 0, 0],
        [0, D, 0],
        [0, D, H],
        [0, 0, H],
      ],
      [-1, 0, 0],
      [0, 1, 0],
      "T",
      bn,
    ),
    face(
      [
        [W, 0, 0],
        [W, D, 0],
        [W, D, H],
        [W, 0, H],
      ],
      [1, 0, 0],
      [0, 1, 0],
      "T",
      bn,
    ),
  ];
  const shell = emit(`CLOSED_SHELL('',(#${faces.join(",#")}))`);
  emit(`MANIFOLD_SOLID_BREP('',#${shell})`);
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION((''),'');",
    "FILE_NAME('t','',(''),(''),'','','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    "ENDSEC;",
    "DATA;",
    ...lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
  ].join("\n");
}

const bodies = (step: string): number => {
  const r = importStep(step) as unknown as { tree: { nodes: unknown[] } };
  return r.tree.nodes.length;
};

describe("면 방향 sense 플래그 (ADVANCED_FACE 4번째 인자)", () => {
  it("★`.F.` 로 뒤집힌 아래 캡을 읽어 판재를 임포트한다", () => {
    // PLANE 방향은 위·아래 모두 +Z 다. sense 를 읽지 않으면 캡이 둘 다 +Z 라 두께를 못 정한다.
    expect(bodies(makePlate({ bottomSense: "F" }))).toBeGreaterThan(0);
  });

  it("★캡 방향이 아니라 **치수**가 맞아야 한다 — 바디 수만 세면 뒤집힌 판도 통과한다", () => {
    const r = importStep(makePlate({ bottomSense: "F" })) as unknown as {
      tree: {
        nodes: Array<{
          payload: {
            kind: string;
            depth?: number;
            loop?: Array<{ x: number; y: number }>;
          };
        }>;
      };
    };
    const f = r.tree.nodes[0]!.payload;
    expect(f.kind).toBe("extrude");
    expect(f.depth).toBeCloseTo(10, 6);
    const xs = f.loop!.map((q) => q.x),
      ys = f.loop!.map((q) => q.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(60, 6);
  });

  it("양쪽이 `.T.` 여도 프리즘은 받는다 — 부호 없이도 두께가 확정되기 때문", () => {
    /**
     * ⚠ 처음 이 자리에 「받으면 안 된다」고 썼다가 **실측에서 틀렸다.** 평행한 평면 2장은
     *   법선 부호와 무관하게 외곽·두께를 정한다 — 지어내는 것이 없다.
     *   sense 플래그가 필요한 곳은 **판+원통 홀** 경로다(캡을 위·아래로 나눠야 한다).
     *   가정을 제품에 맞추지 않고, 제품이 실제로 하는 일을 적는다.
     */
    expect(bodies(makePlate({ bottomSense: "T" }))).toBeGreaterThan(0);
  });
});

describe("외곽 경계 선언 (FACE_OUTER_BOUND 부재)", () => {
  it("`FACE_BOUND` 가 하나뿐이면 그것이 외곽이다 — 유일한 해석이라 추정이 아니다", () => {
    expect(
      bodies(makePlate({ bottomSense: "F", boundName: "FACE_BOUND" })),
    ).toBeGreaterThan(0);
  });

  it("★`FACE_BOUND` 가 여럿이면 **거부한다** — 면적 최대를 외곽으로 보는 것은 추정이다", () => {
    const r = importStep(
      makePlate({
        bottomSense: "F",
        boundName: "FACE_BOUND",
        extraBoundOnTop: true,
      }),
    ) as unknown as {
      tree: { nodes: unknown[] };
      unsupported?: string[];
    };
    expect(r.tree.nodes.length).toBe(0);
    // 사유가 「무엇을 모르는지」를 말해야 다음에 무엇을 선언할지 알 수 있다.
    expect((r.unsupported ?? []).join(" ")).toMatch(
      /FACE_BOUND 2개|고를 수 없다/,
    );
  });
});

/**
 * 타원 현 분할 — **고지한 새그가 실제 편차를 덮는가** (260801g).
 *
 * ⚠ 처음 새그를 **작은 쪽 반축**으로 잡았다. 매개변수각을 균등 분할하면 최대 새그는
 *   `a·Δt²/8` 로 **큰 쪽 반축**이 지배하므로, 작은 쪽으로 잡으면 분할이 성기고 고지값이
 *   실제보다 작아진다 — **정확도 과고지**다. 근사는 허용하되 과고지는 결함이다.
 */
describe("타원 현 근사 (ELLIPSE)", () => {
  /** STEP 한 조각을 파싱해 `arcChordPoints` 가 쓰는 엔티티 맵을 만든다. */
  function ellipseChord(
    a: number,
    b: number,
  ): { points: Array<[number, number, number]>; sagittaMm: number } {
    const ents = parseEntities(
      [
        "#1=CARTESIAN_POINT('',(0.,0.,0.));",
        "#2=DIRECTION('',(0.,0.,1.));",
        "#3=DIRECTION('',(1.,0.,0.));",
        "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);",
        `#5=ELLIPSE('',#4,${a}.,${b}.);`,
      ].join(String.fromCharCode(10)),
    );
    // 시작·끝을 같은 점으로 주면 전 둘레를 돈다.
    const r = arcChordPoints(ents.get(5)!, [a, 0, 0], [a, 0, 0], ents);
    if (!r) throw new Error("타원 근사가 값을 내지 못했다");
    return r;
  }

  it("★고지한 새그가 실제 최대 편차보다 작지 않다 — 과고지 금지", () => {
    const A = 50,
      B = 30;
    const { points: mid, sagittaMm } = ellipseChord(A, B);
    /**
     * ⚠ 반환값은 **중간점만**이다 — 엣지 끝점은 호출측(루프 조립)이 넣는다.
     *   처음 이 사실을 빼고 닫았더니 마지막 현이 2구간을 건너뛰어 편차가 **4배**로 나왔고
     *   「과고지」라고 오판할 뻔했다. 끝점을 넣어 실제 루프와 같은 다각형으로 잰다.
     */
    const points: Array<[number, number, number]> = [[A, 0, 0], ...mid];
    // 실제 편차: 각 현에서 타원까지의 최대 거리를 조밀 샘플로 잰다.
    let worst = 0;
    for (let i = 0; i < points.length; i++) {
      const p0 = points[i]!,
        p1 = points[(i + 1) % points.length]!;
      const t0 = Math.atan2(p0[1] / B, p0[0] / A);
      let t1 = Math.atan2(p1[1] / B, p1[0] / A);
      if (t1 <= t0) t1 += 2 * Math.PI;
      for (let k = 1; k < 60; k++) {
        const t = t0 + ((t1 - t0) * k) / 60;
        const px = A * Math.cos(t),
          py = B * Math.sin(t);
        const dx = p1[0] - p0[0],
          dy = p1[1] - p0[1];
        const u = Math.max(
          0,
          Math.min(
            1,
            ((px - p0[0]) * dx + (py - p0[1]) * dy) / (dx * dx + dy * dy),
          ),
        );
        worst = Math.max(
          worst,
          Math.hypot(px - (p0[0] + u * dx), py - (p0[1] + u * dy)),
        );
      }
    }
    expect(worst).toBeLessThanOrEqual(sagittaMm + 1e-9);
    expect(sagittaMm).toBeLessThanOrEqual(ARC_CHORD_TOL_MM);
  });

  it("점이 실제로 타원 위에 있다 — 원(a=b) 공식을 타원에 그대로 쓰면 어긋난다", () => {
    const A = 50,
      B = 30;
    for (const [x, y] of ellipseChord(A, B).points) {
      expect((x / A) ** 2 + (y / B) ** 2).toBeCloseTo(1, 9);
    }
  });

  it("preserves analytic parameters and signed EDGE_CURVE direction", () => {
    const ents = parseEntities(
      [
        "#1=CARTESIAN_POINT('',(0.,0.,0.));",
        "#2=DIRECTION('',(0.,0.,1.));",
        "#3=DIRECTION('',(1.,0.,0.));",
        "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);",
        "#5=CIRCLE('',#4,10.);",
      ].join(String.fromCharCode(10)),
    );
    const positive = arcChordPoints(
      ents.get(5)!,
      [10, 0, 0],
      [0, 10, 0],
      ents,
      true,
    );
    const negative = arcChordPoints(
      ents.get(5)!,
      [10, 0, 0],
      [0, 10, 0],
      ents,
      false,
    );
    expect(positive?.analytic).toMatchObject({
      center: [0, 0, 0],
      radiusX: 10,
      radiusY: 10,
    });
    expect(positive?.analytic.sweepRad).toBeCloseTo(Math.PI / 2);
    expect(negative?.analytic.sweepRad).toBeCloseTo((-3 * Math.PI) / 2);
  });
});
