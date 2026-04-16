export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── IP 기반 레이트 리밋 (메모리, 서버 재시작 시 초기화) ──────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;        // 최대 5회
const RATE_WINDOW = 60_000;  // 1분 윈도우

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY || "";
const ADMIN_EMAILS = process.env.SEND_MAIL_RECIPIENTS || process.env.ADMIN_EMAIL || 'admin@nexyfab.com';

// Setup mail transporter
// Note: In production, configure these via environment variables
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

async function verifyRecaptcha(token: string) {
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `secret=${RECAPTCHA_SECRET}&response=${token}`
    });
    const data = await res.json();
    return data.success && data.score >= 0.5;
}

function saveInquiry(data: Record<string, unknown>): void {
  const id = `inquiry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();

  const db = getDbAdapter();
  db.execute(
    `INSERT INTO nf_inquiries
       (id, action, name, email, project_name, budget, message, phone, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    id,
    String(data.action ?? 'send_contact'),
    String(data.name ?? ''),
    String(data.email ?? ''),
    String(data.project_name ?? data.company ?? ''),
    String(data.budget ?? data.budget_range ?? ''),
    String(data.message ?? data.content ?? ''),
    String(data.phone ?? ''),
    now,
  ).catch(err => console.error('saveInquiry DB write failed:', err));
}

export async function POST(req: NextRequest) {
    // CSRF origin check
    if (!checkOrigin(req)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // 0. 레이트 리밋
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1';
    if (!checkRateLimit(ip)) {
        return NextResponse.json({ success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
    }

    const formData = await req.formData();
    const data: Record<string, any> = {};
    const attachments: { filename: string; content: Buffer; path?: string }[] = [];

    // Separate files from text fields
    for (const [key, value] of formData.entries()) {
      if (value instanceof File && value.size > 0) {
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (value.size > maxSize) continue;
        const buffer = Buffer.from(await value.arrayBuffer());
        const safeName = value.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const ALLOWED_UPLOAD_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'step', 'stp', 'stl', 'dxf'];
        const ext = safeName.split('.').pop()?.toLowerCase() || '';
        if (!ALLOWED_UPLOAD_EXTS.includes(ext)) {
          continue; // Skip disallowed file types
        }
        attachments.push({ filename: safeName, content: buffer });
      } else {
        data[key] = value;
      }
    }

    // Save attachment files to disk (non-public directory — not web-accessible)
    if (attachments.length > 0) {
      const uploadDir = path.join(process.cwd(), 'data', 'uploads', 'inquiries', crypto.randomUUID());
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const savedPaths: string[] = [];
      for (const att of attachments) {
        const filePath = path.join(uploadDir, att.filename);
        fs.writeFileSync(filePath, att.content);
        att.path = filePath;
        savedPaths.push(`data/uploads/inquiries/${path.basename(uploadDir)}/${att.filename}`);
      }
      data._attachmentPaths = savedPaths;
    }

    // 1. Honeypot check
    if (data.website) {
        return NextResponse.json({ success: false, error: 'Spam detected' }, { status: 400 });
    }

    // 2. reCAPTCHA v3 verification (required)
    const token = data['g-recaptcha-response'];
    if (!token || !(await verifyRecaptcha(token))) {
        return NextResponse.json({ success: false, error: 'reCAPTCHA verification failed' }, { status: 403 });
    }

    // 3. Data Processing
    const type = data.action || 'unknown';
    const lang = (data.lang === 'kr' || data.lang === 'ko') ? 'ko' : (data.lang || 'en');
    let name = data.name || '';
    const company = data.company || '';
    const email = data.email || '';
    const phone = data.phone || '';

    if (!name && company) {
        name = company.split('(')[0].trim();
    }
    if (!name) name = 'Guest User';

    // 4. Construct Admin Email Content (Simplified Port)
    let adminSubject = `[System Notification] ${type} from ${name}`;
    let adminHtml = `<h3>New ${type.replace(/_/g, ' ')}</h3>`;
    
    // Add all form fields to email
    for (const [key, value] of Object.entries(data)) {
        if (['g-recaptcha-response', 'website', 'action', '_attachmentPaths'].includes(key)) continue;
        adminHtml += `<p><strong>${escapeHtml(String(key))}:</strong> ${escapeHtml(String(value))}</p>`;
    }
    if (attachments.length > 0) {
        adminHtml += `<p><strong>첨부파일 (${attachments.length}개):</strong> ${attachments.map(a => escapeHtml(a.filename)).join(', ')}</p>`;
    }

    // 5. Backup data
    saveInquiry(data);

    // 6. Send Emails
    try {
        // Only attempt sending if SMTP is configured
        if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
            // Admin Email (with attachments if any)
            await transporter.sendMail({
                from: `"Nexyfab System" <info@Nexyfab.com>`,
                to: ADMIN_EMAILS,
                subject: adminSubject,
                html: adminHtml,
                attachments: attachments.map(a => ({ filename: a.filename, content: a.content })),
            });

            // User Auto-reply logic would go here (Similar to PHP dictionary)
            // ... (Skipping verbose auto-reply port for brevity unless asked)
        } else {
            console.warn('SMTP_HOST/USER/PASS not set. Email not sent, but inquiry saved.');
        }

        return NextResponse.json({ success: true, message: 'Inquiry processed successfully' });
    } catch (err) {
        console.error('Email sending failed:', err);
        return NextResponse.json({ success: false, error: 'Failed to send notification' }, { status: 500 });
    }
}


