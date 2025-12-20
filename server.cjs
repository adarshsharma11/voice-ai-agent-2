/**
 * Custom server for Twilio integration.
 *
 * This handles:
 * - /twilio/voice (POST) → TwiML for inbound calls
 * - /twilio/outbound (GET/POST) → TwiML for outbound calls
 * - /twilio/stream (WebSocket) → bidirectional audio bridge to OpenAI Realtime
 *
 * Run with: node server.cjs
 * Or update package.json scripts to use this instead of next dev.
 */
require('dotenv/config');
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

const http = require('node:http');
const next = require('next');
const { WebSocketServer, WebSocket } = require('ws');

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, port });
const handle = app.getRequestHandler();

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return json;
}

async function logTool(payload) {
  try {
    await postJson(`http://127.0.0.1:${port}/api/tool-log`, payload);
  } catch {
    // ignore logging failures
  }
}

function safeJsonParse(str) {
  try {
    return { ok: true, value: JSON.parse(str) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

// Agent instructions (imported inline to avoid ESM issues in CJS).
const AGENT_INSTRUCTIONS = {
  customer_service: `
# Nika – Customer Service (Inbound)
# Languages; English and Hebrew
## Mandatory greeting (FIRST sentence)
- You MUST say the company name in the first sentence and include a quick AI disclosure.
- Use a natural variant like:
  - "Thanks for calling NikaTech Solutions — this is Nika, the AI assistant. How can I help today?"

## Role
- You handle inbound support/customer service for NikaTech Solutions.
- Goal: resolve quickly, or escalate cleanly with a clear next step.

## Voice / feel
- Warm, empathetic, patient. Use light human mannerisms sparingly.
- Ask max 1 question at a time.

## Accuracy / safety
- Never hallucinate policies, pricing, availability, or fixes.
- If you're unsure, say what you need and offer the safest next step.

## Triage flow
1) Empathy + restate the issue briefly.
2) Categorize (billing / technical / scheduling / other).
3) Confirm key details: name, best callback/email, specifics.
4) Resolve if possible; otherwise escalate.
5) End with summary: what we did, what happens next, and when.

## Calendar
- Use calendar_find_slots to propose times.
- Only call calendar_create_event after explicit confirmation.
`,

  assistant: `
# Nika – Personal Assistant (for Alon)
## Greeting (keep it short + fast)
- Start with ONE short sentence only, then a question.
- Example: "NikaTech Solutions — Nika here. How can I help?"

## Role
- You are Alon's personal assistant.
- You help manage time, scheduling, and email quickly and correctly.

## Style
- Speak quickly and efficiently. Keep responses short.
- Be direct and concise. Ask as few questions as possible.
- Propose a clear plan + 2–3 options + confirm.
- Ask max 1 question at a time.

## Email (Gmail)
- You CAN use Gmail tools (search/get/draft/send) via your toolkit when asked.
- If the user asks to "read my latest email", use email_get_latest.
- Never send an email without explicit confirmation.
- Before sending: read back To + Subject and ask: "Send it?"
- When user confirms, use email_send (NOT email_draft_create then email_send_draft).
- IMPORTANT: Always pass the FULL email address to email_send (e.g. "name@gmail.com").
- Draft structure (always):
  - Greeting line
  - 1–2 short paragraphs
  - Clear next step / ask
  - Warm sign-off
  - Signature: "— Alon" unless user asks otherwise

## Calendar
- Default to a 30-minute slot unless told otherwise.
- Use calendar_find_slots to propose times (2–3 options).
- If the user gives a day+time like "Friday 4pm", use calendar_check_time_nl.
- Only call calendar_create_event after explicit confirmation.
`,

  outbound: `
# Nika – Outbound Sales (Follow-up)
# Languages; English and Hebrew
## Mandatory greeting (FIRST sentence)
- You MUST say the company name in the first sentence and include a quick AI disclosure.
- Use a natural variant like:
  - "Hi — Nika calling from NikaTech Solutions. I'm the AI assistant here."

## Role
- You're calling to follow up or re-engage a lead.
- Your goal is to book a 10–15 min call with Alon or secure a clear next step.

## Style
- Friendly, energetic, confident. Keep it short.
- Ask max 1 question at a time.

## Default call flow
1) Pattern interrupt + context: "Quick one: I'll take 20 seconds for why I'm calling, and you can tell me 'not a fit' — fair?"
2) Value prop (1 sentence): "We help boost ROI by automating operational stuff."
3) Micro-qualifier (ONE question only)
4) Close for meeting (low friction): "Is it crazy to book a 12-minute call with Alon this week?"
5) Objection handles (short, then re-close)
6) End polite: "Thanks — this is Nika at NikaTech Solutions. Appreciate you."

## Scheduling
- Default to a 12-minute call.
- Required to book: timezone + time window.
- Use calendar_find_slots to offer 2–3 specific times.
- Use calendar_create_event only after explicit confirmation.
`,
};

function normalizeAgentKey(raw) {
  const v = String(raw || '').toLowerCase().trim();
  if (v === 'assistant' || v === 'pa' || v === 'personal_assistant') return 'assistant';
  if (v === 'outbound' || v === 'sales') return 'outbound';
  return 'customer_service';
}

function agentToEagerness(agent) {
  // Phone audio benefits from slightly lower eagerness to avoid cutting off
  if (agent === 'outbound') return 'medium';
  if (agent === 'customer_service') return 'low';
  return 'low';
}

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: String(map.weekday || ''),
  };
}

function tzOffsetMs(date, timeZone) {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

function zonedToUtcIso(ymdhm, timeZone) {
  // Convert a local datetime in `timeZone` to a UTC ISO string.
  const baseUtc = Date.UTC(ymdhm.year, ymdhm.month - 1, ymdhm.day, ymdhm.hour, ymdhm.minute, 0);
  let guess = new Date(baseUtc);
  let off = tzOffsetMs(guess, timeZone);
  let utc = new Date(baseUtc - off);
  // One more iteration for DST boundaries
  off = tzOffsetMs(utc, timeZone);
  utc = new Date(baseUtc - off);
  return utc.toISOString();
}

function parseWeekdayIndex(text) {
  const t = String(text || '').toLowerCase();
  const map = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  };
  for (const k of Object.keys(map)) {
    if (t.includes(k)) return map[k];
  }
  return null;
}

function parseTimeOfDay(text) {
  const t = String(text || '').toLowerCase();
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = m[3];
  if (ampm) {
    if (hour === 12) hour = 0;
    if (ampm === 'pm') hour += 12;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function inferTimeZone({ explicitTz, text }) {
  const tz = String(explicitTz || '').trim();
  if (tz) return tz;
  const t = String(text || '').toLowerCase();
  // Common spoken US timezones
  if (t.includes('eastern') || /\bet\b/.test(t)) return 'America/New_York';
  if (t.includes('central') || /\bct\b/.test(t)) return 'America/Chicago';
  if (t.includes('mountain') || /\bmt\b/.test(t)) return 'America/Denver';
  if (t.includes('pacific') || /\bpt\b/.test(t)) return 'America/Los_Angeles';
  // Fallback: if you want to override globally, set DEFAULT_TIMEZONE in .env
  if (process.env.DEFAULT_TIMEZONE) return String(process.env.DEFAULT_TIMEZONE);
  return 'America/New_York';
}

function normalizeEmailAddress(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  // If a valid email is already present, extract it.
  const direct = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (direct) return direct[0].toLowerCase();

  // Spoken formats: "name at gmail dot com"
  let s = raw.toLowerCase();
  // Handle various spoken "at" patterns
  s = s.replace(/\s*\(at\)\s*/g, '@');
  s = s.replace(/\s+at\s+/g, '@');
  s = s.replace(/\bat\b/g, '@'); // standalone "at"
  // Handle various spoken "dot" patterns
  s = s.replace(/\s*\(dot\)\s*/g, '.');
  s = s.replace(/\s+dot\s+/g, '.');
  s = s.replace(/\bdot\b/g, '.'); // standalone "dot"
  // Remove remaining spaces
  s = s.replace(/\s+/g, '');

  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}

function allowedTools(agent) {
  // Phone bridge tool definitions (JSON schema). Keep in sync with executeTool() below.
  const base = [
    {
      type: 'function',
      name: 'detect_intent',
      description:
        'Given the caller’s latest utterance, returns a simple intent classification with confidence and optional entities.',
      parameters: {
        type: 'object',
        properties: { utterance: { type: 'string' } },
        required: ['utterance'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'update_call_memory',
      description: 'Updates per-call memory (caller_name, project_type, preferred_time, notes).',
      parameters: {
        type: 'object',
        properties: {
          caller_name: { type: 'string' },
          project_type: { type: 'string' },
          preferred_time: { type: 'string' },
          note: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'lookup_customer',
      description: 'Mock CRM lookup using phone_number and/or email.',
      parameters: {
        type: 'object',
        properties: {
          phone_number: { type: 'string' },
          email: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'request_callback',
      description: 'Logs that a human should call back later, returning a mock ticket ID.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          urgency: { type: 'string', enum: ['low', 'normal', 'high'] },
        },
        required: ['reason'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'escalate_to_human',
      description: 'Marks that this call should be handled by a human.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'send_followup_sms',
      description: 'Mock SMS send (no real SMS is sent).',
      parameters: {
        type: 'object',
        properties: { phone_number: { type: 'string' }, message: { type: 'string' } },
        required: ['phone_number', 'message'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'calendar_find_slots',
      description: 'Checks Google Calendar and returns available time slots inside a given window.',
      parameters: {
        type: 'object',
        properties: {
          window_start: { type: 'string' },
          window_end: { type: 'string' },
          timezone: { type: 'string' },
          duration_minutes: { type: 'number' },
          max_results: { type: 'number' },
        },
        required: ['window_start', 'window_end', 'timezone', 'duration_minutes'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'calendar_check_time',
      description:
        'Checks whether a specific start time is available for the requested duration. Returns available=true/false.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string' },
          timezone: { type: 'string' },
          duration_minutes: { type: 'number' },
        },
        required: ['start', 'timezone', 'duration_minutes'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'calendar_check_time_nl',
      description:
        'Checks a specific natural-language time like \"Friday 4pm\" in a timezone. Use this when the user gives a day+time instead of an ISO datetime.',
      parameters: {
        type: 'object',
        properties: {
          when: { type: 'string' },
          timezone: { type: 'string', description: 'IANA timezone (optional if user said e.g. Eastern Time)' },
          duration_minutes: { type: 'number' },
        },
        required: ['when', 'duration_minutes'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'calendar_create_event',
      description: 'Creates a Google Calendar event. Only call after the user confirms the exact time.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          description: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          timezone: { type: 'string' },
          attendees: { type: 'array', items: { type: 'string' } },
          location: { type: 'string' },
        },
        required: ['summary', 'start', 'end', 'timezone'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'calendar_update_event',
      description: 'Updates a Google Calendar event. Only call after the user confirms the changes.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string' },
          summary: { type: 'string' },
          description: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          timezone: { type: 'string' },
          attendees: { type: 'array', items: { type: 'string' } },
          location: { type: 'string' },
        },
        required: ['event_id'],
        additionalProperties: false,
      },
    },
  ];

  if (agent === 'assistant') {
    base.push(
      {
        type: 'function',
        name: 'email_search',
        description: 'Searches Gmail using a Gmail query. Returns message IDs and thread IDs.',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string' }, max_results: { type: 'number' } },
          required: ['q'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'email_get',
        description: 'Fetches a Gmail message by ID. Use format=\"metadata\" unless you truly need full body.',
        parameters: {
          type: 'object',
          properties: {
            message_id: { type: 'string' },
            // Alias some models prefer:
            id: { type: 'string' },
            format: { type: 'string', enum: ['metadata', 'full'] },
          },
          required: [],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'email_get_latest',
        description:
          'Fetches your most recent email message (metadata by default). Use this when the user asks for “my latest email”.',
        parameters: {
          type: 'object',
          properties: { format: { type: 'string', enum: ['metadata', 'full'] } },
          required: [],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'email_draft_create',
        description: 'Creates an email draft (does not send). Always confirm before sending. The "to" field MUST be a complete email address like "name@example.com" – include the full address the user provides.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Full email address (e.g. "john@gmail.com"). Must include @ and domain.' },
            subject: { type: 'string' },
            body_text: { type: 'string' },
            thread_id: { type: 'string' },
          },
          required: ['to', 'subject', 'body_text'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'email_send_draft',
        description: 'Sends a previously created draft. ONLY after explicit user confirmation.',
        parameters: { type: 'object', properties: { draft_id: { type: 'string' } }, required: ['draft_id'], additionalProperties: false },
      },
      {
        type: 'function',
        name: 'email_send',
        description: 'Creates AND sends an email in one step. Use this when the user confirms they want to send. Requires full email address.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Full email address (e.g. "john@gmail.com"). Must include @ and domain.' },
            subject: { type: 'string' },
            body_text: { type: 'string' },
            thread_id: { type: 'string' },
          },
          required: ['to', 'subject', 'body_text'],
          additionalProperties: false,
        },
      },
    );
  }

  return base;
}

app.prepare().then(() => {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);

      // Twilio Voice webhooks (TwiML)
      const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/+$/g, '');
      const streamSecret = process.env.STREAM_SECRET || '';

      if (!publicUrl || !streamSecret) {
        if (url.pathname === '/twilio/voice' || url.pathname === '/twilio/outbound') {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain');
          res.end('Missing PUBLIC_URL or STREAM_SECRET in .env');
          return;
        }
      }

      const baseWs = publicUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') || `ws://${req.headers.host}`;

      // TwiML for bidirectional audio
      // IMPORTANT: Twilio may strip query params on the websocket upgrade.
      // Use <Parameter> so agent/token survive into the Twilio "start" event.
      const twiml = (streamUrl, params = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl.replace(/&/g, '&amp;')}">
      ${Object.entries(params)
        .map(([k, v]) => `      <Parameter name="${k}" value="${String(v).replace(/&/g, '&amp;')}" />`)
        .join('\n')}
    </Stream>
  </Connect>
</Response>`;

      // Inbound calls -> Personal Assistant agent (default)
      if (url.pathname === '/twilio/voice' && req.method === 'POST') {
        const streamUrl = new URL(`${baseWs}/twilio/stream`);
        streamUrl.searchParams.set('agent', 'assistant');
        streamUrl.searchParams.set('token', streamSecret);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/xml');
        res.end(
          twiml(streamUrl.toString(), {
            agent: 'assistant',
            token: streamSecret,
          }),
        );
        return;
      }

      // Outbound calls
      if (url.pathname === '/twilio/outbound' && (req.method === 'GET' || req.method === 'POST')) {
        const agent = normalizeAgentKey(url.searchParams.get('agent') || 'outbound');
        const streamUrl = new URL(`${baseWs}/twilio/stream`);
        streamUrl.searchParams.set('agent', agent);
        streamUrl.searchParams.set('token', streamSecret);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/xml');
        res.end(
          twiml(streamUrl.toString(), {
            agent,
            token: streamSecret,
          }),
        );
        return;
      }

      await handle(req, res);
    } catch (err) {
      console.error('[server] request error', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    if (url.pathname !== '/twilio/stream') {
      socket.destroy();
      return;
    }

    // Validate stream secret
    const token = url.searchParams.get('token');
    const expected = process.env.STREAM_SECRET;
    // Twilio sometimes strips query params on the websocket upgrade depending on configuration.
    // To avoid immediate call hangups, treat a missing token as a warning, but only reject when
    // a token is provided and it is incorrect.
    if (expected) {
      if (!token) {
        console.log('[twilio] stream token missing on websocket upgrade (allowing)');
      } else if (token !== expected) {
        console.log('[twilio] invalid stream token (rejecting)');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    console.log('[twilio] WebSocket connected');

    let streamSid = null;
    let gotFirstMedia = false;
    let gotFirstDelta = false;
    let agent = 'customer_service';

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      agent = normalizeAgentKey(url.searchParams.get('agent'));
    } catch {}

    let openaiWs = null;
    let openaiStarted = false;

    // Audio buffering for smoother phone delivery
    let audioQueue = [];
    let isSending = false;
    let lastAudioDeltaAt = 0;

    // Per-call memory for mock tools.
    const callMemory = {
      caller_name: null,
      project_type: null,
      preferred_time: null,
      notes: [],
    };

    // Deduplicate tool calls (OpenAI may emit multiple related events per call).
    const handledToolCallIds = new Set();
    
    // Accumulate function call arguments (they stream in chunks)
    const pendingFunctionCalls = new Map(); // call_id -> { name, arguments }

    const sendToOpenAI = (ev) => {
      try {
        if (openaiWs?.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify(ev));
        }
      } catch (e) {
        console.error('[openai] send error', e);
      }
    };

    const sendToTwilio = (payload) => {
      try {
        if (ws.readyState === WebSocket.OPEN && streamSid) {
          ws.send(JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload },
          }));
        }
      } catch (e) {
        console.error('[twilio] send error', e);
      }
    };

    // Process audio queue to avoid overwhelming Twilio
    const processAudioQueue = () => {
      if (isSending || audioQueue.length === 0) return;
      isSending = true;

      const chunk = audioQueue.shift();
      sendToTwilio(chunk);

      // Small delay between chunks for phone line stability
      setTimeout(() => {
        isSending = false;
        processAudioQueue();
      }, 10);
    };

    const queueAudio = (payload) => {
      audioQueue.push(payload);
      processAudioQueue();
    };

    const closeOpenAI = () => {
      try {
        openaiWs?.close();
      } catch {}
      openaiWs = null;
      audioQueue = [];
    };

    const startOpenAI = () => {
      if (openaiStarted) return;
      openaiStarted = true;

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error('[openai] Missing OPENAI_API_KEY');
        return;
      }

      const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
      const wsUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

      console.log(`[openai] Connecting to ${model}...`);

      openaiWs = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      openaiWs.on('open', () => {
        console.log('[openai] Connected');

        // Session update with phone-optimized settings
        sendToOpenAI({
          type: 'session.update',
          session: {
            voice: 'sage',
            modalities: ['audio', 'text'],
            input_audio_format: 'g711_ulaw',
            output_audio_format: 'g711_ulaw',
            instructions: AGENT_INSTRUCTIONS[agent] || AGENT_INSTRUCTIONS.customer_service,
            tools: allowedTools(agent),
            tool_choice: 'auto',
            turn_detection: {
              type: 'server_vad',
              // Phone-optimized VAD settings for better hearing
              threshold: 0.4,              // Lower threshold = more sensitive to speech
              prefix_padding_ms: 500,      // More padding before speech starts
              silence_duration_ms: 800,    // Longer silence before considering turn complete
              create_response: true,
            },
            input_audio_transcription: {
              model: 'whisper-1',
            },
          },
        });

        // Send initial greeting trigger
        setTimeout(() => {
          sendToOpenAI({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'hi' }],
            },
          });
          sendToOpenAI({ type: 'response.create' });
        }, 500);
      });

      openaiWs.on('message', (data) => {
        let ev;
        try {
          ev = JSON.parse(String(data));
        } catch {
          return;
        }

        // DEBUG: Log ALL non-audio events
        if (ev?.type && !ev.type.includes('audio') && !ev.type.includes('transcription')) {
          console.log('[openai] EVENT:', ev.type, JSON.stringify(ev).slice(0, 500));
        }

        // Audio delta -> queue for Twilio
        if (ev?.type === 'response.audio.delta' && ev.delta) {
          if (!gotFirstDelta) {
            console.log('[openai] First audio delta received');
            gotFirstDelta = true;
          }
          lastAudioDeltaAt = Date.now();
          queueAudio(ev.delta);
        }

        // Log transcriptions for debugging
        if (ev?.type === 'conversation.item.input_audio_transcription.completed') {
          console.log('[transcription] User:', ev.transcript);
        }

        if (ev?.type === 'response.audio_transcript.done') {
          console.log('[transcription] Nika:', ev.transcript);
        }

        // Log errors
        if (ev?.type === 'error') {
          console.error('[openai] Error:', ev.error);
        }

        // ---- Accumulate function call arguments (streamed in deltas) ----
        if (ev?.type === 'response.function_call_arguments.delta') {
          const cid = ev.call_id;
          if (cid) {
            if (!pendingFunctionCalls.has(cid)) {
              pendingFunctionCalls.set(cid, { name: '', arguments: '' });
            }
            const pending = pendingFunctionCalls.get(cid);
            pending.arguments += ev.delta || '';
          }
        }

        // Capture function name from output_item.added
        if (ev?.type === 'response.output_item.added' && ev?.item?.type === 'function_call') {
          const cid = ev.item.call_id;
          if (cid) {
            if (!pendingFunctionCalls.has(cid)) {
              pendingFunctionCalls.set(cid, { name: '', arguments: '' });
            }
            pendingFunctionCalls.get(cid).name = ev.item.name || '';
          }
        }
        
        // BEST SOURCE: response.output_item.done has COMPLETE function_call with all args
        if (ev?.type === 'response.output_item.done' && ev?.item?.type === 'function_call') {
          const cid = ev.item.call_id;
          if (cid) {
            // This event has the FULL arguments - override anything partial
            pendingFunctionCalls.set(cid, { 
              name: ev.item.name || '', 
              arguments: ev.item.arguments || '' 
            });
            console.log('[DEBUG] output_item.done has full args:', ev.item.name, ev.item.arguments?.slice(0, 200));
          }
        }
        
        // ALSO: response.done contains ALL output items - extract function calls from there
        if (ev?.type === 'response.done' && ev?.response?.output) {
          for (const item of ev.response.output) {
            if (item.type === 'function_call' && item.call_id) {
              pendingFunctionCalls.set(item.call_id, {
                name: item.name || '',
                arguments: item.arguments || '',
              });
              console.log('[DEBUG] response.done has function_call:', item.name, item.arguments?.slice(0, 200));
            }
          }
        }

        // ---- Tool calling (function calling) ----
        // The Realtime API emits function call events; we execute the function and send a
        // function_call_output item back, then trigger response continuation.
        const maybeHandleToolCall = async () => {
          let callId;
          let fnName;
          let argsStr;

          // Get function call info - we only trigger on events with FULL args now
          
          // 1. response.function_call_arguments.done - has full args in ev.arguments
          if (ev?.type === 'response.function_call_arguments.done') {
            callId = ev.call_id;
            fnName = ev.name || '';
            argsStr = ev.arguments || '';
          }

          // 2. response.output_item.done with function_call - has full args in ev.item.arguments
          if (!fnName && ev?.type === 'response.output_item.done' && ev?.item?.type === 'function_call') {
            callId = ev.item.call_id;
            fnName = ev.item.name || '';
            argsStr = ev.item.arguments || '';
          }

          if (!fnName || !callId) return;
          
          // Clean up any pending data
          pendingFunctionCalls.delete(callId);
          if (handledToolCallIds.has(callId)) return;
          handledToolCallIds.add(callId);

          console.log('[toolcall] start', { callId, fnName });
          console.log('[toolcall] raw argsStr:', argsStr);

          const parsed = safeJsonParse(argsStr || '{}');
          const args = parsed.ok ? parsed.value : {};
          console.log('[toolcall] parsed args:', JSON.stringify(args));

          const sessionId = streamSid || 'unknown-stream';

          const executeTool = async (name, toolArgs) => {
            // Mock tools (same behavior as the web tools)
            if (name === 'detect_intent') {
              const text = String(toolArgs?.utterance || '').toLowerCase();
              let intent = 'other';
              let confidence = 0.6;
              const entities = {};
              if (text.includes('book') || text.includes('schedule') || text.includes('call')) {
                intent = 'booking_request';
                confidence = 0.9;
              } else if (text.includes('issue') || text.includes('problem') || text.includes('bug') || text.includes('error')) {
                intent = 'support_question';
                confidence = 0.9;
              } else if (text.startsWith('what ') || text.startsWith('how ') || text.includes('explain') || text.includes('information')) {
                intent = 'general_info';
                confidence = 0.8;
              }
              if (text.includes('tomorrow')) entities.time_reference = 'tomorrow';
              else if (text.includes('today')) entities.time_reference = 'today';
              else if (text.includes('next week')) entities.time_reference = 'next_week';
              return { intent, confidence, entities: Object.keys(entities).length ? entities : undefined };
            }

            if (name === 'update_call_memory') {
              if (toolArgs?.caller_name !== undefined) callMemory.caller_name = toolArgs.caller_name;
              if (toolArgs?.project_type !== undefined) callMemory.project_type = toolArgs.project_type;
              if (toolArgs?.preferred_time !== undefined) callMemory.preferred_time = toolArgs.preferred_time;
              if (toolArgs?.note) callMemory.notes.push(String(toolArgs.note));
              return { success: true, memory: callMemory };
            }

            if (name === 'lookup_customer') {
              const phone = toolArgs?.phone_number || '';
              const email = toolArgs?.email || '';
              const mockExists =
                Boolean(phone || email) &&
                ((phone && String(phone).replace(/\\D/g, '').slice(-1) === '2') ||
                  (email && String(email).toLowerCase().includes('vip')));
              return mockExists
                ? {
                    exists: true,
                    customer_id: 'CUST-EXAMPLE-001',
                    name: 'Alex Example',
                    last_project: 'AI voice agent for property lead qualification',
                    is_vip: true,
                  }
                : { exists: false };
            }

            if (name === 'request_callback') {
              return { success: true, ticket_id: `CBK-${Date.now()}`, normalized_urgency: toolArgs?.urgency || 'normal' };
            }

            if (name === 'escalate_to_human') {
              return { success: true, routed_to: 'human_operator', reason: toolArgs?.reason };
            }

            if (name === 'send_followup_sms') {
              return { success: true, provider: 'mock' };
            }

            // Real tools backed by Next API routes
            if (name === 'calendar_find_slots') {
              console.log('[calendar_find_slots] ALL args:', JSON.stringify(toolArgs));
              return await postJson(`http://127.0.0.1:${port}/api/google-calendar`, { action: 'find_slots', ...toolArgs });
            }
            if (name === 'calendar_check_time') {
              console.log('[calendar_check_time] ALL args:', JSON.stringify(toolArgs));
              const startIso = toolArgs?.start;
              const tz = toolArgs?.timezone;
              const duration = Number(toolArgs?.duration_minutes);
              const startMs = Date.parse(startIso);
              if (!Number.isFinite(startMs)) throw new Error(`Invalid datetime: ${startIso}`);
              if (!Number.isFinite(duration) || duration <= 0) throw new Error('duration_minutes must be > 0');
              const endMs = startMs + duration * 60_000;

              const slots = await postJson(`http://127.0.0.1:${port}/api/google-calendar`, {
                action: 'find_slots',
                window_start: new Date(startMs).toISOString(),
                window_end: new Date(endMs).toISOString(),
                timezone: tz,
                duration_minutes: duration,
                max_results: 3,
              });

              const available = Array.isArray(slots?.slots) && slots.slots.some((s) => s?.start === new Date(startMs).toISOString());
              return {
                requested: {
                  start: new Date(startMs).toISOString(),
                  end: new Date(endMs).toISOString(),
                  timezone: tz,
                  duration_minutes: duration,
                },
                available,
                alternatives: slots?.slots || [],
              };
            }
            if (name === 'calendar_check_time_nl') {
              console.log('[calendar_check_time_nl] ALL args:', JSON.stringify(toolArgs));
              const when = String(toolArgs?.when || toolArgs?.time || toolArgs?.datetime || '');
              const tz = inferTimeZone({ explicitTz: toolArgs?.timezone, text: when });
              // Default to 30 minutes if not provided
              let duration = Number(toolArgs?.duration_minutes || toolArgs?.duration || 30);
              if (!Number.isFinite(duration) || duration <= 0) duration = 30;

              const weekdayIdx = parseWeekdayIndex(when);
              const tod = parseTimeOfDay(when);
              if (weekdayIdx === null || !tod) {
                throw new Error('Could not parse `when`. Please include weekday + time like "Friday 4pm".');
              }

              const now = new Date();
              const zp = getZonedParts(now, tz);
              const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
              const curW = weekdayMap[zp.weekday] ?? 0;
              let daysUntil = (weekdayIdx - curW + 7) % 7;

              // If it's the same weekday but time already passed in that timezone, push to next week.
              if (daysUntil === 0) {
                const curMinutes = zp.hour * 60 + zp.minute;
                const targetMinutes = tod.hour * 60 + tod.minute;
                if (targetMinutes <= curMinutes) daysUntil = 7;
              }

              const baseUtcMid = Date.UTC(zp.year, zp.month - 1, zp.day, 0, 0, 0);
              const targetUtcMid = baseUtcMid + daysUntil * 86400_000;
              const d = new Date(targetUtcMid);
              const targetY = d.getUTCFullYear();
              const targetM = d.getUTCMonth() + 1;
              const targetD = d.getUTCDate();

              const startIso = zonedToUtcIso(
                { year: targetY, month: targetM, day: targetD, hour: tod.hour, minute: tod.minute },
                tz,
              );

              // Reuse the exact-time checker
              return await executeTool('calendar_check_time', {
                start: startIso,
                timezone: tz,
                duration_minutes: duration,
              });
            }
            if (name === 'calendar_create_event') {
              return await postJson(`http://127.0.0.1:${port}/api/google-calendar`, { action: 'create_event', ...toolArgs });
            }
            if (name === 'calendar_update_event') {
              return await postJson(`http://127.0.0.1:${port}/api/google-calendar`, { action: 'update_event', ...toolArgs });
            }

            if (name === 'email_search') {
              return await postJson(`http://127.0.0.1:${port}/api/gmail`, {
                action: 'search',
                q: toolArgs?.q,
                max_results: toolArgs?.max_results,
              });
            }
            if (name === 'email_get') {
              const messageId = toolArgs?.message_id || toolArgs?.id;
              if (!messageId) throw new Error('message_id (or id) is required');
              return await postJson(`http://127.0.0.1:${port}/api/gmail`, {
                action: 'get',
                message_id: messageId,
                format: toolArgs?.format ?? 'metadata',
              });
            }
            if (name === 'email_get_latest') {
              const format = toolArgs?.format ?? 'metadata';
              const search = await postJson(`http://127.0.0.1:${port}/api/gmail`, {
                action: 'search',
                // Gmail returns newest-first for message list.
                q: 'newer_than:30d',
                max_results: 5,
              });
              const first = Array.isArray(search?.messages) ? search.messages[0] : null;
              const messageId = first?.id;
              if (!messageId) throw new Error('No recent emails found (search returned empty).');
              return await postJson(`http://127.0.0.1:${port}/api/gmail`, {
                action: 'get',
                message_id: messageId,
                format,
              });
            }
            if (name === 'email_draft_create') {
              console.log('[email_draft_create] ALL args:', JSON.stringify(toolArgs));
              const rawTo = toolArgs?.to || toolArgs?.recipient || toolArgs?.email || toolArgs?.address;
              console.log('[email_draft_create] raw to:', JSON.stringify(rawTo));
              const normalizedTo = normalizeEmailAddress(rawTo);
              console.log('[email_draft_create] normalized to:', normalizedTo);
              if (!normalizedTo) throw new Error('Invalid email address. Please provide something like name@example.com');
              return await postJson(`http://127.0.0.1:${port}/api/gmail`, {
                action: 'draft_create',
                to: normalizedTo,
                subject: toolArgs?.subject,
                body_text: toolArgs?.body_text,
                thread_id: toolArgs?.thread_id,
              });
            }
            if (name === 'email_send_draft') {
              return await postJson(`http://127.0.0.1:${port}/api/gmail`, { action: 'send_draft', draft_id: toolArgs?.draft_id });
            }
            if (name === 'email_send') {
              // Combined create-and-send: create draft, then send it immediately
              console.log('[email_send] ALL args:', JSON.stringify(toolArgs));
              // Try multiple possible field names the model might use
              const rawTo = toolArgs?.to || toolArgs?.recipient || toolArgs?.email || toolArgs?.address;
              console.log('[email_send] raw to:', JSON.stringify(rawTo));
              const normalizedTo = normalizeEmailAddress(rawTo);
              console.log('[email_send] normalized to:', normalizedTo);
              if (!normalizedTo) throw new Error('Invalid email address. Please provide something like name@example.com');
              
              // Step 1: Create draft
              const draft = await postJson(`http://127.0.0.1:${port}/api/gmail`, {
                action: 'draft_create',
                to: normalizedTo,
                subject: toolArgs?.subject,
                body_text: toolArgs?.body_text,
                thread_id: toolArgs?.thread_id,
              });
              
              const draftId = draft?.draft?.id || draft?.id;
              if (!draftId) throw new Error('Failed to create draft');
              
              // Step 2: Send draft
              const sent = await postJson(`http://127.0.0.1:${port}/api/gmail`, {
                action: 'send_draft',
                draft_id: draftId,
              });
              
              return { success: true, message_id: sent?.id, to: normalizedTo, subject: toolArgs?.subject };
            }

            throw new Error(`Unknown tool: ${name}`);
          };

          let result;
          try {
            result = await executeTool(fnName, args);
            await logTool({ sessionId, agentName: agent, toolName: fnName, args, result });
          } catch (err) {
            const error = String(err?.message || err);
            await logTool({ sessionId, agentName: agent, toolName: fnName, args, error });
            result = { error };
          }

          // Send tool result back to the model
          sendToOpenAI({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(result),
            },
          });
          console.log('[toolcall] output_sent', { callId, fnName });
          // IMPORTANT: do NOT call response.create here.
          // The model is already in an active response when it calls tools, and it will
          // continue once it receives function_call_output. Calling response.create here
          // can trigger 'conversation_already_has_active_response'.
          //
          // If we don't see audio resume shortly after tool output, send one best-effort
          // response.create as a fallback (and ignore any "active response" errors).
          const outputSentAt = Date.now();
          setTimeout(() => {
            try {
              if (lastAudioDeltaAt && lastAudioDeltaAt >= outputSentAt) return;
              if (openaiWs?.readyState !== WebSocket.OPEN) return;
              sendToOpenAI({ type: 'response.create' });
              console.log('[toolcall] fallback_response_create', { callId, fnName });
            } catch {}
          }, 700);
        };

        // Fire-and-forget tool handling so audio still streams.
        // ONLY trigger on events that have COMPLETE arguments:
        // - response.function_call_arguments.done (has full args in ev.arguments)
        // - response.output_item.done with type=function_call (has full args in ev.item.arguments)
        // DO NOT trigger on response.output_item.added (has empty args!)
        if (ev?.type === 'response.function_call_arguments.done') {
          maybeHandleToolCall().catch(() => {});
        }
        if (ev?.type === 'response.output_item.done' && ev?.item?.type === 'function_call') {
          maybeHandleToolCall().catch(() => {});
        }
      });

      openaiWs.on('error', (e) => {
        console.error('[openai] WebSocket error:', e?.message || e);
      });

      openaiWs.on('close', (code, reason) => {
        console.log('[openai] WebSocket closed:', code, String(reason || ''));
      });
    };

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      if (msg?.event === 'connected') {
        console.log('[twilio] Stream connected');
        return;
      }

      if (msg?.event === 'start') {
        streamSid = msg.start?.streamSid;
        // Twilio customParameters are the reliable way to get agent/token (query params can be stripped).
        try {
          const cp = msg.start?.customParameters || msg.start?.custom_parameters || {};
          if (cp.agent) agent = normalizeAgentKey(cp.agent);
          const expected = process.env.STREAM_SECRET;
          if (expected && cp.token && cp.token !== expected) {
            console.log('[twilio] invalid stream token in start event (closing)');
            ws.close();
            return;
          }
        } catch {}

        console.log('[twilio] Stream started:', { streamSid, agent });
        startOpenAI();
        return;
      }

      if (msg?.event === 'media') {
        if (!gotFirstMedia) {
          console.log('[twilio] First media packet received');
          gotFirstMedia = true;
        }

        // Forward audio to OpenAI
        if (msg.media?.payload) {
          sendToOpenAI({
            type: 'input_audio_buffer.append',
            audio: msg.media.payload,
          });
        }
        return;
      }

      if (msg?.event === 'stop') {
        console.log('[twilio] Stream stopped');
        closeOpenAI();
        return;
      }
    });

    ws.on('close', () => {
      console.log('[twilio] WebSocket closed');
      closeOpenAI();
    });

    ws.on('error', (e) => {
      console.error('[twilio] WebSocket error:', e?.message || e);
    });
  });

  server.listen(port, () => {
    console.log(`\n[server] Ready on http://localhost:${port} (dev=${dev})`);
    console.log(`[server] Twilio webhook: POST ${process.env.PUBLIC_URL || 'http://localhost:' + port}/twilio/voice`);
    console.log(`[server] Twilio stream:  ws://localhost:${port}/twilio/stream\n`);
  });
});

