import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * GET /api/transactions
 * Returns paginated transactions with optional filters.
 *
 * Query params:
 * - account_id: string (optional)
 * - month: number 1-12 (optional)
 * - year: number (optional)
 * - category: string (optional)
 * - type: 'debit' | 'credit' (optional)
 * - limit: number (default 50, max 200)
 * - offset: number (default 0)
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('account_id')
  const month = searchParams.get('month') ? parseInt(searchParams.get('month')!) : null
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : null
  const category = searchParams.get('category')
  const type = searchParams.get('type')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT)), MAX_LIMIT)
  const offset = parseInt(searchParams.get('offset') ?? '0')

  let query = supabaseAdmin
    .from('transactions')
    .select('*', { count: 'exact' })
    .eq('user_id', auth.userId)
    .order('date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (accountId) query = query.eq('account_id', accountId)
  if (category) query = query.eq('category', category)
  if (type === 'debit' || type === 'credit') query = query.eq('type', type)

  if (month && year) {
    const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
    const dateTo = new Date(year, month, 1).toISOString().slice(0, 10)
    query = query.gte('date', dateFrom).lt('date', dateTo)
  } else if (year) {
    query = query.gte('date', `${year}-01-01`).lt('date', `${year + 1}-01-01`)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    data,
    error: null,
    pagination: { total: count ?? 0, limit, offset },
  })
}
