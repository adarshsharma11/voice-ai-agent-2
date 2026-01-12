import { NextResponse } from "next/server";

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

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
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

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (process.env.STREAM_SECRET && token !== process.env.STREAM_SECRET) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const rawBody = await req.text();
  const form = new URLSearchParams(rawBody);
  const callSid = form.get("CallSid") || form.get("CallSid".toLowerCase());
  const callStatus = form.get("CallStatus") || form.get("CallStatus".toLowerCase());
  const campaignId = url.searchParams.get("campaignId");

  if (!campaignId) return NextResponse.json({ ok: true });
  const campaign = campaigns.get(campaignId);
  if (!campaign) return NextResponse.json({ ok: true });

  if (callStatus) campaign.lastCallStatus = callStatus;

  const endStates = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
  const matchesCurrent = Boolean(callSid && campaign.currentCallSid && callSid === campaign.currentCallSid);

  if (matchesCurrent && callStatus && endStates.has(callStatus)) {
    campaign.completed += 1;
    campaign.currentCallSid = null;
    campaign.currentTo = null;
    await dialNext(campaign);
  }

  return NextResponse.json({ ok: true });
}
