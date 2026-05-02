import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAccountCreation, isPlanError } from '@/lib/planGuard'

/**
 * GET /api/accounts
 * Lists all accounts for the authenticated user.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('*')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, error: null })
}

/**
 * POST /api/accounts
 * Creates a new account. Free plan limited to 1 account.
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const guard = await guardAccountCreation(auth.userId)
  if (isPlanError(guard)) return guard

  const body = await req.json().catch(() => ({}))
  const { name, bank_name, color } = body as {
    name?: string
    bank_name?: string
    color?: string
  }

  if (!name?.trim()) {
    return NextResponse.json({ data: null, error: 'O campo "name" é obrigatório' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .insert({
      user_id: auth.userId,
      name: name.trim(),
      bank_name: bank_name ?? null,
      color: color ?? null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, error: null }, { status: 201 })
}
