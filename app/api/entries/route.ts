import { NextRequest, NextResponse } from 'next/server';
import { createEntry, listEntries, deleteEntry } from '@/lib/daemon';

export async function GET(req: NextRequest) {
  const groupId = req.nextUrl.searchParams.get('groupId');
  if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });
  const entries = await listEntries(groupId);
  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const { groupId, party, title, description, category } = await req.json();
  if (!groupId || !party || !title) {
    return NextResponse.json({ error: 'groupId, party, and title required' }, { status: 400 });
  }
  const entry = await createEntry(groupId, party, title, description || '', category || 'context');
  return NextResponse.json(entry);
}

export async function DELETE(req: NextRequest) {
  const { issueNumber } = await req.json();
  if (!issueNumber) {
    return NextResponse.json({ error: 'issueNumber required' }, { status: 400 });
  }
  await deleteEntry(issueNumber);
  return NextResponse.json({ ok: true });
}
