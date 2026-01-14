import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { appendRequestLog } from '../../lib/requestLog';

export const runtime = 'nodejs';

type FindSlotsRequest = {
  action: 'find_slots';
  window_start: string;
  window_end: string;
  timezone: string;
  duration_minutes: number;
  max_results?: number;
};

type CreateEventRequest = {
  action: 'create_event';
  summary: string;
  description?: string;
  start: string;
  end: string;
  timezone: string;
  attendees?: string[];
  location?: string;
};

type UpdateEventRequest = {
  action: 'update_event';
  event_id: string;
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  timezone?: string;
  attendees?: string[];
  location?: string;
};

type RequestBody = FindSlotsRequest | CreateEventRequest | UpdateEventRequest;

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
      process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
  );
}

function getCalendarId() {
  return process.env.GOOGLE_CALENDAR_CALENDAR_ID || 'primary';
}

function getCalendarClient() {
  const oauth2 = new google.auth.OAuth2(
    requireEnv('GOOGLE_CALENDAR_CLIENT_ID'),
    requireEnv('GOOGLE_CALENDAR_CLIENT_SECRET'),
  );
  oauth2.setCredentials({ refresh_token: requireEnv('GOOGLE_CALENDAR_REFRESH_TOKEN') });
  return google.calendar({ version: 'v3', auth: oauth2 });
}

function parseDateMs(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`Invalid datetime: ${iso}`);
  return ms;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function roundUpToStep(ms: number, stepMinutes: number) {
  const step = stepMinutes * 60_000;
  return Math.ceil(ms / step) * step;
}

function formatSlotLabel(startMs: number, endMs: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${fmt.format(new Date(startMs))} – ${fmt.format(new Date(endMs))} (${timeZone})`;
}

async function handleFindSlots(body: FindSlotsRequest) {
  const cal = getCalendarClient();
  const calendarId = getCalendarId();

  const windowStartMs = parseDateMs(body.window_start);
  const windowEndMs = parseDateMs(body.window_end);
  if (windowEndMs <= windowStartMs) throw new Error('window_end must be after window_start');

  const durationMs = Math.round(Number(body.duration_minutes) * 60_000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('duration_minutes must be > 0');

  const timeMin = new Date(windowStartMs).toISOString();
  const timeMax = new Date(windowEndMs).toISOString();

  const fb = await cal.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      timeZone: body.timezone,
      items: [{ id: calendarId }],
    },
  });

  const busyRaw = fb.data.calendars?.[calendarId]?.busy ?? [];
  const busy = busyRaw
    .map((b) => ({ startMs: Date.parse(b.start || ''), endMs: Date.parse(b.end || '') }))
    .filter((b) => Number.isFinite(b.startMs) && Number.isFinite(b.endMs) && b.endMs > b.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const stepMinutes = 15;
  const maxResults = Math.min(20, Math.max(1, body.max_results ?? 5));
  const slots: Array<{ start: string; end: string; label: string }> = [];

  let t = roundUpToStep(windowStartMs, stepMinutes);
  let busyIdx = 0;

  while (t + durationMs <= windowEndMs && slots.length < maxResults) {
    const slotStart = t;
    const slotEnd = t + durationMs;
    while (busyIdx < busy.length && busy[busyIdx].endMs <= slotStart) busyIdx++;
    const conflict =
      busyIdx < busy.length && overlaps(slotStart, slotEnd, busy[busyIdx].startMs, busy[busyIdx].endMs);

    if (!conflict) {
      slots.push({
        start: new Date(slotStart).toISOString(),
        end: new Date(slotEnd).toISOString(),
        label: formatSlotLabel(slotStart, slotEnd, body.timezone),
      });
    }
    t += stepMinutes * 60_000;
  }

  return {
    timezone: body.timezone,
    window_start: timeMin,
    window_end: timeMax,
    duration_minutes: body.duration_minutes,
    slots,
  };
}

async function handleCreateEvent(body: CreateEventRequest) {
  const cal = getCalendarClient();
  const calendarId = getCalendarId();
  parseDateMs(body.start);
  parseDateMs(body.end);

  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: body.summary,
      description: body.description,
      location: body.location,
      start: { dateTime: body.start, timeZone: body.timezone },
      end: { dateTime: body.end, timeZone: body.timezone },
      attendees: body.attendees?.map((email) => ({ email })) ?? undefined,
    },
  });

  const ev = res.data;
  return {
    id: ev.id,
    status: ev.status,
    htmlLink: ev.htmlLink,
    summary: ev.summary,
    start: ev.start,
    end: ev.end,
  };
}

async function handleUpdateEvent(body: UpdateEventRequest) {
  const cal = getCalendarClient();
  const calendarId = getCalendarId();

  // If times are provided, validate.
  if (body.start) parseDateMs(body.start);
  if (body.end) parseDateMs(body.end);

  const res = await cal.events.patch({
    calendarId,
    eventId: body.event_id,
    requestBody: {
      summary: body.summary,
      description: body.description,
      location: body.location,
      start: body.start ? { dateTime: body.start, timeZone: body.timezone } : undefined,
      end: body.end ? { dateTime: body.end, timeZone: body.timezone } : undefined,
      attendees: body.attendees?.map((email) => ({ email })) ?? undefined,
    },
  });

  const ev = res.data;
  return {
    id: ev.id,
    status: ev.status,
    htmlLink: ev.htmlLink,
    summary: ev.summary,
    start: ev.start,
    end: ev.end,
  };
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  await appendRequestLog({
    ts: new Date().toISOString(),
    kind: 'api',
    name: 'google-calendar',
    payload: body,
  });

  if (!isConfigured()) {
    return NextResponse.json(
      {
        error:
          'Google Calendar is not configured. Set GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, and GOOGLE_CALENDAR_REFRESH_TOKEN.',
      },
      { status: 501 },
    );
  }

  try {
    const result =
      body.action === 'find_slots'
        ? await handleFindSlots(body)
        : body.action === 'create_event'
          ? await handleCreateEvent(body)
          : body.action === 'update_event'
            ? await handleUpdateEvent(body)
          : null;

    if (!result) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    await appendRequestLog({
      ts: new Date().toISOString(),
      kind: 'api',
      name: 'google-calendar:result',
      result,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    const message = String(err?.message || err);
    await appendRequestLog({
      ts: new Date().toISOString(),
      kind: 'api',
      name: 'google-calendar:error',
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
