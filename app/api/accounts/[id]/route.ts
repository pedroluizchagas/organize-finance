import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * DELETE /api/accounts/[id]
 * Deletes an account and cascades to transactions via DB foreign key.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const { id } = params

  // Verify ownership before deleting
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('accounts')
    .select('id')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ data: null, error: 'Conta não encontrada' }, { status: 404 })
  }

  const { error } = await supabaseAdmin
    .from('accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.userId)

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: { id }, error: null })
}
