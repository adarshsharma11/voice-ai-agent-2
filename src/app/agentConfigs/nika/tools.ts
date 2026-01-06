import { tool } from '@openai/agents/realtime';

async function logTool(payload: {
  sessionId?: string;
  agentName?: string;
  toolName: string;
  phase?: 'start' | 'end';
  args?: any;
  result?: any;
  error?: string;
}) {
  try {
    await fetch('/api/tool-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // ignore logging failures
  }
}

async function callApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return json as T;
}

type NikaToolOptions = {
  includeEmail?: boolean;
};

export function createNikaTools(agentName: string, opts: NikaToolOptions = {}) {
  const tools: any[] = [
    tool({
      name: 'detect_intent',
      description:
        'Given the caller’s latest utterance, returns a mock intent classification with confidence and optional entities.',
      parameters: {
        type: 'object',
        properties: {
          utterance: { type: 'string' },
        },
        required: ['utterance'],
        additionalProperties: false,
      },
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.nikaSessionId;
        const text: string = (args?.utterance || '').toLowerCase();

        let intent = 'other';
        let confidence = 0.6;
        const entities: Record<string, any> = {};

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

        const result = {
          intent,
          confidence,
          entities: Object.keys(entities).length ? entities : undefined,
        };

        await logTool({ sessionId, agentName, toolName: 'detect_intent', args, result });
        return result;
      },
    }),

    tool({
      name: 'update_call_memory',
      description:
        'Updates a small per-call memory object (caller_name, project_type, preferred_time, notes).',
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
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.nikaSessionId;
        const existing = context.nikaCallMemory || {
          caller_name: null,
          project_type: null,
          preferred_time: null,
          notes: [] as string[],
        };

        const updated = {
          ...existing,
          caller_name: args?.caller_name ?? existing.caller_name,
          project_type: args?.project_type ?? existing.project_type,
          preferred_time: args?.preferred_time ?? existing.preferred_time,
          notes: [...existing.notes, ...(args?.note ? [String(args.note)] : [])],
        };

        context.nikaCallMemory = updated;
        await logTool({ sessionId, agentName, toolName: 'update_call_memory', args, result: updated });
        return { success: true, memory: updated };
      },
    }),

    tool({
      name: 'lookup_customer',
      description:
        'Pretends to look up a customer in a CRM using phone and/or email, returning a mock record.',
      parameters: {
        type: 'object',
        properties: {
          phone_number: { type: 'string' },
          email: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.nikaSessionId;
        const phone = args?.phone_number || '';
        const email = args?.email || '';

        const mockExists =
          Boolean(phone || email) &&
          ((phone && phone.replace(/\\D/g, '').slice(-1) === '2') ||
            (email && email.toLowerCase().includes('vip')));

        const result = mockExists
          ? {
              exists: true,
              customer_id: 'CUST-EXAMPLE-001',
              name: 'Alex Example',
              last_project: 'AI voice agent for property lead qualification',
              is_vip: true,
            }
          : { exists: false };

        await logTool({ sessionId, agentName, toolName: 'lookup_customer', args, result });
        return result;
      },
    }),

    tool({
      name: 'request_callback',
      description:
        'Logs that a human should call the person back later, returning a mock ticket ID.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          urgency: { type: 'string', enum: ['low', 'normal', 'high'] },
        },
        required: ['reason'],
        additionalProperties: false,
      },
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.nikaSessionId;
        const ticketId = `CBK-${Date.now()}`;
        const result = { success: true, ticket_id: ticketId, normalized_urgency: args?.urgency || 'normal' };
        await logTool({ sessionId, agentName, toolName: 'request_callback', args, result });
        return result;
      },
    }),

    tool({
      name: 'escalate_to_human',
      description:
        'Marks that this call should be handled by a human, returning a simple success object.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
        additionalProperties: false,
      },
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.nikaSessionId;
        const result = { success: true, routed_to: 'human_operator', reason: args?.reason };
        await logTool({ sessionId, agentName, toolName: 'escalate_to_human', args, result });
        return result;
      },
    }),

    tool({
      name: 'send_followup_sms',
      description:
        'Pretends to send an SMS summary to the caller after the call ends. No real SMS is sent.',
      parameters: {
        type: 'object',
        properties: {
          phone_number: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['phone_number', 'message'],
        additionalProperties: false,
      },
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.nikaSessionId;
        const result = { success: true, provider: 'mock' };
        await logTool({ sessionId, agentName, toolName: 'send_followup_sms', args, result });
        return result;
      },
    }),

    tool({
      name: 'calendar_find_slots',
      description:
        'Checks Google Calendar and returns available time slots inside a given window.',
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
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.nikaSessionId;
        try {
          const result = await callApi('/api/google-calendar', { action: 'find_slots', ...args });
          await logTool({ sessionId, agentName, toolName: 'calendar_find_slots', args, result });
          return result;
        } catch (e: any) {
          await logTool({ sessionId, agentName, toolName: 'calendar_find_slots', args, error: String(e?.message || e) });
          throw e;
        }
      },
    }),

    tool({
      name: 'calendar_create_event',
      description:
        'Creates a Google Calendar event. Only call after the user confirms the exact time.',
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
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.nikaSessionId;
        try {
          const result = await callApi('/api/google-calendar', { action: 'create_event', ...args });
          await logTool({ sessionId, agentName, toolName: 'calendar_create_event', args, result });
          return result;
        } catch (e: any) {
          await logTool({ sessionId, agentName, toolName: 'calendar_create_event', args, error: String(e?.message || e) });
          throw e;
        }
      },
    }),
  ];

  if (opts.includeEmail) {
    tools.push(
      tool({
        name: 'email_search',
        description:
          'Searches your Gmail using a Gmail query (e.g. "from:foo subject:bar newer_than:7d"). Returns message IDs and thread IDs.',
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            max_results: { type: 'number' },
          },
          required: ['q'],
          additionalProperties: false,
        },
        execute: async (args: any, { context }: any) => {
          const sessionId = context?.nikaSessionId;
          try {
            const result = await callApi('/api/gmail', {
              action: 'search',
              q: args?.q,
              max_results: args?.max_results,
            });
            await logTool({ sessionId, agentName, toolName: 'email_search', args, result });
            return result;
          } catch (e: any) {
            await logTool({ sessionId, agentName, toolName: 'email_search', args, error: String(e?.message || e) });
            throw e;
          }
        },
      }),
      tool({
        name: 'email_get',
        description:
          'Fetches a specific Gmail message by ID. Use format="metadata" unless you truly need the full body.',
        parameters: {
          type: 'object',
          properties: {
            message_id: { type: 'string' },
            format: { type: 'string', enum: ['metadata', 'full'] },
          },
          required: ['message_id'],
          additionalProperties: false,
        },
        execute: async (args: any, { context }: any) => {
          const sessionId = context?.nikaSessionId;
          try {
            const result = await callApi('/api/gmail', {
              action: 'get',
              message_id: args?.message_id,
              format: args?.format ?? 'metadata',
            });
            await logTool({ sessionId, agentName, toolName: 'email_get', args, result });
            return result;
          } catch (e: any) {
            await logTool({ sessionId, agentName, toolName: 'email_get', args, error: String(e?.message || e) });
            throw e;
          }
        },
      }),
      tool({
        name: 'email_draft_create',
        description:
          'Creates an email draft (does not send). Always confirm the content with the user before sending.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string' },
            subject: { type: 'string' },
            body_text: { type: 'string' },
            thread_id: { type: 'string' },
          },
          required: ['to', 'subject', 'body_text'],
          additionalProperties: false,
        },
        execute: async (args: any, { context }: any) => {
          const sessionId = context?.nikaSessionId;
          try {
            const result = await callApi('/api/gmail', {
              action: 'draft_create',
              to: args?.to,
              subject: args?.subject,
              body_text: args?.body_text,
              thread_id: args?.thread_id,
            });
            await logTool({ sessionId, agentName, toolName: 'email_draft_create', args, result });
            return result;
          } catch (e: any) {
            await logTool({ sessionId, agentName, toolName: 'email_draft_create', args, error: String(e?.message || e) });
            throw e;
          }
        },
      }),
      tool({
        name: 'email_send_draft',
        description:
          'Sends a previously created draft. ONLY call this after the user explicitly confirms sending.',
        parameters: {
          type: 'object',
          properties: {
            draft_id: { type: 'string' },
          },
          required: ['draft_id'],
          additionalProperties: false,
        },
        execute: async (args: any, { context }: any) => {
          const sessionId = context?.nikaSessionId;
          try {
            const result = await callApi('/api/gmail', {
              action: 'send_draft',
              draft_id: args?.draft_id,
            });
            await logTool({ sessionId, agentName, toolName: 'email_send_draft', args, result });
            return result;
          } catch (e: any) {
            await logTool({ sessionId, agentName, toolName: 'email_send_draft', args, error: String(e?.message || e) });
            throw e;
          }
        },
      }),
    );
  }

  return tools;
}

