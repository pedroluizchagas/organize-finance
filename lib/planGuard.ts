import { supabaseAdmin } from './supabase'
import { NextResponse } from 'next/server'

const FREE_PLAN_MAX_ACCOUNTS = 1
const FREE_PLAN_MAX_UPLOADS_PER_MONTH = 2

export type PlanGuardError = NextResponse

/**
 * Checks whether the user can create a new bank account.
 * Free plan: max 1 account.
 */
export async function guardAccountCreation(
  userId: string
): Promise<null | PlanGuardError> {
  const profile = await getUserPlan(userId)
  if (!profile) return planError('Perfil não encontrado')
  if (profile.plan === 'pro') return null

  const { count, error } = await supabaseAdmin
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (error) return planError('Erro ao verificar contas')

  if ((count ?? 0) >= FREE_PLAN_MAX_ACCOUNTS) {
    return planError(
      `O plano gratuito permite no máximo ${FREE_PLAN_MAX_ACCOUNTS} conta. Faça upgrade para o Finly Pro.`,
      403
    )
  }

  return null
}

/**
 * Checks whether the user can upload a new statement this month.
 * Free plan: max 2 uploads per calendar month.
 */
export async function guardUploadLimit(
  userId: string
): Promise<null | PlanGuardError> {
  const profile = await getUserPlan(userId)
  if (!profile) return planError('Perfil não encontrado')
  if (profile.plan === 'pro') return null

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

  const { count, error } = await supabaseAdmin
    .from('statement_uploads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', monthStart)
    .lt('created_at', monthEnd)

  if (error) return planError('Erro ao verificar uploads')

  if ((count ?? 0) >= FREE_PLAN_MAX_UPLOADS_PER_MONTH) {
    return planError(
      `O plano gratuito permite no máximo ${FREE_PLAN_MAX_UPLOADS_PER_MONTH} uploads por mês. Faça upgrade para o Finly Pro.`,
      403
    )
  }

  return null
}

/**
 * Checks whether the user can access AI insights.
 * Free plan: no AI insights.
 */
export async function guardAIInsights(
  userId: string
): Promise<null | PlanGuardError> {
  const profile = await getUserPlan(userId)
  if (!profile) return planError('Perfil não encontrado')
  if (profile.plan === 'pro') return null

  return planError(
    'Insights de IA estão disponíveis apenas no Finly Pro. Faça upgrade para acessar.',
    403
  )
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function getUserPlan(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single()

  if (error || !data) return null
  return data as { plan: 'free' | 'pro' }
}

function planError(message: string, status = 400): PlanGuardError {
  return NextResponse.json({ data: null, error: message }, { status })
}

export function isPlanError(value: null | PlanGuardError): value is PlanGuardError {
  return value instanceof NextResponse
}
