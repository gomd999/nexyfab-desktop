// AUTO-GENERATED from scripts/engineering-core/core.mjs — eng-api 계산 카탈로그(10종).
// 재생성: node -e "..." (커밋 메시지/문서 참조). AI 의도추출 프롬프트에 주입.
export interface CalcParam { desc: string; type?: string; min?: number; max?: number; enum?: (string|number)[] }
export interface CalcSpec { id: string; domain: string; title: string; description: string; required: string[]; params: Record<string, CalcParam> }
export const CALC_CATALOG: CalcSpec[] = [
  {
    "id": "retaining_wall_stability",
    "domain": "civil",
    "title": "옹벽 안정 검토 (전도·활동·지지력)",
    "description": "Rankine 주동토압 기반 캔틸레버 옹벽 외적 안정 3종 검토. 전도 FS + 합력 편심(e≤B/6), 활동 FS, 지지력(사다리꼴 접지압). 수동토압 저항은 보수적으로 무시(옵션).",
    "required": [
      "H",
      "stemThickness",
      "baseWidth",
      "baseThickness",
      "toeLength",
      "gammaBackfill",
      "phiBackfill",
      "baseFriction",
      "allowableBearing"
    ],
    "params": {
      "H": {
        "desc": "벽 전체 높이(기초 저면~상단) m",
        "type": "number",
        "min": 0,
        "max": 12
      },
      "stemThickness": {
        "desc": "벽체(stem) 두께 m (등두께 가정)",
        "type": "number",
        "min": 0
      },
      "baseWidth": {
        "desc": "기초 폭 B, m",
        "type": "number",
        "min": 0
      },
      "baseThickness": {
        "desc": "기초 두께 m",
        "type": "number",
        "min": 0
      },
      "toeLength": {
        "desc": "앞굽(toe) 길이 m",
        "type": "number",
        "min": 0
      },
      "gammaConcrete": {
        "desc": "콘크리트 단위중량 kN/m³ (기본 24)",
        "type": "number",
        "min": 20,
        "max": 26
      },
      "gammaBackfill": {
        "desc": "뒤채움 단위중량 kN/m³",
        "type": "number",
        "min": 10,
        "max": 24
      },
      "phiBackfill": {
        "desc": "뒤채움 내부마찰각 °",
        "type": "number",
        "min": 15,
        "max": 45
      },
      "surcharge": {
        "desc": "상재하중 kPa (기본 0)",
        "type": "number",
        "min": 0
      },
      "baseFriction": {
        "desc": "저면 마찰계수 μ=tanδ",
        "type": "number",
        "min": 0,
        "max": 1
      },
      "allowableBearing": {
        "desc": "허용지지력 q_allow kPa",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "column_buckling",
    "domain": "temporary-structures/steel",
    "title": "압축재 좌굴 검토 (기둥·랙 포스트·동바리)",
    "description": "휨좌굴 한계상태의 압축강도 산정 및 소요축력 판정. LRFD(φPn)·ASD 병기. 세장비 게이트 KL/r ≤ 200.",
    "required": [
      "Fy",
      "Ag",
      "L",
      "r",
      "Pu"
    ],
    "params": {
      "Fy": {
        "desc": "항복강도 MPa",
        "type": "number",
        "min": 200,
        "max": 700
      },
      "E": {
        "desc": "탄성계수 MPa (기본: 표준값)",
        "type": "number",
        "min": 190000,
        "max": 215000
      },
      "Ag": {
        "desc": "총단면적 mm²",
        "type": "number",
        "min": 0
      },
      "L": {
        "desc": "비지지 길이 mm",
        "type": "number",
        "min": 0
      },
      "K": {
        "desc": "유효좌굴계수 (기본 1.0)",
        "type": "number",
        "min": 0.5,
        "max": 2.4
      },
      "r": {
        "desc": "단면회전반경 mm (약축)",
        "type": "number",
        "min": 0
      },
      "Pu": {
        "desc": "소요축력 kN (LRFD 계수하중)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "simple_beam",
    "domain": "steel/building",
    "title": "단순보 검토 (휨·전단·처짐)",
    "description": "단순지지 보, 등분포+중앙집중 하중. 콤팩트 단면·충분한 횡지지 가정(LTB 미검토 게이트 명시).",
    "required": [
      "L",
      "Fy",
      "Sx",
      "Aw",
      "Ix"
    ],
    "params": {
      "L": {
        "desc": "지간 mm",
        "type": "number",
        "min": 0,
        "max": 30000
      },
      "w": {
        "desc": "등분포하중 kN/m (기본 0)",
        "type": "number",
        "min": 0
      },
      "P": {
        "desc": "중앙 집중하중 kN (기본 0)",
        "type": "number",
        "min": 0
      },
      "Fy": {
        "desc": "항복강도 MPa",
        "type": "number",
        "min": 200,
        "max": 700
      },
      "E": {
        "desc": "탄성계수 MPa (기본: 표준값)",
        "type": "number",
        "min": 190000,
        "max": 215000
      },
      "Sx": {
        "desc": "단면계수 mm³",
        "type": "number",
        "min": 0
      },
      "Aw": {
        "desc": "웨브 전단면적 mm² (d×tw)",
        "type": "number",
        "min": 0
      },
      "Ix": {
        "desc": "단면2차모멘트 mm⁴",
        "type": "number",
        "min": 0
      },
      "deflectionLimit": {
        "desc": "처짐한계 분모 n (L/n), 기본: 표준값",
        "type": "number",
        "min": 100,
        "max": 1000
      }
    }
  },
  {
    "id": "bolt_connection",
    "domain": "steel/building",
    "title": "볼트접합 검토 (지압형: 전단·지압)",
    "description": "지압형(bearing-type) 볼트군의 설계강도. 마찰형(slip-critical)·인장·블록전단은 미포함(게이트 명시).",
    "required": [
      "boltGrade",
      "d",
      "nBolts",
      "tPlate",
      "Fu",
      "Vu"
    ],
    "params": {
      "boltGrade": {
        "desc": "볼트 등급-나사부 조건",
        "type": "string",
        "enum": [
          "A325-N",
          "A325-X",
          "A490-N",
          "F10T-N",
          "F10T-X",
          "F8T-N",
          "F8T-X",
          "F13T-N",
          "F13T-X",
          "4.6-N",
          "4.6-X"
        ]
      },
      "d": {
        "desc": "볼트 공칭지름 mm",
        "type": "number",
        "min": 12,
        "max": 36
      },
      "nBolts": {
        "desc": "볼트 개수",
        "type": "integer",
        "min": 1,
        "max": 100
      },
      "shearPlanes": {
        "desc": "전단면 수 (기본 1)",
        "type": "integer",
        "min": 1,
        "max": 2
      },
      "tPlate": {
        "desc": "지압 지배 판두께 mm (얇은 쪽)",
        "type": "number",
        "min": 0
      },
      "Fu": {
        "desc": "판재 인장강도 MPa",
        "type": "number",
        "min": 300,
        "max": 700
      },
      "Vu": {
        "desc": "소요전단력 kN (LRFD 계수하중, 볼트군 전체)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "rack_frame",
    "domain": "temporary-structures/rack",
    "title": "랙 프레임 검토 (해석+포스트 좌굴+빔 휨+횡변위)",
    "description": "2D 단일베이 랙 프레임: 직접강성법 해석으로 포스트 축력·횡변위 산출 후 포스트 좌굴(KDS 14 31 10)·빔 휨/처짐·횡변위(H/n) 판정. 커넥터 반강접·유공단면 미반영(시험성적서 병행 필수).",
    "required": [
      "bayWidth",
      "postHeight",
      "levels",
      "levelPitch",
      "loadPerLevel",
      "Fy",
      "post",
      "beam"
    ],
    "params": {
      "bayWidth": {
        "desc": "베이 폭 mm",
        "type": "number",
        "min": 500,
        "max": 5000
      },
      "postHeight": {
        "desc": "포스트 전체 높이 mm",
        "type": "number",
        "min": 1000,
        "max": 15000
      },
      "levels": {
        "desc": "적재단 수",
        "type": "integer",
        "min": 1,
        "max": 12
      },
      "levelPitch": {
        "desc": "단 간격 mm (균등)",
        "type": "number",
        "min": 300,
        "max": 3000
      },
      "loadPerLevel": {
        "desc": "단당 적재하중 kN (베이당)",
        "type": "number",
        "min": 0,
        "max": 100
      },
      "lateralLoadPct": {
        "desc": "수평하중 = 총 수직하중의 % (기본 2%)",
        "type": "number",
        "min": 0,
        "max": 10
      },
      "Fy": {
        "desc": "항복강도 MPa",
        "type": "number",
        "min": 200,
        "max": 700
      },
      "E": {
        "desc": "탄성계수 MPa (기본: 표준값)",
        "type": "number",
        "min": 190000,
        "max": 215000
      },
      "K": {
        "desc": "포스트 유효좌굴계수 (기본 1.0 — 반강접 클수록 증가)",
        "type": "number",
        "min": 0.5,
        "max": 2.4
      },
      "baseFixed": {
        "desc": "기초 고정단 여부 (기본 false=핀)",
        "type": "boolean"
      },
      "swayLimitDenominator": {
        "desc": "횡변위 한계 H/n (기본 200)",
        "type": "number",
        "min": 100,
        "max": 500
      },
      "post": {
        "desc": "포스트 단면 {A mm², I mm⁴, r mm(약축)}",
        "type": "object"
      },
      "beam": {
        "desc": "빔 단면 {A mm², Ix mm⁴, Sx mm³, Aw mm²}",
        "type": "object"
      }
    }
  },
  {
    "id": "rc_beam",
    "domain": "concrete/building",
    "title": "RC 보 검토 (휨·전단, 강도설계법)",
    "description": "직사각형 단철근 보. 변형률 적합 이분법 정해 + KDS 등가응력블록(η·β1 표 4.1-2). 압축철근·T형 플랜지·비틀림 미포함.",
    "required": [
      "b",
      "d",
      "fck",
      "fy",
      "As",
      "Mu"
    ],
    "params": {
      "b": {
        "desc": "단면 폭 bw, mm",
        "type": "number",
        "min": 0,
        "max": 3000
      },
      "d": {
        "desc": "유효깊이, mm",
        "type": "number",
        "min": 0,
        "max": 3000
      },
      "fck": {
        "desc": "콘크리트 설계기준압축강도 MPa",
        "type": "number",
        "min": 18,
        "max": 90
      },
      "fy": {
        "desc": "철근 설계기준항복강도 MPa",
        "type": "number",
        "min": 300,
        "max": 600
      },
      "As": {
        "desc": "인장철근 단면적 mm²",
        "type": "number",
        "min": 0
      },
      "Mu": {
        "desc": "계수휨모멘트 kN·m",
        "type": "number",
        "min": 0
      },
      "Vu": {
        "desc": "계수전단력 kN (0/생략=전단 검토 생략)",
        "type": "number",
        "min": 0
      },
      "Av": {
        "desc": "전단철근 단면적(간격 s 내 전 가닥) mm²",
        "type": "number",
        "min": 0
      },
      "s": {
        "desc": "전단철근 간격 mm",
        "type": "number",
        "min": 0
      },
      "fyt": {
        "desc": "전단철근 항복강도 MPa (기본 fy)",
        "type": "number",
        "min": 300,
        "max": 600
      },
      "lambda": {
        "desc": "경량콘크리트계수 λ (기본 1.0)",
        "type": "number",
        "min": 0.75,
        "max": 1
      }
    }
  },
  {
    "id": "landscape_drainage",
    "domain": "landscape/civil",
    "title": "조경 우수 배수 검토 (합리식 + Manning)",
    "description": "소유역 첨두유출량(합리식)과 원형 관거 만관 용량(Manning) 대조. 강우강도 i는 지역 IDF에서 입력.",
    "required": [
      "areaHa",
      "C",
      "i_mmhr"
    ],
    "params": {
      "areaHa": {
        "desc": "배수(집수)면적 ha — 합리식은 소유역용",
        "type": "number",
        "min": 0,
        "max": 500
      },
      "C": {
        "desc": "유출계수 (녹지 0.05~0.3, 포장 0.7~0.95)",
        "type": "number",
        "min": 0.05,
        "max": 0.95
      },
      "i_mmhr": {
        "desc": "설계 강우강도 mm/hr (지역 IDF·재현빈도에서)",
        "type": "number",
        "min": 0,
        "max": 300
      },
      "pipeDia_mm": {
        "desc": "관거 내경 mm (생략=유출량만 산정)",
        "type": "number",
        "min": 100,
        "max": 3000
      },
      "slope": {
        "desc": "관거 경사 m/m",
        "type": "number",
        "min": 0,
        "max": 0.5
      },
      "n": {
        "desc": "Manning 조도계수 (기본 0.013 콘크리트관)",
        "type": "number",
        "min": 0.009,
        "max": 0.05
      }
    }
  },
  {
    "id": "rc_column_pm",
    "domain": "concrete/building",
    "title": "RC 기둥 P-M 상관 검토 (1축 휨+축력)",
    "description": "직사각형 띠/나선 기둥, 2면 등배근. 하중 편심 경로에서 변형률 적합 이분법으로 (φPn,φMn) 정해 후 대조.",
    "required": [
      "b",
      "h",
      "fck",
      "fy",
      "Ast",
      "Pu",
      "Mu"
    ],
    "params": {
      "b": {
        "desc": "단면 폭 mm (휨축 직각)",
        "type": "number",
        "min": 0,
        "max": 3000
      },
      "h": {
        "desc": "단면 깊이 mm (휨 방향)",
        "type": "number",
        "min": 0,
        "max": 3000
      },
      "dPrime": {
        "desc": "연단~철근중심 거리 mm (기본 60)",
        "type": "number",
        "min": 30,
        "max": 200
      },
      "fck": {
        "desc": "콘크리트 강도 MPa",
        "type": "number",
        "min": 18,
        "max": 90
      },
      "fy": {
        "desc": "철근 항복강도 MPa",
        "type": "number",
        "min": 300,
        "max": 600
      },
      "Ast": {
        "desc": "축방향 주철근 총단면적 mm² (2면 균등 분할 가정)",
        "type": "number",
        "min": 0
      },
      "Pu": {
        "desc": "계수축력 kN (압축)",
        "type": "number",
        "min": 0
      },
      "Mu": {
        "desc": "계수휨모멘트 kN·m (장주효과 반영 후)",
        "type": "number",
        "min": 0
      },
      "transverse": {
        "desc": "횡철근 형식 (기본 tied)",
        "type": "string",
        "enum": [
          "tied",
          "spiral"
        ]
      }
    }
  },
  {
    "id": "isolated_footing",
    "domain": "concrete/building/civil",
    "title": "독립기초 검토 (지지력·뚫림전단·1방향 전단)",
    "description": "직사각형 독립기초 + 중심 축하중. 뚫림전단은 KDS 2021 신형 성능식(압축대 모델). 편심·모멘트 재하는 범위 외.",
    "required": [
      "B",
      "L",
      "t",
      "d",
      "cb",
      "cl",
      "Pu",
      "Pservice",
      "qAllow",
      "fck"
    ],
    "params": {
      "B": {
        "desc": "기초 폭 mm",
        "type": "number",
        "min": 0,
        "max": 10000
      },
      "L": {
        "desc": "기초 길이 mm",
        "type": "number",
        "min": 0,
        "max": 10000
      },
      "t": {
        "desc": "기초 두께 mm",
        "type": "number",
        "min": 0,
        "max": 2000
      },
      "d": {
        "desc": "유효깊이 mm (t−피복−철근)",
        "type": "number",
        "min": 0,
        "max": 2000
      },
      "cb": {
        "desc": "기둥 폭 mm (B 방향)",
        "type": "number",
        "min": 0
      },
      "cl": {
        "desc": "기둥 깊이 mm (L 방향)",
        "type": "number",
        "min": 0
      },
      "Pu": {
        "desc": "계수축하중 kN (전단 검토)",
        "type": "number",
        "min": 0
      },
      "Pservice": {
        "desc": "사용축하중 kN (지지력 검토)",
        "type": "number",
        "min": 0
      },
      "qAllow": {
        "desc": "허용지지력 kPa",
        "type": "number",
        "min": 0
      },
      "fck": {
        "desc": "콘크리트 강도 MPa",
        "type": "number",
        "min": 18,
        "max": 90
      },
      "rho": {
        "desc": "기초판 평균 주인장철근비 (기본 0.005 — 식 4.11-7 하한)",
        "type": "number",
        "min": 0.001,
        "max": 0.05
      },
      "columnPosition": {
        "desc": "기둥 위치 (αs: 1.0/1.33/2.0, 기본 interior)",
        "type": "string",
        "enum": [
          "interior",
          "edge",
          "corner"
        ]
      },
      "lambda": {
        "desc": "경량콘크리트계수 (기본 1.0)",
        "type": "number",
        "min": 0.75,
        "max": 1
      },
      "soilDepth": {
        "desc": "기초 상부 흙 두께 mm (기본 0)",
        "type": "number",
        "min": 0
      },
      "gammaSoil": {
        "desc": "흙 단위중량 kN/m³ (기본 18)",
        "type": "number",
        "min": 10,
        "max": 24
      }
    }
  },
  {
    "id": "occupancy_egress",
    "domain": "interior",
    "title": "수용인원·피난 검토 (재실자·유효폭·출구)",
    "description": "용도별 재실자 밀도로 수용인원 산정, 피난 유효폭·출구 수·문 유효폭을 대조. 밀도·폭계수는 용도/기준에서 입력.",
    "required": [
      "floorAreaM2",
      "occupantDensityM2"
    ],
    "params": {
      "floorAreaM2": {
        "desc": "바닥(재실)면적 m²",
        "type": "number",
        "min": 0,
        "max": 100000
      },
      "occupantDensityM2": {
        "desc": "인당 점유면적 m²/인 (집회밀집 0.5, 집회좌석 1.4, 판매 3.0, 업무 10 …)",
        "type": "number",
        "min": 0,
        "max": 20
      },
      "seatCount": {
        "desc": "실제 좌석 수 (있으면 재실자=max(밀도산정, 좌석))",
        "type": "number",
        "min": 0
      },
      "egressWidthProvidedMm": {
        "desc": "확보 피난 유효폭 합 mm (모든 출구)",
        "type": "number",
        "min": 0
      },
      "egressFactorMmPerOcc": {
        "desc": "재실자당 피난폭 mm/인 (기본 5.0 · 계단 7.6)",
        "type": "number",
        "min": 1,
        "max": 20
      },
      "exitCount": {
        "desc": "출구 수",
        "type": "number",
        "min": 1
      },
      "doorClearWidthMm": {
        "desc": "주 출입문 유효폭 mm (기본 최소 900)",
        "type": "number",
        "min": 0
      }
    }
  }
];
