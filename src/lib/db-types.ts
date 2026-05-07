// src/lib/db-types.ts
// better-sqlite3 쿼리 결과 타입 정의

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  plan: 'free' | 'pro' | 'team' | 'enterprise';
  email_verified: number; // 0 or 1 (SQLite boolean)
  project_count: number;
  created_at: number;
  failed_login_attempts: number;
  locked_until: number | null;
  totp_secret: string | null;
  totp_enabled: number; // 0 or 1
  // v28: global role
  role: string;
  // v30: avatar
  avatar_url: string | null;
  // v31: profile fields
  language: string | null;
  country: string | null;
  timezone: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  signup_source: string | null;
  last_login_at: number | null;
  login_count: number;
  signup_ip: string | null;
  last_login_ip: string | null;
  // v33: 통합 회원 서비스 태깅
  services: string;           // JSON: '["nexyfab","nexyflow"]'
  signup_service: string | null;
  nexyfab_plan: string | null;
  nexyflow_plan: string;
  oauth_provider: string | null;
  oauth_id: string | null;
  account_type: string | null;
  business_reg_number: string | null;
  /** BM Stage A–F (nf_users.stage). 마이그레이션 v61+. */
  stage?: string | null;
  industry: string | null;
  employee_size: string | null;
  terms_agreed_at: number | null;
  privacy_agreed_at: number | null;
  age_confirmed: number;
  marketing_agreed: number;
  marketing_agreed_at: number | null;
  updated_at: number | null;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  shape_id: string | null;
  material_id: string | null;
  scene_data: string | null;
  thumbnail: string | null;
  tags: string | null;
  created_at: number;
  updated_at: number;
}

export interface RFQRow {
  id: string;
  user_id: string;
  user_email: string | null;
  shape_id: string | null;
  shape_name: string | null;
  material_id: string | null;
  quantity: number;
  volume_cm3: number | null;
  surface_area_cm2: number | null;
  bbox: string | null;
  dfm_results: string | null;
  cost_estimates: string | null;
  note: string | null;
  status: string;
  quote_amount: number | null;
  manufacturer_note: string | null;
  created_at: number;
  updated_at: number;
}

export interface ShareRow {
  token: string;
  user_id: string | null;
  mesh_data_base64: string;
  metadata: string | null;
  expires_at: number;
  view_count: number;
  created_at: number;
}

export interface CommentRow {
  id: string;
  project_id: string;
  position: string;
  text: string;
  author: string;
  author_plan: string | null;
  type: 'comment' | 'issue' | 'approval';
  resolved: number;
  created_at: number;
}

export interface CollabSessionRow {
  session_id: string;
  project_id: string;
  user_id: string;
  user_name: string;
  cursor: string | null;
  color: string;
  last_ping: number;
}

export interface AuditLogRow {
  id: string;
  user_id: string;
  action: string;
  resource_id: string | null;
  metadata: string | null;
  ip: string | null;
  created_at: number;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  revoked: number;
  created_at: number;
}
