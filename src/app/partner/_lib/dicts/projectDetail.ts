// Project detail page dictionary (/partner/projects/[id]).

import type { PartnerLang } from '../partnerLang';

export interface ProjectDetailDict {
  loading: string;
  notFound: string;
  backToList: string;
  brandSubtitle: string;
  fallbackPartner: string;
  thisProject: string;
  statusHeader: string;
  navOverview: string;
  navFiles: string;
  navMessages: string;
  navLogout: string;

  ddayExceededSuffix: string;
  ddayDDay: string;
  ddayDplus: (n: number) => string;
  ddayDminus: (n: number) => string;

  bannerOverdue: (n: number) => string;
  bannerToday: string;
  bannerDaysLeft: (n: number) => string;
  bannerDeadlinePrefix: string;

  status_contracted: string;
  status_in_progress: string;
  status_quality_check: string;
  status_delivered: string;
  status_completed: string;
  status_cancelled: string;

  nextLabel_in_progress: string;
  nextLabel_quality_check: string;
  nextLabel_delivered: string;

  completionRequested: string;
  btnPrintContract: string;
  fieldContractAmount: string;
  fieldContractDate: string;
  fieldFactory: string;
  fieldDeadline: string;
  customerContactTitle: string;

  btnNextStatus: (label: string) => string;
  btnUpdating: string;
  btnRequestCompletion: string;
  btnRequestingCompletion: string;

  progressTitle: string;
  progressSaveBtn: string;
  progressSaving: string;
  notesAddTitle: string;
  notesPlaceholder: string;
  notesSaveBtn: string;
  notesSaving: string;
  timelineTitle: string;

  filesTitle: string;
  filesSubtitle: (project: string, status: string) => string;
  filesCountLabel: (n: number) => string;
  dropzoneActive: string;
  dropzoneIdle: string;
  dropzoneHint: string;
  dropzoneRetention: string;
  previewLabel: string;
  previewBeforeUpload: string;
  previewBtnUpload: string;
  previewBtnCancel: string;
  uploadingPrefix: string;
  btnCamera: string;
  btnPickFile: string;
  emptyAttachments: string;
  lightboxAlt: string;
  fileType_image: string;
  fileType_model: string;
  fileType_document: string;
  versionLatestSuffix: string;
  btnView3d: string;
  btnPreview: string;
  btnDownload: string;
  btnDelete: string;
  btnPrevVersions: string;
  confirmDeleteFile: string;
  toastUploadFailed: (name: string) => string;
  toastUploadError: (name: string) => string;
  toastDeleteFailed: (msg: string) => string;
  toastDeleteError: string;
  toastStorageFull: string;

  messagesTitle: string;
  messagesEmpty: string;
  messageFilePrefix: string;
  messageInputPlaceholder: string;
  attachLabel: string;
  btnSend: string;
  sendingShort: string;
  toastMsgSendFailed: string;
  toastFileUploadFailed: string;
  toastCompletionSent: string;
  toastCompletionFailed: string;
  toastStatusFailed: string;
  toastNoteSaveFailed: string;
  toastProgressFailed: string;
}

