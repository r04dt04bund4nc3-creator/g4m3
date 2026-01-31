import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Allow either SUPABASE_URL or VITE_SUPABASE_URL (common during local dev/deployment)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate
if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseKey) {
  console.error('Missing critical env vars for webhook', {
    stripe: !!stripeSecretKey,
    webhook: !!webhookSecret,
    supabaseUrl: !!supabaseUrl,
    supabaseKey: !!supabaseKey,
  });
  // In Vercel, this will lead to a deployment error, which is good for catching missing envs
  throw new Error('Server configuration incomplete for webhook');
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });
const supabase = createClient(supabaseUrl, supabaseKey);

export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let buf, sig, event;
  try {
    buf = await buffer(req);
    sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;
    const tier = session.metadata?.tier; // 'prize-6' or 'prize-3'

    if (!userId || !tier) {
      console.warn('Stripe checkout.session.completed event missing userId or tier in metadata.');
      return res.status(200).json({ received: true });
    }

    try {
      // Update subscription status, tier, and reset nft_claimed for the new cycle
      const { error } = await supabase
        .from('user_streaks')
        .update({
          subscription_status: 'active',
          subscription_tier: tier,
          nft_claimed: false, // Reset for the new subscription period
        })
        .eq('user_id', userId);

      if (error) throw error;
      console.log(`✅ Subscription activated for ${userId} (${tier}). NFT claim reset.`);
    } catch (dbErr) {
      console.error('DB Update Failed for checkout.session.completed:', dbErr);
      return res.status(500).send('DB Error');
    }
  } else if (event.type === 'customer.subscription.deleted') {
    // This event handles when a subscription is cancelled or ends
    const subscription = event.data.object;
    const userId = subscription.metadata?.user_id; // Assuming user_id is in subscription metadata from create-checkout

    if (!userId) {
      console.warn('Stripe customer.subscription.deleted event missing userId in metadata.');
      return res.status(200).json({ received: true });
    }

    try {
      const { error } = await supabase
        .from('user_streaks')
        .update({
          subscription_status: 'inactive',
          subscription_tier: null,
        })
        .eq('user_id', userId);

      if (error) throw error;
      console.log(`❌ Subscription deactivated for ${userId}.`);
    } catch (dbErr) {
      console.error('DB Update Failed for customer.subscription.deleted:', dbErr);
      return res.status(500).send('DB Error');
    }
  }

  res.status(200).json({ received: true });
}