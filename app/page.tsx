'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// --- Types ---

interface User {
  name: string;
  email: string;
  picture: string;
}

interface Group {
  id: string;
  name: string;
  createdBy: string;
  members: { email: string; name: string; picture: string }[];
  createdAt: string;
}

interface Entry {
  issueNumber: number;
  party: string;
  groupId: string;
  title: string;
  description: string;
  createdAt: string;
  status: string;
}

interface Draft {
  id: string;
  title: string;
  description: string;
  createdAt: string;
}

type View = 'groups' | 'group';
type Tab = 'private' | 'shared';

// --- Google Sign-In ---

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, config: {
            theme?: string;
            size?: string;
            width?: number;
            text?: string;
            shape?: string;
          }) => void;
        };
      };
    };
  }
}

function loadGsiScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.google?.accounts?.id) { resolve(); return; }
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]') as HTMLScriptElement | null;
    if (existing) {
      if (window.google?.accounts?.id) { resolve(); return; }
      existing.addEventListener('load', () => resolve(), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

// --- Helpers ---

function getStoredUser(): User | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('shlomBait_user');
  return raw ? JSON.parse(raw) : null;
}

function getDrafts(email: string, groupId: string): Draft[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(`shlomBait_drafts_${email}_${groupId}`);
  return raw ? JSON.parse(raw) : [];
}

function saveDrafts(email: string, groupId: string, drafts: Draft[]) {
  localStorage.setItem(`shlomBait_drafts_${email}_${groupId}`, JSON.stringify(drafts));
}

// --- App ---

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>('groups');
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [tab, setTab] = useState<Tab>('private');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [joinError, setJoinError] = useState('');
  const buttonRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef<(response: { credential: string }) => void>(undefined);

  // --- Auth ---

  const handleGoogleResponse = useCallback(async (response: { credential: string }) => {
    setAuthLoading(true);
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    if (res.ok) {
      const userData: User = await res.json();
      localStorage.setItem('shlomBait_user', JSON.stringify(userData));
      setUser(userData);
    }
    setAuthLoading(false);
  }, []);

  callbackRef.current = handleGoogleResponse;

  useEffect(() => {
    const stored = getStoredUser();
    if (stored) setUser(stored);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded && !user && buttonRef.current) {
      loadGsiScript().then(() => {
        if (!buttonRef.current || !window.google) return;
        const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
        if (!clientId) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => callbackRef.current?.(resp),
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline', size: 'large', width: 300, text: 'signin_with', shape: 'rectangular',
        });
      });
    }
  }, [loaded, user]);

  // --- Groups ---

  const fetchGroups = useCallback(async () => {
    if (!user) return;
    const res = await fetch('/api/groups', { headers: { 'x-user-email': user.email } });
    if (res.ok) setGroups(await res.json());
  }, [user]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || !user) return;
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGroupName.trim(), user }),
    });
    if (res.ok) {
      setNewGroupName('');
      setShowCreate(false);
      await fetchGroups();
    }
  };

  const handleJoinGroup = async () => {
    if (!joinCode.trim() || !user) return;
    setJoinError('');
    const res = await fetch('/api/groups/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: joinCode.trim(), user }),
    });
    if (res.ok) {
      setJoinCode('');
      setShowJoin(false);
      await fetchGroups();
    } else {
      setJoinError('Group not found');
    }
  };

  const enterGroup = (group: Group) => {
    setActiveGroup(group);
    setView('group');
    setTab('private');
    setDrafts(getDrafts(user!.email, group.id));
    setSuggestion('');
  };

  // --- Entries ---

  const fetchEntries = useCallback(async () => {
    if (!activeGroup) return;
    const res = await fetch(`/api/entries?groupId=${activeGroup.id}`);
    if (res.ok) setEntries(await res.json());
  }, [activeGroup]);

  useEffect(() => { if (activeGroup) fetchEntries(); }, [activeGroup, fetchEntries]);

  const addDraft = () => {
    if (!newTitle.trim() || !user || !activeGroup) return;
    const draft: Draft = {
      id: Date.now().toString(),
      title: newTitle.trim(),
      description: newDesc.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [draft, ...drafts];
    setDrafts(updated);
    saveDrafts(user.email, activeGroup.id, updated);
    setNewTitle('');
    setNewDesc('');
  };

  const deleteDraft = (id: string) => {
    if (!user || !activeGroup) return;
    const updated = drafts.filter(d => d.id !== id);
    setDrafts(updated);
    saveDrafts(user.email, activeGroup.id, updated);
  };

  const submitDraft = async (draft: Draft) => {
    if (!user || !activeGroup) return;
    setSubmitting(draft.id);
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: activeGroup.id, party: user.name, title: draft.title, description: draft.description }),
    });
    if (res.ok) {
      deleteDraft(draft.id);
      await fetchEntries();
    }
    setSubmitting(null);
  };

  const submitAll = async () => {
    for (const draft of drafts) {
      await submitDraft(draft);
    }
  };

  const requestSuggestion = async () => {
    if (!activeGroup) return;
    setSuggesting(true);
    setSuggestion('');
    const res = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: activeGroup.id }),
    });
    if (res.ok) {
      const data = await res.json();
      setSuggestion(data.suggestion);
    }
    setSuggesting(false);
  };

  const signOut = () => {
    localStorage.removeItem('shlomBait_user');
    setUser(null);
    setGroups([]);
    setActiveGroup(null);
    setView('groups');
  };

  if (!loaded) return null;

  // --- Sign-in screen ---

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center space-y-8">
          <h1 className="text-3xl font-light text-stone-800">shlomBait</h1>
          <p className="text-stone-500 text-sm">Family conflict resolution</p>
          {authLoading ? (
            <p className="text-sm text-stone-400">Signing in...</p>
          ) : (
            <div ref={buttonRef} className="flex justify-center" />
          )}
        </div>
      </div>
    );
  }

  // --- Groups screen ---

  if (view === 'groups') {
    return (
      <div className="min-h-screen bg-stone-50">
        <header className="border-b border-stone-200 bg-white">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <h1 className="text-lg font-medium text-stone-800">shlomBait</h1>
            <div className="flex items-center gap-3">
              {user.picture && <img src={user.picture} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />}
              <span className="text-sm text-stone-400">{user.name}</span>
              <button data-id="sign-out" onClick={signOut} className="text-xs text-stone-400 hover:text-stone-600 cursor-pointer">sign out</button>
            </div>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-stone-500">My Groups</h2>
            <div className="flex gap-2">
              <button
                data-id="show-join-group"
                onClick={() => { setShowJoin(!showJoin); setShowCreate(false); }}
                className="text-sm px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 cursor-pointer transition-colors"
              >
                Join
              </button>
              <button
                data-id="show-create-group"
                onClick={() => { setShowCreate(!showCreate); setShowJoin(false); }}
                className="text-sm px-3 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 cursor-pointer transition-colors"
              >
                New Group
              </button>
            </div>
          </div>

          {/* Create group form */}
          {showCreate && (
            <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
              <input
                data-id="new-group-name"
                type="text"
                placeholder="Group name (e.g. Me & Dad)"
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateGroup()}
                className="w-full text-stone-800 placeholder:text-stone-300 outline-none"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button data-id="cancel-create-group" onClick={() => setShowCreate(false)} className="text-sm text-stone-400 hover:text-stone-600 cursor-pointer">Cancel</button>
                <button
                  data-id="create-group"
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className="text-sm px-4 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {/* Join group form */}
          {showJoin && (
            <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
              <input
                data-id="join-code-input"
                type="text"
                placeholder="Paste group code"
                value={joinCode}
                onChange={e => { setJoinCode(e.target.value); setJoinError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleJoinGroup()}
                className="w-full text-stone-800 placeholder:text-stone-300 outline-none"
                autoFocus
              />
              {joinError && <p className="text-sm text-red-500">{joinError}</p>}
              <div className="flex justify-end gap-2">
                <button data-id="cancel-join-group" onClick={() => setShowJoin(false)} className="text-sm text-stone-400 hover:text-stone-600 cursor-pointer">Cancel</button>
                <button
                  data-id="join-group"
                  onClick={handleJoinGroup}
                  disabled={!joinCode.trim()}
                  className="text-sm px-4 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  Join
                </button>
              </div>
            </div>
          )}

          {/* Group list */}
          {groups.length === 0 && !showCreate && !showJoin && (
            <div className="text-center py-16 text-stone-400">
              <p className="text-lg mb-2">No groups yet</p>
              <p className="text-sm">Create a group and invite someone to get started</p>
            </div>
          )}

          {groups.map(group => (
            <button
              key={group.id}
              data-id={`group-${group.id}`}
              onClick={() => enterGroup(group)}
              className="w-full bg-white rounded-xl border border-stone-200 p-4 text-left hover:border-stone-300 cursor-pointer transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-stone-800 font-medium">{group.name}</p>
                  <p className="text-xs text-stone-400 mt-1">
                    {group.members.map(m => m.name).join(', ')}
                  </p>
                </div>
                <div className="flex -space-x-2">
                  {group.members.map(m => (
                    m.picture ? (
                      <img key={m.email} src={m.picture} alt="" className="w-7 h-7 rounded-full border-2 border-white" referrerPolicy="no-referrer" />
                    ) : (
                      <div key={m.email} className="w-7 h-7 rounded-full border-2 border-white bg-stone-200 flex items-center justify-center text-xs text-stone-500">
                        {m.name[0]}
                      </div>
                    )
                  ))}
                </div>
              </div>
            </button>
          ))}
        </main>
      </div>
    );
  }

  // --- Inside a group ---

  const myEntries = entries.filter(e => e.party === user.name);
  const partyNames = [...new Set(entries.map(e => e.party))];

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              data-id="back-to-groups"
              onClick={() => { setView('groups'); setActiveGroup(null); setEntries([]); setSuggestion(''); }}
              className="text-stone-400 hover:text-stone-600 cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <h1 className="text-lg font-medium text-stone-800">{activeGroup!.name}</h1>
              <p className="text-xs text-stone-400">{activeGroup!.members.map(m => m.name).join(', ')}</p>
            </div>
          </div>
          <button
            data-id="copy-invite-code"
            onClick={() => navigator.clipboard.writeText(activeGroup!.id)}
            className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 cursor-pointer transition-colors"
          >
            Copy invite code
          </button>
        </div>
        <div className="max-w-2xl mx-auto px-4 flex gap-6">
          {(['private', 'shared'] as Tab[]).map(t => (
            <button
              key={t}
              data-id={`tab-${t}`}
              data-active-tab={tab === t ? t : undefined}
              onClick={() => { setTab(t); if (t === 'shared') fetchEntries(); }}
              className={`pb-2 text-sm border-b-2 cursor-pointer transition-colors ${
                tab === t
                  ? 'border-stone-800 text-stone-800'
                  : 'border-transparent text-stone-400 hover:text-stone-600'
              }`}
            >
              {t === 'private' ? 'My Log' : 'Shared View'}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {tab === 'private' ? (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
              <input
                data-id="new-entry-title"
                type="text"
                placeholder="What's on your mind?"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addDraft()}
                className="w-full text-stone-800 placeholder:text-stone-300 outline-none text-lg"
              />
              <textarea
                data-id="new-entry-desc"
                placeholder="More details (optional)"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                rows={2}
                className="w-full text-stone-600 placeholder:text-stone-300 outline-none text-sm resize-none"
              />
              <div className="flex justify-end">
                <button
                  data-id="save-draft"
                  onClick={addDraft}
                  disabled={!newTitle.trim()}
                  className="px-4 py-1.5 rounded-lg bg-stone-800 text-white text-sm hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  Save draft
                </button>
              </div>
            </div>

            {drafts.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-stone-500">Drafts ({drafts.length})</h2>
                  <button data-id="submit-all" onClick={submitAll} className="text-sm text-stone-500 hover:text-stone-800 cursor-pointer">
                    Submit all to shared view
                  </button>
                </div>
                {drafts.map(draft => (
                  <div key={draft.id} className="bg-white rounded-xl border border-stone-200 p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-stone-800">{draft.title}</p>
                      {draft.description && <p className="text-sm text-stone-500 mt-1">{draft.description}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        data-id={`submit-draft-${draft.id}`}
                        onClick={() => submitDraft(draft)}
                        disabled={submitting === draft.id}
                        className="text-xs px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {submitting === draft.id ? '...' : 'Submit'}
                      </button>
                      <button
                        data-id={`delete-draft-${draft.id}`}
                        onClick={() => deleteDraft(draft.id)}
                        className="text-xs px-2 py-1 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 cursor-pointer transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {myEntries.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-medium text-stone-500">Submitted ({myEntries.length})</h2>
                {myEntries.map(entry => (
                  <div key={entry.issueNumber} className="bg-stone-100 rounded-xl p-4 opacity-60">
                    <p className="text-stone-600">{entry.title}</p>
                    {entry.description && <p className="text-sm text-stone-400 mt-1">{entry.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-stone-500">
                {entries.length} entries from {partyNames.length} {partyNames.length === 1 ? 'person' : 'people'}
              </h2>
              <button data-id="refresh-entries" onClick={fetchEntries} className="text-xs text-stone-400 hover:text-stone-600 cursor-pointer">
                Refresh
              </button>
            </div>

            {partyNames.map(name => {
              const partyEntries = entries.filter(e => e.party === name);
              return (
                <div key={name} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400">{name}</h3>
                  {partyEntries.map(entry => (
                    <div key={entry.issueNumber} className="bg-white rounded-xl border border-stone-200 p-4">
                      <p className="text-stone-800">{entry.title}</p>
                      {entry.description && <p className="text-sm text-stone-500 mt-1">{entry.description}</p>}
                      <p className="text-xs text-stone-300 mt-2">{new Date(entry.createdAt).toLocaleDateString()}</p>
                    </div>
                  ))}
                </div>
              );
            })}

            {entries.length === 0 && (
              <p className="text-center text-stone-400 py-12">No entries submitted yet</p>
            )}

            <div className="border-t border-stone-200 pt-6">
              <button
                data-id="suggest-mitigations"
                onClick={requestSuggestion}
                disabled={suggesting || entries.length === 0}
                className="w-full py-3 rounded-xl bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                {suggesting ? 'Thinking...' : 'Suggest Mitigations'}
              </button>
            </div>

            {suggestion && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                <h3 className="text-sm font-medium text-amber-800 mb-3">Suggestions</h3>
                <div className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">{suggestion}</div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