const KO: ProjectDetailDict = {
  loading: '불러오는 중...',
  notFound: '계약을 찾을 수 없습니다.',
  backToList: '← 프로젝트 목록으로',
  brandSubtitle: '파트너 포털',
  fallbackPartner: '파트너',
  thisProject: '이 프로젝트',
  statusHeader: '현재 상태',
  navOverview: '프로젝트 개요',
  navFiles: '파일 관리',
  navMessages: '메시지',
  navLogout: '로그아웃',

  ddayExceededSuffix: ' (기한 초과)',
  ddayDDay: 'D-Day',
  ddayDplus: (n) => `D+${n}`,
  ddayDminus: (n) => `D-${n}`,

  bannerOverdue: (n) => `납기 ${n}일 초과!`,
  bannerToday: '오늘이 납기일입니다!',
  bannerDaysLeft: (n) => `납기까지 ${n}일 남았습니다`,
  bannerDeadlinePrefix: '납기일:',

  status_contracted: '계약 완료',
  status_in_progress: '진행 중',
  status_quality_check: '품질 검수',
  status_delivered: '납품 완료',
  status_completed: '완료',
  status_cancelled: '취소됨',

  nextLabel_in_progress: '진행 시작',
  nextLabel_quality_check: '품질검사 시작',
  nextLabel_delivered: '납품 완료',

  completionRequested: '완료 확인 요청 중',
  btnPrintContract: '🖨️ 계약서 출력',
  fieldContractAmount: '계약 금액',
  fieldContractDate: '계약일',
  fieldFactory: '공장명',
  fieldDeadline: '납기일',
  customerContactTitle: '고객 담당자',

  btnNextStatus: (label) => `${label} →`,
  btnUpdating: '처리 중...',
  btnRequestCompletion: '✅ 완료 확인 요청',
  btnRequestingCompletion: '요청 중...',

  progressTitle: '제조 진행률',
  progressSaveBtn: '진행률 저장',
  progressSaving: '저장 중...',
  notesAddTitle: '진행 메모 추가',
  notesPlaceholder: '진행 상황 메모 입력...',
  notesSaveBtn: '저장',
  notesSaving: '저장 중...',
  timelineTitle: '진행 기록',

  filesTitle: '파일 관리',
  filesSubtitle: (project, status) => `${project} · ${status}`,
  filesCountLabel: (n) => `📎 파일 / 결과물 ${n > 0 ? `(${n}개)` : ''}`,
  dropzoneActive: '파일을 놓아 업로드',
  dropzoneIdle: '파일을 드래그하거나 아래 버튼을 클릭하세요',
  dropzoneHint: '이미지, STL, STEP, PDF, DWG 지원',
  dropzoneRetention: '계약 완료 후 180일간 파일이 보관됩니다. 중요한 파일은 로컬에 백업해 주세요.',
  previewLabel: '미리보기',
  previewBeforeUpload: '업로드 전 미리보기',
  previewBtnUpload: '업로드',
  previewBtnCancel: '취소',
  uploadingPrefix: '업로드 중:',
  btnCamera: '📷 사진 촬영',
  btnPickFile: '📎 파일 선택',
  emptyAttachments: '첨부된 파일이 없습니다.',
  lightboxAlt: '원본 이미지',
  fileType_image: '이미지',
  fileType_model: '3D 모델',
  fileType_document: '도면',
  versionLatestSuffix: ' (최신)',
  btnView3d: '🧊 3D 보기',
  btnPreview: '👁 미리보기',
  btnDownload: '다운로드',
  btnDelete: '삭제',
  btnPrevVersions: '이전 버전',
  confirmDeleteFile: '파일을 삭제하시겠습니까?',
  toastUploadFailed: (name) => `파일 업로드 실패: ${name}`,
  toastUploadError: (name) => `업로드 중 오류: ${name}`,
  toastDeleteFailed: (msg) => `삭제 실패: ${msg}`,
  toastDeleteError: '삭제 중 오류가 발생했습니다.',
  toastStorageFull: '저장 공간이 부족합니다.',

  messagesTitle: '메시지',
  messagesEmpty: '메시지가 없습니다.',
  messageFilePrefix: '📎 파일',
  messageInputPlaceholder: '메시지 입력... (Enter로 전송)',
  attachLabel: '파일 첨부',
  btnSend: '전송',
  sendingShort: '...',
  toastMsgSendFailed: '메시지 전송에 실패했습니다.',
  toastFileUploadFailed: '파일 업로드에 실패했습니다.',
  toastCompletionSent: '완료 확인 요청이 전송되었습니다.',
  toastCompletionFailed: '완료 요청에 실패했습니다.',
  toastStatusFailed: '상태 변경에 실패했습니다.',
  toastNoteSaveFailed: '메모 저장에 실패했습니다.',
  toastProgressFailed: '진행률 저장에 실패했습니다.',
};

