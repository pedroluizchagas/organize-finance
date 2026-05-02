import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
})

/**
 * POST /api/stripe/portal
 * Creates a Stripe Customer Portal session for managing or canceling subscriptions.
 * Returns { url }.
 *
 * Body: { return_url: string }
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const body = await req.json().catch(() => ({}))
  const { return_url } = body as { return_url?: string }

  if (!return_url) {
    return NextResponse.json(
      { data: null, error: 'Campo "return_url" é obrigatório' },
      { status: 400 }
    )
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', auth.userId)
    .single()

  if (!profile?.stripe_customer_id) {
    return NextResponse.json(
      { data: null, error: 'Nenhuma assinatura ativa encontrada' },
      { status: 404 }
    )
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url,
  })

  return NextResponse.json({ data: { url: session.url }, error: null })
}
