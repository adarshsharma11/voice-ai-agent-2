import { NextRequest, NextResponse } from 'next/server';
import { appendRequestLog } from '@/app/lib/requestLog';

export const runtime = 'nodejs';

type ToolLogBody = {
  sessionId?: string;
  agentName?: string;
  toolName: string;
  phase?: 'start' | 'end';
  args?: any;
  result?: any;
  error?: string;
};

function sanitizeToolLog(body: ToolLogBody) {
  // Avoid writing full email bodies to disk by default.
  if (!body?.toolName?.startsWith('email_')) return body;

  const allowBodies = process.env.LOG_EMAIL_BODIES === '1';
  if (allowBodies) return body;

  const safeArgs = (() => {
    if (!body.args || typeof body.args !== 'object') return body.args;
    const a: any = { ...body.args };
    if ('body_text' in a) a.body_text = '[redacted]';
    return a;
  })();

  const safeResult = (() => {
    if (!body.result || typeof body.result !== 'object') return body.result;
    const r: any = { ...body.result };
    if ('body_text' in r) r.body_text = '[redacted]';
    return r;
  })();

  return { ...body, args: safeArgs, result: safeResult };
}

declare global {
  var __NIKA_TOOL_LOGS__: Map<string, ToolLogBody[]> | undefined;
}

function store() {
  if (!globalThis.__NIKA_TOOL_LOGS__) globalThis.__NIKA_TOOL_LOGS__ = new Map();
  return globalThis.__NIKA_TOOL_LOGS__;
}

export async function POST(req: NextRequest) {
  let body: ToolLogBody;
  try {
    body = (await req.json()) as ToolLogBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body?.toolName) {
    return NextResponse.json({ error: 'toolName is required' }, { status: 400 });
  }

  const sessionId = body.sessionId || 'unknown-session';
  const entry = sanitizeToolLog({ ...body, sessionId });
  const s = store();
  const arr = s.get(sessionId) ?? [];
  arr.push(entry);
  s.set(sessionId, arr);

  // Log to local json file (and keep in memory for end-of-session flush).
  await appendRequestLog({
    ts: new Date().toISOString(),
    kind: 'tool',
    sessionId,
    agentName: body.agentName,
    name: `${body.toolName}${body.phase ? `:${body.phase}` : ''}`,
    payload: entry.args,
    result: entry.result,
    error: entry.error,
  });

  // Also print a high-signal line to terminal.
  console.log('[TOOL]', {
    sessionId,
    agent: body.agentName,
    tool: body.toolName,
    phase: body.phase,
    error: body.error,
  });

  return NextResponse.json({ ok: true });
}

