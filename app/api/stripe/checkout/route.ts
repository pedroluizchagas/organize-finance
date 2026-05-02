import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getAuthenticatedUser, isAuthError } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
})

/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session for the Finly Pro plan.
 * Returns { url } to redirect the user.
 *
 * Body: { success_url: string, cancel_url: string }
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedUser(req)
  if (isAuthError(auth)) return auth

  const body = await req.json().catch(() => ({}))
  const { success_url, cancel_url } = body as { success_url?: string; cancel_url?: string }

  if (!success_url || !cancel_url) {
    return NextResponse.json(
      { data: null, error: 'Campos "success_url" e "cancel_url" são obrigatórios' },
      { status: 400 }
    )
  }

  // Fetch or create Stripe customer
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', auth.userId)
    .single()

  let customerId = profile?.stripe_customer_id

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email ?? undefined,
      metadata: { user_id: auth.userId },
    })
    customerId = customer.id

    await supabaseAdmin
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', auth.userId)
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: process.env.STRIPE_PRO_PRICE_ID!,
        quantity: 1,
      },
    ],
    success_url,
    cancel_url,
    metadata: { user_id: auth.userId },
    locale: 'pt-BR',
  })

  return NextResponse.json({ data: { url: session.url }, error: null })
}