const EN: ProjectDetailDict = {
  loading: 'Loading…',
  notFound: 'Contract not found.',
  backToList: '← Back to projects',
  brandSubtitle: 'Partner portal',
  fallbackPartner: 'Partner',
  thisProject: 'This project',
  statusHeader: 'Current status',
  navOverview: 'Overview',
  navFiles: 'Files',
  navMessages: 'Messages',
  navLogout: 'Log out',

  ddayExceededSuffix: ' (overdue)',
  ddayDDay: 'Today',
  ddayDplus: (n) => `+${n}d`,
  ddayDminus: (n) => `${n}d left`,

  bannerOverdue: (n) => `Delivery is ${n} day${n === 1 ? '' : 's'} overdue!`,
  bannerToday: 'Today is the delivery date!',
  bannerDaysLeft: (n) => `${n} day${n === 1 ? '' : 's'} until delivery`,
  bannerDeadlinePrefix: 'Due:',

  status_contracted: 'Contracted',
  status_in_progress: 'In progress',
  status_quality_check: 'Quality check',
  status_delivered: 'Delivered',
  status_completed: 'Completed',
  status_cancelled: 'Cancelled',

  nextLabel_in_progress: 'Start production',
  nextLabel_quality_check: 'Start quality check',
  nextLabel_delivered: 'Mark as delivered',

  completionRequested: 'Completion confirmation pending',
  btnPrintContract: '🖨️ Print contract',
  fieldContractAmount: 'Contract amount',
  fieldContractDate: 'Contract date',
  fieldFactory: 'Factory',
  fieldDeadline: 'Due date',
  customerContactTitle: 'Customer contact',

  btnNextStatus: (label) => `${label} →`,
  btnUpdating: 'Updating…',
  btnRequestCompletion: '✅ Request completion confirmation',
  btnRequestingCompletion: 'Sending…',

  progressTitle: 'Production progress',
  progressSaveBtn: 'Save progress',
  progressSaving: 'Saving…',
  notesAddTitle: 'Add progress note',
  notesPlaceholder: 'Type a progress note…',
  notesSaveBtn: 'Save',
  notesSaving: 'Saving…',
  timelineTitle: 'Progress history',

  filesTitle: 'Files',
  filesSubtitle: (project, status) => `${project} · ${status}`,
  filesCountLabel: (n) => `📎 Files / deliverables${n > 0 ? ` (${n})` : ''}`,
  dropzoneActive: 'Drop to upload',
  dropzoneIdle: 'Drag files here or click below',
  dropzoneHint: 'Image, STL, STEP, PDF, DWG supported',
  dropzoneRetention: 'Files are retained for 180 days after the contract completes — back up important files locally.',
  previewLabel: 'Preview',
  previewBeforeUpload: 'Preview before upload',
  previewBtnUpload: 'Upload',
  previewBtnCancel: 'Cancel',
  uploadingPrefix: 'Uploading:',
  btnCamera: '📷 Take photo',
  btnPickFile: '📎 Pick file',
  emptyAttachments: 'No attachments yet.',
  lightboxAlt: 'Original image',
  fileType_image: 'Image',
  fileType_model: '3D model',
  fileType_document: 'Drawing',
  versionLatestSuffix: ' (latest)',
  btnView3d: '🧊 View 3D',
  btnPreview: '👁 Preview',
  btnDownload: 'Download',
  btnDelete: 'Delete',
  btnPrevVersions: 'Older versions',
  confirmDeleteFile: 'Delete this file?',
  toastUploadFailed: (name) => `Upload failed: ${name}`,
  toastUploadError: (name) => `Upload error: ${name}`,
  toastDeleteFailed: (msg) => `Delete failed: ${msg}`,
  toastDeleteError: 'Error while deleting.',
  toastStorageFull: 'Storage quota exceeded.',

  messagesTitle: 'Messages',
  messagesEmpty: 'No messages.',
  messageFilePrefix: '📎 File',
  messageInputPlaceholder: 'Type a message… (Enter to send)',
  attachLabel: 'Attach file',
  btnSend: 'Send',
  sendingShort: '…',
  toastMsgSendFailed: 'Failed to send the message.',
  toastFileUploadFailed: 'File upload failed.',
  toastCompletionSent: 'Completion confirmation requested.',
  toastCompletionFailed: 'Failed to request completion.',
  toastStatusFailed: 'Failed to change status.',
  toastNoteSaveFailed: 'Failed to save the note.',
  toastProgressFailed: 'Failed to save the progress.',
};

