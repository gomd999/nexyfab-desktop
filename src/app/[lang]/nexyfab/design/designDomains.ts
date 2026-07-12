/**
 * 설계 분야 레지스트리(프론트) — "각 문이 진짜 다른 경험"이 되도록 분야별 프리셋 갤러리 +
 * 검증 분야 매핑을 담는다. 사이드바 분할·`?domain=` 진입·검증 패널 기본 분야가 모두 이걸 참조.
 *
 * 정직성: 프리셋은 **compose가 실제로 만들어내는 시드 프롬프트**(AI 생성이라 결과는 변동 가능).
 * verifyDomain=null인 분야(기계·판금)는 공통 코어(manifold·치수)만으로 정직하게 검증한다
 * (구조 계산기 없음). 나머지는 draft 계산기(비법정 참고)를 분야 패널에 연결.
 */

export interface DesignPreset {
  titleKo: string;
  titleEn: string;
  /** compose에 넣을 시드 설명(한국어). */
  promptKo: string;
  promptEn: string;
}

export interface DesignDomain {
  /** UI slug (URL ?domain=). */
  slug: string;
  icon: string;
  labelKo: string;
  labelEn: string;
  descKo: string;
  descEn: string;
  /** domain-verify.mjs의 분야 slug. null이면 공통 코어(manifold·치수)만. */
  verifyDomain: string | null;
  /** 결정론 파라메트릭 프리셋(GET/POST /api/nexyfab/drawing/preset) 제공 여부. */
  parametric?: boolean;
  presets: DesignPreset[];
}

export const DESIGN_DOMAINS: DesignDomain[] = [
  {
    slug: 'mech',
    icon: '🔧',
    labelKo: '기계·장비·판금',
    labelEn: 'Machinery / sheet metal',
    descKo: '파트·판금·프레임 부재. 검증=치수·manifold(공통 코어).',
    descEn: 'Parts, sheet metal, frame members. Verified by manifold & dimensions.',
    verifyDomain: null,
    parametric: true,
    presets: [
      {
        titleKo: '알루미늄 플레이트 (볼트홀)',
        titleEn: 'Aluminium plate (bolt holes)',
        promptKo: '가로 300 세로 200 두께 12 알루미늄 플레이트, 네 모서리에 지름 8 볼트홀, 중앙에 지름 40 관통',
        promptEn: 'Aluminium plate 300 x 200 x 12, 8mm bolt holes at four corners, 40mm through-hole in the middle',
      },
      {
        titleKo: 'L 브래킷',
        titleEn: 'L-bracket',
        promptKo: 'L자 브래킷, 다리 각 80mm, 두께 6, 각 면에 지름 6 홀 2개',
        promptEn: 'L-bracket, 80mm legs, 6mm thick, two 6mm holes per face',
      },
      {
        titleKo: '각관 프레임 부재',
        titleEn: 'Square tube member',
        promptKo: '각관 프레임 부재, 단면 50×50 벽두께 3, 길이 1000',
        promptEn: 'Square tube frame member, 50x50 section, 3mm wall, 1000mm long',
      },
    ],
  },
  {
    slug: 'rack',
    icon: '🏗',
    labelKo: '가설·랙·경량철골',
    labelEn: 'Temporary / rack / light steel',
    descKo: '포스트·빔 부재. 검증=압축재 좌굴·단순보 휨(형상서 단면·경간 파생).',
    descEn: 'Posts & beams. Verified by column buckling / beam bending (section & span from geometry).',
    verifyDomain: 'temporary-rack',
    parametric: true,
    presets: [
      {
        titleKo: '랙 포스트 (각관)',
        titleEn: 'Rack post (square tube)',
        promptKo: '랙 포스트, 각관 단면 100×100 벽두께 4, 높이 3000',
        promptEn: 'Rack post, 100x100 square tube, 4mm wall, 3000mm tall',
      },
      {
        titleKo: '보 부재 (직사각 단면)',
        titleEn: 'Beam member (rect section)',
        promptKo: '보 부재, 직사각 단면 폭 75 높이 150, 길이 2400',
        promptEn: 'Beam member, 75 x 150 rectangular section, 2400mm long',
      },
    ],
  },
  {
    slug: 'civil',
    icon: '🌉',
    labelKo: '토목 소구조물',
    labelEn: 'Civil small structures',
    descKo: '옹벽·암거. 검증=옹벽 안정(전도·활동·지지력, 조건 입력).',
    descEn: 'Retaining walls & culverts. Verified by wall stability (overturn / slide / bearing).',
    verifyDomain: 'civil',
    presets: [
      {
        titleKo: '옹벽 단면 (L형)',
        titleEn: 'Retaining wall section (L)',
        promptKo: '옹벽 단면 압출: L형 프로파일, 벽고 3000 벽두께 300, 저판 폭 2000 두께 400, 길이 1000',
        promptEn: 'Retaining wall as an extruded L-profile: 3000 tall, 300 stem, 2000 base width, 400 base thick, 1000 long',
      },
      {
        titleKo: '박스 암거',
        titleEn: 'Box culvert',
        promptKo: '박스 암거, 내부 1500×1500 벽두께 200, 길이 2000',
        promptEn: 'Box culvert, 1500 x 1500 inner, 200mm walls, 2000mm long',
      },
    ],
  },
  {
    slug: 'building',
    icon: '🏢',
    labelKo: '건축 부재',
    labelEn: 'Building member (RC)',
    descKo: 'RC 보·기둥 단면. 검증=RC 보 휨·전단(단면 b·d 형상서 파생, 철근·하중 입력).',
    descEn: 'RC beams & columns. Verified by RC beam flexure/shear (b·d from geometry).',
    verifyDomain: 'building-member',
    presets: [
      {
        titleKo: 'RC 보 단면',
        titleEn: 'RC beam section',
        promptKo: 'RC 보 부재, 직사각 단면 폭 300 높이 600, 길이 6000',
        promptEn: 'RC beam member, 300 x 600 rectangular section, 6000mm long',
      },
      {
        titleKo: 'RC 기둥 단면',
        titleEn: 'RC column section',
        promptKo: 'RC 기둥, 정사각 단면 500×500, 높이 3000',
        promptEn: 'RC column, 500 x 500 square section, 3000mm tall',
      },
    ],
  },
  {
    slug: 'landscape',
    icon: '🌳',
    labelKo: '조경 구조·배수',
    labelEn: 'Landscape / drainage',
    descKo: '데크 부재·측구. 검증=우수 배수(합리식, 유역·강우 입력).',
    descEn: 'Deck members & channels. Verified by stormwater (rational method).',
    verifyDomain: 'landscape',
    presets: [
      {
        titleKo: '데크 보',
        titleEn: 'Deck joist',
        promptKo: '데크 보, 직사각 단면 폭 100 높이 200, 길이 3000',
        promptEn: 'Deck joist, 100 x 200 section, 3000mm long',
      },
      {
        titleKo: 'U형 측구',
        titleEn: 'U-channel drain',
        promptKo: 'U형 측구 압출, 내부 폭 300 깊이 300 벽두께 50, 길이 2000',
        promptEn: 'U-shaped drainage channel, 300 wide, 300 deep, 50mm walls, 2000mm long',
      },
    ],
  },
];

export function findDomain(slug: string | null | undefined): DesignDomain | null {
  if (!slug) return null;
  return DESIGN_DOMAINS.find((d) => d.slug === slug) ?? null;
}
