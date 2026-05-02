import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAIInsights, isPlanError } from '@/lib/planGuard'

/**
 * GET /api/insights?month=&year=
 * Returns the existing monthly insight, or triggers AI generation if not yet created.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const month = parseInt(searchParams.get('month') ?? '')
  const year = parseInt(searchParams.get('year') ?? '')

  if (!month || !year || month < 1 || month > 12) {
    return NextResponse.json(
      { data: null, error: 'Parâmetros "month" (1-12) e "year" são obrigatórios' },
      { status: 400 }
    )
  }

  // Check if already exists
  const { data: existing } = await supabaseAdmin
    .from('ai_insights')
    .select('*')
    .eq('user_id', auth.userId)
    .eq('month', month)
    .eq('year', year)
    .single()

  if (existing) {
    return NextResponse.json({ data: existing, error: null })
  }

  // Guard AI access before generating
  const guard = await guardAIInsights(auth.userId)
  if (isPlanError(guard)) return guard

  // Trigger generation by delegating to the AI insights route
  const generationUrl = new URL('/api/ai/insights', req.url)
  const generationResp = await fetch(generationUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: req.headers.get('authorization') ?? '',
    },
    body: JSON.stringify({ month, year }),
  })

  const result = await generationResp.json()
  return NextResponse.json(result, { status: generationResp.status })
}
