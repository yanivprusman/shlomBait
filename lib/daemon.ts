import net from 'net';
import { existsSync } from 'fs';

const UDS_PATH = '/run/automatelinux/automatelinux-daemon.sock';
const UDS_PATH_API = '/run/automatelinux/automatelinux-api.sock';

const API_COMMANDS = new Set([
  'createIssue', 'listIssues', 'getIssue', 'updateIssue', 'closeIssue',
  'reopenIssue', 'deleteIssue',
]);

function getSocketPath(cmd: string): string {
  if (API_COMMANDS.has(cmd) && existsSync(UDS_PATH_API)) return UDS_PATH_API;
  return UDS_PATH;
}

export function sendToDaemon(commandObj: Record<string, unknown>, timeoutMs = 5000): Promise<string> {
  const socketPath = getSocketPath(commandObj.command as string || '');
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let response = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; client.destroy(); reject(new Error('Daemon timeout')); }
    }, timeoutMs);

    client.on('connect', () => {
      client.write(JSON.stringify(commandObj) + '\n');
    });
    client.on('data', (data) => {
      response += data.toString();
      if (response.endsWith('\n')) {
        if (!done) { done = true; clearTimeout(timer); client.destroy(); resolve(response); }
      }
    });
    client.on('error', (err) => {
      if (!done) { done = true; clearTimeout(timer); client.destroy(); reject(err); }
    });
  });
}

const APP_NAME = 'shlomBait';

export interface Entry {
  issueNumber: number;
  party: string;
  title: string;
  description: string;
  createdAt: string;
  status: string;
}

export async function createEntry(party: string, title: string, description: string): Promise<Entry> {
  const raw = await sendToDaemon({
    command: 'createIssue',
    app: APP_NAME,
    title,
    description,
    labels: JSON.stringify([party]),
  });
  const result = JSON.parse(raw.trim());
  return {
    issueNumber: result.issueNumber,
    party,
    title,
    description,
    createdAt: new Date().toISOString(),
    status: 'open',
  };
}

export async function listEntries(): Promise<Entry[]> {
  const raw = await sendToDaemon({
    command: 'listIssues',
    app: APP_NAME,
  });
  const result = JSON.parse(raw.trim());
  const issues = result.issues || result || [];
  return issues.map((issue: any) => ({
    issueNumber: issue.issue_number ?? issue.issueNumber,
    party: (issue.labels || [])[0] || 'unknown',
    title: issue.title,
    description: issue.description || '',
    createdAt: issue.created_at || issue.createdAt || '',
    status: issue.status || 'open',
  }));
}

export async function deleteEntry(issueNumber: number): Promise<void> {
  await sendToDaemon({
    command: 'deleteIssue',
    app: APP_NAME,
    issueNumber,
  });
}
