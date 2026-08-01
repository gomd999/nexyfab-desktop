// quick-quote 재질/공정 목록 — 6개 site 언어(ko/en/ja/cn/es/ar) 라벨.
//
// 260802 이전엔 MATERIALS/PROCESSES 의 label 이 한국어 리터럴 문자열이라
// 페이지 자체는 dict 로 지역화돼 있었음에도 en/ja/cn/es/ar 사용자에게
// 재질·공정 이름만 한국어가 그대로 노출됐다(simulator RISK_SCENARIOS 와 동일 유형).

export type SiteLang = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

export interface LabeledOption {
    id: string;
    label: Record<SiteLang, string>;
}

export const MATERIALS: LabeledOption[] = [
    { id: 'steel_s45c',    label: { ko: '일반강철 (S45C)', en: 'Carbon Steel (S45C)', ja: '一般鋼材 (S45C)', cn: '普通钢材 (S45C)', es: 'Acero al carbono (S45C)', ar: 'فولاذ كربوني (S45C)' } },
    { id: 'aluminum_6061', label: { ko: '알루미늄합금 (6061)', en: 'Aluminum Alloy (6061)', ja: 'アルミ合金 (6061)', cn: '铝合金 (6061)', es: 'Aleación de aluminio (6061)', ar: 'سبيكة ألومنيوم (6061)' } },
    { id: 'stainless_304', label: { ko: '스테인레스 (SUS304)', en: 'Stainless Steel (SUS304)', ja: 'ステンレス (SUS304)', cn: '不锈钢 (SUS304)', es: 'Acero inoxidable (SUS304)', ar: 'فولاذ مقاوم للصدأ (SUS304)' } },
    { id: 'brass',         label: { ko: '황동 (C3604)', en: 'Brass (C3604)', ja: '真鍮 (C3604)', cn: '黄铜 (C3604)', es: 'Latón (C3604)', ar: 'نحاس أصفر (C3604)' } },
    { id: 'abs_plastic',   label: { ko: 'ABS 플라스틱', en: 'ABS Plastic', ja: 'ABS樹脂', cn: 'ABS塑料', es: 'Plástico ABS', ar: 'بلاستيك ABS' } },
    { id: 'pom',           label: { ko: 'POM (엔지니어링 플라스틱)', en: 'POM (Engineering Plastic)', ja: 'POM (エンジニアリングプラスチック)', cn: 'POM（工程塑料）', es: 'POM (plástico técnico)', ar: 'POM (بلاستيك هندسي)' } },
    { id: 'pc',            label: { ko: 'PC (폴리카보네이트)', en: 'PC (Polycarbonate)', ja: 'PC (ポリカーボネート)', cn: 'PC（聚碳酸酯）', es: 'PC (policarbonato)', ar: 'PC (بولي كربونات)' } },
    { id: 'titanium',      label: { ko: '티타늄 (Ti-6Al-4V)', en: 'Titanium (Ti-6Al-4V)', ja: 'チタン (Ti-6Al-4V)', cn: '钛合金 (Ti-6Al-4V)', es: 'Titanio (Ti-6Al-4V)', ar: 'تيتانيوم (Ti-6Al-4V)' } },
];

export const PROCESSES: LabeledOption[] = [
    { id: 'cnc',               label: { ko: 'CNC 가공', en: 'CNC Machining', ja: 'CNC加工', cn: 'CNC加工', es: 'Mecanizado CNC', ar: 'تشغيل CNC' } },
    { id: 'injection_molding', label: { ko: '사출 성형', en: 'Injection Molding', ja: '射出成形', cn: '注塑成型', es: 'Moldeo por inyección', ar: 'قولبة بالحقن' } },
    { id: 'die_casting',       label: { ko: '다이캐스팅', en: 'Die Casting', ja: 'ダイカスト', cn: '压铸', es: 'Fundición a presión', ar: 'الصب بالقالب' } },
    { id: 'sheet_metal',       label: { ko: '판금 가공', en: 'Sheet Metal', ja: '板金加工', cn: '钣金加工', es: 'Chapa metálica', ar: 'تشكيل الصفائح المعدنية' } },
    { id: '3d_printing_fdm',   label: { ko: '3D프린팅 (FDM)', en: '3D Printing (FDM)', ja: '3Dプリント (FDM)', cn: '3D打印（FDM）', es: 'Impresión 3D (FDM)', ar: 'طباعة ثلاثية الأبعاد (FDM)' } },
    { id: '3d_printing_sla',   label: { ko: '3D프린팅 (SLA)', en: '3D Printing (SLA)', ja: '3Dプリント (SLA)', cn: '3D打印（SLA）', es: 'Impresión 3D (SLA)', ar: 'طباعة ثلاثية الأبعاد (SLA)' } },
    { id: '3d_printing_sls',   label: { ko: '3D프린팅 (SLS)', en: '3D Printing (SLS)', ja: '3Dプリント (SLS)', cn: '3D打印（SLS）', es: 'Impresión 3D (SLS)', ar: 'طباعة ثلاثية الأبعاد (SLS)' } },
    { id: 'forging',           label: { ko: '단조', en: 'Forging', ja: '鍛造', cn: '锻造', es: 'Forjado', ar: 'التطريق' } },
];
