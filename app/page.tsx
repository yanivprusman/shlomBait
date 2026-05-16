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

type EntryCategory = 'context' | 'idea' | 'concern' | 'decision';

interface Entry {
  issueNumber: number;
  party: string;
  groupId: string;
  title: string;
  description: string;
  category: EntryCategory;
  createdAt: string;
  status: string;
}

interface Draft {
  id: string;
  title: string;
  description: string;
  category: EntryCategory;
  createdAt: string;
}

interface ReadinessState {
  [email: string]: boolean;
}

type View = 'groups' | 'group';
type Tab = 'surface' | 'shared' | 'synthesize';

const CATEGORY_META: Record<EntryCategory, { label: string; color: string; bgColor: string; description: string }> = {
  context: { label: 'Context', color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200', description: 'Facts, observations, information the other side may not have' },
  idea: { label: 'Idea', color: 'text-violet-700', bgColor: 'bg-violet-50 border-violet-200', description: 'Proposals, possibilities, things worth considering' },
  concern: { label: 'Concern', color: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-200', description: 'Worries, risks, things that feel unresolved' },
  decision: { label: 'Decision Needed', color: 'text-rose-700', bgColor: 'bg-rose-50 border-rose-200', description: 'Something that requires a joint decision' },
};

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

function getReadiness(groupId: string): ReadinessState {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(`shlomBait_readiness_${groupId}`);
  return raw ? JSON.parse(raw) : {};
}

function saveReadiness(groupId: string, state: ReadinessState) {
  localStorage.setItem(`shlomBait_readiness_${groupId}`, JSON.stringify(state));
}

// --- App ---

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>('groups');
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [tab, setTab] = useState<Tab>('surface');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState<EntryCategory>('context');
  const [synthesis, setSynthesis] = useState('');
  const [synthesizing, setSynthesizing] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [readiness, setReadiness] = useState<ReadinessState>({});
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
    setTab('surface');
    setDrafts(getDrafts(user!.email, group.id));
    setSynthesis('');
    setReadiness(getReadiness(group.id));
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
      category: newCategory,
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
      body: JSON.stringify({
        groupId: activeGroup.id,
        party: user.name,
        title: draft.title,
        description: draft.description,
        category: draft.category,
      }),
    });
    if (res.ok) {
      deleteDraft(draft.id);
      // When submitting new entries, mark self as not ready (context changed)
      const updated = { ...readiness, [user.email]: false };
      setReadiness(updated);
      saveReadiness(activeGroup.id, updated);
      await fetchEntries();
    }
    setSubmitting(null);
  };

  const submitAll = async () => {
    for (const draft of drafts) {
      await submitDraft(draft);
    }
  };

  const toggleReadiness = () => {
    if (!user || !activeGroup) return;
    const updated = { ...readiness, [user.email]: !readiness[user.email] };
    setReadiness(updated);
    saveReadiness(activeGroup.id, updated);
  };

  const allReady = activeGroup
    ? activeGroup.members.length >= 2 && activeGroup.members.every(m => readiness[m.email])
    : false;

  const requestSynthesis = async () => {
    if (!activeGroup) return;
    setSynthesizing(true);
    setSynthesis('');
    const res = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: activeGroup.id }),
    });
    if (res.ok) {
      const data = await res.json();
      setSynthesis(data.suggestion);
    }
    setSynthesizing(false);
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
          <p className="text-stone-500 text-sm max-w-xs mx-auto">Surface full context before forming conclusions. Better information flow, better decisions together.</p>
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
            <h2 className="text-sm font-medium text-stone-500">My Collaborations</h2>
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
                New Collaboration
              </button>
            </div>
          </div>

          {showCreate && (
            <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
              <input
                data-id="new-group-name"
                type="text"
                placeholder="Name this collaboration (e.g. Project Alpha with Shlom)"
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

          {showJoin && (
            <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
              <input
                data-id="join-code-input"
                type="text"
                placeholder="Paste collaboration code"
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

          {groups.length === 0 && !showCreate && !showJoin && (
            <div className="text-center py-16 text-stone-400">
              <p className="text-lg mb-2">No collaborations yet</p>
              <p className="text-sm">Create a collaboration and invite your partner to get started</p>
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
                    {group.members.map(m => m.name).join(' & ')}
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
  const iAmReady = readiness[user.email] || false;

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              data-id="back-to-groups"
              onClick={() => { setView('groups'); setActiveGroup(null); setEntries([]); setSynthesis(''); }}
              className="text-stone-400 hover:text-stone-600 cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <h1 className="text-lg font-medium text-stone-800">{activeGroup!.name}</h1>
              <p className="text-xs text-stone-400">{activeGroup!.members.map(m => m.name).join(' & ')}</p>
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
          {(['surface', 'shared', 'synthesize'] as Tab[]).map(t => (
            <button
              key={t}
              data-id={`tab-${t}`}
              data-active-tab={tab === t ? t : undefined}
              onClick={() => { setTab(t); if (t === 'shared' || t === 'synthesize') fetchEntries(); }}
              className={`pb-2 text-sm border-b-2 cursor-pointer transition-colors ${
                tab === t
                  ? 'border-stone-800 text-stone-800'
                  : 'border-transparent text-stone-400 hover:text-stone-600'
              }`}
            >
              {t === 'surface' ? 'Surface' : t === 'shared' ? 'Full Picture' : 'Synthesize'}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {tab === 'surface' ? (
          <div className="space-y-6">
            {/* Guidance */}
            <div className="bg-stone-100 rounded-xl p-4 text-sm text-stone-600 space-y-1">
              <p className="font-medium text-stone-700">Surface everything relevant before concluding.</p>
              <p>Don&apos;t filter for &quot;importance&quot; yet. Share context, ideas, concerns, and decisions needed. Your collaborator will do the same.</p>
            </div>

            {/* Category selector */}
            <div className="flex gap-2 flex-wrap">
              {(Object.entries(CATEGORY_META) as [EntryCategory, typeof CATEGORY_META[EntryCategory]][]).map(([key, meta]) => (
                <button
                  key={key}
                  data-id={`category-${key}`}
                  onClick={() => setNewCategory(key)}
                  className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer transition-colors ${
                    newCategory === key
                      ? `${meta.bgColor} ${meta.color} font-medium`
                      : 'border-stone-200 text-stone-400 hover:text-stone-600'
                  }`}
                >
                  {meta.label}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
              <div className={`text-xs px-2 py-0.5 rounded inline-block ${CATEGORY_META[newCategory].bgColor} ${CATEGORY_META[newCategory].color}`}>
                {CATEGORY_META[newCategory].label}
              </div>
              <input
                data-id="new-entry-title"
                type="text"
                placeholder={CATEGORY_META[newCategory].description}
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addDraft()}
                className="w-full text-stone-800 placeholder:text-stone-300 outline-none text-lg"
              />
              <textarea
                data-id="new-entry-desc"
                placeholder="Add detail, reasoning, or examples (optional)"
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
                  Save to drafts
                </button>
              </div>
            </div>

            {/* Drafts */}
            {drafts.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-stone-500">Ready to share ({drafts.length})</h2>
                  <button data-id="submit-all" onClick={submitAll} className="text-sm text-stone-500 hover:text-stone-800 cursor-pointer">
                    Share all
                  </button>
                </div>
                {drafts.map(draft => (
                  <div key={draft.id} className={`rounded-xl border p-4 flex items-start justify-between gap-3 ${CATEGORY_META[draft.category].bgColor}`}>
                    <div className="min-w-0">
                      <span className={`text-xs font-medium ${CATEGORY_META[draft.category].color}`}>{CATEGORY_META[draft.category].label}</span>
                      <p className="text-stone-800 mt-1">{draft.title}</p>
                      {draft.description && <p className="text-sm text-stone-500 mt-1">{draft.description}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        data-id={`submit-draft-${draft.id}`}
                        onClick={() => submitDraft(draft)}
                        disabled={submitting === draft.id}
                        className="text-xs px-3 py-1 rounded-lg bg-white/80 text-stone-700 hover:bg-white disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {submitting === draft.id ? '...' : 'Share'}
                      </button>
                      <button
                        data-id={`delete-draft-${draft.id}`}
                        onClick={() => deleteDraft(draft.id)}
                        className="text-xs px-2 py-1 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 cursor-pointer transition-colors"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Already shared by me */}
            {myEntries.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-medium text-stone-500">Already shared ({myEntries.length})</h2>
                {myEntries.map(entry => (
                  <div key={entry.issueNumber} className="bg-stone-100 rounded-xl p-4 opacity-60">
                    <span className="text-xs text-stone-400">{CATEGORY_META[entry.category]?.label || 'Context'}</span>
                    <p className="text-stone-600 mt-1">{entry.title}</p>
                    {entry.description && <p className="text-sm text-stone-400 mt-1">{entry.description}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* Readiness signal */}
            <div className="border-t border-stone-200 pt-6">
              <button
                data-id="toggle-readiness"
                onClick={toggleReadiness}
                className={`w-full py-3 rounded-xl border-2 cursor-pointer transition-all ${
                  iAmReady
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                }`}
              >
                {iAmReady
                  ? "I've shared everything relevant (click to undo)"
                  : "Signal: I've surfaced all my context"}
              </button>
              <div className="mt-3 flex gap-2 justify-center">
                {activeGroup!.members.map(m => (
                  <span key={m.email} className={`text-xs px-2 py-1 rounded-full ${readiness[m.email] ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-400'}`}>
                    {m.name.split(' ')[0]} {readiness[m.email] ? '  ready' : '  surfacing...'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : tab === 'shared' ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-stone-500">
                {entries.length} entries from {partyNames.length} {partyNames.length === 1 ? 'person' : 'people'}
              </h2>
              <button data-id="refresh-entries" onClick={fetchEntries} className="text-xs text-stone-400 hover:text-stone-600 cursor-pointer">
                Refresh
              </button>
            </div>

            {/* Group by category */}
            {(Object.keys(CATEGORY_META) as EntryCategory[]).map(cat => {
              const catEntries = entries.filter(e => (e.category || 'context') === cat);
              if (catEntries.length === 0) return null;
              return (
                <div key={cat} className="space-y-2">
                  <h3 className={`text-xs font-semibold uppercase tracking-wider ${CATEGORY_META[cat].color}`}>
                    {CATEGORY_META[cat].label} ({catEntries.length})
                  </h3>
                  {catEntries.map(entry => (
                    <div key={entry.issueNumber} className={`rounded-xl border p-4 ${CATEGORY_META[cat].bgColor}`}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-stone-800">{entry.title}</p>
                          {entry.description && <p className="text-sm text-stone-500 mt-1">{entry.description}</p>}
                        </div>
                        <span className="text-xs text-stone-400 shrink-0 ml-3">{entry.party.split(' ')[0]}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {entries.length === 0 && (
              <p className="text-center text-stone-400 py-12">No entries shared yet. Use the Surface tab to add context.</p>
            )}

            {/* Readiness indicator */}
            {entries.length > 0 && (
              <div className="bg-stone-100 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stone-600">Readiness for synthesis:</span>
                  <div className="flex gap-2">
                    {activeGroup!.members.map(m => (
                      <span key={m.email} className={`text-xs px-2 py-1 rounded-full ${readiness[m.email] ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-200 text-stone-400'}`}>
                        {m.name.split(' ')[0]} {readiness[m.email] ? 'ready' : 'surfacing'}
                      </span>
                    ))}
                  </div>
                </div>
                {!allReady && (
                  <p className="text-xs text-stone-400 mt-2">
                    Synthesis works best when both collaborators have finished surfacing their full context.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Synthesize tab */
          <div className="space-y-6">
            {!allReady && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                <p className="font-medium">Both sides haven&apos;t signaled readiness yet.</p>
                <p className="mt-1 text-amber-600">You can still synthesize, but the analysis will be more valuable when both collaborators have surfaced their full context.</p>
              </div>
            )}

            {allReady && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
                Both collaborators have signaled readiness. The full picture is available for synthesis.
              </div>
            )}

            <div className="space-y-3">
              <h2 className="text-sm font-medium text-stone-500">What synthesis will do:</h2>
              <ul className="text-sm text-stone-600 space-y-1.5 list-none">
                <li>Identify information gaps or asymmetries between perspectives</li>
                <li>Surface implicit assumptions that may differ</li>
                <li>Find common ground and shared priorities</li>
                <li>Propose decisions that optimize for the shared system, not just one side</li>
                <li>Flag where premature filtering may have occurred</li>
              </ul>
            </div>

            <button
              data-id="request-synthesis"
              onClick={requestSynthesis}
              disabled={synthesizing || entries.length === 0}
              className="w-full py-3 rounded-xl bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              {synthesizing ? 'Analyzing...' : entries.length === 0 ? 'No entries to synthesize' : 'Synthesize Full Picture'}
            </button>

            {synthesis && (
              <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-medium text-stone-700">Synthesis</h3>
                <div className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">{synthesis}</div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