const JA: ProjectDetailDict = {
  ...EN,
  loading: '読み込み中…',
  notFound: '契約が見つかりません。',
  backToList: '← プロジェクト一覧へ',
  brandSubtitle: 'パートナーポータル',
  fallbackPartner: 'パートナー',
  thisProject: 'このプロジェクト',
  statusHeader: '現在のステータス',
  navOverview: '概要',
  navFiles: 'ファイル管理',
  navMessages: 'メッセージ',
  navLogout: 'ログアウト',
  ddayExceededSuffix: ' (期限超過)',
  ddayDDay: 'D-Day',
  ddayDplus: (n) => `D+${n}`,
  ddayDminus: (n) => `D-${n}`,
  bannerOverdue: (n) => `納期 ${n}日超過！`,
  bannerToday: '本日が納期です！',
  bannerDaysLeft: (n) => `納期まで ${n}日`,
  bannerDeadlinePrefix: '納期:',
  status_contracted: '契約完了',
  status_in_progress: '進行中',
  status_quality_check: '品質検査',
  status_delivered: '納品完了',
  status_completed: '完了',
  status_cancelled: 'キャンセル',
  nextLabel_in_progress: '進行開始',
  nextLabel_quality_check: '品質検査開始',
  nextLabel_delivered: '納品完了',
  completionRequested: '完了確認待ち',
  btnPrintContract: '🖨️ 契約書を印刷',
  fieldContractAmount: '契約金額',
  fieldContractDate: '契約日',
  fieldFactory: '工場名',
  fieldDeadline: '納期',
  customerContactTitle: '顧客担当者',
  btnNextStatus: (label) => `${label} →`,
  btnUpdating: '処理中…',
  btnRequestCompletion: '✅ 完了確認をリクエスト',
  btnRequestingCompletion: 'リクエスト中…',
  progressTitle: '製造進捗',
  progressSaveBtn: '進捗を保存',
  progressSaving: '保存中…',
  notesAddTitle: '進捗メモを追加',
  notesPlaceholder: '進捗メモを入力…',
  notesSaveBtn: '保存',
  notesSaving: '保存中…',
  timelineTitle: '進捗履歴',
  filesTitle: 'ファイル管理',
  filesSubtitle: (project, status) => `${project} · ${status}`,
  filesCountLabel: (n) => `📎 ファイル / 成果物${n > 0 ? ` (${n}件)` : ''}`,
  dropzoneActive: 'ドロップしてアップロード',
  dropzoneIdle: 'ファイルをドラッグするか、下のボタンをクリック',
  dropzoneHint: '画像、STL、STEP、PDF、DWG に対応',
  dropzoneRetention: '契約完了後 180 日間ファイルを保持します。重要なファイルはローカルにバックアップしてください。',
  previewLabel: 'プレビュー',
  previewBeforeUpload: 'アップロード前のプレビュー',
  previewBtnUpload: 'アップロード',
  previewBtnCancel: 'キャンセル',
  uploadingPrefix: 'アップロード中:',
  btnCamera: '📷 写真撮影',
  btnPickFile: '📎 ファイル選択',
  emptyAttachments: '添付ファイルはありません。',
  lightboxAlt: '元画像',
  fileType_image: '画像',
  fileType_model: '3D モデル',
  fileType_document: '図面',
  versionLatestSuffix: ' (最新)',
  btnView3d: '🧊 3D表示',
  btnPreview: '👁 プレビュー',
  btnDownload: 'ダウンロード',
  btnDelete: '削除',
  btnPrevVersions: '以前のバージョン',
  confirmDeleteFile: 'このファイルを削除しますか？',
  toastUploadFailed: (name) => `アップロード失敗: ${name}`,
  toastUploadError: (name) => `アップロードエラー: ${name}`,
  toastDeleteFailed: (msg) => `削除失敗: ${msg}`,
  toastDeleteError: '削除中にエラーが発生しました。',
  toastStorageFull: 'ストレージ容量が不足しています。',
  messagesTitle: 'メッセージ',
  messagesEmpty: 'メッセージはありません。',
  messageFilePrefix: '📎 ファイル',
  messageInputPlaceholder: 'メッセージを入力… (Enter で送信)',
  attachLabel: 'ファイル添付',
  btnSend: '送信',
  sendingShort: '…',
  toastMsgSendFailed: 'メッセージの送信に失敗しました。',
  toastFileUploadFailed: 'ファイルアップロードに失敗しました。',
  toastCompletionSent: '完了確認リクエストを送信しました。',
  toastCompletionFailed: '完了リクエストに失敗しました。',
  toastStatusFailed: 'ステータス変更に失敗しました。',
  toastNoteSaveFailed: 'メモの保存に失敗しました。',
  toastProgressFailed: '進捗の保存に失敗しました。',
};

