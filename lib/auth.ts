import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Validates the Authorization Bearer token from the request header
 * using Supabase Auth and returns the authenticated user's ID.
 *
 * Returns { userId } on success, or a NextResponse error to return immediately.
 */
export async function getAuthenticatedUser(
  req: NextRequest
): Promise<{ userId: string } | NextResponse> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ data: null, error: 'Missing authorization header' }, { status: 401 })
  }

  const token = authHeader.slice(7)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return NextResponse.json({ data: null, error: 'Invalid or expired token' }, { status: 401 })
  }

  return { userId: data.user.id }
}

export function isAuthError(result: { userId: string } | NextResponse): result is NextResponse {
  return result instanceof NextResponse
}
