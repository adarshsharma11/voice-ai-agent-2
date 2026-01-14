import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { appendRequestLog } from '../../lib/requestLog';

export const runtime = 'nodejs';

type GmailSearchRequest = {
  action: 'search';
  q: string;
  max_results?: number;
};

type GmailGetRequest = {
  action: 'get';
  message_id?: string;
  // Alias: some callers send `id` instead of `message_id`
  id?: string;
  format?: 'metadata' | 'full';
};

type GmailDraftCreateRequest = {
  action: 'draft_create';
  to: string;
  subject: string;
  body_text: string;
  thread_id?: string;
};

type GmailSendDraftRequest = {
  action: 'send_draft';
  draft_id: string;
};

type RequestBody =
  | GmailSearchRequest
  | GmailGetRequest
  | GmailDraftCreateRequest
  | GmailSendDraftRequest;

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_GMAIL_CLIENT_ID &&
      process.env.GOOGLE_GMAIL_CLIENT_SECRET &&
      process.env.GOOGLE_GMAIL_REFRESH_TOKEN,
  );
}

function getGmailClient() {
  const oauth2 = new google.auth.OAuth2(
    requireEnv('GOOGLE_GMAIL_CLIENT_ID'),
    requireEnv('GOOGLE_GMAIL_CLIENT_SECRET'),
  );
  oauth2.setCredentials({ refresh_token: requireEnv('GOOGLE_GMAIL_REFRESH_TOKEN') });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

function getUserId() {
  return process.env.GOOGLE_GMAIL_USER || 'me';
}

function base64UrlEncode(str: string) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildRawEmail(opts: { to: string; subject: string; bodyText: string }) {
  // Minimal RFC 5322 message. Gmail API accepts base64url-encoded raw.
  const lines = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    opts.bodyText,
  ];
  return lines.join('\r\n');
}

function headersToMap(headers: any[] | undefined) {
  const out: Record<string, string> = {};
  for (const h of headers || []) {
    if (h?.name && h?.value) out[String(h.name).toLowerCase()] = String(h.value);
  }
  return out;
}

function extractPlainText(payload: any): string {
  // Prefer body.data if present and text/plain.
  if (!payload) return '';
  const mimeType = payload.mimeType;
  const bodyData = payload.body?.data;
  if (mimeType === 'text/plain' && bodyData) {
    return Buffer.from(String(bodyData).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  }
  const parts = payload.parts || [];
  for (const p of parts) {
    const t = extractPlainText(p);
    if (t) return t;
  }
  return '';
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Always log that a call happened, but keep it metadata-only (no email bodies).
  await appendRequestLog({
    ts: new Date().toISOString(),
    kind: 'api',
    name: 'gmail',
    payload: {
      action: (body as any)?.action,
      // Keep small metadata only
      q: (body as any)?.q,
      message_id: (body as any)?.message_id,
      id: (body as any)?.id,
      draft_id: (body as any)?.draft_id,
      to: (body as any)?.to,
      subject: (body as any)?.subject,
      thread_id: (body as any)?.thread_id,
    },
  });

  if (!isConfigured()) {
    return NextResponse.json(
      {
        error:
          'Gmail is not configured. Set GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET, and GOOGLE_GMAIL_REFRESH_TOKEN.',
      },
      { status: 501 },
    );
  }

  try {
    const gmail = getGmailClient();
    const userId = getUserId();

    if (body.action === 'search') {
      const maxResults = Math.min(50, Math.max(1, body.max_results ?? 10));
      const res = await gmail.users.messages.list({
        userId,
        q: body.q,
        maxResults,
      });
      const messages = res.data.messages ?? [];
      return NextResponse.json({ messages });
    }

    if (body.action === 'get') {
      const format = body.format ?? 'metadata';
      const messageId = body.message_id || (body as any).id;
      if (!messageId) {
        return NextResponse.json({ error: 'message_id is required' }, { status: 400 });
      }
      const res = await gmail.users.messages.get({
        userId,
        id: messageId,
        format: format === 'full' ? 'full' : 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Date'],
      });
      const msg = res.data;
      const headers = headersToMap(msg.payload?.headers as any[]);
      const result: any = {
        id: msg.id,
        threadId: msg.threadId,
        labelIds: msg.labelIds,
        snippet: msg.snippet,
        headers,
      };
      if (format === 'full') {
        result.body_text = extractPlainText(msg.payload);
      }
      return NextResponse.json(result);
    }

    if (body.action === 'draft_create') {
      const raw = buildRawEmail({
        to: body.to,
        subject: body.subject,
        bodyText: body.body_text,
      });
      const encoded = base64UrlEncode(raw);
      const res = await gmail.users.drafts.create({
        userId,
        requestBody: {
          message: {
            raw: encoded,
            threadId: body.thread_id,
          },
        },
      });
      return NextResponse.json({
        id: res.data.id,
        messageId: res.data.message?.id,
        threadId: res.data.message?.threadId,
      });
    }

    if (body.action === 'send_draft') {
      const res = await gmail.users.drafts.send({
        userId,
        requestBody: { id: body.draft_id },
      });
      return NextResponse.json({
        id: res.data.id,
        threadId: res.data.threadId,
        labelIds: res.data.labelIds,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    const message = String(err?.message || err);
    await appendRequestLog({
      ts: new Date().toISOString(),
      kind: 'api',
      name: 'gmail:error',
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
