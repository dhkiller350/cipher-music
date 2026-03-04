import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { userEmail, plan, amountCents, currency, ref } = body;
  if (!userEmail || !plan || amountCents === undefined) {
    return NextResponse.json({ error: 'userEmail, plan, and amountCents are required' }, { status: 400 });
  }
  const paymentRef = ref ?? `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('payments')
    .insert({
      ref: paymentRef,
      user_email: userEmail,
      plan,
      amount_cents: amountCents,
      currency: currency ?? 'usd',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