const CN: ProjectDetailDict = {
  ...EN,
  loading: '加载中…',
  notFound: '未找到合同。',
  backToList: '← 返回项目列表',
  brandSubtitle: '合作伙伴门户',
  fallbackPartner: '合作伙伴',
  thisProject: '本项目',
  statusHeader: '当前状态',
  navOverview: '项目概览',
  navFiles: '文件管理',
  navMessages: '消息',
  navLogout: '退出',
  ddayExceededSuffix: ' (已逾期)',
  ddayDDay: '当天',
  ddayDplus: (n) => `逾期 ${n} 天`,
  ddayDminus: (n) => `还剩 ${n} 天`,
  bannerOverdue: (n) => `已逾期 ${n} 天!`,
  bannerToday: '今天是交期!',
  bannerDaysLeft: (n) => `距离交期还有 ${n} 天`,
  bannerDeadlinePrefix: '交期:',
  status_contracted: '已签约',
  status_in_progress: '进行中',
  status_quality_check: '质检中',
  status_delivered: '已交付',
  status_completed: '已完成',
  status_cancelled: '已取消',
  nextLabel_in_progress: '开始生产',
  nextLabel_quality_check: '开始质检',
  nextLabel_delivered: '标记已交付',
  completionRequested: '等待完成确认',
  btnPrintContract: '🖨️ 打印合同',
  fieldContractAmount: '合同金额',
  fieldContractDate: '签约日',
  fieldFactory: '工厂名称',
  fieldDeadline: '交期',
  customerContactTitle: '客户联系人',
  btnNextStatus: (label) => `${label} →`,
  btnUpdating: '处理中…',
  btnRequestCompletion: '✅ 申请完成确认',
  btnRequestingCompletion: '请求中…',
  progressTitle: '生产进度',
  progressSaveBtn: '保存进度',
  progressSaving: '保存中…',
  notesAddTitle: '添加进度备注',
  notesPlaceholder: '输入进度备注…',
  notesSaveBtn: '保存',
  notesSaving: '保存中…',
  timelineTitle: '进度记录',
  filesTitle: '文件管理',
  filesSubtitle: (project, status) => `${project} · ${status}`,
  filesCountLabel: (n) => `📎 文件 / 成果${n > 0 ? ` (${n} 个)` : ''}`,
  dropzoneActive: '松开以上传',
  dropzoneIdle: '拖拽文件或点击下方按钮',
  dropzoneHint: '支持 图片, STL, STEP, PDF, DWG',
  dropzoneRetention: '合同完成后文件保留 180 天。重要文件请本地备份。',
  previewLabel: '预览',
  previewBeforeUpload: '上传前预览',
  previewBtnUpload: '上传',
  previewBtnCancel: '取消',
  uploadingPrefix: '上传中:',
  btnCamera: '📷 拍照',
  btnPickFile: '📎 选择文件',
  emptyAttachments: '尚未附加文件。',
  lightboxAlt: '原图',
  fileType_image: '图片',
  fileType_model: '3D 模型',
  fileType_document: '图纸',
  versionLatestSuffix: ' (最新)',
  btnView3d: '🧊 查看 3D',
  btnPreview: '👁 预览',
  btnDownload: '下载',
  btnDelete: '删除',
  btnPrevVersions: '历史版本',
  confirmDeleteFile: '确定要删除该文件吗?',
  toastUploadFailed: (name) => `上传失败: ${name}`,
  toastUploadError: (name) => `上传错误: ${name}`,
  toastDeleteFailed: (msg) => `删除失败: ${msg}`,
  toastDeleteError: '删除时发生错误。',
  toastStorageFull: '存储空间不足。',
  messagesTitle: '消息',
  messagesEmpty: '没有消息。',
  messageFilePrefix: '📎 文件',
  messageInputPlaceholder: '输入消息… (Enter 发送)',
  attachLabel: '附加文件',
  btnSend: '发送',
  sendingShort: '…',
  toastMsgSendFailed: '消息发送失败。',
  toastFileUploadFailed: '文件上传失败。',
  toastCompletionSent: '已发送完成确认申请。',
  toastCompletionFailed: '完成申请失败。',
  toastStatusFailed: '状态变更失败。',
  toastNoteSaveFailed: '备注保存失败。',
  toastProgressFailed: '进度保存失败。',
};

