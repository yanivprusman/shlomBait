import net from 'net';
import { existsSync } from 'fs';
import crypto from 'crypto';

const UDS_PATH = '/run/automatelinux/automatelinux-daemon.sock';
const UDS_PATH_API = '/run/automatelinux/automatelinux-api.sock';

const API_COMMANDS = new Set([
  'createIssue', 'listIssues', 'getIssue', 'updateIssue', 'closeIssue',
  'reopenIssue', 'deleteIssue',
  'upsertEntry', 'getEntry', 'deleteEntry',
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

// --- Groups ---

export interface Group {
  id: string;
  name: string;
  createdBy: string;
  members: { email: string; name: string; picture: string }[];
  createdAt: string;
}

function groupKey(id: string) { return `shlomBait:group:${id}`; }
function userGroupsKey(email: string) { return `shlomBait:userGroups:${email}`; }

async function getEntryJson<T>(key: string): Promise<T | null> {
  const raw = await sendToDaemon({ command: 'getEntry', key });
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null' || trimmed.startsWith('Key not found')) return null;
  return JSON.parse(trimmed);
}

async function setEntry(key: string, value: unknown) {
  await sendToDaemon({ command: 'upsertEntry', key, value: JSON.stringify(value) });
}

export async function createGroup(
  name: string,
  creator: { email: string; name: string; picture: string },
): Promise<Group> {
  const id = crypto.randomBytes(4).toString('hex');
  const group: Group = {
    id,
    name,
    createdBy: creator.email,
    members: [creator],
    createdAt: new Date().toISOString(),
  };
  await setEntry(groupKey(id), group);
  await addGroupToUser(creator.email, id);
  return group;
}

export async function getGroup(id: string): Promise<Group | null> {
  return getEntryJson<Group>(groupKey(id));
}

export async function joinGroup(
  id: string,
  user: { email: string; name: string; picture: string },
): Promise<Group | null> {
  const group = await getGroup(id);
  if (!group) return null;
  if (!group.members.some(m => m.email === user.email)) {
    group.members.push(user);
    await setEntry(groupKey(id), group);
  }
  await addGroupToUser(user.email, id);
  return group;
}

async function addGroupToUser(email: string, groupId: string) {
  const key = userGroupsKey(email);
  const ids = (await getEntryJson<string[]>(key)) || [];
  if (!ids.includes(groupId)) {
    ids.push(groupId);
    await setEntry(key, ids);
  }
}

export async function getUserGroups(email: string): Promise<Group[]> {
  const ids = (await getEntryJson<string[]>(userGroupsKey(email))) || [];
  const groups: Group[] = [];
  for (const id of ids) {
    const g = await getGroup(id);
    if (g) groups.push(g);
  }
  return groups;
}

// --- Entries (scoped to group) ---

const APP_NAME = 'shlomBait';

export interface Entry {
  issueNumber: number;
  party: string;
  groupId: string;
  title: string;
  description: string;
  createdAt: string;
  status: string;
}

export async function createEntry(groupId: string, party: string, title: string, description: string): Promise<Entry> {
  const raw = await sendToDaemon({
    command: 'createIssue',
    app: APP_NAME,
    title,
    description,
    labels: JSON.stringify([`group:${groupId}`, party]),
  });
  const result = JSON.parse(raw.trim());
  return {
    issueNumber: result.issueNumber,
    party,
    groupId,
    title,
    description,
    createdAt: new Date().toISOString(),
    status: 'open',
  };
}

export async function listEntries(groupId: string): Promise<Entry[]> {
  const raw = await sendToDaemon({
    command: 'listIssues',
    app: APP_NAME,
  });
  const result = JSON.parse(raw.trim());
  const issues = result.issues || result || [];
  return issues
    .filter((issue: any) => (issue.labels || []).includes(`group:${groupId}`))
    .map((issue: any) => {
      const labels: string[] = issue.labels || [];
      const party = labels.find((l: string) => !l.startsWith('group:')) || 'unknown';
      return {
        issueNumber: issue.issue_number ?? issue.issueNumber,
        party,
        groupId,
        title: issue.title,
        description: issue.description || '',
        createdAt: issue.created_at || issue.createdAt || '',
        status: issue.status || 'open',
      };
    });
}

export async function deleteEntry(issueNumber: number): Promise<void> {
  await sendToDaemon({
    command: 'deleteIssue',
    app: APP_NAME,
    issueNumber,
  });
}
