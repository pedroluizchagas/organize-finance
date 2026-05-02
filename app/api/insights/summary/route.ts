import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/insights/summary
 * Returns aggregated stats for the current month and balance trend for last 6 months.
 *
 * Response:
 * - current_month: { total_spent, total_received, balance, by_category }
 * - monthly_trend: last 6 months with total_spent and total_received
 * - top_transactions: 5 largest debits of the current month
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // Current month date range
  const monthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`
  const monthEnd = new Date(currentYear, currentMonth, 1).toISOString().slice(0, 10)

  // Fetch current month transactions
  const { data: currentTx, error: currentError } = await supabaseAdmin
    .from('transactions')
    .select('amount, type, category')
    .eq('user_id', auth.userId)
    .gte('date', monthStart)
    .lt('date', monthEnd)

  if (currentError) {
    return NextResponse.json({ data: null, error: currentError.message }, { status: 500 })
  }

  // Aggregate current month
  const byCategory: Record<string, number> = {}
  let totalSpent = 0
  let totalReceived = 0

  for (const tx of currentTx ?? []) {
    const amt = Number(tx.amount)
    if (tx.type === 'debit') {
      totalSpent += amt
      const cat = tx.category ?? 'Outros'
      byCategory[cat] = (byCategory[cat] ?? 0) + amt
    } else {
      totalReceived += amt
    }
  }

  const byCategorySorted = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, total]) => ({ category, total: Number(total.toFixed(2)) }))

  // Last 6 months trend
  const sixMonthsAgo = new Date(currentYear, currentMonth - 7, 1)
  const { data: trendTx, error: trendError } = await supabaseAdmin
    .from('transactions')
    .select('date, amount, type')
    .eq('user_id', auth.userId)
    .gte('date', sixMonthsAgo.toISOString().slice(0, 10))
    .lt('date', monthEnd)

  if (trendError) {
    return NextResponse.json({ data: null, error: trendError.message }, { status: 500 })
  }

  const trendMap: Record<string, { spent: number; received: number }> = {}
  for (const tx of trendTx ?? []) {
    const key = tx.date.slice(0, 7) // YYYY-MM
    if (!trendMap[key]) trendMap[key] = { spent: 0, received: 0 }
    if (tx.type === 'debit') {
      trendMap[key].spent += Number(tx.amount)
    } else {
      trendMap[key].received += Number(tx.amount)
    }
  }

  const monthly_trend = Object.entries(trendMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, vals]) => ({
      period,
      total_spent: Number(vals.spent.toFixed(2)),
      total_received: Number(vals.received.toFixed(2)),
      balance: Number((vals.received - vals.spent).toFixed(2)),
    }))

  // Top 5 largest debits this month
  const { data: topTx, error: topError } = await supabaseAdmin
    .from('transactions')
    .select('id, date, description, amount, category')
    .eq('user_id', auth.userId)
    .eq('type', 'debit')
    .gte('date', monthStart)
    .lt('date', monthEnd)
    .order('amount', { ascending: false })
    .limit(5)

  if (topError) {
    return NextResponse.json({ data: null, error: topError.message }, { status: 500 })
  }

  return NextResponse.json({
    data: {
      current_month: {
        period: `${currentYear}-${String(currentMonth).padStart(2, '0')}`,
        total_spent: Number(totalSpent.toFixed(2)),
        total_received: Number(totalReceived.toFixed(2)),
        balance: Number((totalReceived - totalSpent).toFixed(2)),
        by_category: byCategorySorted,
      },
      monthly_trend,
      top_transactions: topTx ?? [],
    },
    error: null,
  })
}
