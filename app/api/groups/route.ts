import { NextRequest, NextResponse } from 'next/server';
import { createGroup, getUserGroups } from '@/lib/daemon';

export async function GET(req: NextRequest) {
  const email = req.headers.get('x-user-email');
  if (!email) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const groups = await getUserGroups(email);
  return NextResponse.json(groups);
}

export async function POST(req: NextRequest) {
  const { name, user } = await req.json();
  if (!name || !user?.email) {
    return NextResponse.json({ error: 'name and user required' }, { status: 400 });
  }
  const group = await createGroup(name, user);
  return NextResponse.json(group);
}
