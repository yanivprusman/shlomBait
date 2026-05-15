import { NextRequest, NextResponse } from 'next/server';
import { createEntry, listEntries, deleteEntry } from '@/lib/daemon';

export async function GET() {
  const entries = await listEntries();
  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const { party, title, description } = await req.json();
  if (!party || !title) {
    return NextResponse.json({ error: 'party and title required' }, { status: 400 });
  }
  const entry = await createEntry(party, title, description || '');
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
