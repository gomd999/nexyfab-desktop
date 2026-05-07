/**
 * db.ts — better-sqlite3 기반 단일 DB 레이어
 * WAL 모드로 동시 쓰기 경쟁 조건 해결
 * 최초 실행 시 기존 JSON 파일을 DB로 자동 마이그레이션
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const ADMINLINK_DIR = path.join(process.cwd(), 'adminlink');
const DB_PATH = path.join(DATA_DIR, 'nexyfab.db');
const MIGRATED_FLAG = path.join(DATA_DIR, '.db_migrated');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contracts (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id           TEXT PRIMARY KEY,
      contract_id  TEXT NOT NULL,
      sender       TEXT NOT NULL,
      sender_type  TEXT NOT NULL,
      text         TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_contract ON messages(contract_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY,
      recipient   TEXT NOT NULL,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      message     TEXT NOT NULL,
      contract_id TEXT,
      quote_id    TEXT,
      created_at  TEXT NOT NULL,
      read        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient, created_at DESC);

    CREATE TABLE IF NOT EXISTS inquiries (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);
  migrateJson(db);
}

function migrateJson(db: Database.Database) {
  if (fs.existsSync(MIGRATED_FLAG)) return;

  const run = db.transaction(() => {
    // contracts
    const contractsFile = path.join(DATA_DIR, 'contracts.json');
    if (fs.existsSync(contractsFile)) {
      try {
        const arr = JSON.parse(fs.readFileSync(contractsFile, 'utf-8'));
        const ins = db.prepare('INSERT OR IGNORE INTO contracts (id, data) VALUES (?, ?)');
        for (const c of arr) ins.run(c.id, JSON.stringify(c));
      } catch (e) { console.error('[db] contracts 마이그레이션 실패:', e); }
    }

    // messages
    const messagesFile = path.join(DATA_DIR, 'messages.json');
    if (fs.existsSync(messagesFile)) {
      try {
        const store: Record<string, Array<{ id: string; sender: string; senderType: string; text: string; createdAt: string }>> = JSON.parse(fs.readFileSync(messagesFile, 'utf-8'));
        const ins = db.prepare('INSERT OR IGNORE INTO messages (id, contract_id, sender, sender_type, text, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        for (const [contractId, msgs] of Object.entries(store)) {
          for (const m of msgs) ins.run(m.id, contractId, m.sender, m.senderType, m.text, m.createdAt);
        }
      } catch (e) { console.error('[db] messages 마이그레이션 실패:', e); }
    }

    // notifications
    const notifFile = path.join(ADMINLINK_DIR, 'notifications.json');
    if (fs.existsSync(notifFile)) {
      try {
        const all: Record<string, Array<{ id: string; type: string; title: string; message: string; contractId?: string; quoteId?: string; createdAt: string; read?: boolean }>> = JSON.parse(fs.readFileSync(notifFile, 'utf-8'));
        const ins = db.prepare('INSERT OR IGNORE INTO notifications (id, recipient, type, title, message, contract_id, quote_id, created_at, read) VALUES (?,?,?,?,?,?,?,?,?)');
        for (const [recipient, notifs] of Object.entries(all)) {
          for (const n of notifs) ins.run(n.id, recipient, n.type, n.title, n.message, n.contractId ?? null, n.quoteId ?? null, n.createdAt, n.read ? 1 : 0);
        }
      } catch (e) { console.error('[db] notifications 마이그레이션 실패:', e); }
    }

    // inquiries
    const inquiriesFile = path.join(ADMINLINK_DIR, 'inquiries.json');
    if (fs.existsSync(inquiriesFile)) {
      try {
        const arr = JSON.parse(fs.readFileSync(inquiriesFile, 'utf-8'));
        const ins = db.prepare('INSERT OR IGNORE INTO inquiries (id, data) VALUES (?, ?)');
        for (const inq of arr) ins.run(inq.id, JSON.stringify(inq));
      } catch (e) { console.error('[db] inquiries 마이그레이션 실패:', e); }
    }
  });

  run();
  fs.writeFileSync(MIGRATED_FLAG, new Date().toISOString());
  console.log('[db] JSON → SQLite 마이그레이션 완료');
}

// ─── Contract helpers ──────────────────────────────────────────────────────

export interface ContractRecord {
  id: string;
  [key: string]: unknown;
}

export function dbReadContracts(): ContractRecord[] {
  const rows = getDb().prepare('SELECT data FROM contracts').all() as { data: string }[];
  return rows.map(r => JSON.parse(r.data) as ContractRecord);
}

export function dbWriteContract(contract: ContractRecord): void {
  getDb().prepare('INSERT OR REPLACE INTO contracts (id, data) VALUES (?, ?)').run(contract.id, JSON.stringify(contract));
}

export function dbDeleteContract(id: string): void {
  getDb().prepare('DELETE FROM contracts WHERE id = ?').run(id);
}

// ─── Message helpers ───────────────────────────────────────────────────────

export interface DbMessage {
  id: string;
  contractId: string;
  sender: string;
  senderType: 'admin' | 'partner' | 'customer';
  text: string;
  createdAt: string;
}

interface MessageRow {
  id: string;
  contract_id: string;
  sender: string;
  sender_type: string;
  text: string;
  created_at: string;
}

export function dbGetMessages(contractId: string): DbMessage[] {
  const rows = getDb()
    .prepare('SELECT * FROM messages WHERE contract_id = ? ORDER BY created_at ASC')
    .all(contractId) as MessageRow[];
  return rows.map(r => ({
    id: r.id,
    contractId: r.contract_id,
    sender: r.sender,
    senderType: r.sender_type as DbMessage['senderType'],
    text: r.text,
    createdAt: r.created_at,
  }));
}

export function dbInsertMessage(msg: DbMessage): void {
  getDb()
    .prepare('INSERT INTO messages (id, contract_id, sender, sender_type, text, created_at) VALUES (?,?,?,?,?,?)')
    .run(msg.id, msg.contractId, msg.sender, msg.senderType, msg.text, msg.createdAt);
}

// ─── Notification helpers ──────────────────────────────────────────────────

export interface DbNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  contractId?: string;
  quoteId?: string;
  createdAt: string;
  read: boolean;
}

interface NotificationRow {
  id: string;
  recipient: string;
  type: string;
  title: string;
  message: string;
  contract_id: string | null;
  quote_id: string | null;
  created_at: string;
  read: number;
}

export function dbGetNotifications(recipient: string, limit = 50): DbNotification[] {
  const rows = getDb()
    .prepare('SELECT * FROM notifications WHERE recipient = ? ORDER BY created_at DESC LIMIT ?')
    .all(recipient, limit) as NotificationRow[];
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    title: r.title,
    message: r.message,
    contractId: r.contract_id ?? undefined,
    quoteId: r.quote_id ?? undefined,
    createdAt: r.created_at,
    read: r.read === 1,
  }));
}

export function dbInsertNotification(recipient: string, notif: DbNotification): void {
  const db = getDb();
  // 최대 200개 유지
  const { c } = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE recipient = ?').get(recipient) as { c: number };
  if (c >= 200) {
    db.prepare(`
      DELETE FROM notifications WHERE recipient = ? AND id IN (
        SELECT id FROM notifications WHERE recipient = ? ORDER BY created_at ASC LIMIT ?
      )
    `).run(recipient, recipient, c - 199);
  }
  db.prepare(
    'INSERT OR IGNORE INTO notifications (id, recipient, type, title, message, contract_id, quote_id, created_at, read) VALUES (?,?,?,?,?,?,?,?,0)'
  ).run(notif.id, recipient, notif.type, notif.title, notif.message, notif.contractId ?? null, notif.quoteId ?? null, notif.createdAt);
}

export function dbMarkNotificationRead(recipient: string, id: string): void {
  getDb().prepare('UPDATE notifications SET read = 1 WHERE recipient = ? AND id = ?').run(recipient, id);
}

export function dbMarkAllNotificationsRead(recipient: string): void {
  getDb().prepare('UPDATE notifications SET read = 1 WHERE recipient = ?').run(recipient);
}

export function dbClearNotifications(recipient: string): void {
  getDb().prepare('DELETE FROM notifications WHERE recipient = ?').run(recipient);
}

export function dbDeleteNotification(recipient: string, id: string): void {
  getDb().prepare('DELETE FROM notifications WHERE recipient = ? AND id = ?').run(recipient, id);
}

// ─── Inquiry helpers ───────────────────────────────────────────────────────

export interface InquiryRecord {
  id: string;
  [key: string]: unknown;
}

export function dbReadInquiries(): InquiryRecord[] {
  const rows = getDb().prepare('SELECT data FROM inquiries').all() as { data: string }[];
  return rows.map(r => JSON.parse(r.data) as InquiryRecord);
}

export function dbWriteInquiry(inquiry: InquiryRecord): void {
  getDb().prepare('INSERT OR REPLACE INTO inquiries (id, data) VALUES (?, ?)').run(inquiry.id, JSON.stringify(inquiry));
}

export function dbDeleteInquiry(id: string): void {
  getDb().prepare('DELETE FROM inquiries WHERE id = ?').run(id);
}
