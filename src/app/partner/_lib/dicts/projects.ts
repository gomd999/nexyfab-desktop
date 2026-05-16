// Projects (contracts list) page dictionary.

import type { PartnerLang } from '../partnerLang';

export interface ProjectsDict {
  pageTitle: string;
  pageSubtitle: string;
  searchPlaceholder: string;
  tabAll: string;
  tabActive: string;
  tabCompleted: string;
  tabOnHold: string;
  status_contracted: string;
  status_in_progress: string;
  status_quality_check: string;
  status_delivered: string;
  status_completed: string;
  status_cancelled: string;
  completionRequested: string;
  milestoneTitle: string;
  milestoneSuffix: (done: number, total: number) => string;
  deadlineLabel: string;
  detailCta: string;
  emptyAll: string;
  emptyActive: string;
  emptyCompleted: string;
  emptyOnHold: string;
  searchEmptyTitle: (q: string) => string;
  searchEmptyHint: string;
}

const KO: ProjectsDict = {
  pageTitle: '프로젝트',
  pageSubtitle: '프로젝트를 선택하면 상세 관리 페이지로 이동합니다',
  searchPlaceholder: '프로젝트명, 공장명 검색...',
  tabAll: '전체',
  tabActive: '진행중',
  tabCompleted: '완료',
  tabOnHold: '보류',
  status_contracted: '계약 완료',
  status_in_progress: '진행 중',
  status_quality_check: '품질 검수',
  status_delivered: '납품 완료',
  status_completed: '완료',
  status_cancelled: '취소됨',
  completionRequested: '완료 확인 요청 중',
  milestoneTitle: '마일스톤 진행',
  milestoneSuffix: (d, total) => `${d}/${total} 단계 완료`,
  deadlineLabel: '납기일',
  detailCta: '상세 보기 →',
  emptyAll: '배정된 계약이 없습니다.',
  emptyActive: '현재 진행 중인 프로젝트가 없습니다.',
  emptyCompleted: '완료된 프로젝트가 없습니다.',
  emptyOnHold: '보류된 프로젝트가 없습니다.',
  searchEmptyTitle: (q) => `"${q}"에 대한 검색 결과가 없습니다.`,
  searchEmptyHint: '프로젝트명 또는 공장명을 다시 확인해 보세요.',
};

const EN: ProjectsDict = {
  pageTitle: 'Projects',
  pageSubtitle: 'Click a project to open its details.',
  searchPlaceholder: 'Search by project or factory name…',
  tabAll: 'All',
  tabActive: 'Active',
  tabCompleted: 'Completed',
  tabOnHold: 'On hold',
  status_contracted: 'Contracted',
  status_in_progress: 'In progress',
  status_quality_check: 'Quality check',
  status_delivered: 'Delivered',
  status_completed: 'Completed',
  status_cancelled: 'Cancelled',
  completionRequested: 'Completion confirmation pending',
  milestoneTitle: 'Milestone progress',
  milestoneSuffix: (d, total) => `${d}/${total} steps done`,
  deadlineLabel: 'Deadline',
  detailCta: 'View details →',
  emptyAll: 'No assigned contracts yet.',
  emptyActive: 'No projects in progress right now.',
  emptyCompleted: 'No completed projects yet.',
  emptyOnHold: 'No projects on hold.',
  searchEmptyTitle: (q) => `No results for "${q}".`,
  searchEmptyHint: 'Double-check the project or factory name.',
};

const JA: ProjectsDict = {
  pageTitle: 'プロジェクト',
  pageSubtitle: 'プロジェクトを選択すると詳細ページに移動します。',
  searchPlaceholder: 'プロジェクト名・工場名で検索…',
  tabAll: 'すべて',
  tabActive: '進行中',
  tabCompleted: '完了',
  tabOnHold: '保留',
  status_contracted: '契約完了',
  status_in_progress: '進行中',
  status_quality_check: '品質検査',
  status_delivered: '納品完了',
  status_completed: '完了',
  status_cancelled: 'キャンセル',
  completionRequested: '完了確認待ち',
  milestoneTitle: 'マイルストーン進捗',
  milestoneSuffix: (d, total) => `${d}/${total} 完了`,
  deadlineLabel: '納期',
  detailCta: '詳細を見る →',
  emptyAll: '割り当てられた契約はありません。',
  emptyActive: '進行中のプロジェクトはありません。',
  emptyCompleted: '完了したプロジェクトはありません。',
  emptyOnHold: '保留中のプロジェクトはありません。',
  searchEmptyTitle: (q) => `「${q}」に該当する結果はありません。`,
  searchEmptyHint: 'プロジェクト名や工場名を再確認してください。',
};

