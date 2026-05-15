import type { FeedbackBackend } from '@automate/feedback-lib';

async function jsonPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export const feedbackBackend: FeedbackBackend = {
  sendChatMessage: (req) => jsonPost('/api/feedback', req),
  submitChatIssues: (issues, context) => jsonPost('/api/feedback/submit', { issues, ...context }),
  getSessionStatus: async (tmuxSession) => {
    const res = await fetch(`/api/feedback/status?session=${tmuxSession}`);
    return res.json();
  },
  closeSession: async (tmuxSession) => {
    await fetch('/api/feedback/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tmuxSession }) });
  },
  closeSessionOnUnload: (tmuxSession) => {
    navigator.sendBeacon('/api/feedback/session-end', JSON.stringify({ tmuxSession }));
  },
  listIssues: async (appOverride) => {
    const url = appOverride ? `/api/feedback/issues?app=${appOverride}` : '/api/feedback/issues';
    const res = await fetch(url);
    return res.json();
  },
  issueAction: (body) => jsonPost('/api/feedback/response', body),
  getSessionHistory: async (sessionId, appOverride) => {
    const params = new URLSearchParams({ sessionId });
    if (appOverride) params.set('app', appOverride);
    const res = await fetch(`/api/feedback/session-history?${params}`);
    return res.json();
  },
};
