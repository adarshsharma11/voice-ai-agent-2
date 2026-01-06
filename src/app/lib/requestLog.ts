import { appendFile } from 'node:fs/promises';

export type RequestLogEntry = {
  ts: string;
  kind: 'tool' | 'api';
  sessionId?: string;
  agentName?: string;
  name: string;
  payload?: any;
  result?: any;
  error?: string;
};

/**
 * Minimal local request logging (dev-friendly).
 *
 * Appends JSON lines to `<repo>/request-log.jsonl`.
 * This file is gitignored.
 */
export async function appendRequestLog(entry: RequestLogEntry) {
  const line = JSON.stringify(entry);
  await appendFile(`${process.cwd()}/request-log.jsonl`, `${line}\n`, 'utf8');
}

