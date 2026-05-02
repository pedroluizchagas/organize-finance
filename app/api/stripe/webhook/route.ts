import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
})

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events for subscription lifecycle.
 * Must be registered in Stripe dashboard with the raw body.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Webhook signature verification failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  switch (event.type) {
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription
      await handleSubscriptionCreated(sub)
      break
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      await handleSubscriptionUpdated(sub)
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      await handleSubscriptionDeleted(sub)
      break
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      await handlePaymentFailed(invoice)
      break
    }
    default:
      // Unhandled event type — acknowledge to avoid retries
      break
  }

  return NextResponse.json({ received: true })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleSubscriptionCreated(sub: Stripe.Subscription) {
  const userId = await getUserIdFromCustomer(sub.customer as string)
  if (!userId) return

  await supabaseAdmin.from('profiles').update({
    plan: 'pro',
    stripe_subscription_id: sub.id,
    subscription_status: sub.status as string,
    trial_ends_at: sub.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : null,
  }).eq('id', userId)
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const userId = await getUserIdFromCustomer(sub.customer as string)
  if (!userId) return

  const plan = sub.status === 'active' || sub.status === 'trialing' ? 'pro' : 'free'

  await supabaseAdmin.from('profiles').update({
    plan,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status as string,
    trial_ends_at: sub.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : null,
  }).eq('id', userId)
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const userId = await getUserIdFromCustomer(sub.customer as string)
  if (!userId) return

  await supabaseAdmin.from('profiles').update({
    plan: 'free',
    stripe_subscription_id: null,
    subscription_status: 'canceled',
  }).eq('id', userId)
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id

  if (!customerId) return

  const userId = await getUserIdFromCustomer(customerId)
  if (!userId) return

  await supabaseAdmin.from('profiles').update({
    subscription_status: 'past_due',
  }).eq('id', userId)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getUserIdFromCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single()

  return data?.id ?? null
}
