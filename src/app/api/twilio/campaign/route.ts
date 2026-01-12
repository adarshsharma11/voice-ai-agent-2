import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

type CampaignStatus = "idle" | "running" | "completed" | "stopped" | "error";

type Campaign = {
  id: string;
  agent: string;
  status: CampaignStatus;
  createdAt: string;
  total: number;
  completed: number;
  currentTo: string | null;
  currentCallSid: string | null;
  lastCallStatus: string | null;
  remaining: string[];
  dialing: boolean;
  lastError: string | null;
};

const globalStore = globalThis as typeof globalThis & {
  __twilioCampaigns?: Map<string, Campaign>;
};
const campaigns = globalStore.__twilioCampaigns ?? new Map<string, Campaign>();
globalStore.__twilioCampaigns = campaigns;

export const runtime = "nodejs";

const createSchema = z.object({
  numbers: z.array(z.string()).min(1),
  agent: z.string().optional().default("outbound"),
});

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function normalizeToE164(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  const plusPrefixed = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;

  if (plusPrefixed) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

async function createTwilioCall(args: { to: string; agent: string; campaignId: string }) {
  const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
  const authToken = requireEnv("TWILIO_AUTH_TOKEN");
  const from = requireEnv("TWILIO_NUMBER");
  const publicUrl = requireEnv("PUBLIC_URL").replace(/\/+$/g, "");
  const streamSecret = requireEnv("STREAM_SECRET");

  const twimlUrl = new URL(`${publicUrl}/twilio/outbound`);
  twimlUrl.searchParams.set("agent", args.agent);

  const statusCallback = new URL(`${publicUrl}/api/twilio/status`);
  statusCallback.searchParams.set("campaignId", args.campaignId);
  statusCallback.searchParams.set("token", streamSecret);

  const body = new URLSearchParams();
  body.set("To", args.to);
  body.set("From", from);
  body.set("Url", twimlUrl.toString());
  body.set("Method", "POST");
  body.set("StatusCallback", statusCallback.toString());
  body.set("StatusCallbackMethod", "POST");
  body.append("StatusCallbackEvent", "initiated");
  body.append("StatusCallbackEvent", "answered");
  body.append("StatusCallbackEvent", "completed");

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (json && (json.message || json.error_message || json.error)) || `Twilio HTTP ${res.status}`;
    throw new Error(String(message));
  }

  return { sid: String(json.sid || ""), status: String(json.status || "") };
}

async function dialNext(campaign: Campaign) {
  if (campaign.dialing) return;
  if (campaign.status !== "running") return;
  if (campaign.currentCallSid) return;

  const next = campaign.remaining.shift() || null;
  if (!next) {
    campaign.status = "completed";
    campaign.currentTo = null;
    campaign.lastError = null;
    return;
  }

  campaign.dialing = true;
  campaign.currentTo = next;
  campaign.lastError = null;

  try {
    const created = await createTwilioCall({
      to: next,
      agent: campaign.agent,
      campaignId: campaign.id,
    });
    campaign.currentCallSid = created.sid || null;
    campaign.lastCallStatus = created.status || null;
  } catch (e) {
    campaign.currentCallSid = null;
    campaign.lastCallStatus = "failed_to_create";
    campaign.completed += 1;
    campaign.lastError = e instanceof Error ? e.message : "Failed to create call";
    campaign.dialing = false;
    await dialNext(campaign);
    return;
  } finally {
    campaign.dialing = false;
  }
}

function campaignPublicState(c: Campaign) {
  return {
    id: c.id,
    agent: c.agent,
    status: c.status,
    createdAt: c.createdAt,
    total: c.total,
    completed: c.completed,
    currentTo: c.currentTo,
    currentCallSid: c.currentCallSid,
    lastCallStatus: c.lastCallStatus,
    remainingCount: c.remaining.length,
    lastError: c.lastError,
  };
}

export async function POST(req: Request) {
  try {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const numbers = parsed.data.numbers
      .map((n) => normalizeToE164(n))
      .filter((n): n is string => Boolean(n));

    if (numbers.length === 0) {
      return NextResponse.json({ error: "No valid phone numbers provided" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const campaign: Campaign = {
      id,
      agent: parsed.data.agent,
      status: "running",
      createdAt: new Date().toISOString(),
      total: numbers.length,
      completed: 0,
      currentTo: null,
      currentCallSid: null,
      lastCallStatus: null,
      remaining: [...numbers],
      dialing: false,
      lastError: null,
    };

    campaigns.set(id, campaign);
    await dialNext(campaign);

    return NextResponse.json({ campaign: campaignPublicState(campaign) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const campaign = campaigns.get(campaignId);
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ campaign: campaignPublicState(campaign) });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const campaign = campaigns.get(campaignId);
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

  campaign.status = "stopped";
  campaign.currentTo = null;
  campaign.currentCallSid = null;

  return NextResponse.json({ campaign: campaignPublicState(campaign) });
}
