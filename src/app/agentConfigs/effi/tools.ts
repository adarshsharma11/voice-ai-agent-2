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

type EffiToolOptions = {
  includeEmail?: boolean;
};

export function createEffiTools(agentName: string, opts: EffiToolOptions = {}) {
  const tools: any[] = [
    tool({
      name: 'detect_intent',
      description:
        "Given the caller's latest utterance, returns a mock intent classification with confidence and optional entities.",
      parameters: {
        type: 'object',
        properties: {
          utterance: { type: 'string' },
        },
        required: ['utterance'],
        additionalProperties: false,
      },
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.effiSessionId;
        const text: string = (args?.utterance || '').toLowerCase();

        let intent = 'other';
        let confidence = 0.6;
        const entities: Record<string, any> = {};

        if (text.includes('book') || text.includes('schedule') || text.includes('reservation')) {
          intent = 'booking_request';
          confidence = 0.9;
        } else if (text.includes('issue') || text.includes('problem') || text.includes('broken') || text.includes('not working')) {
          intent = 'maintenance_issue';
          confidence = 0.9;
        } else if (text.includes('wifi') || text.includes('parking') || text.includes('check') || text.includes('amenity')) {
          intent = 'guest_inquiry';
          confidence = 0.85;
        } else if (text.startsWith('what ') || text.startsWith('how ') || text.includes('where')) {
          intent = 'general_info';
          confidence = 0.8;
        }

        if (text.includes('tomorrow')) entities.time_reference = 'tomorrow';
        else if (text.includes('today')) entities.time_reference = 'today';
        else if (text.includes('tonight')) entities.time_reference = 'tonight';

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
        'Updates a small per-call memory object (guest_name, property_name, check_in_date, notes).',
      parameters: {
        type: 'object',
        properties: {
          guest_name: { type: 'string' },
          property_name: { type: 'string' },
          check_in_date: { type: 'string' },
          note: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.effiSessionId;
        const existing = context.effiCallMemory || {
          guest_name: null,
          property_name: null,
          check_in_date: null,
          notes: [] as string[],
        };

        const updated = {
          ...existing,
          guest_name: args?.guest_name ?? existing.guest_name,
          property_name: args?.property_name ?? existing.property_name,
          check_in_date: args?.check_in_date ?? existing.check_in_date,
          notes: [...existing.notes, ...(args?.note ? [String(args.note)] : [])],
        };

        context.effiCallMemory = updated;
        await logTool({ sessionId, agentName, toolName: 'update_call_memory', args, result: updated });
        return { success: true, memory: updated };
      },
    }),

    tool({
      name: 'lookup_guest',
      description:
        'Looks up a guest in the MOMA House system using phone and/or email, returning a mock record.',
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
        const sessionId = context?.effiSessionId;
        const phone = args?.phone_number || '';
        const email = args?.email || '';

        const mockExists =
          Boolean(phone || email) &&
          ((phone && phone.replace(/\D/g, '').slice(-1) === '2') ||
            (email && email.toLowerCase().includes('vip')));

        const result = mockExists
          ? {
              exists: true,
              guest_id: 'GUEST-MOMA-001',
              name: 'Sarah Williams',
              current_property: 'MOMA Wellness Villa',
              check_in: '2025-01-15',
              check_out: '2025-01-22',
              is_vip: true,
            }
          : { exists: false };

        await logTool({ sessionId, agentName, toolName: 'lookup_guest', args, result });
        return result;
      },
    }),

    tool({
      name: 'lookup_property',
      description:
        'Looks up a property in the MOMA House portfolio by name or address.',
      parameters: {
        type: 'object',
        properties: {
          property_name: { type: 'string' },
          address: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.effiSessionId;
        const name = (args?.property_name || '').toLowerCase();

        const result = {
          exists: true,
          property_id: 'PROP-MOMA-001',
          name: name.includes('villa') ? 'MOMA Wellness Villa' : 'MOMA Serenity Suite',
          address: '123 Wellness Way, Miami Beach, FL',
          bedrooms: 4,
          amenities: ['Pool', 'Spa', 'Gym', 'Private Chef Kitchen', 'Meditation Room'],
          wifi_code: 'MOMA2025Wellness',
          parking_code: '4521',
        };

        await logTool({ sessionId, agentName, toolName: 'lookup_property', args, result });
        return result;
      },
    }),

    tool({
      name: 'request_callback',
      description:
        'Logs that a human (Effi or team) should call the person back later, returning a mock ticket ID.',
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
        const sessionId = context?.effiSessionId;
        const ticketId = `MOMA-CBK-${Date.now()}`;
        const result = { success: true, ticket_id: ticketId, normalized_urgency: args?.urgency || 'normal' };
        await logTool({ sessionId, agentName, toolName: 'request_callback', args, result });
        return result;
      },
    }),

    tool({
      name: 'escalate_to_human',
      description:
        'Marks that this call should be handled by Effi or the MOMA House team.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
        additionalProperties: false,
      },
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.effiSessionId;
        const result = { success: true, routed_to: 'effi_or_team', reason: args?.reason };
        await logTool({ sessionId, agentName, toolName: 'escalate_to_human', args, result });
        return result;
      },
    }),

    tool({
      name: 'send_followup_sms',
      description:
        'Pretends to send an SMS to the guest. No real SMS is sent.',
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
        const sessionId = context?.effiSessionId;
        const result = { success: true, provider: 'mock' };
        await logTool({ sessionId, agentName, toolName: 'send_followup_sms', args, result });
        return result;
      },
    }),

    tool({
      name: 'book_service',
      description:
        'Books a MOMA House wellness service (breathwork, private chef, massage, etc.).',
      parameters: {
        type: 'object',
        properties: {
          service_type: { type: 'string', enum: ['breathwork', 'meditation', 'private_chef', 'sports_massage', 'yoga', 'personal_training'] },
          date: { type: 'string' },
          time: { type: 'string' },
          duration_minutes: { type: 'number' },
          special_requests: { type: 'string' },
        },
        required: ['service_type', 'date', 'time'],
        additionalProperties: false,
      },
      execute: async (args: any, { context }: any) => {
        const sessionId = context?.effiSessionId;
        const bookingId = `MOMA-SVC-${Date.now()}`;
        const result = {
          success: true,
          booking_id: bookingId,
          service: args?.service_type,
          date: args?.date,
          time: args?.time,
          duration: args?.duration_minutes || 60,
          confirmation_sent: true,
        };
        await logTool({ sessionId, agentName, toolName: 'book_service', args, result });
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
        const sessionId = context?.effiSessionId;
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
        const sessionId = context?.effiSessionId;
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
          'Searches Gmail using a Gmail query. Returns message IDs and thread IDs.',
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
          const sessionId = context?.effiSessionId;
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
          'Fetches a specific Gmail message by ID.',
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
          const sessionId = context?.effiSessionId;
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
          const sessionId = context?.effiSessionId;
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
          const sessionId = context?.effiSessionId;
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

