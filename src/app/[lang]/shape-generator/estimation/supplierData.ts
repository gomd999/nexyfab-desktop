/**
 * supplierData.ts — Korean SMB manufacturing supplier directory.
 *
 * Static seed data (JSON-compatible). In production this would be fetched
 * from a managed database, but a local seed lets the feature work offline
 * and in demos without a backend call.
 */

export type ProcessType = 'cnc' | 'sheetmetal_laser' | 'fdm' | 'sla' | 'sls' | 'injection';

export interface Supplier {
  id: string;
  name: string;
  nameKo: string;
  region: string;        // 시/도 code, e.g. 'gyeonggi', 'seoul'
  regionLabel: string;   // 경기도
  processes: ProcessType[];
  materials: string[];   // material ids this shop handles
  leadTimeDays: { min: number; max: number };
  ratingStars: number;   // 1-5 (0.5 steps)
  reviewCount: number;
  certifications: string[];  // e.g. ['ISO9001', 'IATF16949']
  minOrderKRW: number;
  contactEmail?: string;
  website?: string;
  tags: string[];
}

export const SUPPLIERS: Supplier[] = [
  {
    id: 'sup-001',
    name: 'Daejin Precision',
    nameKo: '대진정밀',
    region: 'gyeonggi',
    regionLabel: '경기도',
    processes: ['cnc'],
    materials: ['aluminum', 'steel', 'titanium'],
    leadTimeDays: { min: 3, max: 7 },
    ratingStars: 4.5,
    reviewCount: 128,
    certifications: ['ISO9001'],
    minOrderKRW: 150000,
    tags: ['5축', '미세가공', '항공부품'],
  },
  {
    id: 'sup-002',
    name: 'Hansung Sheet Metal',
    nameKo: '한성판금',
    region: 'incheon',
    regionLabel: '인천',
    processes: ['sheetmetal_laser'],
    materials: ['steel', 'aluminum', 'stainless'],
    leadTimeDays: { min: 2, max: 5 },
    ratingStars: 4.0,
    reviewCount: 74,
    certifications: [],
    minOrderKRW: 80000,
    tags: ['레이저컷', '벤딩', '용접'],
  },
  {
    id: 'sup-003',
    name: 'Namhae CNC & Sheet',
    nameKo: '남해CNC판금',
    region: 'busan',
    regionLabel: '부산',
    processes: ['cnc', 'sheetmetal_laser'],
    materials: ['aluminum', 'steel', 'copper'],
    leadTimeDays: { min: 4, max: 10 },
    ratingStars: 4.0,
    reviewCount: 42,
    certifications: ['ISO9001'],
    minOrderKRW: 100000,
    tags: ['선박부품', 'CNC밀링', '판금'],
  },
  {
    id: 'sup-004',
    name: 'Seoul 3D Factory',
    nameKo: '서울3D공장',
    region: 'seoul',
    regionLabel: '서울',
    processes: ['fdm', 'sla', 'sls'],
    materials: ['abs_white', 'nylon', 'resin'],
    leadTimeDays: { min: 1, max: 3 },
    ratingStars: 4.5,
    reviewCount: 210,
    certifications: [],
    minOrderKRW: 30000,
    tags: ['시제품', '소량생산', '당일출고'],
  },
  {
    id: 'sup-005',
    name: 'Ilsan Injection Mold',
    nameKo: '일산사출성형',
    region: 'gyeonggi',
    regionLabel: '경기도',
    processes: ['injection'],
    materials: ['abs_white', 'nylon', 'rubber'],
    leadTimeDays: { min: 14, max: 30 },
    ratingStars: 3.5,
    reviewCount: 33,
    certifications: ['ISO9001'],
    minOrderKRW: 500000,
    tags: ['금형제작', '사출성형', '양산'],
  },
  {
    id: 'sup-006',
    name: 'Gwangju Precision Parts',
    nameKo: '광주정밀부품',
    region: 'gwangju',
    regionLabel: '광주',
    processes: ['cnc'],
    materials: ['steel', 'aluminum', 'brass'],
    leadTimeDays: { min: 3, max: 8 },
    ratingStars: 4.0,
    reviewCount: 56,
    certifications: ['ISO9001', 'IATF16949'],
    minOrderKRW: 120000,
    tags: ['자동차부품', 'CNC선반', '정밀가공'],
  },
  {
    id: 'sup-007',
    name: 'Daegu Metal Works',
    nameKo: '대구금속공업',
    region: 'daegu',
    regionLabel: '대구',
    processes: ['sheetmetal_laser', 'cnc'],
    materials: ['steel', 'aluminum', 'stainless'],
    leadTimeDays: { min: 3, max: 7 },
    ratingStars: 4.5,
    reviewCount: 91,
    certifications: ['ISO9001'],
    minOrderKRW: 90000,
    tags: ['섬유기계', '용접', '레이저'],
  },
  {
    id: 'sup-008',
    name: 'Ansan Fast Proto',
    nameKo: '안산빠른시제품',
    region: 'gyeonggi',
    regionLabel: '경기도',
    processes: ['fdm', 'cnc', 'sheetmetal_laser'],
    materials: ['aluminum', 'steel', 'abs_white', 'nylon'],
    leadTimeDays: { min: 1, max: 5 },
    ratingStars: 5.0,
    reviewCount: 147,
    certifications: [],
    minOrderKRW: 50000,
    tags: ['급속시제품', '소량CNC', '3D프린팅'],
  },
];

/** Material-ID → list of compatible ProcessTypes. */
export const MATERIAL_PROCESS_MAP: Record<string, ProcessType[]> = {
  aluminum:   ['cnc', 'sheetmetal_laser', 'fdm'],
  steel:      ['cnc', 'sheetmetal_laser'],
  titanium:   ['cnc'],
  copper:     ['cnc', 'sheetmetal_laser'],
  gold:       ['cnc'],
  abs_white:  ['fdm', 'sla', 'injection'],
  abs_black:  ['fdm', 'sla', 'injection'],
  nylon:      ['fdm', 'sls', 'injection'],
  glass:      ['cnc'],
  rubber:     ['injection'],
  wood:       ['cnc', 'fdm'],
  ceramic:    ['cnc', 'sla'],
  stainless:  ['cnc', 'sheetmetal_laser'],
  brass:      ['cnc'],
  resin:      ['sla'],
};

/** Match suppliers by process and material. Returns ranked list. */
export function matchSuppliers(
  process: ProcessType,
  materialId: string,
  regionFilter?: string,
): Supplier[] {
  return SUPPLIERS
    .filter(s =>
      s.processes.includes(process) &&
      (s.materials.includes(materialId) || s.materials.includes(materialId.split('_')[0])) &&
      (!regionFilter || s.region === regionFilter),
    )
    .sort((a, b) => b.ratingStars - a.ratingStars || b.reviewCount - a.reviewCount);
}

export const REGION_OPTIONS = [
  { value: '', label: { ko: '전국', en: 'All Regions' } },
  { value: 'seoul', label: { ko: '서울', en: 'Seoul' } },
  { value: 'gyeonggi', label: { ko: '경기도', en: 'Gyeonggi' } },
  { value: 'incheon', label: { ko: '인천', en: 'Incheon' } },
  { value: 'busan', label: { ko: '부산', en: 'Busan' } },
  { value: 'daegu', label: { ko: '대구', en: 'Daegu' } },
  { value: 'gwangju', label: { ko: '광주', en: 'Gwangju' } },
  { value: 'daejeon', label: { ko: '대전', en: 'Daejeon' } },
];
