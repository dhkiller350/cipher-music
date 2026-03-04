import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { userEmail, event, metadata, ip, userAgent } = body;
  if (!userEmail || !event) {
    return NextResponse.json({ error: 'userEmail and event are required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('access_log')
    .insert({
      user_email: userEmail,
      event,
      metadata: metadata ?? {},
      ip: ip ?? null,
      user_agent: userAgent ?? null,
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