const CN: ProjectsDict = {
  pageTitle: '项目',
  pageSubtitle: '选择项目可进入详细管理页面。',
  searchPlaceholder: '搜索项目名或工厂名…',
  tabAll: '全部',
  tabActive: '进行中',
  tabCompleted: '已完成',
  tabOnHold: '搁置',
  status_contracted: '已签约',
  status_in_progress: '进行中',
  status_quality_check: '质检中',
  status_delivered: '已交付',
  status_completed: '已完成',
  status_cancelled: '已取消',
  completionRequested: '等待完成确认',
  milestoneTitle: '里程碑进度',
  milestoneSuffix: (d, total) => `${d}/${total} 完成`,
  deadlineLabel: '截止日',
  detailCta: '查看详情 →',
  emptyAll: '尚未分配合同。',
  emptyActive: '当前没有进行中的项目。',
  emptyCompleted: '尚无已完成的项目。',
  emptyOnHold: '没有搁置的项目。',
  searchEmptyTitle: (q) => `没有 "${q}" 的搜索结果。`,
  searchEmptyHint: '请重新核对项目名或工厂名。',
};

const ES: ProjectsDict = {
  pageTitle: 'Proyectos',
  pageSubtitle: 'Selecciona un proyecto para abrir su detalle.',
  searchPlaceholder: 'Buscar por proyecto o fábrica…',
  tabAll: 'Todos',
  tabActive: 'Activos',
  tabCompleted: 'Completados',
  tabOnHold: 'En espera',
  status_contracted: 'Contratado',
  status_in_progress: 'En curso',
  status_quality_check: 'Control de calidad',
  status_delivered: 'Entregado',
  status_completed: 'Completado',
  status_cancelled: 'Cancelado',
  completionRequested: 'Pendiente de confirmar finalización',
  milestoneTitle: 'Progreso de hitos',
  milestoneSuffix: (d, total) => `${d}/${total} pasos completados`,
  deadlineLabel: 'Fecha límite',
  detailCta: 'Ver detalle →',
  emptyAll: 'Aún no tienes contratos asignados.',
  emptyActive: 'No hay proyectos en curso ahora mismo.',
  emptyCompleted: 'Aún no hay proyectos completados.',
  emptyOnHold: 'No hay proyectos en espera.',
  searchEmptyTitle: (q) => `Sin resultados para "${q}".`,
  searchEmptyHint: 'Revisa el nombre del proyecto o de la fábrica.',
};

const AR: ProjectsDict = {
  pageTitle: 'المشاريع',
  pageSubtitle: 'اختر مشروعًا لعرض تفاصيله.',
  searchPlaceholder: 'ابحث باسم المشروع أو المصنع…',
  tabAll: 'الكل',
  tabActive: 'نشطة',
  tabCompleted: 'منجزة',
  tabOnHold: 'متوقفة',
  status_contracted: 'تم التعاقد',
  status_in_progress: 'قيد التنفيذ',
  status_quality_check: 'فحص الجودة',
  status_delivered: 'مُسلَّم',
  status_completed: 'مكتمل',
  status_cancelled: 'ملغى',
  completionRequested: 'بانتظار تأكيد الإنجاز',
  milestoneTitle: 'تقدم المراحل',
  milestoneSuffix: (d, total) => `${d}/${total} مرحلة منجزة`,
  deadlineLabel: 'الموعد النهائي',
  detailCta: 'عرض التفاصيل ←',
  emptyAll: 'لا توجد عقود مخصصة بعد.',
  emptyActive: 'لا توجد مشاريع قيد التنفيذ حاليًا.',
  emptyCompleted: 'لا توجد مشاريع منجزة بعد.',
  emptyOnHold: 'لا توجد مشاريع متوقفة.',
  searchEmptyTitle: (q) => `لا توجد نتائج لـ "${q}".`,
  searchEmptyHint: 'تحقّق من اسم المشروع أو المصنع.',
};

export function projectsDict(lang: PartnerLang): ProjectsDict {
  switch (lang) {
    case 'ko': return KO;
    case 'en': return EN;
    case 'ja': return JA;
    case 'cn': return CN;
    case 'es': return ES;
    case 'ar': return AR;
    default:   return EN;
  }
}
