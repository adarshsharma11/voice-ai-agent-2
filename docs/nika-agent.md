## Nika Voice Agent – NikaTech Solutions

Nika is a dedicated voice agent configured in this repo using the OpenAI Realtime API and the Agents SDK.  
She is designed as a senior operations-style assistant for NikaTech Solutions: friendly, sharp, and pragmatic.

---

### 1. Where Nika is defined

- **Agent config file**: `src/app/agentConfigs/nika.ts`
  - Exports:
    - `nikaAgent` – the main `RealtimeAgent` instance.
    - `nikaScenario` – an array containing `nikaAgent`, used by the scenario selector.
    - `nikaCompanyName` – `"NikaTech Solutions"`, used for guardrails.
- **Scenario registration**:
  - `src/app/agentConfigs/index.ts`
    - Adds the `nika` scenario key to `allAgentSets`:
      - `nika: nikaScenario`
  - `src/app/App.tsx`
    - Imports `nikaScenario` and `nikaCompanyName`.
    - Adds `nika` to the `sdkScenarioMap`.
    - Uses `nikaCompanyName` when the `agentConfig` is `nika` for moderation guardrails.

---

### 2. How to run the Nika agent locally

1. **Install dependencies** (if you haven’t already):

```bash
cd /Users/alonflorentin/Downloads/FreeLance/AI-Agents/openai-realtime-agents
npm install
```

2. **Ensure your environment is set up** (same as other scenarios):
   - `.env` should contain your `OPENAI_API_KEY` and any other required values, following `.env.sample`.

3. **Start the dev server**:

```bash
npm run dev
```

4. **Open Nika directly via URL**:
   - Navigate to: `http://localhost:3000?agentConfig=nika`

5. **Or select Nika from the UI**:
   - Go to `http://localhost:3000`.
   - In the **Scenario** dropdown at the top, choose `nika`.
   - In the **Agent** dropdown, select `Nika` (if not already selected).

Nika will then run as the active Realtime voice agent using the configured persona and tools.

---

### 3. Nika’s behavior & persona (summary)

High-level behavior is encoded in the `instructions` block inside `src/app/agentConfigs/nika.ts`:

- **Role**: Senior AI voice agent and lead engineer for **NikaTech Solutions**.
- **Tone**: Friendly, sharp, confident, warm; short, helpful sentences; calm but responsive pacing.
- **Call flow**:
  - Greet the caller.
  - Understand the goal in 1–2 focused questions.
  - Summarize and confirm the intent.
  - Either answer directly or call tools (lookup, logging, booking, escalation).
  - Close with a clear next step.
- **Safety**:
  - Never hallucinate specific facts about NikaTech or its systems.
  - Prefer to say “I don’t want to guess that. Let me check or pass this to a human.”
  - Uses guardrails with company name `"NikaTech Solutions"`.

For the full persona and behavior rules, read the `instructions` field in `src/app/agentConfigs/nika.ts`.

---

### 4. Tools defined for Nika (mocked)

Inside `nika.ts`, Nika has several mocked tools using the Agents SDK `tool()` helper.  
Each tool logs its request and response to the **browser DevTools console** with a prefix like:

- `[NIKA TOOL][detect_intent] ...`
- `[NIKA TOOL][update_call_memory] ...`
- `[NIKA TOOL][lookup_customer] ...`
- `[NIKA TOOL][request_callback] ...`
- `[NIKA TOOL][escalate_to_human] ...`
- `[NIKA TOOL][send_followup_sms] ...`

The current tools are:

- **`detect_intent`**
  - Purpose: Classify the caller’s latest utterance into a simple intent (e.g., booking, support, general info, other) with a mock confidence and optional entities.
  - Behavior: Uses simple rule-based logic and logs both the request and mock response.

- **`update_call_memory`**
  - Purpose: Maintain a small per-call memory object with fields like `caller_name`, `project_type`, `preferred_time`, and an array of `notes`.
  - Behavior: Merges new values into a context-scoped memory object and logs the updated memory.

- **`lookup_customer`**
  - Purpose: Pretend to look up a customer using `phone_number` and/or `email`.
  - Behavior: Returns a fixed, fake-but-plausible record when inputs match simple deterministic rules, and logs both the lookup input and mock result.

- **`request_callback`**
  - Purpose: Log that a human should call the person back later.
  - Behavior: Returns a mock `ticket_id` and logs the reason, urgency, and resulting object.

- **`escalate_to_human`**
  - Purpose: Mark that this call should be handled or reviewed by a human.
  - Behavior: Returns a simple success object and logs the escalation reason and response.

- **`send_followup_sms`**
  - Purpose: Pretend to send a follow-up SMS summary at the end of the call.
  - Behavior: Does NOT integrate with Twilio; it just logs the phone number and message and returns a mock success object.

All `execute` implementations are intentionally minimal and side-effect-free so you can safely extend or replace them.

---

### 5. How to view tool requests

When running Nika locally:

1. Start the app as described above and open the Nika scenario.
2. Open the **browser’s DevTools console** (e.g., right-click → Inspect → Console).
3. Watch for log lines starting with `[NIKA TOOL]` to see every tool request and its mock response.
4. If you later route any tool logic to server-side API routes, you will also see corresponding logs in the **terminal** where `npm run dev` is running.

---

### 6. How to extend Nika with real tools

To connect Nika to real systems (CRM, booking, property DB, etc.):

1. Open `src/app/agentConfigs/nika.ts`.
2. Locate the relevant tool in the `tools` array (e.g., `lookup_customer`, `request_callback`, or `send_followup_sms`).
3. Replace the `execute` function with real logic, for example:
   - Call your REST API or FastAPI backend.
   - Talk to Supabase, Firebase, or a VectorDB.
   - Send a Slack notification or create a ticket.
4. Keep parameter schemas in sync with your backend:
   - Update the `parameters` shape as needed.
   - Make sure you validate/normalize inside your backend as well.

Once wired up, Nika will automatically start using the enhanced behaviors without any UI changes.


