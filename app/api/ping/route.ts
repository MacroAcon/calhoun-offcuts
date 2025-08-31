import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseAdmin';

export async function GET() {
  const { error } = await supabase.from('listings').select('id').limit(1);
  return NextResponse.json({
    ok: !error,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    error: error?.message ?? null
  });
}
