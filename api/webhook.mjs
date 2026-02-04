import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseKey) {
  throw new Error('Server configuration incomplete for webhook');
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });
const supabase = createClient(supabaseUrl, supabaseKey);

export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  let buf, sig, event;
  try {
    buf = await buffer(req);
    sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 1. Handling Successful Initial Checkout
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;
    const tier = session.metadata?.tier;

    if (userId && tier) {
      await supabase
        .from('user_streaks')
        .update({
          subscription_status: 'active',
          subscription_tier: tier,
          nft_claimed: false, 
        })
        .eq('user_id', userId);
      console.log(`✅ Subscription activated: ${userId}`);
    }
  } 

  // 2. Handling Cancellations or Expirations
  else if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const userId = subscription.metadata?.user_id;

    if (userId) {
      await supabase
        .from('user_streaks')
        .update({
          subscription_status: 'inactive',
          subscription_tier: null,
        })
        .eq('user_id', userId);
      console.log(`❌ Subscription ended: ${userId}`);
    }
  }

  // 3. Optional: Handling Payment Failures (e.g., card expired mid-subscription)
  else if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const userId = invoice.subscription ? (await stripe.subscriptions.retrieve(invoice.subscription)).metadata.user_id : null;
    
    if (userId) {
      await supabase.from('user_streaks').update({ subscription_status: 'past_due' }).eq('user_id', userId);
    }
  }

  res.status(200).json({ received: true });
}