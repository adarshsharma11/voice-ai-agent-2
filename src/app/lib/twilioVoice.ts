import crypto from 'node:crypto';

export type TwilioAgentKey = 'customer_service' | 'assistant' | 'outbound';

export function normalizeAgentKey(raw: string | null | undefined): TwilioAgentKey {
  const v = String(raw || '').toLowerCase().trim();
  if (v === 'assistant' || v === 'pa' || v === 'personal_assistant') return 'assistant';
  if (v === 'outbound' || v === 'sales') return 'outbound';
  if (v === 'customer_service' || v === 'cs' || v === 'receptionist') return 'customer_service';
  return 'customer_service';
}

export function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getPublicUrl() {
  return requireEnv('PUBLIC_URL').replace(/\/+$/g, '');
}

export function getStreamSecret() {
  return requireEnv('STREAM_SECRET');
}

export function buildStreamWssUrl(agent: TwilioAgentKey) {
  const base = getPublicUrl().replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  const url = new URL(`${base}/twilio/stream`);
  url.searchParams.set('agent', agent);
  url.searchParams.set('token', getStreamSecret());
  return url.toString();
}

export function twimlConnectStream(streamUrl: string) {
  // Minimal TwiML. Keep it simple + explicit.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(streamUrl)}" />
  </Connect>
</Response>`;
}

function escapeXml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Twilio request signature validation for Next route handlers.
 *
 * Twilio signs the exact raw body, so we must validate against the raw string
 * and the full URL Twilio requested.
 */
export function validateTwilioSignature(args: {
  rawBody: string;
  twilioSignature: string | null;
  url: string;
}): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  if (!args.twilioSignature) return false;

  // Twilio signature: base64(HMAC-SHA1(authToken, url + sortedParams))
  // Since we have the raw body, we can parse as x-www-form-urlencoded.
  const params = new URLSearchParams(args.rawBody);
  const kv: Record<string, string> = {};
  for (const [k, v] of params.entries()) kv[k] = v;

  const sortedKeys = Object.keys(kv).sort();
  const data = args.url + sortedKeys.map((k) => k + kv[k]).join('');
  const digest = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  return timingSafeEqual(digest, args.twilioSignature);
}

function timingSafeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

