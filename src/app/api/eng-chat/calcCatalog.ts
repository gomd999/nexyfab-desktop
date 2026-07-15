// AUTO-GENERATED from scripts/engineering-core/core.mjs — eng-api 계산 카탈로그(58종).
// 재생성: node scripts/engineering-core/gen-calc-catalog.mjs. AI 의도추출 프롬프트에 주입.
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
        "desc": "뒤채움 내부마찰각 ° (개발강도 φd 입력 허용 — EM-2502 SMF 관례)",
        "type": "number",
        "min": 10,
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
      },
      "seismicKh": {
        "desc": "수평지진계수 kh (옵션 — >0이면 Mononobe-Okabe 지진시 검토 추가. 내진등급·지반에서 프로젝트가 결정)",
        "type": "number",
        "min": 0,
        "max": 0.5
      },
      "seismicKv": {
        "desc": "연직지진계수 kv (기본 0. 음수=상향 관례 소스도 있음 — 부호 그대로 (1−kv)에 반영)",
        "type": "number",
        "min": -0.5,
        "max": 0.5
      },
      "backfillSlopeDeg": {
        "desc": "뒤채움 경사 β° (기본 0 수평 — M-O 일반식용)",
        "type": "number",
        "min": 0,
        "max": 30
      },
      "wallFrictionDeg": {
        "desc": "벽마찰각 δ° (기본 0 보수측 — 지진시 수평성분 PAE·cosδ 적용, 연직 유리효과 무시)",
        "type": "number",
        "min": 0,
        "max": 30
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
      "lu_mm": {
        "desc": "비지지길이 mm (입력 시 장주 검토 §4.4 — 횡구속 가정)",
        "type": "number",
        "min": 0,
        "max": 12000
      },
      "kFactor": {
        "desc": "유효길이계수 k (횡구속 1.0 허용 — §4.4.6(5), 기본 1.0)",
        "type": "number",
        "min": 0.5,
        "max": 1
      },
      "M1_kNm": {
        "desc": "단부 작은 모멘트 M1 (단곡률 +, 이중곡률 −)",
        "type": "number",
        "min": -10000
      },
      "M2_kNm": {
        "desc": "단부 큰 모멘트 M2 (기본 Mu — 미입력 시 Mu 사용)",
        "type": "number",
        "min": 0
      },
      "betaDns": {
        "desc": "βdns = 지속축력/최대축력 (§4.4.6(4) — 하중조합에서 산정 입력, 기본 0.6 관례 명시)",
        "type": "number",
        "min": 0,
        "max": 1
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
  },
  {
    "id": "timber_beam",
    "domain": "timber/landscape/building",
    "title": "목재 휨부재 검토 (허용응력설계)",
    "description": "침엽수 육안등급구조재 장선·보의 휨·전단·처짐. 기준허용응력×하중기간계수(KDS 41 50 10).",
    "required": [
      "species",
      "grade",
      "b",
      "h",
      "L"
    ],
    "params": {
      "species": {
        "desc": "수종군(표 3.1-3): larch 낙엽송류/pine 소나무류/koreanpine 잣나무류/cedar 삼나무류",
        "type": "string",
        "enum": [
          "larch",
          "pine",
          "koreanpine",
          "cedar"
        ]
      },
      "grade": {
        "desc": "육안등급 (1·2·3등급)",
        "type": "number",
        "enum": [
          1,
          2,
          3
        ]
      },
      "b": {
        "desc": "단면 폭 mm",
        "type": "number",
        "min": 0,
        "max": 600
      },
      "h": {
        "desc": "단면 춤 mm",
        "type": "number",
        "min": 0,
        "max": 1200
      },
      "L": {
        "desc": "스팬 mm (단순지지)",
        "type": "number",
        "min": 0,
        "max": 12000
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
      "duration": {
        "desc": "지배 하중기간(표 3.1-7 — 조합 중 최단 기간, 기본 tenYears)",
        "type": "string",
        "enum": [
          "permanent",
          "tenYears",
          "twoMonths",
          "sevenDays",
          "tenMinutes",
          "impact"
        ]
      },
      "deflLimit": {
        "desc": "처짐 한계 분모 L/n (기본 240 — KDS 41 50 15 정성 규정, 관례값 명시)",
        "type": "number",
        "min": 100,
        "max": 500
      },
      "wetService": {
        "desc": "습윤 사용조건(옥외 데크·파고라 등) — 표 3.1-8 습윤계수 CM 적용 (기본 false=건조)",
        "type": "boolean"
      }
    }
  },
  {
    "id": "box_culvert_frame",
    "domain": "civil",
    "title": "박스 암거 강성라멘 단면력 (단일 셀)",
    "description": "처짐각법 정해로 우각부·중앙 모멘트와 전단력 산출. 이후 rc_beam으로 부재 검토 연계.",
    "required": [
      "innerWidth",
      "innerHeight",
      "wallThk",
      "cover",
      "gammaSoil",
      "K"
    ],
    "params": {
      "innerWidth": {
        "desc": "내폭 m",
        "type": "number",
        "min": 0,
        "max": 8
      },
      "innerHeight": {
        "desc": "내고 m",
        "type": "number",
        "min": 0,
        "max": 8
      },
      "wallThk": {
        "desc": "부재 두께 m (등두께)",
        "type": "number",
        "min": 0,
        "max": 1.5
      },
      "cover": {
        "desc": "토피고 m",
        "type": "number",
        "min": 0,
        "max": 20
      },
      "gammaSoil": {
        "desc": "흙 단위중량 kN/m³",
        "type": "number",
        "min": 10,
        "max": 24
      },
      "K": {
        "desc": "측방토압계수 (정지토압 K0=1−sinφ 등 — 프로젝트 결정, 입력)",
        "type": "number",
        "min": 0.2,
        "max": 1
      },
      "surcharge": {
        "desc": "등분포 상재하중 kPa (기본 0 — 윤하중 등가는 별도 산정 후 입력)",
        "type": "number",
        "min": 0
      },
      "gammaConcrete": {
        "desc": "콘크리트 단위중량 (기본 24)",
        "type": "number",
        "min": 20,
        "max": 26
      },
      "pTopOverride": {
        "desc": "벽 상단 측압 직접입력 kPa (별도 토압·수압 산정 결과 — 입력 시 K·γ 유도 대체, pBotOverride와 쌍)",
        "type": "number",
        "min": 0,
        "max": 500
      },
      "pBotOverride": {
        "desc": "벽 하단 측압 직접입력 kPa (pTopOverride와 쌍 필수)",
        "type": "number",
        "min": 0,
        "max": 800
      },
      "topThk": {
        "desc": "상판 두께 m (미입력 시 wallThk — 부재별 강성 반영)",
        "type": "number",
        "min": 0,
        "max": 1.5
      },
      "botThk": {
        "desc": "저판 두께 m (미입력 시 wallThk)",
        "type": "number",
        "min": 0,
        "max": 1.5
      },
      "surchargeV": {
        "desc": "연직 활하중 등가 등분포 kPa (상판 전용 — surcharge와 분리 입력 시 측압에 미반영)",
        "type": "number",
        "min": 0
      },
      "subgradeKs": {
        "desc": "연직 지반반력계수 Kv kN/m³ (입력 시 하판 Winkler 스프링 매트릭스 해석 — 도로교 계열 Kv=Kv0(Bv/0.3)^(-3/4), 국토부 2008 예: 17778.5)",
        "type": "number",
        "min": 1000,
        "max": 500000
      },
      "envelope": {
        "desc": "활하중 포락선 (국토부 2008 표 12-2 사용하중 3조합: ①전재하 ②연직활하중 제외 ③측압 0.5배) — 위치별 최대",
        "type": "boolean"
      },
      "EcMPa": {
        "desc": "콘크리트 탄성계수 MPa (스프링 모드 필수 상대강성 — 기본 8500∛(fck+4), fck=24 기준 25811)",
        "type": "number",
        "min": 15000,
        "max": 45000
      }
    }
  },
  {
    "id": "seismic_static",
    "domain": "building/seismic",
    "title": "등가정적 지진하중 (밑면전단·층별 분포)",
    "description": "KDS 41 17 00 등가정적해석법 — 유효지반가속도→설계스펙트럼→Cs→V→층별 Fx.",
    "required": [
      "R",
      "weightsKN",
      "heightsM"
    ],
    "params": {
      "zone": {
        "desc": "지진구역 (I=0.11·II=0.07, KDS 17 10 00 표 4.2-2). S 직접 입력 시 생략 가능",
        "type": "string",
        "enum": [
          "I",
          "II"
        ]
      },
      "S": {
        "desc": "유효지반가속도 직접 입력 (기본: Z×2.0(2400년))",
        "type": "number",
        "min": 0.05,
        "max": 0.5
      },
      "siteClass": {
        "desc": "지반종류 (기본 S4)",
        "type": "string",
        "enum": [
          "S1",
          "S2",
          "S3",
          "S4",
          "S5"
        ]
      },
      "importance": {
        "desc": "내진등급 (특 1.5·I 1.2·II 1.0, 기본 grade2)",
        "type": "string",
        "enum": [
          "special",
          "grade1",
          "grade2"
        ]
      },
      "R": {
        "desc": "반응수정계수 (표 6.2-1 — 시스템 결정, 필수 입력)",
        "type": "number",
        "min": 1,
        "max": 8
      },
      "structType": {
        "desc": "약산주기 계수용 구조형식 (기본 rc_moment)",
        "type": "string",
        "enum": [
          "rc_moment",
          "steel_moment",
          "steel_ebf_brb"
        ]
      },
      "T": {
        "desc": "고유주기 직접 입력 s (생략 시 Ta=Ct·hn^x)",
        "type": "number",
        "min": 0,
        "max": 10
      },
      "heightsM": {
        "desc": "층별 바닥 높이 hx (m, 밑면 기준, 하층→상층)",
        "type": "array"
      },
      "weightsKN": {
        "desc": "층별 유효중량 wx (kN, 고정하중 기준)",
        "type": "array"
      }
    }
  },
  {
    "id": "timber_nail",
    "domain": "timber/connection",
    "title": "못접합부 1면전단 (목재-목재)",
    "description": "KDS 41 50 30 표 4.4-4 보통못 기준허용전단내력 × CD × 개수.",
    "required": [
      "sideThk",
      "nailLen",
      "nailDia",
      "group",
      "demandN"
    ],
    "params": {
      "sideThk": {
        "desc": "측면부재 두께 mm (표 절점)",
        "type": "number",
        "enum": [
          12,
          19,
          25,
          38
        ]
      },
      "nailLen": {
        "desc": "못 길이 mm (표 절점)",
        "type": "number",
        "min": 50,
        "max": 152
      },
      "nailDia": {
        "desc": "못 지름 mm (표 절점)",
        "type": "number",
        "min": 2.5,
        "max": 7
      },
      "group": {
        "desc": "수종군 (낙엽송류A~삼나무류D)",
        "type": "string",
        "enum": [
          "A",
          "B",
          "C",
          "D"
        ]
      },
      "count": {
        "desc": "못 개수 (기본 1)",
        "type": "number",
        "min": 1,
        "max": 50
      },
      "duration": {
        "desc": "하중기간 (기본 tenYears)",
        "type": "string",
        "enum": [
          "permanent",
          "tenYears",
          "twoMonths",
          "sevenDays",
          "tenMinutes",
          "impact"
        ]
      },
      "metalSide": {
        "desc": "금속측면판 (+10%, §4.4.3.2)",
        "type": "boolean"
      },
      "demandN": {
        "desc": "소요 전단력 N (접합부 전체)",
        "type": "number",
        "min": 0
      },
      "assemblyWet": {
        "desc": "조립 시 함수율>19% (표 4.9-2)",
        "type": "boolean"
      },
      "serviceWet": {
        "desc": "사용 중 함수율>19% (표 4.9-2)",
        "type": "boolean"
      },
      "predrilled": {
        "desc": "미리 구멍 뚫음 (표 4.4-5 완화 기준 적용)",
        "type": "boolean"
      },
      "endDist": {
        "desc": "끝면거리 mm (입력 시 표 4.4-5 게이트 검사)",
        "type": "number",
        "min": 0
      },
      "edgeDist": {
        "desc": "연단거리 mm",
        "type": "number",
        "min": 0
      },
      "spacingPar": {
        "desc": "섬유 평행 간격 mm",
        "type": "number",
        "min": 0
      },
      "spacingPerp": {
        "desc": "섬유 수직 간격 mm",
        "type": "number",
        "min": 0
      },
      "endGrain": {
        "desc": "끝면(마구리)에 박음 — Ceg 0.67 (§4.4.3.3(2))",
        "type": "boolean"
      },
      "toeNail": {
        "desc": "경사못 — Ctn 0.83 (§4.4.3.3(4))",
        "type": "boolean"
      },
      "diaphragm": {
        "desc": "격막(구조용판재) — Cdi 1.1 (§4.4.3.3(3))",
        "type": "boolean"
      }
    }
  },
  {
    "id": "timber_bolt",
    "domain": "timber/connection",
    "title": "볼트접합부 1면전단 (목재-목재)",
    "description": "KDS 41 50 30 표 4.5-2 기준허용전단내력(∥/⊥) × CD × CM × CΔ × Cg.",
    "required": [
      "mainThk",
      "sideThk",
      "boltDia",
      "group",
      "demandN"
    ],
    "params": {
      "mainThk": {
        "desc": "주부재 두께 mm (표 절점)",
        "type": "number",
        "enum": [
          38,
          89,
          140
        ]
      },
      "sideThk": {
        "desc": "측면부재 두께 mm (표 절점 — v1: 38)",
        "type": "number",
        "enum": [
          38
        ]
      },
      "boltDia": {
        "desc": "볼트 지름 mm",
        "type": "number",
        "enum": [
          12,
          16,
          19,
          22,
          25
        ]
      },
      "group": {
        "desc": "수종군",
        "type": "string",
        "enum": [
          "A",
          "B",
          "C",
          "D"
        ]
      },
      "grade": {
        "desc": "등급 (Cg의 E 산정용, 기본 2)",
        "type": "string",
        "enum": [
          "1",
          "2",
          "3"
        ]
      },
      "loadDir": {
        "desc": "하중 방향 (기본 parallel=섬유평행)",
        "type": "string",
        "enum": [
          "parallel",
          "perp"
        ]
      },
      "count": {
        "desc": "볼트 총 개수 (기본 1)",
        "type": "number",
        "min": 1,
        "max": 20
      },
      "nRow": {
        "desc": "하중방향 1열 내 볼트 수 (기본 count와 동일 — Cg 산정)",
        "type": "number",
        "min": 1,
        "max": 12
      },
      "rowSpacing_mm": {
        "desc": "1열 내 볼트 중심간격 s mm (nRow≥2 시 Cg 필수)",
        "type": "number",
        "min": 0
      },
      "mainWidth": {
        "desc": "주부재 폭 mm (Cg의 Am=주두께×폭, nRow≥2 시 필수)",
        "type": "number",
        "min": 10,
        "max": 1000
      },
      "sideWidth": {
        "desc": "측면부재 폭 mm (Cg의 As, nRow≥2 시 필수)",
        "type": "number",
        "min": 10,
        "max": 1000
      },
      "duration": {
        "desc": "하중기간 (기본 tenYears)",
        "type": "string",
        "enum": [
          "permanent",
          "tenYears",
          "twoMonths",
          "sevenDays",
          "tenMinutes",
          "impact"
        ]
      },
      "serviceWet": {
        "desc": "사용 중 함수율>19% (표 4.9-2: CM 0.7)",
        "type": "boolean"
      },
      "loadType": {
        "desc": "평행하중 성격 (끝면거리 기준: 인장 침엽수 7D/압축 4D, 기본 tension)",
        "type": "string",
        "enum": [
          "tension",
          "compression"
        ]
      },
      "hardwood": {
        "desc": "활엽수 (인장 끝면 5D — 기본 침엽수 7D)",
        "type": "boolean"
      },
      "endDist": {
        "desc": "끝면거리 mm (입력 시 CΔ 산정, 감소최소 미달 FAIL)",
        "type": "number",
        "min": 0
      },
      "edgeDist": {
        "desc": "연단거리 mm (게이트 — 미달 FAIL, 보간 없음: 표 4.5-5)",
        "type": "number",
        "min": 0
      },
      "spacing": {
        "desc": "1열 내 간격 mm (입력 시 CΔ 산정 — rowSpacing_mm과 동일 물리량, 게이트 검사용)",
        "type": "number",
        "min": 0
      },
      "rowGap": {
        "desc": "볼트 열 사이 간격 mm (입력 시 표 4.5-8 게이트: ∥ 1.5D · ⊥ l/D 구간별 2.5D~5D)",
        "type": "number",
        "min": 0
      },
      "demandN": {
        "desc": "소요 전단력 N",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "wind_simple",
    "domain": "architecture/lateral",
    "title": "수평풍하중 간편법 (저층 주골조)",
    "description": "KDS 41 12 00 §5.15 간편법 — 설계풍압·기단전단력. 저층(H≤20m) 정형 건물 전용.",
    "required": [
      "V0",
      "H",
      "B",
      "D",
      "demandNone"
    ],
    "params": {
      "V0": {
        "desc": "기본풍속 m/s (그림 5.5-1 건설지 등풍속선 — 필수 입력, 예: 서울 26·부산 38·제주 44)",
        "type": "number",
        "min": 20,
        "max": 50
      },
      "H": {
        "desc": "기준높이 m (간편법 상한 20)",
        "type": "number",
        "min": 0,
        "max": 20
      },
      "B": {
        "desc": "대표폭(풍직각방향) m",
        "type": "number",
        "min": 0,
        "max": 30
      },
      "D": {
        "desc": "깊이(풍방향) m",
        "type": "number",
        "min": 0,
        "max": 100
      },
      "roofSlopeDeg": {
        "desc": "지붕경사각 ° (기본 0 — ≥10°는 적용 불가)",
        "type": "number",
        "min": 0,
        "max": 45
      },
      "terrain": {
        "desc": "환경계수 Ce: 통상 1.0 / 장애물 없는 평탄지 1.5 / 해안가 2.0 (기본 normal)",
        "type": "string",
        "enum": [
          "normal",
          "flatOpen",
          "coast"
        ]
      },
      "Kzt": {
        "desc": "지형계수 (언덕·산 정상부 할증 시 — Ce에 Kzt² 곱, 기본 1.0)",
        "type": "number",
        "min": 1,
        "max": 2
      },
      "demandNone": {
        "desc": "자리표시 0 입력 (풍하중 산출 계산기 — 판정은 골조 연계)",
        "type": "number",
        "min": 0,
        "max": 0
      }
    }
  },
  {
    "id": "wind_static",
    "domain": "architecture/lateral",
    "title": "수평풍하중 정식법 (강체 밀폐형)",
    "description": "KDS 41 12 00 §5.2 — 설계속도압·가스트·풍압분포·기단전단. 간편법(§5.15) 범위 밖 건물용.",
    "required": [
      "V0",
      "H",
      "B",
      "D",
      "exposure",
      "demandNone"
    ],
    "params": {
      "V0": {
        "desc": "기본풍속 m/s (그림 5.5-1 — 필수 입력)",
        "type": "number",
        "min": 20,
        "max": 50
      },
      "H": {
        "desc": "기준높이 m (v1 상한 100 — 초고층 별도)",
        "type": "number",
        "min": 0,
        "max": 100
      },
      "B": {
        "desc": "건물폭(풍직각방향) m",
        "type": "number",
        "min": 0,
        "max": 200
      },
      "D": {
        "desc": "깊이(풍방향) m",
        "type": "number",
        "min": 0,
        "max": 200
      },
      "exposure": {
        "desc": "지표면조도 (표 5.5-1: A 대도시밀집~D 해안·평탄)",
        "type": "string",
        "enum": [
          "A",
          "B",
          "C",
          "D"
        ]
      },
      "importance": {
        "desc": "중요도 (표 5.5-5, 기본 1)",
        "type": "string",
        "enum": [
          "skyscraper",
          "special",
          "1",
          "2",
          "3"
        ]
      },
      "Kzt": {
        "desc": "지형계수 (기본 1.0 평탄지)",
        "type": "number",
        "min": 1,
        "max": 2
      },
      "Kd": {
        "desc": "풍향계수 (기본 1.0 — 관측자료 없을 때, §5.5.3(3)①)",
        "type": "number",
        "min": 0.85,
        "max": 1
      },
      "natFreqHz": {
        "desc": "풍방향 고유진동수 Hz (미입력 시 KDS 41 17 근사주기로 판정 — structType 필요)",
        "type": "number",
        "min": 0,
        "max": 20
      },
      "structType": {
        "desc": "근사주기용 구조형식 (natFreqHz 미입력 시)",
        "type": "string",
        "enum": [
          "rc_moment",
          "steel_moment",
          "steel_ebf_brb"
        ]
      },
      "dampingRatio": {
        "desc": "풍방향 1차 감쇠비 ζD (유연건물 식 5.6-1 필수 — 프로젝트 결정값, 통상 RC 0.02·강구조 0.01 관례는 참고만)",
        "type": "number",
        "min": 0.005,
        "max": 0.05
      },
      "modeExp": {
        "desc": "1차 모드 연직분포 지수 β (기본 1.0 직선 — 원문 §5.6.1 모드 미상 시 기준 제시값, 질량 균등 가정 명시)",
        "type": "number",
        "min": 0.5,
        "max": 2
      },
      "storyH": {
        "desc": "층고 m (층전단 산출용, 기본 3.5)",
        "type": "number",
        "min": 2,
        "max": 6
      },
      "demandNone": {
        "desc": "자리표시 0 (하중 산출 계산기)",
        "type": "number",
        "min": 0,
        "max": 0
      }
    }
  },
  {
    "id": "drainage_network",
    "domain": "landscape/civil",
    "title": "우수 배수 네트워크 (합리식 누적)",
    "description": "다구역 집수 → 간선 순차 누적(CA·tc) → 구간별 관경 검토/제안. 부지·공원 스케일.",
    "required": [
      "segments"
    ],
    "params": {
      "segments": {
        "desc": "상류→하류 순 구간 배열: [{name?, areaHa, C, tcMin, len_m, slope, dia_mm?, n?}] — areaHa=구간 신규 집수면적, tcMin=해당 구역 자체 유입시간(분)"
      },
      "iFixed_mmhr": {
        "desc": "고정 설계 강우강도 mm/hr (입력 시 IDF 무시 — 소규모 개산)",
        "type": "number",
        "min": 0,
        "max": 300
      },
      "idfA": {
        "desc": "Talbot IDF 계수 a — I=a/(tc+b) (지역 확률강우 분석값, 예: 서울 30년 등 — 출처는 프로젝트 자료)",
        "type": "number",
        "min": 0,
        "max": 20000
      },
      "idfB": {
        "desc": "Talbot IDF 계수 b (분)",
        "type": "number",
        "min": 0,
        "max": 120
      },
      "fillRatio": {
        "desc": "허용 충만도 (만관 대비, 기본 1.0 — 실무 0.75 권장 시 입력)",
        "type": "number",
        "min": 0.5,
        "max": 1
      }
    }
  },
  {
    "id": "girder_line",
    "domain": "bridge",
    "title": "주거더 활하중 단면력 (KL-510 · 단순지지)",
    "description": "KL-510 표준트럭+차로하중 영향선 최대 M·V — 충격·다차로·분배계수 반영.",
    "required": [
      "span",
      "DF"
    ],
    "params": {
      "span": {
        "desc": "지간 m (등경간)",
        "type": "number",
        "min": 5,
        "max": 200
      },
      "spans": {
        "desc": "경간 수 (기본 1 단순지지 · 2~6=등경간 연속 — 3연모멘트 삼중대각 일반해·차로 패턴재하 포락)",
        "type": "integer",
        "min": 1,
        "max": 6
      },
      "EI_kNm2": {
        "desc": "휨강성 EI kN·m² (입력 시 처짐 검토 §4.3.1.7 — 트럭 vs 25%트럭+차로 중 큰 값)",
        "type": "number",
        "min": 0
      },
      "deflLimitRatio": {
        "desc": "처짐 한계 L/n (기본 800 관례 — 발주자 기준 확인 명시)",
        "type": "number",
        "min": 100,
        "max": 2000
      },
      "nLanes": {
        "desc": "재하차로 수 (기본 1 — 다차로계수 표 4.3-1 적용)",
        "type": "integer",
        "min": 1,
        "max": 8
      },
      "DF": {
        "desc": "거더 분배계수 (KDS 24 10 11 산정값 입력 — 지어내지 않음. 레버룰·강성법 등 프로젝트 산정)",
        "type": "number",
        "min": 0,
        "max": 1.5
      },
      "fatigue": {
        "desc": "피로 검토 모드 (트럭 80%·IM 15% — §4.3.2·표 4.4-1)",
        "type": "boolean"
      },
      "demandM_kNm": {
        "desc": "비교용 소요 모멘트 (선택 — 판정용)",
        "type": "number",
        "min": 0
      },
      "demandV_kN": {
        "desc": "비교용 소요 전단 (선택)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "slope_infinite",
    "domain": "civil/slope",
    "title": "무한사면 안정 (평면 파괴)",
    "description": "한계평형 폐형해 — 얕은 표층 파괴 FS. 절토·성토 사면 개념 검토.",
    "required": [
      "slopeDeg",
      "phiDeg",
      "depthM",
      "gamma",
      "fsRequired"
    ],
    "params": {
      "slopeDeg": {
        "desc": "사면 경사 β °",
        "type": "number",
        "min": 5,
        "max": 60
      },
      "phiDeg": {
        "desc": "내부마찰각 φ′ ° (지반조사값)",
        "type": "number",
        "min": 5,
        "max": 45
      },
      "cohesion": {
        "desc": "점착력 c′ kPa (기본 0 — 보수측)",
        "type": "number",
        "min": 0,
        "max": 100
      },
      "depthM": {
        "desc": "파괴면 깊이 z m (표층)",
        "type": "number",
        "min": 0,
        "max": 10
      },
      "gamma": {
        "desc": "단위중량 kN/m³",
        "type": "number",
        "min": 14,
        "max": 24
      },
      "waterDepthM": {
        "desc": "침윤 수두 zw m (0=건조, z=완전포화 — 사면 평행 침투 가정)",
        "type": "number",
        "min": 0,
        "max": 10
      },
      "fsRequired": {
        "desc": "요구 안전율 (KDS 11 70 05 — 건기/우기·비탈면 등급별 상이, 프로젝트 값 입력)",
        "type": "number",
        "min": 1,
        "max": 3
      }
    }
  },
  {
    "id": "fatigue_goodman",
    "domain": "mech/fatigue",
    "title": "피로 안전율 (Goodman 계열)",
    "description": "평균·교번응력 → Goodman/Gerber/Soderberg 안전율. Se는 입력(날조 금지).",
    "required": [
      "sigmaA",
      "sigmaM",
      "Se",
      "Su"
    ],
    "params": {
      "sigmaA": {
        "desc": "교번응력 진폭 σa MPa",
        "type": "number",
        "min": 0
      },
      "sigmaM": {
        "desc": "평균응력 σm MPa (압축 평균은 Goodman에서 σm=0 보수 처리 명시)",
        "type": "number",
        "min": -500
      },
      "Se": {
        "desc": "Se MPa — 직접 입력(우선). 0/미입력+아래 보정 입력 시 Shigley 표준 추정",
        "type": "number",
        "min": 0
      },
      "surface": {
        "desc": "Se 추정: 표면 (Shigley ka=a·Su^b 공표 계수 — 출처 명시)",
        "type": "string",
        "enum": [
          "ground",
          "machined",
          "hotRolled",
          "asForged"
        ]
      },
      "dia_mm": {
        "desc": "Se 추정: 회전굽힘 지름 kb (2.79~51: (d/7.62)^−0.107 · 51~254: 1.51d^−0.157)",
        "type": "number",
        "min": 0,
        "max": 254
      },
      "loadType": {
        "desc": "Se 추정: 하중 kc (1.0/0.85/0.59 — Shigley)",
        "type": "string",
        "enum": [
          "bending",
          "axial",
          "torsion"
        ]
      },
      "reliability": {
        "desc": "Se 추정: 신뢰도 ke (1.0/0.897/0.868/0.814/0.753 — Shigley)",
        "type": "string",
        "enum": [
          "50",
          "90",
          "95",
          "99",
          "99.9"
        ]
      },
      "lifeMode": {
        "desc": "유한수명 S-N (Basquin, f=0.9 관례 명시) — 등가 완전교번 응력으로 N 산출",
        "type": "boolean"
      },
      "minerBlocks": {
        "desc": "Miner 누적: [{sigmaA, sigmaM, cycles}] 배열 (lifeMode와 함께)"
      },
      "Su": {
        "desc": "인장강도 Su MPa",
        "type": "number",
        "min": 0
      },
      "Sy": {
        "desc": "항복강도 Sy MPa (Soderberg·1차 항복 검토용 — 선택)",
        "type": "number",
        "min": 0
      },
      "nRequired": {
        "desc": "요구 안전율 (기본 1.5 관례 명시)",
        "type": "number",
        "min": 1,
        "max": 10
      }
    }
  },
  {
    "id": "vibration_basic",
    "domain": "mech/dynamics",
    "title": "보 고유진동수·조화응답 전달률",
    "description": "1차 굽힘 고유진동수(폐형) + 가진 주파수 공진 여유·전달률 검토.",
    "required": [
      "support",
      "E_MPa",
      "I_mm4",
      "massPerM_kg",
      "L_mm"
    ],
    "params": {
      "support": {
        "desc": "지지 조건",
        "type": "string",
        "enum": [
          "simple",
          "cantilever",
          "fixedFixed",
          "fixedPinned"
        ]
      },
      "E_MPa": {
        "desc": "탄성계수 MPa",
        "type": "number",
        "min": 0
      },
      "I_mm4": {
        "desc": "단면 2차모멘트 mm⁴",
        "type": "number",
        "min": 0
      },
      "massPerM_kg": {
        "desc": "단위길이 질량 kg/m (부가질량 환산 포함 — 명시)",
        "type": "number",
        "min": 0
      },
      "L_mm": {
        "desc": "길이 mm",
        "type": "number",
        "min": 0,
        "max": 60000
      },
      "forcingHz": {
        "desc": "가진 주파수 Hz (입력 시 공진 여유·전달률 검토)",
        "type": "number",
        "min": 0
      },
      "zeta": {
        "desc": "감쇠비 (기본 0.02 관례 명시 — 측정값 권장)",
        "type": "number",
        "min": 0.001,
        "max": 0.5
      },
      "marginRequired": {
        "desc": "공진 이격비 요구 (기본 1.25 관례)",
        "type": "number",
        "min": 1.05,
        "max": 3
      }
    }
  },
  {
    "id": "thermal_stress",
    "domain": "mech/thermal",
    "title": "구속 열응력·열팽창",
    "description": "온도변화 구속 응력(σ=kEαΔT)·자유 팽창량 + 허용응력 대조.",
    "required": [
      "E_MPa",
      "alpha_1perC",
      "deltaT"
    ],
    "params": {
      "E_MPa": {
        "desc": "탄성계수 MPa",
        "type": "number",
        "min": 0
      },
      "alpha_1perC": {
        "desc": "선팽창계수 1/°C (강 ~1.2e-5 — 재료값 입력)",
        "type": "number",
        "min": 0,
        "max": 0.00005
      },
      "deltaT": {
        "desc": "온도변화 °C (+가열)",
        "type": "number",
        "min": -300,
        "max": 600
      },
      "restraint": {
        "desc": "구속도 k (1=완전구속 보수측, 기본 1)",
        "type": "number",
        "min": 0,
        "max": 1
      },
      "L_mm": {
        "desc": "자유 팽창량 계산 길이 mm (선택)",
        "type": "number",
        "min": 0
      },
      "allowMPa": {
        "desc": "허용응력 MPa (입력 시 판정)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "acoustic_tl",
    "domain": "interior/acoustics",
    "title": "단일벽 차음 (질량법칙)",
    "description": "면밀도 → 투과손실 TL 개산(주파수 대역) + 요구치 대조.",
    "required": [
      "surfaceDensity_kgm2"
    ],
    "params": {
      "surfaceDensity_kgm2": {
        "desc": "면밀도 kg/m² (콘크리트 150t≈360·석고 12.5t≈10 — 재료값 입력)",
        "type": "number",
        "min": 0,
        "max": 1000
      },
      "freqHz": {
        "desc": "평가 주파수 Hz (기본 500 관례 대표)",
        "type": "number",
        "min": 63,
        "max": 8000
      },
      "requiredTL_dB": {
        "desc": "요구 투과손실 dB (경계벽 법정 기준 등 — 프로젝트 확인 입력)",
        "type": "number",
        "min": 20,
        "max": 80
      }
    }
  },
  {
    "id": "duct_sizing",
    "domain": "interior/hvac",
    "title": "덕트 사이징 (속도법)",
    "description": "풍량·허용유속 → 덕트 표준경/각형 치수 + 직관 마찰손실.",
    "required": [
      "flowCMH",
      "velocityLimit"
    ],
    "params": {
      "flowCMH": {
        "desc": "풍량 m³/h (환기 계산 연동)",
        "type": "number",
        "min": 0,
        "max": 100000
      },
      "velocityLimit": {
        "desc": "허용 유속 m/s (거실 3~5·주덕트 6~8 관례 — 용도 확인 입력)",
        "type": "number",
        "min": 1,
        "max": 20
      },
      "lengthM": {
        "desc": "직관 길이 m (마찰손실 — 선택)",
        "type": "number",
        "min": 0
      },
      "roughness_mm": {
        "desc": "조도 mm (아연도강판 0.15 관례, 기본)",
        "type": "number",
        "min": 0.01,
        "max": 3
      },
      "aspect": {
        "desc": "각형 종횡비 (입력 시 각형 치수 제안)",
        "type": "number",
        "min": 1,
        "max": 4
      }
    }
  },
  {
    "id": "slope_bishop",
    "domain": "civil/slope",
    "title": "Bishop 간편법 (원호 — 절편 입력)",
    "description": "절편 배열 → FS 반복 수렴. USACE 공표예제 재현 게이트.",
    "required": [
      "fsRequired"
    ],
    "params": {
      "slices": {
        "desc": "절편 배열 [{W, alphaDeg, dx, c, phiDeg, u?}] — geometry 미입력 시 필수"
      },
      "geometry": {
        "desc": "자동 모드(선택): { H(사면고 m), slopeDeg, gamma, c_kPa, phiDeg, nSlices? } — 균질 단일층·수평 지표. 임계원 그리드 탐색 자동"
      },
      "fsRequired": {
        "desc": "요구 안전율 (조건별 기준 — 프로젝트 확인 입력)",
        "type": "number",
        "min": 1,
        "max": 3
      }
    }
  },
  {
    "id": "mse_wall",
    "domain": "civil/retaining",
    "title": "보강토옹벽 외적 안정 (LRFD)",
    "description": "활동·편심·지지력 CDR — FHWA GEC11 방법(공표예제 재현).",
    "required": [
      "H",
      "L",
      "gammaR",
      "phiR",
      "gammaF",
      "phiF",
      "bearingResistance"
    ],
    "params": {
      "H": {
        "desc": "설계벽고 m (근입 포함)",
        "type": "number",
        "min": 0,
        "max": 20
      },
      "L": {
        "desc": "보강재 길이 m (통상 0.7H)",
        "type": "number",
        "min": 0,
        "max": 20
      },
      "gammaR": {
        "desc": "보강토체 단위중량 kN/m³",
        "type": "number",
        "min": 14,
        "max": 24
      },
      "phiR": {
        "desc": "보강토체 φ′r ° (기초 마찰에 사용 — min(φr, φfd) 보수)",
        "type": "number",
        "min": 25,
        "max": 45
      },
      "gammaF": {
        "desc": "배면토 단위중량",
        "type": "number",
        "min": 14,
        "max": 24
      },
      "phiF": {
        "desc": "배면토 φ′f ° (Ka 산정)",
        "type": "number",
        "min": 20,
        "max": 45
      },
      "phiFd": {
        "desc": "기초지반 φ′ (기본 phiR과 min — 활동 마찰)",
        "type": "number",
        "min": 20,
        "max": 45
      },
      "surcharge": {
        "desc": "등가 활하중 상재 q kPa (heq×γ)",
        "type": "number",
        "min": 0
      },
      "bearingResistance": {
        "desc": "계수 지지저항 kPa (지반조사 — φ_b 포함값 또는 공칭×0.65)",
        "type": "number",
        "min": 0
      },
      "gEV": {
        "desc": "연직토 하중계수 (기본 1.35 — FHWA Str I max)",
        "type": "number",
        "min": 1,
        "max": 1.5
      },
      "gEH": {
        "desc": "수평토 (기본 1.50)",
        "type": "number",
        "min": 0.9,
        "max": 1.75
      },
      "gLL": {
        "desc": "활하중 (기본 1.75)",
        "type": "number",
        "min": 1,
        "max": 2
      },
      "internal": {
        "desc": "내적 안정(선택 — FHWA GEC11 방법): { Sv_m(보강 수직간격), type(steel_strip|bar_mat|geosynthetic), Tal_kNm(장기 설계인장강도/폭), Rc(피복비 기본 1), Fstar(인발마찰 — 미입력 시 geosyn (2/3)tanφ·steel 기본 1.2 관례 명시), alphaP(0.8 geosyn/1.0 steel) }"
      }
    }
  },
  {
    "id": "deck_strip",
    "domain": "bridge/deck",
    "title": "교량 바닥판 휨모멘트 (간략식)",
    "description": "내측(직각 배근)·캔틸레버 바닥판 활하중 M — 충격·연속 보정 + 단면 검토 연계.",
    "required": [
      "mode"
    ],
    "params": {
      "mode": {
        "desc": "내측(거더 사이) / 캔틸레버(내민)",
        "type": "string",
        "enum": [
          "interior",
          "cantilever"
        ]
      },
      "span_m": {
        "desc": "내측: 바닥판 지간 L m (거더 중심 간 — 0.6~6m 간략식 범위)",
        "type": "number",
        "min": 0.6,
        "max": 6
      },
      "continuous": {
        "desc": "내측: 3지점 이상 연속 (×0.8 — 기본 true 관례)",
        "type": "boolean"
      },
      "X_m": {
        "desc": "캔틸레버: 하중점~지지점 거리 m",
        "type": "number",
        "min": 0,
        "max": 3
      },
      "grade": {
        "desc": "교량 등급 (1등교 P=96kN 기준 — 2등 0.75배·3등 0.5625배, 기본 1)",
        "type": "string",
        "enum": [
          "1",
          "2",
          "3"
        ]
      },
      "deckThk_mm": {
        "desc": "바닥판 두께 (자중 모멘트 포함용 — 선택)",
        "type": "number",
        "min": 160,
        "max": 400
      },
      "pavementThk_mm": {
        "desc": "포장 두께 (DW — 선택, 22.6kN/m³)",
        "type": "number",
        "min": 0,
        "max": 200
      }
    }
  },
  {
    "id": "earthwork_grid",
    "domain": "landscape/earthwork",
    "title": "격자 토공량 (점고법)",
    "description": "기존·계획 지반고 격자 → 절토·성토량, 토량환산(입력 계수) 반영.",
    "required": [],
    "params": {
      "existing": {
        "desc": "기존 지반고 2D 배열 [row][col] (m) — 격자 교점 (격자 모드)"
      },
      "proposed": {
        "desc": "계획 지반고 2D 배열 (동일 크기)"
      },
      "cellSize_m": {
        "desc": "격자 간격 m (격자 모드 필수)",
        "type": "number",
        "min": 0,
        "max": 100
      },
      "tin": {
        "desc": "TIN 모드(선택 — 격자 대신): { points: [[x,y,zExist,zPlan],...], triangles: [[i,j,k],...] } — 불규칙 삼각망. 삼각기둥법 V=A·(dz1+dz2+dz3)/3, 절성 혼재 삼각형은 평면 교선 정확 분할"
      },
      "swellFactor": {
        "desc": "토량변화율 L(흐트러짐 — 운반토량용, 기본 1.0=미반영 명시)",
        "type": "number",
        "min": 1,
        "max": 1.6
      },
      "shrinkFactor": {
        "desc": "다짐 C(성토 필요 원지반토량 환산, 기본 1.0=미반영)",
        "type": "number",
        "min": 0.7,
        "max": 1
      }
    }
  },
  {
    "id": "pipe_sizing",
    "domain": "interior/plumbing",
    "title": "급수 배관 사이징 (속도법+HW)",
    "description": "설계유량·허용유속 → 호칭경 + Hazen-Williams 마찰손실.",
    "required": [
      "flowLpm",
      "velocityLimit"
    ],
    "params": {
      "flowLpm": {
        "desc": "설계 유량 L/min (동시사용유량 — 프로젝트 산정 입력)",
        "type": "number",
        "min": 0,
        "max": 10000
      },
      "velocityLimit": {
        "desc": "허용 유속 m/s (급수 1.5~2.5 관례 — 소음·수격 고려 확인 입력)",
        "type": "number",
        "min": 0.5,
        "max": 4
      },
      "lengthM": {
        "desc": "배관 길이 m (마찰손실 — 선택)",
        "type": "number",
        "min": 0
      },
      "hwC": {
        "desc": "HW 조도계수 C (동관 130·PVC 150·강관 100 — 재질값 입력, 기본 130)",
        "type": "number",
        "min": 80,
        "max": 160
      },
      "staticHead_m": {
        "desc": "정수두 m (필요 급수압 검토용 — 선택)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "shear_wall",
    "domain": "architecture/lateral",
    "title": "전단벽 횡강성·분담 (개략)",
    "description": "벽 요소 강성(휨+전단변형)·병렬 분담률·벽체 개략 전단 검토.",
    "required": [
      "walls",
      "storyShear_kN"
    ],
    "params": {
      "walls": {
        "desc": "벽 목록 [{lw_mm(벽 길이), t_mm(두께), h_mm(높이), fck?}] — 최대 20"
      },
      "frameStiffness_kNmm": {
        "desc": "병렬 골조 강성 kN/mm (frame2d 산정값 입력 — 선택, 벽·골조 분담)",
        "type": "number",
        "min": 0
      },
      "storyShear_kN": {
        "desc": "층전단력 V (지진·풍 산정값)",
        "type": "number",
        "min": 0
      },
      "fck": {
        "desc": "콘크리트 강도 (기본 24)",
        "type": "number",
        "min": 18,
        "max": 60
      },
      "detail": {
        "desc": "벽 상세 전단검토(§4.9 원문식 — 선택): { wallIndex(1~), Nu_kN(압축+), Mu_kNm, Vu_kN, Avh_mm2?, sh_mm?, fy?, Avv_mm2?, sv_mm? } — Avv/sv 입력 시 §4.9.3 최소철근·간격 검토 포함"
      },
      "boundary": {
        "desc": "특수경계요소 검토(선택 — KDS 14 20 80 §4.7.6 원문): { wallIndex(1~), c_mm(압축연단 중립축 — P-M 해석 산정 입력), deltaU_mm(설계변위), hw_mm(벽 전체높이 — 기본 벽 h), Mu_kNm?, Vu_kN?(연장범위 Mu/4Vu용), sigmaMax_MPa?(응력법 (3) — 비균열 선형탄성 산정 입력), rhoBoundary?(경계부 종방향 철근비 — (5)① 2.8/fy 검토) } — 변위법 (2)①: c≥lw/(600(δu/hw)), δu/hw≥0.007"
      }
    }
  },
  {
    "id": "girder_df",
    "domain": "bridge",
    "title": "거더 분배계수 DF (정밀식)",
    "description": "KDS 24 10 11 표 4.6-5·6 — 내측·외측 휨 분배계수, 적용범위 게이트.",
    "required": [
      "S_mm",
      "L_mm",
      "ts_mm"
    ],
    "params": {
      "S_mm": {
        "desc": "거더 간격 S (적용범위 1100~4900)",
        "type": "number",
        "min": 1100,
        "max": 4900
      },
      "L_mm": {
        "desc": "지간 L (6000~73000)",
        "type": "number",
        "min": 6000,
        "max": 73000
      },
      "ts_mm": {
        "desc": "바닥판 두께 ts (110~300)",
        "type": "number",
        "min": 110,
        "max": 300
      },
      "KgOverLts3": {
        "desc": "Kg/(L·ts³) 항 (기본 1.0 — §4.6.3.2② 기본설계 허용. 정밀=n(I+A·eg²)/Lts³ 산정 입력)",
        "type": "number",
        "min": 0.5,
        "max": 5
      },
      "Nb": {
        "desc": "거더 수 (적용범위 ≥4 — 3이면 지렛대 법칙 비교 필요 명시)",
        "type": "integer",
        "min": 3,
        "max": 20
      },
      "de_mm": {
        "desc": "외측: 외측거더 복부~방호책 내면 거리 de (입력 시 외측 DF 산출)",
        "type": "number",
        "min": -300,
        "max": 1700
      }
    }
  },
  {
    "id": "psc_girder",
    "domain": "bridge/psc",
    "title": "PSC 거더 응력 검토 (이송·사용)",
    "description": "긴장력·편심·단면성능 → 상·하연 응력 2단계 검토. 손실률·허용계수 입력 원칙.",
    "required": [
      "A_mm2",
      "I_mm4",
      "yt_mm",
      "yb_mm",
      "Pj_kN",
      "e_mm",
      "fck"
    ],
    "params": {
      "A_mm2": {
        "desc": "단면적",
        "type": "number",
        "min": 0
      },
      "I_mm4": {
        "desc": "단면 2차모멘트",
        "type": "number",
        "min": 0
      },
      "yt_mm": {
        "desc": "도심~상연",
        "type": "number",
        "min": 0
      },
      "yb_mm": {
        "desc": "도심~하연",
        "type": "number",
        "min": 0
      },
      "Pj_kN": {
        "desc": "재킹 긴장력",
        "type": "number",
        "min": 0
      },
      "e_mm": {
        "desc": "긴장재 편심 (도심 아래 +)",
        "type": "number",
        "min": 0
      },
      "lossImmediate_pct": {
        "desc": "즉시손실 % (탄성수축 등 — KDS 24 14 21 산정 입력, 기본 0=미반영 명시)",
        "type": "number",
        "min": 0,
        "max": 20
      },
      "lossTotal_pct": {
        "desc": "총손실 % (장기 포함 — 산정 입력. 참고 관례 18~25%는 안내일 뿐)",
        "type": "number",
        "min": 0,
        "max": 40
      },
      "Mo_kNm": {
        "desc": "이송 시 모멘트(자중)",
        "type": "number",
        "min": 0
      },
      "Ms_kNm": {
        "desc": "사용 시 전체 모멘트(자중+2차사하중+활하중)",
        "type": "number",
        "min": 0
      },
      "fck": {
        "desc": "콘크리트 강도 (PSC ≥30 관례)",
        "type": "number",
        "min": 30,
        "max": 70
      },
      "fci": {
        "desc": "이송 시 강도 (기본 0.8fck 관례 명시)",
        "type": "number",
        "min": 20,
        "max": 60
      },
      "compFactor": {
        "desc": "압축한계 계수 (기본 0.6 — KDS 24 14 21 §4.2.2.1② 원문: 사용조합-I 0.6fck·전달 §1.5.7.2③ 0.6fck(t))",
        "type": "number",
        "min": 0.4,
        "max": 0.7
      },
      "MsSustained_kNm": {
        "desc": "지속하중 모멘트 (입력 시 조합-V 지속 압축한계 0.45fck 검토 — §4.2.2.1① 원문)",
        "type": "number",
        "min": 0
      },
      "tensFactor": {
        "desc": "인장 참고한계 ×√fck (기본 0.25 참고 관례 — 한계상태설계법의 정식 검토는 균열폭/탈압축(§4.2.3, 후속) 명시)",
        "type": "number",
        "min": 0,
        "max": 0.63
      },
      "camber": {
        "desc": "솟음 산정(선택 — 탄성 폐형): { L_m(지간), wSw_kNm(자중 등분포), Ec_MPa?(기본 8500∛(fck+4)), Eci_MPa?(전달 시 — 기본 fci 기준), creepMult?(장기배율 — PCI 근사표 등 산정 입력, 기본 미적용 명시) }"
      },
      "tendon": {
        "desc": "긴장재 응력 한계 검토(선택 — §1.5.7.2·§1.5.7.3 원문): { Ap_mm2, fpu_MPa, fpy_MPa(항복 — 뚜렷하지 않으면 fp0.2k 입력·명시) }"
      },
      "crackControl": {
        "desc": "간접 균열 제어(선택 — §4.2.3.3 표 4.2-4·4.2-5 원문): { steelStress_MPa(균열단면 기준 철근응력 — 산정 입력), barDia_mm?, barSpacing_mm?, section: rc_flexure|rc_tension|psc } — 지름 또는 간격 중 하나 만족 시 한계균열폭(PSC 0.2·RC 0.3mm) 충족 간주(§4.2.3.1(6)). 최소철근량(§4.2.3.2 식4.2-1)은 별도 확인"
      },
      "crackWidth": {
        "desc": "직접 균열폭 계산(선택 — §4.2.3.4 식4.2-4~7 원문): { fso_MPa(균열단면 철근응력), fcte_MPa(유효 인장강도 fctm(t) — 산정 입력), h_mm, d_mm, x_mm(중립축 — 균열환산단면 산정 입력), b_mm(유효폭), cc_mm(최소피복), db_mm, As_mm2, Ap_mm2?, xi1?(부착비 ξ1 — 표 4.2-3, 기본 0=긴장재 무시 보수), barSpacing_mm?, kt?(0.6 단기/0.4 장기 — 기본 0.4), k1?(0.8 이형/1.6 원형·긴장재), k2?(0.5 휨/1.0 인장), Es_MPa?, n?(탄성계수비 — 기본 Es/(8500∛(fck+4)) 관례 명시), limit_mm?(표 4.2-2: PSC 0.2·RC 0.3 기본 0.2) }"
      },
      "ultimate": {
        "desc": "극한휨 Mn(선택 — 변형률적합 이분법·이선형 긴장재 모델 명시): { b_mm(압축면 유효폭 — 플랜지), dp_mm(긴장재 유효깊이), Ap_mm2, fpu_MPa, fpy_MPa, Ep_MPa?(기본 200000 강연선 관례 — 195~200GPa 제품치 입력 권장), As_mm2?(인장철근), d_mm?(철근 깊이), fy_MPa?, Mu_kNm?(판정용 — 계수휨모멘트), phiF?(휨 강도감수계수 — 기본 0.85 인장지배 관례, 한계상태법 재료계수 방식과 구분 명시) }. 직사각 압축블록 한정(플랜지 내 중립축 검증 게이트)"
      }
    }
  },
  {
    "id": "weld_connection",
    "domain": "mechanical/connection",
    "title": "필릿용접 접합 (KDS 14 31 25)",
    "description": "필릿용접 설계강도(0.75·0.6FEXX·Ae)+치수·길이 게이트 — 건축구조물 기준.",
    "required": [
      "weldSize_mm",
      "length_mm",
      "FEXX_MPa",
      "demandP_kN"
    ],
    "params": {
      "weldSize_mm": {
        "desc": "용접치수 s (다리길이)",
        "type": "number",
        "min": 0,
        "max": 30
      },
      "length_mm": {
        "desc": "용접 총길이 L (양면이면 합계 입력)",
        "type": "number",
        "min": 0
      },
      "nSegments": {
        "desc": "세그먼트 수 (기본 1 — 유효길이 공제 2s×n)",
        "type": "integer",
        "min": 1,
        "max": 20
      },
      "FEXX_MPa": {
        "desc": "용접재 인장강도 (KS 등급 — 매칭용접재 원칙, 표 4.1-8 주2)",
        "type": "number",
        "min": 400,
        "max": 830
      },
      "demandP_kN": {
        "desc": "소요강도 (용접군 도심 통과 합력 — 편심은 후속, 별도 해석 입력)",
        "type": "number",
        "min": 0
      },
      "tThin_mm": {
        "desc": "접합부 얇은 쪽 판두께 (최소치수 게이트 — 표 4.1-6(a))",
        "type": "number",
        "min": 0
      },
      "lapJoint": {
        "desc": "겹침이음 여부 (최대치수 게이트 §4.1.2.2.2(2))",
        "type": "boolean"
      },
      "tEdge_mm": {
        "desc": "겹침이음 시 연단 용접되는 판두께 (최대치수 판정용)",
        "type": "number",
        "min": 0
      },
      "endLoaded": {
        "desc": "부재 단부 길이방향 재하 여부 (장대 감소 식4.1-1 적용 — 기본 true 보수)",
        "type": "boolean"
      },
      "group": {
        "desc": "용접군 편심 검토(선택 — 탄성벡터법, 순간중심법 대비 보수 명시): { segments: [{x1,y1,x2,y2}] mm(용접선 좌표), Px_kN?, Py_kN?, e_mm?(하중 작용점의 도심 편심 — Py 기준 x방향) 또는 Mz_kNm?(직접 모멘트) } — 단위길이 소요 vs 설계강도"
      }
    }
  },
  {
    "id": "consolidation",
    "domain": "civil/settlement",
    "title": "압밀침하 (Terzaghi 1D)",
    "description": "정규/과압밀 침하량 + 압밀도-시간 곡선(급수 정확해) — 시험물성 입력 원칙.",
    "required": [
      "H_m",
      "e0",
      "Cc",
      "sigma0_kPa",
      "dSigma_kPa"
    ],
    "params": {
      "H_m": {
        "desc": "압밀층 두께",
        "type": "number",
        "min": 0,
        "max": 50
      },
      "e0": {
        "desc": "초기 간극비 (시험)",
        "type": "number",
        "min": 0,
        "max": 5
      },
      "Cc": {
        "desc": "압축지수 (압밀시험 — 경험식 추정 안 함)",
        "type": "number",
        "min": 0,
        "max": 2
      },
      "Cr": {
        "desc": "재압축지수 (과압밀 검토 시 필수)",
        "type": "number",
        "min": 0,
        "max": 0.5
      },
      "sigma0_kPa": {
        "desc": "층 중앙 유효상재응력 σ0′",
        "type": "number",
        "min": 0
      },
      "dSigma_kPa": {
        "desc": "층 중앙 응력증가 Δσ (2:1법·Boussinesq 등 별도 산정 입력)",
        "type": "number",
        "min": 0
      },
      "sigmaP_kPa": {
        "desc": "선행압밀압력 σp′ (미입력=정규압밀 가정 명시)",
        "type": "number",
        "min": 0
      },
      "cv_m2yr": {
        "desc": "압밀계수 m²/yr (시간침하 산정 시)",
        "type": "number",
        "min": 0
      },
      "drainage": {
        "desc": "배수조건 (기본 double — Hdr=H/2)",
        "enum": [
          "double",
          "single"
        ]
      },
      "targetU_pct": {
        "desc": "목표 압밀도 % (기본 90)",
        "type": "number",
        "min": 10,
        "max": 99
      },
      "allowSettle_mm": {
        "desc": "허용 침하량 (판정용 — 발주 기준 입력)",
        "type": "number",
        "min": 0
      },
      "immediate": {
        "desc": "즉시침하(탄성 — 선택): { q_kPa(순하중), B_m(기초폭), Es_kPa(지반 탄성계수 — 시험 입력), nu?(0.3 기본), If?(영향계수 — 형상·강성 도표 입력, 기본 강성 원형 0.79π/4≈0.79 아님 — 유연 중앙 1.0 관례 명시) } — Se=q·B·(1−ν²)/Es·If 폐형"
      },
      "secondary": {
        "desc": "2차압밀(선택): { Calpha(2차압밀계수 — 시험 입력), t1_yr(1차완료 시점), t2_yr(설계수명) } — Ss=Cα·H/(1+e0)·log(t2/t1)"
      }
    }
  },
  {
    "id": "pile_capacity",
    "domain": "civil/foundation",
    "title": "말뚝 축방향 지지력 (정역학)",
    "description": "층별 α/β법 주면마찰+선단지지 → 극한·허용 지지력. 계수는 산정 입력 원칙.",
    "required": [
      "dia_m",
      "length_m",
      "layers"
    ],
    "params": {
      "dia_m": {
        "desc": "말뚝 직경 (원형 환산)",
        "type": "number",
        "min": 0,
        "max": 3
      },
      "length_m": {
        "desc": "근입 길이",
        "type": "number",
        "min": 0,
        "max": 80
      },
      "layers": {
        "desc": "지층 배열 [{thick_m, type: clay|sand, Su_kPa?(점토), alpha?(점토 α — 시험/도표 입력), sigmaVmid_kPa?(사질 층중앙 유효응력 — 지하수 반영 산정 입력), beta?(사질 β=K·tanδ)}] — 합계두께 ≥ 근입장"
      },
      "tip": {
        "desc": "선단 지반: { type: clay|sand, Su_kPa?(점토), Nc?(기본 9 고전값), sigmaVtip_kPa?(사질 선단 유효응력), Nq?(도표 산정 입력 — 필수, 지어내지 않음) }"
      },
      "FS": {
        "desc": "안전율 (기본 3.0 정역학 관례 — §4.1.1.4(3) 재하시험도 ≥2)",
        "type": "number",
        "min": 2,
        "max": 6
      },
      "demandP_kN": {
        "desc": "작용하중 (판정용)",
        "type": "number",
        "min": 0
      },
      "group": {
        "desc": "무리말뚝(선택): { n(본수), rows, cols, spacing_m } — 효율 Converse-Labarre 폐형(관례 명시): η=1−θ(( (rows−1)cols+(cols−1)rows )/(90·rows·cols)), θ=atan(D/s)°"
      },
      "negFriction": {
        "desc": "부주면마찰(선택): { depth_m(중립점 깊이 — 침하해석 산정 입력), fn_kPa(단위 부주면마찰 — α·Su 등 산정 입력) } — Qa에서 차감(보수 관례 명시)"
      }
    }
  },
  {
    "id": "planting_base",
    "domain": "landscape/planting",
    "title": "식재기반·수목 검토 (KDS 34 30 10/34 40 10)",
    "description": "생육토심 게이트·객토깊이·공원 식재밀도·이식 수목중량·규격환산 — 원문 표 전사.",
    "required": [],
    "params": {
      "soilCheck": {
        "desc": "생육토심 검토: { plantType: 잔디초화류|소관목|대관목|천근성교목|심근성교목, soilKind: artificial|natural|mixed, soilGrade?: mid|high(생육 판정용), providedDepth_cm, hasDrainLayer?: boolean }"
      },
      "densityCheck": {
        "desc": "식재밀도 검토: { parkType(표 4.2-1 키), area_m2, trees?, shrubs?, hedges? (계획 수량) }"
      },
      "treeWeight": {
        "desc": "이식 수목중량: { rootDia_cm?(근원 — 흉고 미지 시 표 4.4-3 환산·범위 밖은 ×0.8), dbh_cm?(흉고 직접), height_m?, trunkGroup: A|B|C|D(표 4.4-1 — A≥1340·B 1300~1340·C 1250~1300·D 1210~1250, 그룹 대표값 명시), leafFactor?(p 0.2~0.3 — 기본 0.25), rootBallVol_m3?(뿌리분 체적 — 별도 산정 입력 시 지하부 1,300kg/m³ 적용 §4.4.4(3)) }"
      },
      "soilReplace": {
        "desc": "객토 검토: { category: 교목|아교목|관목|지피초화류 } → 표 3.1-1 깊이"
      }
    }
  },
  {
    "id": "fixture_supply",
    "domain": "interior/plumbing",
    "title": "위생기구 급수 검토 (KDS 31 30 15)",
    "description": "기구별 유량·유동압력·최소관지름 게이트 + 설계유량 합산(동시사용률 입력 원칙).",
    "required": [
      "fixtures"
    ],
    "params": {
      "fixtures": {
        "desc": "기구 목록 [{type(표 키: 세면기·대변기_세정밸브 등), count, plannedDN?(계획 관지름 — 최소치 게이트)}]"
      },
      "simultaneity": {
        "desc": "동시사용률 (기본 1.0=전기구 동시 — 보수. KDS 미규정, 발주기준·기구단위법 산정 입력 원칙)",
        "type": "number",
        "min": 0,
        "max": 1
      },
      "supplyPressure_kPa": {
        "desc": "공급 압력 (기구 최저 유동압력·550kPa 상한 게이트)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "coupling_beam",
    "domain": "architecture/lateral",
    "title": "연결보 (특수전단벽 — §4.7.7)",
    "description": "세장비 분류·대각보강 필요 판정·식4.7-3 전단강도·상세 게이트.",
    "required": [
      "ln_mm",
      "h_mm",
      "b_mm",
      "fck",
      "Vu_kN"
    ],
    "params": {
      "ln_mm": {
        "desc": "연결보 순경간",
        "type": "number",
        "min": 0
      },
      "h_mm": {
        "desc": "보 깊이",
        "type": "number",
        "min": 0
      },
      "b_mm": {
        "desc": "보 폭 (Acp=b·h)",
        "type": "number",
        "min": 0
      },
      "fck": {
        "desc": "콘크리트 강도",
        "type": "number",
        "min": 21,
        "max": 70
      },
      "Vu_kN": {
        "desc": "계수전단력",
        "type": "number",
        "min": 0
      },
      "diagonal": {
        "desc": "대각보강 검토(선택): { Avd_mm2(한 다발 대각철근 총단면적), fy?, nBars?(다발 가닥수 — ≥4 게이트), alphaDeg?(대각 경사각 — 직접) 또는 zDiag_mm?(상·하 다발 도심 수직거리 — tanα=z/ln 산정), sTrans_mm?(횡철근 간격), db_mm?(대각철근 지름), option?(3|4 — §(4)③ 6db / ④ min(150,6db)) }"
      },
      "phiV": {
        "desc": "전단 강도감수계수 (기본 0.75 관례 — 대각보강 연결보 φ는 발주기준·KDS 14 20 10 확인 입력 명시)",
        "type": "number",
        "min": 0.5,
        "max": 0.9
      }
    }
  },
  {
    "id": "mass_haul",
    "domain": "civil/earthwork",
    "title": "유토곡선 (누적토량·운반)",
    "description": "측점별 절/성토 → 누적곡선·균형점·평균운반거리·잉여/부족 — 다짐 보정 반영.",
    "required": [
      "stations"
    ],
    "params": {
      "stations": {
        "desc": "구간 배열 [{sta_m(구간 끝 측점 위치), cut_m3, fill_m3}] — 측점 순서대로(구간장 임의)"
      },
      "shrinkC": {
        "desc": "다짐 토량환산 C (성토 필요 원지반토량 = fill/C, 기본 1.0=미반영 명시)",
        "type": "number",
        "min": 0.7,
        "max": 1
      },
      "freeHaul_m": {
        "desc": "무료 운반거리 (선택 — 초과 구간 표시. 장비·단가 판단은 별도 명시)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "bolt_group",
    "domain": "mechanical/connection",
    "title": "볼트군 편심 (탄성벡터법)",
    "description": "편심하중 볼트군 — 직접+비틀림 벡터합 최대 볼트력 vs φRn.",
    "required": [
      "bolts",
      "boltDia_mm",
      "Fnv_MPa"
    ],
    "params": {
      "bolts": {
        "desc": "볼트 좌표 [{x,y}] mm — 2~36개"
      },
      "boltDia_mm": {
        "desc": "볼트 지름 (Ab=π d²/4 — 나사부 전단이면 유효단면 별도 명시)",
        "type": "number",
        "min": 12,
        "max": 36
      },
      "Fnv_MPa": {
        "desc": "공칭전단강도 Fnv (등급별 — F10T-N 400 등 kds.json 대조 입력)",
        "type": "number",
        "min": 150,
        "max": 600
      },
      "Px_kN": {
        "desc": "수평력 (군 전체)",
        "type": "number"
      },
      "Py_kN": {
        "desc": "수직력",
        "type": "number"
      },
      "e_mm": {
        "desc": "편심 (Py 기준 x방향 — 도심에서)",
        "type": "number"
      },
      "Mz_kNm": {
        "desc": "직접 모멘트 입력(선택 — e 대신)",
        "type": "number"
      },
      "threadsIncluded": {
        "desc": "나사부 전단면 포함 여부 (true면 0.75Ab 관례 적용 명시)",
        "type": "boolean"
      }
    }
  },
  {
    "id": "shaft_design",
    "domain": "mechanical/power",
    "title": "전동축 설계 (굽힘+비틀림)",
    "description": "MSST/ASME 조합응력 — 소요지름 산정 또는 검토. 피로는 Se 입력 연계.",
    "required": [
      "M_Nm",
      "T_Nm"
    ],
    "params": {
      "M_Nm": {
        "desc": "굽힘모멘트 (지지점·하중 배치에서 산정 입력)",
        "type": "number",
        "min": 0
      },
      "T_Nm": {
        "desc": "비틀림 토크 (동력/각속도 산정 입력)",
        "type": "number",
        "min": 0
      },
      "d_mm": {
        "desc": "축 지름 (입력 시 검토 모드 · 미입력 시 소요지름 산정)",
        "type": "number",
        "min": 0,
        "max": 500
      },
      "tauAllow_MPa": {
        "desc": "허용전단응력 (재료·기준 산정 입력 — ASME 관례 0.3Sy·0.18Su 중 작은 값, 키홈 시 75% — 산정 근거 입력 원칙)",
        "type": "number",
        "min": 0
      },
      "Km": {
        "desc": "굽힘 충격계수 (기본 1.5 — 회전축 정하중 관례 명시)",
        "type": "number",
        "min": 1,
        "max": 3
      },
      "Kt": {
        "desc": "비틀림 충격계수 (기본 1.0)",
        "type": "number",
        "min": 1,
        "max": 3
      },
      "Se_MPa": {
        "desc": "피로한도 (선택 — 입력 시 Soderberg 피로검토: 굽힘 완전교번·비틀림 정상 가정 명시)",
        "type": "number",
        "min": 0
      },
      "Sy_MPa": {
        "desc": "항복강도 (Soderberg용)",
        "type": "number",
        "min": 0
      },
      "fatigueSF": {
        "desc": "피로 목표 안전율 (기본 2.0 관례)",
        "type": "number",
        "min": 1,
        "max": 5
      }
    }
  },
  {
    "id": "spring_design",
    "domain": "mechanical/element",
    "title": "압축 코일스프링 (Wahl)",
    "description": "전단응력(Wahl 보정)·스프링상수·처짐·좌굴/밀착 게이트.",
    "required": [
      "d_mm",
      "D_mm",
      "Na",
      "G_MPa",
      "F_N"
    ],
    "params": {
      "d_mm": {
        "desc": "선경",
        "type": "number",
        "min": 0,
        "max": 50
      },
      "D_mm": {
        "desc": "평균 코일경",
        "type": "number",
        "min": 0,
        "max": 500
      },
      "Na": {
        "desc": "유효 감김수",
        "type": "number",
        "min": 1,
        "max": 50
      },
      "G_MPa": {
        "desc": "전단탄성계수 (강 78,500~81,500 — 재료값 입력)",
        "type": "number",
        "min": 60000,
        "max": 90000
      },
      "F_N": {
        "desc": "작용 하중",
        "type": "number",
        "min": 0
      },
      "tauAllow_MPa": {
        "desc": "허용전단응력 (재료·선경 의존 — KS 자료 산정 입력. 미입력=INFO)",
        "type": "number",
        "min": 0
      },
      "freeLen_mm": {
        "desc": "자유고 (좌굴·밀착 게이트용)",
        "type": "number",
        "min": 0
      },
      "totalCoils": {
        "desc": "총 감김수 (밀착고 = d×총감김 — 연삭 단부 관례)",
        "type": "number",
        "min": 2
      }
    }
  },
  {
    "id": "bearing_life",
    "domain": "mechanical/element",
    "title": "베어링 수명 L10 (ISO 281 기본식)",
    "description": "기본 정격수명 + 신뢰도 보정 — C·X·Y는 카탈로그 입력 원칙.",
    "required": [
      "C_kN",
      "type",
      "n_rpm"
    ],
    "params": {
      "C_kN": {
        "desc": "기본 동정격하중 (카탈로그)",
        "type": "number",
        "min": 0
      },
      "type": {
        "desc": "볼(p=3) / 롤러(p=10/3)",
        "enum": [
          "ball",
          "roller"
        ]
      },
      "Fr_kN": {
        "desc": "레이디얼 하중",
        "type": "number",
        "min": 0
      },
      "Fa_kN": {
        "desc": "축하중 (X·Y 필요)",
        "type": "number",
        "min": 0
      },
      "X": {
        "desc": "레이디얼 계수 (카탈로그 — Fa 있으면 필수)",
        "type": "number",
        "min": 0,
        "max": 1
      },
      "Y": {
        "desc": "축 계수 (카탈로그)",
        "type": "number",
        "min": 0,
        "max": 5
      },
      "n_rpm": {
        "desc": "회전수",
        "type": "number",
        "min": 0
      },
      "reliability_pct": {
        "desc": "신뢰도 % (기본 90 — a1=ISO 표준값)",
        "enum": [
          90,
          95,
          96,
          97,
          98,
          99
        ]
      },
      "aIso": {
        "desc": "수명수정계수 a_iso (윤활·오염 도표 산정 입력 — 기본 1.0=미반영 명시)",
        "type": "number",
        "min": 0.1,
        "max": 50
      },
      "targetHours": {
        "desc": "목표 수명 h (판정용 — 장비 관례 입력)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "tolerance_stack",
    "domain": "mechanical/precision",
    "title": "공차 스택업 (최악/RSS)",
    "description": "치수 사슬 → 결과 공차(최악·RSS)·목표 범위 판정 — 조립 간극/끼움 검토.",
    "required": [
      "chain"
    ],
    "params": {
      "chain": {
        "desc": "치수 사슬 [{name?, nominal_mm, tol_mm(±대칭), dir(+1|-1 — 닫힘 방향)}] 2~30개"
      },
      "targetMin_mm": {
        "desc": "결과치수 하한 (간극 최소 등 — 판정용)",
        "type": "number"
      },
      "targetMax_mm": {
        "desc": "결과치수 상한",
        "type": "number"
      }
    }
  },
  {
    "id": "reverb_time",
    "domain": "interior/acoustics",
    "title": "잔향시간 (Sabine·Eyring)",
    "description": "실체적·표면 흡음 → RT60 2법 병기 — 흡음률·목표값 입력 원칙.",
    "required": [
      "volume_m3",
      "surfaces"
    ],
    "params": {
      "volume_m3": {
        "desc": "실 체적",
        "type": "number",
        "min": 0,
        "max": 100000
      },
      "surfaces": {
        "desc": "표면 배열 [{name?, area_m2, alpha(0~1 — 재료 자료 입력, 주파수 명시 권장)}] 1~30"
      },
      "airAbsorb": {
        "desc": "공기흡음 4mV 반영 (2kHz+ 대역·대공간 — m=0.009/m 관례 명시)",
        "type": "boolean"
      },
      "targetRT_s": {
        "desc": "권장 잔향시간 (용도 기준 입력 — 판정용)",
        "type": "number",
        "min": 0
      },
      "tolerance_pct": {
        "desc": "허용 편차 % (기본 20 관례)",
        "type": "number",
        "min": 5,
        "max": 50
      }
    }
  },
  {
    "id": "point_illuminance",
    "domain": "interior/lighting",
    "title": "점별 조도 (역제곱·코사인)",
    "description": "기구 배치 → 임의 점 수평면 조도 그리드 — 광속법의 정밀판. IES는 입력.",
    "required": [
      "fixtures",
      "planeZ_m"
    ],
    "params": {
      "fixtures": {
        "desc": "기구 [{x_m, y_m, z_m(설치고), flux_lm?(등방 근사용) 또는 I_cd?(하향 대표 광도 — IES 대표값 입력)}] 1~50"
      },
      "planeZ_m": {
        "desc": "작업면 높이 (통상 0.85)",
        "type": "number",
        "min": 0
      },
      "points": {
        "desc": "평가점 [{x_m,y_m}] (미입력 시 기구 아래+중간점 자동)"
      },
      "maintenance": {
        "desc": "유지율 MF (기본 0.8 관례)",
        "type": "number",
        "min": 0.5,
        "max": 1
      },
      "targetLux": {
        "desc": "목표 조도 (KS 조도기준 입력 — 판정용)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "expansion_joint",
    "domain": "bridge/detail",
    "title": "신축이음 이동량",
    "description": "온도+크리프+건조수축 합산 → 소요 이동량·유간 — 계수 입력 원칙.",
    "required": [
      "L_m",
      "dTplus_C",
      "dTminus_C"
    ],
    "params": {
      "L_m": {
        "desc": "신축 길이 (고정점~이음부 — 지점 배치에서 산정 입력)",
        "type": "number",
        "min": 0,
        "max": 1000
      },
      "material": {
        "desc": "상부 재료 (α 1.0e-5 / 1.2e-5 관례 — 기본 concrete)",
        "enum": [
          "concrete",
          "steel"
        ]
      },
      "dTplus_C": {
        "desc": "상승 온도차 (가설온도→최고 — 발주 기준 입력)",
        "type": "number",
        "min": 0,
        "max": 60
      },
      "dTminus_C": {
        "desc": "하강 온도차 (가설온도→최저)",
        "type": "number",
        "min": 0,
        "max": 60
      },
      "creepStrain_ue": {
        "desc": "잔여 크리프 변형률 με (PSC — KDS 24 14 21 산정 입력. 0=미반영 명시)",
        "type": "number",
        "min": 0,
        "max": 1000
      },
      "shrinkStrain_ue": {
        "desc": "잔여 건조수축 με (산정 입력)",
        "type": "number",
        "min": 0,
        "max": 1000
      },
      "marginFactor": {
        "desc": "여유율 (기본 1.15 관례 — 발주 기준 확인)",
        "type": "number",
        "min": 1,
        "max": 1.5
      },
      "jointCapacity_mm": {
        "desc": "이음 제품 이동량 용량 (판정용)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "pump_head",
    "domain": "landscape/water",
    "title": "펌프 전양정·동력",
    "description": "정수두+마찰(H-W)+부차손실+잔류수두 → 전양정·수동력/축동력.",
    "required": [
      "Q_Lmin",
      "staticHead_m",
      "pipeDia_mm",
      "pipeLen_m"
    ],
    "params": {
      "Q_Lmin": {
        "desc": "유량 L/min",
        "type": "number",
        "min": 0
      },
      "staticHead_m": {
        "desc": "정수두 (흡입저면~토출 최고점)",
        "type": "number",
        "min": 0
      },
      "pipeDia_mm": {
        "desc": "관 내경",
        "type": "number",
        "min": 0
      },
      "pipeLen_m": {
        "desc": "관 연장",
        "type": "number",
        "min": 0
      },
      "hwC": {
        "desc": "Hazen-Williams C (기본 130 PVC 관례 — 재질 확인)",
        "type": "number",
        "min": 80,
        "max": 160
      },
      "sumK": {
        "desc": "부차손실계수 합 ΣK (엘보·밸브 — 자료 입력, 기본 0=미반영 명시)",
        "type": "number",
        "min": 0,
        "max": 100
      },
      "residualHead_m": {
        "desc": "잔류수두 (분수 노즐 사양 등 — 입력)",
        "type": "number",
        "min": 0
      },
      "efficiency": {
        "desc": "펌프 효율 (사양 입력 — 미입력 시 수동력만)",
        "type": "number",
        "min": 0.2,
        "max": 0.9
      }
    }
  },
  {
    "id": "steel_beam",
    "domain": "architecture/steel",
    "title": "강재 보 (H형강 콤팩트·강축)",
    "description": "소성휨·횡비틀림좌굴(Lp/Lr/탄성) 3구간 + 전단 — KDS 14 31 10 원문식.",
    "required": [
      "Zx_mm3",
      "Sx_mm3",
      "ry_mm",
      "Fy_MPa",
      "Lb_mm",
      "Mu_kNm"
    ],
    "params": {
      "Zx_mm3": {
        "desc": "소성단면계수 (KS 형강표 입력)",
        "type": "number",
        "min": 0
      },
      "Sx_mm3": {
        "desc": "탄성단면계수",
        "type": "number",
        "min": 0
      },
      "ry_mm": {
        "desc": "약축 회전반경",
        "type": "number",
        "min": 0
      },
      "rts_mm": {
        "desc": "유효 회전반경 (Lb>Lp 시 필요 — 형강표)",
        "type": "number",
        "min": 0
      },
      "J_mm4": {
        "desc": "비틀림상수 (Lb>Lp 시 필요)",
        "type": "number",
        "min": 0
      },
      "h0_mm": {
        "desc": "플랜지 도심간 거리 (Lb>Lp 시 필요)",
        "type": "number",
        "min": 0
      },
      "Fy_MPa": {
        "desc": "항복강도 (SS275→275 등 — 강종 확인)",
        "type": "number",
        "min": 235,
        "max": 460
      },
      "E_MPa": {
        "desc": "탄성계수 (기본 205,000 — KDS 강재 표준값)",
        "type": "number",
        "min": 190000,
        "max": 215000
      },
      "Lb_mm": {
        "desc": "비지지길이",
        "type": "number",
        "min": 0
      },
      "Cb": {
        "desc": "횡좌굴 보정계수 (기본 1.0 안전측 — 원문 명시)",
        "type": "number",
        "min": 1,
        "max": 3
      },
      "Mu_kNm": {
        "desc": "계수휨모멘트",
        "type": "number",
        "min": 0
      },
      "Vu_kN": {
        "desc": "계수전단력 (선택)",
        "type": "number",
        "min": 0
      },
      "Aw_mm2": {
        "desc": "웨브 단면적 d×tw (전단 검토 시)",
        "type": "number",
        "min": 0
      },
      "h_tw": {
        "desc": "웨브 h/tw (전단 φv·Cv 판정 — 형강표)",
        "type": "number",
        "min": 0
      },
      "bf_2tf": {
        "desc": "플랜지 b/2tf (콤팩트 게이트 — 미입력 시 콤팩트 가정 명시)",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "steel_column",
    "domain": "architecture/steel",
    "title": "강재 기둥 (휨좌굴 — KDS 원문)",
    "description": "Fcr 2구간(0.658^λ·0.877Fe)·φc0.90 — 비세장판 단면 한정.",
    "required": [
      "Ag_mm2",
      "r_mm",
      "K",
      "L_mm",
      "Fy_MPa",
      "Pu_kN"
    ],
    "params": {
      "Ag_mm2": {
        "desc": "총단면적",
        "type": "number",
        "min": 0
      },
      "r_mm": {
        "desc": "지배축 회전반경 (min(rx,ry) 통상)",
        "type": "number",
        "min": 0
      },
      "K": {
        "desc": "유효길이계수 (표 4.2-3 — 지지조건 판단 입력)",
        "type": "number",
        "min": 0.5,
        "max": 2.4
      },
      "L_mm": {
        "desc": "비지지길이",
        "type": "number",
        "min": 0
      },
      "Fy_MPa": {
        "desc": "항복강도",
        "type": "number",
        "min": 235,
        "max": 460
      },
      "E_MPa": {
        "desc": "탄성계수 (기본 205,000)",
        "type": "number",
        "min": 190000,
        "max": 215000
      },
      "Pu_kN": {
        "desc": "계수축력",
        "type": "number",
        "min": 0
      },
      "slenderLimit": {
        "desc": "세장비 한계 (기본 200 건축 관례 — 교량 주부재/가새는 발주·원문 확인 입력)",
        "type": "number",
        "min": 100,
        "max": 250
      }
    }
  },
  {
    "id": "earth_retention",
    "domain": "civil/excavation",
    "title": "가설흙막이 (경험토압·버팀대·근입·히빙/보일링)",
    "description": "Peck 토압→버팀 반력→근입 FS 1.2→굴착저면 안정 — KDS 21 30 00 원문.",
    "required": [
      "H_m",
      "soil",
      "gamma"
    ],
    "params": {
      "H_m": {
        "desc": "굴착깊이",
        "type": "number",
        "min": 0,
        "max": 30
      },
      "soil": {
        "desc": "지반 (Peck 3분류 — 경험토압은 H≥6m 좁은 굴착 버팀 지지 전제 원문 명시)",
        "enum": [
          "sand",
          "softClay",
          "stiffClay"
        ]
      },
      "gamma": {
        "desc": "단위중량 kN/m³",
        "type": "number",
        "min": 14,
        "max": 22
      },
      "phi": {
        "desc": "내부마찰각 (sand 필수)",
        "type": "number",
        "min": 20,
        "max": 45
      },
      "su_kPa": {
        "desc": "비배수전단강도 (clay 필수)",
        "type": "number",
        "min": 0
      },
      "mCoef": {
        "desc": "stiffClay 계수 (0.2~0.4γH — 기본 0.3 중앙 명시)",
        "type": "number",
        "min": 0.2,
        "max": 0.4
      },
      "struts": {
        "desc": "버팀 단수 배열 [z_m(지표부터 깊이)] — 1~8단"
      },
      "spacing_m": {
        "desc": "띠장(수평) 방향 버팀보 간격 (기본 2.5 관례)",
        "type": "number",
        "min": 0,
        "max": 10
      },
      "D_m": {
        "desc": "근입깊이 (근입 FS 검토 시)",
        "type": "number",
        "min": 0
      },
      "hw_m": {
        "desc": "내외 수위차 (보일링 검토 — 사질)",
        "type": "number",
        "min": 0
      },
      "gammaSub": {
        "desc": "수중단위중량 γ′ (보일링 — 기본 γ−9.81)",
        "type": "number",
        "min": 7,
        "max": 13
      },
      "B_m": {
        "desc": "굴착폭 (히빙 검토 — 점토)",
        "type": "number",
        "min": 0
      },
      "surcharge_kPa": {
        "desc": "상재하중",
        "type": "number",
        "min": 0
      },
      "fsBoilHeave": {
        "desc": "히빙/보일링 요구 안전율 (기본 1.5 관례 — 발주 기준 우선 §3.2.1(6))",
        "type": "number",
        "min": 1.2,
        "max": 3
      }
    }
  },
  {
    "id": "pavement_walk",
    "domain": "landscape/pavement",
    "title": "보도포장 (줄눈·층구성·수량)",
    "description": "콘크리트 줄눈 간격 게이트(원문 수치)+층 구성 검증+포장·줄눈 수량.",
    "required": [
      "type",
      "length_m",
      "width_m"
    ],
    "params": {
      "type": {
        "desc": "포장 유형 (줄눈 게이트는 콘크리트만)",
        "enum": [
          "concrete_linear",
          "concrete_plaza",
          "block",
          "flexible"
        ]
      },
      "length_m": {
        "desc": "연장 (광장이면 대표 변)",
        "type": "number",
        "min": 0,
        "max": 5000
      },
      "width_m": {
        "desc": "폭",
        "type": "number",
        "min": 0,
        "max": 100
      },
      "expJoint_m": {
        "desc": "계획 팽창줄눈 간격 (선형 — 게이트 9m)",
        "type": "number",
        "min": 0
      },
      "conJoint_m": {
        "desc": "계획 수축줄눈 간격 (선형 — 게이트 3m)",
        "type": "number",
        "min": 0
      },
      "panelArea_m2": {
        "desc": "광장 분할 패널 면적 (팽창 36m²·수축 9m² 게이트)",
        "type": "number",
        "min": 0
      },
      "layers": {
        "desc": "층 구성 배열 [{name, thk_mm}] — 두께=발주/KS 입력(검증은 구성만·두께 합산 수량)"
      },
      "structureType": {
        "desc": "구조 형식 (§1.6.3 구성 검증 — 기본 simple)",
        "enum": [
          "flexible",
          "rigid",
          "simple"
        ]
      }
    }
  },
  {
    "id": "smf_detail",
    "domain": "architecture/seismic",
    "title": "특수모멘트골조 상세 게이트 (§4.4~4.5)",
    "description": "SMF 보·기둥 내진 상세(치수·철근비·후프량·간격·강기둥-약보) 전 게이트.",
    "required": [
      "member"
    ],
    "params": {
      "member": {
        "desc": "부재 구분",
        "enum": [
          "beam",
          "column"
        ]
      },
      "b_mm": {
        "desc": "폭(보)/최소 단면치수(기둥)",
        "type": "number",
        "min": 0
      },
      "h_mm": {
        "desc": "깊이(보)/직각방향 치수(기둥)",
        "type": "number",
        "min": 0
      },
      "d_mm": {
        "desc": "유효깊이(보)",
        "type": "number",
        "min": 0
      },
      "ln_mm": {
        "desc": "순경간(보 — ln≥4d 게이트)",
        "type": "number",
        "min": 0
      },
      "Pu_kN": {
        "desc": "계수축력 (적용 구분 Agfck/10)",
        "type": "number",
        "min": 0
      },
      "fck": {
        "desc": "",
        "type": "number",
        "min": 21,
        "max": 70
      },
      "fy": {
        "desc": "축방향 철근 fy",
        "type": "number",
        "min": 300,
        "max": 600
      },
      "fyh": {
        "desc": "횡방향 철근 fyh (기둥 후프량)",
        "type": "number",
        "min": 300,
        "max": 600
      },
      "As_mm2": {
        "desc": "주철근량 (보 ρ·기둥 ρg)",
        "type": "number",
        "min": 0
      },
      "db_mm": {
        "desc": "축방향 철근 지름 (간격 게이트)",
        "type": "number",
        "min": 0
      },
      "dbh_mm": {
        "desc": "후프 지름 (보 24dh)",
        "type": "number",
        "min": 0
      },
      "s_mm": {
        "desc": "후프/횡철근 간격 (계획)",
        "type": "number",
        "min": 0
      },
      "hc_mm": {
        "desc": "심부 치수 hc (기둥 Ash — 후프 중심간)",
        "type": "number",
        "min": 0
      },
      "Ach_mm2": {
        "desc": "심부 면적 (기둥 4.5-3)",
        "type": "number",
        "min": 0
      },
      "Ash_mm2": {
        "desc": "제공 후프 단면적 (간격 s당)",
        "type": "number",
        "min": 0
      },
      "hx_mm": {
        "desc": "연결철근/후프다리 수평간격 (식4.5-5)",
        "type": "number",
        "min": 0
      },
      "sumMc_kNm": {
        "desc": "기둥 설계휨강도 합 (강기둥-약보)",
        "type": "number",
        "min": 0
      },
      "sumMg_kNm": {
        "desc": "보 설계휨강도 합",
        "type": "number",
        "min": 0
      },
      "MposFace_kNm": {
        "desc": "접합면 정모멘트 강도 (보 §4.4.2(2))",
        "type": "number",
        "min": 0
      },
      "MnegFace_kNm": {
        "desc": "접합면 부모멘트 강도",
        "type": "number",
        "min": 0
      }
    }
  },
  {
    "id": "longterm_deflection",
    "domain": "architecture/serviceability",
    "title": "RC 장기처짐 (λΔ — §4.2.1)",
    "description": "λΔ=ξ/(1+50ρ′)·표 4.2-2 허용처짐 판정 — 순간처짐은 산정 입력.",
    "required": [
      "span_mm",
      "instSustained_mm",
      "duration_months",
      "memberType"
    ],
    "params": {
      "span_mm": {
        "desc": "경간 l",
        "type": "number",
        "min": 0
      },
      "instSustained_mm": {
        "desc": "지속하중(고정+지속활하중)에 의한 순간처짐 (Ie 반영 산정 입력)",
        "type": "number",
        "min": 0
      },
      "instLive_mm": {
        "desc": "활하중 순간처짐 (표 4.2-2 조합용)",
        "type": "number",
        "min": 0
      },
      "duration_months": {
        "desc": "지속 기간 (60=5년 이상 — ξ 원문 4단)",
        "enum": [
          3,
          6,
          12,
          60
        ]
      },
      "rhoPrime": {
        "desc": "압축철근비 ρ′ (중앙부·캔틸레버는 받침부 — 원문. 0=압축철근 없음)",
        "type": "number",
        "min": 0,
        "max": 0.04
      },
      "memberType": {
        "desc": "표 4.2-2 부재 구분 (손상쉬운 요소 지지 여부)",
        "enum": [
          "roof_nofragile",
          "floor_nofragile",
          "fragile",
          "nonfragile_attached"
        ]
      }
    }
  },
  {
    "id": "drainage_vent",
    "domain": "interior/plumbing",
    "title": "배수관 관지름 (DFU법 — KDS 31 30 25)",
    "description": "기구 DFU 합산 → 수평지관·수직관·수평주관 관지름 선정 + 기울기·대변기 게이트.",
    "required": [
      "fixtures",
      "segment"
    ],
    "params": {
      "fixtures": {
        "desc": "기구 [{type(표 4.1-2 키), count}] — 키: 욕조·세탁기·식기세척기·음수기·주방싱크·주방싱크_식세기포함·세면기·청소싱크·샤워부스·소변기_4L·소변기_4L초과·대변기_6L·대변기_13L·싱크_DN40·싱크_DN50"
      },
      "building": {
        "desc": "건물 구분 (표 4.1-2 열 — 기본 general. 공동주택 미규정 기구는 일반값 폴백 명시)",
        "enum": [
          "general",
          "apartment"
        ]
      },
      "segment": {
        "desc": "구간 (수평지관/수직관/수평주관)",
        "enum": [
          "branch",
          "stack",
          "main"
        ]
      },
      "floors": {
        "desc": "층수 (수직관 — 3층 이하/4층+ 표 구분)",
        "type": "integer",
        "min": 1,
        "max": 100
      },
      "slope": {
        "desc": "수평주관 기울기 (표 4.1-4 열)",
        "enum": [
          "1/200",
          "1/100",
          "1/50"
        ]
      },
      "hasWC": {
        "desc": "대변기 포함 여부 (수평주관 최소 DN80 — 표 4.1-4 주1)",
        "type": "boolean"
      },
      "plannedDN": {
        "desc": "계획 관지름 (판정용)",
        "type": "number"
      }
    }
  },
  {
    "id": "liquefaction",
    "domain": "civil/seismic",
    "title": "액상화 평가 (§4.7 — 예비+본평가)",
    "description": "층별 예비평가 생략 게이트 + FS=CRR/CSR 본평가 — CRR·rd 산정 입력 원칙.",
    "required": [
      "layers"
    ],
    "params": {
      "layers": {
        "desc": "층 배열(두께 1.5m 이하 단위 — 원문) [{z_m(중심 심도), aboveGWT?(최고지하수위 상부), N_SPT?(미보정), zoneC?(그림4.7-1 영역C 판정 입력), sigmaV_kPa?, sigmaVe_kPa?, CRR?(시험 산정), tauMax_kPa?(지반응답해석 시)}]"
      },
      "amax_g": {
        "desc": "지표면 최대지반가속도 (g — 지반응답해석/성능목표 재현주기 산정 입력)",
        "type": "number",
        "min": 0,
        "max": 1
      },
      "rd": {
        "desc": "응력감소계수 (산정 입력 — 관례식 사용 시 근거 명시. 층별 다르면 layers에 개별 CSR 위해 tauMax 사용 권장)",
        "type": "number",
        "min": 0.3,
        "max": 1
      }
    }
  },
  {
    "id": "elastomeric_bearing",
    "domain": "bridge/bearing",
    "title": "탄성받침 (강재보강 — §4.2.3)",
    "description": "형상계수·압축/전단/회전 변형률·총변형률 — 전단 0.7/1.0 한계 원문.",
    "required": [
      "a_mm",
      "b_mm",
      "ti_mm",
      "nLayers",
      "G_MPa",
      "Fz_kN"
    ],
    "params": {
      "a_mm": {
        "desc": "받침 나비 a (유효 a′=강판 치수 — 피복 제외 입력 권장)",
        "type": "number",
        "min": 0
      },
      "b_mm": {
        "desc": "받침 길이 b",
        "type": "number",
        "min": 0
      },
      "ti_mm": {
        "desc": "개별 고무층 두께",
        "type": "number",
        "min": 0,
        "max": 30
      },
      "nLayers": {
        "desc": "고무층 수",
        "type": "integer",
        "min": 2,
        "max": 30
      },
      "G_MPa": {
        "desc": "전단탄성계수 (표 4.2-4 등급 — 0.9 통상, 제품값 입력)",
        "type": "number",
        "min": 0.6,
        "max": 1.2
      },
      "Fz_kN": {
        "desc": "설계 수직하중",
        "type": "number",
        "min": 0
      },
      "vxy_mm": {
        "desc": "수평 상대변위 (온도+크리프 등 벡터합 — expansion_joint 연계)",
        "type": "number",
        "min": 0
      },
      "limitState": {
        "desc": "한계상태 (전단 한계 0.7/1.0 — 원문)",
        "enum": [
          "service",
          "ultimate"
        ]
      },
      "alphaA_rad": {
        "desc": "회전각 a방향 (구조해석 입력)",
        "type": "number",
        "min": 0
      },
      "alphaB_rad": {
        "desc": "회전각 b방향",
        "type": "number",
        "min": 0
      },
      "KL": {
        "desc": "하중계수 KL (원문 §4.2.3.6 확인 입력 — 기본 1.0)",
        "type": "number",
        "min": 1,
        "max": 2
      },
      "totalStrainLimit": {
        "desc": "총변형률 한계 (원문 §4.2.3.6 확인 입력 — 미입력 시 총변형률 INFO 보고만·판정 안 함)",
        "type": "number",
        "min": 0
      },
      "Ar_mm2": {
        "desc": "유효 재하면적 Ar (변위 감소 반영 — 기본 a×b 명시)",
        "type": "number",
        "min": 0
      }
    }
  }
];