const ES: ProjectDetailDict = {
  ...EN,
  loading: 'Cargando…',
  notFound: 'Contrato no encontrado.',
  backToList: '← Volver a proyectos',
  brandSubtitle: 'Portal de socios',
  fallbackPartner: 'Socio',
  thisProject: 'Este proyecto',
  statusHeader: 'Estado actual',
  navOverview: 'Resumen',
  navFiles: 'Archivos',
  navMessages: 'Mensajes',
  navLogout: 'Cerrar sesión',
  ddayExceededSuffix: ' (retraso)',
  ddayDDay: 'Hoy',
  ddayDplus: (n) => `+${n}d`,
  ddayDminus: (n) => `${n}d`,
  bannerOverdue: (n) => `¡Entrega con ${n} día${n === 1 ? '' : 's'} de retraso!`,
  bannerToday: '¡Hoy es la fecha de entrega!',
  bannerDaysLeft: (n) => `${n} día${n === 1 ? '' : 's'} para la entrega`,
  bannerDeadlinePrefix: 'Fecha:',
  status_contracted: 'Contratado',
  status_in_progress: 'En curso',
  status_quality_check: 'Control de calidad',
  status_delivered: 'Entregado',
  status_completed: 'Completado',
  status_cancelled: 'Cancelado',
  nextLabel_in_progress: 'Iniciar producción',
  nextLabel_quality_check: 'Iniciar control',
  nextLabel_delivered: 'Marcar entregado',
  completionRequested: 'Pendiente de confirmar finalización',
  btnPrintContract: '🖨️ Imprimir contrato',
  fieldContractAmount: 'Importe',
  fieldContractDate: 'Fecha del contrato',
  fieldFactory: 'Fábrica',
  fieldDeadline: 'Entrega',
  customerContactTitle: 'Contacto del cliente',
  btnNextStatus: (label) => `${label} →`,
  btnUpdating: 'Actualizando…',
  btnRequestCompletion: '✅ Solicitar confirmación',
  btnRequestingCompletion: 'Enviando…',
  progressTitle: 'Progreso de producción',
  progressSaveBtn: 'Guardar progreso',
  progressSaving: 'Guardando…',
  notesAddTitle: 'Añadir nota de progreso',
  notesPlaceholder: 'Escribe una nota…',
  notesSaveBtn: 'Guardar',
  notesSaving: 'Guardando…',
  timelineTitle: 'Historial de progreso',
  filesTitle: 'Archivos',
  filesSubtitle: (project, status) => `${project} · ${status}`,
  filesCountLabel: (n) => `📎 Archivos / entregables${n > 0 ? ` (${n})` : ''}`,
  dropzoneActive: 'Suelta para subir',
  dropzoneIdle: 'Arrastra archivos o haz clic abajo',
  dropzoneHint: 'Compatible: Imagen, STL, STEP, PDF, DWG',
  dropzoneRetention: 'Los archivos se conservan 180 días tras el contrato. Haz copia local de los importantes.',
  previewLabel: 'Vista previa',
  previewBeforeUpload: 'Vista previa antes de subir',
  previewBtnUpload: 'Subir',
  previewBtnCancel: 'Cancelar',
  uploadingPrefix: 'Subiendo:',
  btnCamera: '📷 Foto',
  btnPickFile: '📎 Elegir archivo',
  emptyAttachments: 'Sin adjuntos aún.',
  lightboxAlt: 'Imagen original',
  fileType_image: 'Imagen',
  fileType_model: 'Modelo 3D',
  fileType_document: 'Plano',
  versionLatestSuffix: ' (última)',
  btnView3d: '🧊 Ver 3D',
  btnPreview: '👁 Vista previa',
  btnDownload: 'Descargar',
  btnDelete: 'Eliminar',
  btnPrevVersions: 'Versiones anteriores',
  confirmDeleteFile: '¿Eliminar este archivo?',
  toastUploadFailed: (name) => `Error al subir: ${name}`,
  toastUploadError: (name) => `Error de subida: ${name}`,
  toastDeleteFailed: (msg) => `Error al eliminar: ${msg}`,
  toastDeleteError: 'Error durante la eliminación.',
  toastStorageFull: 'Espacio de almacenamiento insuficiente.',
  messagesTitle: 'Mensajes',
  messagesEmpty: 'Sin mensajes.',
  messageFilePrefix: '📎 Archivo',
  messageInputPlaceholder: 'Escribe un mensaje… (Enter para enviar)',
  attachLabel: 'Adjuntar archivo',
  btnSend: 'Enviar',
  sendingShort: '…',
  toastMsgSendFailed: 'Error al enviar el mensaje.',
  toastFileUploadFailed: 'Error al subir el archivo.',
  toastCompletionSent: 'Confirmación de finalización solicitada.',
  toastCompletionFailed: 'Error al solicitar la confirmación.',
  toastStatusFailed: 'Error al cambiar el estado.',
  toastNoteSaveFailed: 'Error al guardar la nota.',
  toastProgressFailed: 'Error al guardar el progreso.',
};

