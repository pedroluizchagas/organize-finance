import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/auth/profile
 * Creates a profile row after Supabase signup.
 * Called from mobile after the user registers.
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const { userId } = auth

  const body = await req.json().catch(() => ({}))
  const { full_name, email } = body as { full_name?: string; email?: string }

  // Upsert to handle retries safely
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .upsert(
      {
        id: userId,
        full_name: full_name ?? null,
        email: email ?? null,
        plan: 'free',
      },
      { onConflict: 'id' }
    )
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, error: null }, { status: 201 })
}
