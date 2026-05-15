import { NextRequest, NextResponse } from 'next/server';
import { joinGroup } from '@/lib/daemon';

export async function POST(req: NextRequest) {
  const { groupId, user } = await req.json();
  if (!groupId || !user?.email) {
    return NextResponse.json({ error: 'groupId and user required' }, { status: 400 });
  }
  const group = await joinGroup(groupId, user);
  if (!group) {
    return NextResponse.json({ error: 'group not found' }, { status: 404 });
  }
  return NextResponse.json(group);
}
