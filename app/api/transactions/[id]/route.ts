import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * PATCH /api/transactions/[id]
 * Updates a transaction's category manually. Sets manually_edited = true.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const body = await req.json().catch(() => ({}))
  const { category } = body as { category?: string }

  if (!category?.trim()) {
    return NextResponse.json({ data: null, error: 'Campo "category" é obrigatório' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .update({ category: category.trim(), manually_edited: true })
    .eq('id', params.id)
    .eq('user_id', auth.userId) // ensure ownership
    .select()
    .single()

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: error.code === 'PGRST116' ? 404 : 500 })
  }

  return NextResponse.json({ data, error: null })
}

/**
 * DELETE /api/transactions/[id]
 * Deletes a transaction.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const { data: existing } = await supabaseAdmin
    .from('transactions')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', auth.userId)
    .single()

  if (!existing) {
    return NextResponse.json({ data: null, error: 'Transação não encontrada' }, { status: 404 })
  }

  const { error } = await supabaseAdmin
    .from('transactions')
    .delete()
    .eq('id', params.id)
    .eq('user_id', auth.userId)

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: { id: params.id }, error: null })
}
