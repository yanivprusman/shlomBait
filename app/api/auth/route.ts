import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { credential } = await req.json();
  if (!credential) {
    return NextResponse.json({ error: 'credential required' }, { status: 400 });
  }

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
  if (!res.ok) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }

  const info = await res.json();
  return NextResponse.json({
    name: info.name || info.given_name || info.email,
    email: info.email,
    picture: info.picture,
  });
}
