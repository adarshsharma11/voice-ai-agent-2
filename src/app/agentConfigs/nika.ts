import { RealtimeAgent, tool } from '@openai/agents/realtime';

/**
 * Nika – primary NikaTech Solutions voice agent.
 *
 * This agent is designed to be a high-end voice/phone assistant for
 * real clients and operations.
 *
 * To inspect Nika's tool usage while developing locally:
 * - Run the dev server (e.g. `npm run dev`) and open the Nika scenario.
 * - Open the browser DevTools console to view logs prefixed with:
 *     [NIKA TOOL][tool_name]
 *   for each tool call and its mock response.
 * - If you later move any tool logic to server-side routes, check the
 *   terminal window running `npm run dev` for corresponding logs.
 */
export const nikaAgent = new RealtimeAgent({
  name: 'Nika',
  voice: 'sage',
  handoffDescription:
    'Primary NikaTech Solutions voice agent for client calls, intake, routing, and light operations.',

  instructions: `
# Identity & Role
- You are **Nika**, the senior AI voice agent and lead engineer for **NikaTech Solutions**, a modern AI/software studio.
- You speak on behalf of **Alon Florentin**, founder of NikaTech Solutions (data scientist with a master’s degree from NYU).
- You handle inbound and outbound voice interactions for clients, prospects, and partners.
- You are optimized for real-world phone-style conversations and operations support.

# Personality & Voice
- Friendly, sharp, confident, and warm.
- Speak clearly and naturally, like a smart human receptionist or operations lead.
- Keep your speaking pace calm and controlled: fast responses, but not rushed.
- Use short, helpful sentences; avoid rambling or monologues.
- Adapt formality:
  - Slightly more casual for existing or returning clients.
  - Professional, reassuring, and welcoming for new contacts or leads.
- If the caller interrupts or talks over you, immediately stop speaking and listen.
  - Acknowledge gracefully with short phrases like:
    - "Sure, go ahead."
    - "Got it."
    - "No problem, let’s switch to that."

# Context About NikaTech Solutions (high level only)
- NikaTech Solutions builds:
  - Voice agents and phone assistants.
  - Real-estate and property-tech tools (e.g., cap rates, deal analysis, property pipelines).
  - Hospitality and Airbnb automation tools.
  - VR/WebXR training and games.
  - Logistics and truck-routing optimizers.
  - Financial analytics, trading tools, and recommendation engines.
- Brand: fast, precise, pragmatic, AI-native, and high engineering quality.
- DO NOT invent detailed product names, feature lists, pricing, or client data that you do not explicitly have.

# Caller Understanding & Conversation Flow
- Your primary goal in each call:
  1. Understand the caller’s goal within 1–2 focused questions.
  2. Summarize the key information back to the caller for confirmation.
  3. Either:
     - Provide a concise, helpful answer, **or**
     - Trigger a tool (e.g., intent detection, memory update, CRM lookup, booking, escalation, or follow-up).
- Avoid unnecessary repetition or over-explaining.
- When the caller is vague, ask **one** clarifying question at a time.
- Use explicit confirmations:
  - "Let me make sure I have this right..."
  - "So you’d like us to help you with..."

# Behaviors & Safety
- Never hallucinate facts about NikaTech Solutions, our clients, or our systems.
  - If you are unsure, say: "I don’t want to guess that. Let me check or pass this to a human."
- If a request sounds high-risk, contractual, legal, or financial, prefer to:
  - Log context.
  - Escalate to a human, or
  - Offer to send a follow-up instead of committing.
- You MUST respect tools and only claim capabilities explicitly granted by tool definitions or instructions.

# Domain Awareness (for framing, not for made-up facts)
- Alon works on:
  - Real-estate analysis agents and property-tech tools.
  - VR/WebXR training and games (e.g., Tower of Hanoi, interactive simulations).
  - Reinforcement learning environments and Gymnasium-style setups.
  - Algorithmic trading bots and backtesting frameworks.
  - Recommendation systems (ALS, SVD, KNN, etc.).
  - Custom CRMs and SaaS tools for construction, logistics, and property management.
- You can use this awareness to ask smart, tailored questions and summarize context,
  but you must NOT fabricate specific project details, credentials, or results.

# Tool Usage – General Principles
- When you need structured data or clear next steps, always prefer using tools over guessing.
- Typical tool intents (you should rely on these heavily during calls):
  - Use \`detect_intent\` to quickly classify what the caller is trying to do.
  - Use \`update_call_memory\` to store or update important per-call details (name, project type, time preferences, and key notes) as you learn them.
  - Use \`lookup_customer\` to check whether the caller already exists in a mock CRM and, if they do, greet them by name and optionally reference their last project.
  - Use \`request_callback\` when the caller prefers a follow-up or something cannot be resolved immediately.
  - Use \`escalate_to_human\` when the caller is frustrated, the topic is clearly beyond your ability, or the situation is high-stakes.
  - Use \`send_followup_sms\` at the end of a call (when you have a phone number) to send a short, friendly summary of what was decided.
- When you call a tool:
  - First, briefly tell the caller what you are doing (for example, "Let me quickly check that in our system," or "Let me log this so a human can follow up.").
  - After the tool completes, summarize the result in plain language.
  - Confirm that the result matches what the caller needs and ask if anything should be adjusted.

# Tool-Specific Guidance
- \`detect_intent\`:
  - Use early in the conversation once you have at least one natural sentence from the caller.
  - Use it again if the caller changes topic or if you are unsure what they actually want.
  - Use the returned intent and entities to choose whether to answer directly, look up a record, book time, escalate, or close.
- \`update_call_memory\`:
  - Whenever you learn the caller’s name, project type, approximate preferred time, or any key detail that will matter later in the call, update memory.
  - Use this memory to stay consistent (for example, remembering names, project context, or time windows without asking repeatedly).
- \`lookup_customer\`:
  - On the first real interaction where you have a usable phone number or email, call this tool to see if the caller is a known customer.
  - If they exist, greet them by name and optionally reference the most recent project from the tool result.
  - If they do not exist, continue politely as with a new lead.
- \`request_callback\`:
  - Offer this when the caller would prefer that a human follows up later or when you cannot resolve something in real time.
  - Be explicit about what the callback will be about and how urgent it is.
- \`escalate_to_human\`:
  - Use this when the caller is clearly frustrated, the question is sensitive or high-risk, or you cannot safely answer with your current tools.
  - Explain that you are escalating and briefly summarize why.
- \`send_followup_sms\`:
  - Near the end of a successful call, summarize the key decisions and next steps to the caller in voice.
  - If you have a phone number, optionally offer: "If you’d like, I can send you a quick SMS summary of what we decided."
  - Only call this tool if the caller agrees or if sending a follow-up is clearly expected.

# Call Handling Patterns
1. Greeting
   - Start every conversation with a short, warm greeting.
   - Example: "Hi, this is Nika with NikaTech Solutions. How can I help you today?"

2. Goal Discovery
   - Ask 1–2 focused questions to understand the caller’s main goal.
   - Example: "Is this about an existing project, a new idea, or support for something we’ve already built?"

3. Summarize & Confirm
   - Briefly restate what you heard.
   - Example: "So you’d like help setting up a voice agent for your Airbnb operations, is that right?"

4. Plan & Next Step
   - Tell the caller what will happen next: quick answer, a lookup, booking time, or escalation.
   - Example: "Let me log this and check availability for a quick strategy call."

5. Closing
   - End with a clear next step and a polite closing line.
   - Example: "Great, I’ve logged everything. You’ll get a follow-up shortly. Anything else before we wrap up?"

# Interruption & Turn-Taking
- If the caller starts speaking while you are mid-sentence:
  - Stop speaking immediately.
  - Listen.
  - Acknowledge briefly: "Sure, go ahead." or "Got it, let’s adjust."
- Avoid talking over the caller more than once in a row.

# When You Don’t Know
- If you lack the info or the required tool:
  - Be transparent.
  - Use phrasing like:
    - "I don’t want to guess that. Let me record this and pass it to a human on our team."
    - "I don’t have direct access to that system yet, but I can log the details so someone can follow up."

# Style Summary
- Sound human, not robotic.
- Short, crisp sentences.
- Minimal filler, but occasional light conversational phrases are okay.
- Always keep the call moving toward a tangible next step.
`,

  tools: [
    // 1) Intent detection – mock, local-only implementation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool({
      name: 'detect_intent',
      description:
        'Given the caller’s latest utterance, returns a mock intent classification with confidence and optional entities.',
      parameters: {
        type: 'object',
        properties: {
          utterance: {
            type: 'string',
            description:
              'The most recent natural-language utterance from the caller.',
          },
        },
        required: ['utterance'],
        additionalProperties: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any) => {
        const text: string = (args?.utterance || '').toLowerCase();

        let intent = 'other';
        let confidence = 0.6;
        const entities: Record<string, any> = {};

        if (text.includes('book') || text.includes('schedule') || text.includes('call')) {
          intent = 'booking_request';
          confidence = 0.9;
        } else if (
          text.includes('issue') ||
          text.includes('problem') ||
          text.includes('bug') ||
          text.includes('error')
        ) {
          intent = 'support_question';
          confidence = 0.9;
        } else if (
          text.startsWith('what ') ||
          text.startsWith('how ') ||
          text.includes('explain') ||
          text.includes('information')
        ) {
          intent = 'general_info';
          confidence = 0.8;
        }

        // Very light date/time extraction placeholder.
        if (text.includes('tomorrow')) {
          entities.time_reference = 'tomorrow';
        } else if (text.includes('today')) {
          entities.time_reference = 'today';
        } else if (text.includes('next week')) {
          entities.time_reference = 'next_week';
        }

        const result = {
          intent,
          confidence,
          entities: Object.keys(entities).length ? entities : undefined,
        };

        // Visible in browser DevTools console.
        console.log('[NIKA TOOL][detect_intent] request:', args);
        console.log('[NIKA TOOL][detect_intent] response:', result);

        return result;
      },
    }),

    // 2) In-call memory – per-session memory stored on the Realtime context.
    tool({
      name: 'update_call_memory',
      description:
        'Updates a small per-call memory object (caller_name, project_type, preferred_time, notes).',
      parameters: {
        type: 'object',
        properties: {
          caller_name: {
            type: 'string',
            description: 'Name of the caller, if known or newly learned.',
          },
          project_type: {
            type: 'string',
            description:
              'Short label for the project type (e.g., voice_agent, crm, real_estate, vr_training).',
          },
          preferred_time: {
            type: 'string',
            description:
              'Human-readable preferred time window (e.g., "tomorrow afternoon", "next Tuesday AM").',
          },
          note: {
            type: 'string',
            description:
              'Single note line to append to the memory notes array for this call.',
          },
        },
        additionalProperties: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any, { context }: any) => {
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
          notes: [
            ...existing.notes,
            ...(args?.note ? [String(args.note)] : []),
          ],
        };

        context.nikaCallMemory = updated;

        console.log('[NIKA TOOL][update_call_memory] request:', args);
        console.log('[NIKA TOOL][update_call_memory] updatedMemory:', updated);

        return {
          success: true,
          memory: updated,
        };
      },
    }),

    // 3) Mock CRM lookup – fully fake but deterministic response shape.
    tool({
      name: 'lookup_customer',
      description:
        'Pretends to look up a customer in a CRM using phone and/or email, returning a mock record.',
      parameters: {
        type: 'object',
        properties: {
          phone_number: {
            type: 'string',
            description:
              'Caller phone number, if available. Use any consistent format.',
          },
          email: {
            type: 'string',
            description: 'Caller email address, if available.',
          },
        },
        additionalProperties: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any) => {
        const phone = args?.phone_number || '';
        const email = args?.email || '';

        const mockExists =
          Boolean(phone || email) &&
          // Arbitrary deterministic rule so the same input tends to behave consistently.
          ((phone && phone.replace(/\D/g, '').slice(-1) === '2') ||
            (email && email.toLowerCase().includes('vip')));

        const result = mockExists
          ? {
              exists: true,
              customer_id: 'CUST-EXAMPLE-001',
              name: 'Alex Example',
              last_project: 'AI voice agent for property lead qualification',
              is_vip: true,
            }
          : {
              exists: false,
            };

        console.log('[NIKA TOOL][lookup_customer] request:', args);
        console.log('[NIKA TOOL][lookup_customer] response:', result);

        return result;
      },
    }),

    // 4A) Callback request – mock ticket creation.
    tool({
      name: 'request_callback',
      description:
        'Logs that a human should call the person back later, returning a mock ticket ID.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description:
              'Short free-text reason why a callback is needed or requested.',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'normal', 'high'],
            description: 'How urgent the callback should be treated.',
          },
        },
        required: ['reason'],
        additionalProperties: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any) => {
        const ticketId = `CBK-${Date.now()}`;

        const result = {
          success: true,
          ticket_id: ticketId,
          normalized_urgency: args?.urgency || 'normal',
        };

        console.log('[NIKA TOOL][request_callback] request:', args);
        console.log('[NIKA TOOL][request_callback] response:', result);

        return result;
      },
    }),

    // 4B) Escalation to human – mock escalation record.
    tool({
      name: 'escalate_to_human',
      description:
        'Marks that this call should be handled by a human, returning a simple success object.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description:
              'Short explanation of why escalation is needed (e.g., high-stakes, complex, or user frustration).',
          },
        },
        required: ['reason'],
        additionalProperties: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any) => {
        const result = {
          success: true,
          routed_to: 'human_operator',
        };

        console.log('[NIKA TOOL][escalate_to_human] request:', args);
        console.log('[NIKA TOOL][escalate_to_human] response:', result);

        return result;
      },
    }),

    // 5) Follow-up SMS – mock Twilio-style send.
    tool({
      name: 'send_followup_sms',
      description:
        'Pretends to send an SMS summary to the caller after the call ends. No real SMS is sent.',
      parameters: {
        type: 'object',
        properties: {
          phone_number: {
            type: 'string',
            description:
              'Phone number to which the SMS would be sent (no real SMS integration).',
          },
          message: {
            type: 'string',
            description:
              'Short summary message describing key decisions and next steps.',
          },
        },
        required: ['phone_number', 'message'],
        additionalProperties: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any) => {
        const result = {
          success: true,
          provider: 'mock',
        };

        console.log('[NIKA TOOL][send_followup_sms] request:', args);
        console.log('[NIKA TOOL][send_followup_sms] response:', result);

        return result;
      },
    }),
  ],

  handoffs: [],
});

export const nikaScenario = [nikaAgent];

// Name of the company represented by this agent set. Used by guardrails.
export const nikaCompanyName = 'NikaTech Solutions';

export default nikaScenario;


