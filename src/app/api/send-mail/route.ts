export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { screenSanctions } from '@/lib/compliance';
import { rateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import type { CountryCode } from '@/lib/country-pricing';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

    // 0. Rate limit: 5 requests per minute per IP
    const rawIp = getTrustedClientIp(req.headers);
    const ip = rawIp === 'unknown' ? '127.0.0.1' : rawIp;
    const rl = rateLimit(`send-mail:${ip}`, 5, 60_000);
    if (!rl.allowed) {
        return NextResponse.json(
            { success: false, error: 'Too many requests. Please try again later.' },
            { status: 429, headers: rateLimitHeaders(rl, 5) },
        );
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

    // 2a. Sanctions screening — fail-closed for supplier onboarding.
    // Optional `country` / `bank_country` fields (ISO-3166 alpha-2). When
    // absent, we fail-open: legacy forms predate the field and the user base
    // is Korea-dominant, so skipping is safer than rejecting everyone.
    if (data.action === 'send_partner_register') {
        const country = typeof data.country === 'string' ? data.country.trim().toUpperCase() : '';
        const bankCountry = typeof data.bank_country === 'string' ? data.bank_country.trim().toUpperCase() : '';
        if (country) {
            const screen = screenSanctions({
                country: country as CountryCode,
                bankCountry: bankCountry ? (bankCountry as CountryCode) : undefined,
            });
            if (!screen.pass) {
                console.warn('[send-mail] partner register rejected (sanctions):', {
                    program: screen.program, country, bankCountry, email: data.email,
                });
                return NextResponse.json(
                    { success: false, error: screen.reason ?? 'Sanctions screening failed', program: screen.program },
                    { status: 403 },
                );
            }
        }
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
    const adminSubject = `[System Notification] ${type} from ${name}`;
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