const AR: ProjectDetailDict = {
  ...EN,
  loading: 'جارٍ التحميل…',
  notFound: 'العقد غير موجود.',
  backToList: '← الرجوع إلى المشاريع',
  brandSubtitle: 'بوابة الشركاء',
  fallbackPartner: 'شريك',
  thisProject: 'هذا المشروع',
  statusHeader: 'الحالة الحالية',
  navOverview: 'النظرة العامة',
  navFiles: 'الملفات',
  navMessages: 'الرسائل',
  navLogout: 'تسجيل الخروج',
  ddayExceededSuffix: ' (متأخر)',
  ddayDDay: 'اليوم',
  ddayDplus: (n) => `متأخر ${n} يومًا`,
  ddayDminus: (n) => `بقي ${n} يومًا`,
  bannerOverdue: (n) => `الموعد متأخر بـ ${n} يومًا!`,
  bannerToday: 'اليوم هو موعد التسليم!',
  bannerDaysLeft: (n) => `بقي ${n} يومًا حتى التسليم`,
  bannerDeadlinePrefix: 'الموعد:',
  status_contracted: 'تم التعاقد',
  status_in_progress: 'قيد التنفيذ',
  status_quality_check: 'فحص الجودة',
  status_delivered: 'مُسلَّم',
  status_completed: 'مكتمل',
  status_cancelled: 'ملغى',
  nextLabel_in_progress: 'بدء الإنتاج',
  nextLabel_quality_check: 'بدء فحص الجودة',
  nextLabel_delivered: 'تأكيد التسليم',
  completionRequested: 'بانتظار تأكيد الإنجاز',
  btnPrintContract: '🖨️ طباعة العقد',
  fieldContractAmount: 'قيمة العقد',
  fieldContractDate: 'تاريخ العقد',
  fieldFactory: 'المصنع',
  fieldDeadline: 'الموعد النهائي',
  customerContactTitle: 'جهة اتصال العميل',
  btnNextStatus: (label) => `${label} ←`,
  btnUpdating: 'جارٍ التحديث…',
  btnRequestCompletion: '✅ طلب تأكيد الإنجاز',
  btnRequestingCompletion: 'جارٍ الإرسال…',
  progressTitle: 'تقدم الإنتاج',
  progressSaveBtn: 'حفظ التقدم',
  progressSaving: 'جارٍ الحفظ…',
  notesAddTitle: 'إضافة ملاحظة تقدم',
  notesPlaceholder: 'اكتب ملاحظة…',
  notesSaveBtn: 'حفظ',
  notesSaving: 'جارٍ الحفظ…',
  timelineTitle: 'سجل التقدم',
  filesTitle: 'الملفات',
  filesSubtitle: (project, status) => `${project} · ${status}`,
  filesCountLabel: (n) => `📎 الملفات / المخرجات${n > 0 ? ` (${n})` : ''}`,
  dropzoneActive: 'أفلت للتحميل',
  dropzoneIdle: 'اسحب الملفات أو اضغط الزر أدناه',
  dropzoneHint: 'مدعوم: صور، STL، STEP، PDF، DWG',
  dropzoneRetention: 'تُحفظ الملفات 180 يومًا بعد إنجاز العقد. احتفظ بنسخة محلية من الملفات المهمة.',
  previewLabel: 'معاينة',
  previewBeforeUpload: 'معاينة قبل التحميل',
  previewBtnUpload: 'تحميل',
  previewBtnCancel: 'إلغاء',
  uploadingPrefix: 'جارٍ التحميل:',
  btnCamera: '📷 التقاط صورة',
  btnPickFile: '📎 اختر ملفًا',
  emptyAttachments: 'لا توجد مرفقات بعد.',
  lightboxAlt: 'الصورة الأصلية',
  fileType_image: 'صورة',
  fileType_model: 'نموذج ثلاثي الأبعاد',
  fileType_document: 'رسم',
  versionLatestSuffix: ' (الأحدث)',
  btnView3d: '🧊 عرض 3D',
  btnPreview: '👁 معاينة',
  btnDownload: 'تنزيل',
  btnDelete: 'حذف',
  btnPrevVersions: 'الإصدارات السابقة',
  confirmDeleteFile: 'حذف هذا الملف؟',
  toastUploadFailed: (name) => `فشل التحميل: ${name}`,
  toastUploadError: (name) => `خطأ في التحميل: ${name}`,
  toastDeleteFailed: (msg) => `فشل الحذف: ${msg}`,
  toastDeleteError: 'حدث خطأ أثناء الحذف.',
  toastStorageFull: 'مساحة التخزين غير كافية.',
  messagesTitle: 'الرسائل',
  messagesEmpty: 'لا توجد رسائل.',
  messageFilePrefix: '📎 ملف',
  messageInputPlaceholder: 'اكتب رسالة… (Enter للإرسال)',
  attachLabel: 'إرفاق ملف',
  btnSend: 'إرسال',
  sendingShort: '…',
  toastMsgSendFailed: 'فشل إرسال الرسالة.',
  toastFileUploadFailed: 'فشل تحميل الملف.',
  toastCompletionSent: 'تم إرسال طلب تأكيد الإنجاز.',
  toastCompletionFailed: 'فشل طلب الإنجاز.',
  toastStatusFailed: 'فشل تغيير الحالة.',
  toastNoteSaveFailed: 'فشل حفظ الملاحظة.',
  toastProgressFailed: 'فشل حفظ التقدم.',
};

export function projectDetailDict(lang: PartnerLang): ProjectDetailDict {
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
