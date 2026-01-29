import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate
if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseKey) {
  console.error('Missing critical env vars', { 
    stripe: !!stripeSecretKey, 
    webhook: !!webhookSecret, 
    supabase: !!supabaseUrl 
  });
  throw new Error('Server configuration incomplete');
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
    const tier = session.metadata?.tier;

    if (!userId || !tier) return res.status(200).json({ received: true });

    try {
      const { error } = await supabase
        .from('user_streaks')
        .update({ 
          subscription_status: 'active',
          subscription_tier: tier 
        })
        .eq('user_id', userId);

      if (error) throw error;
      console.log(`✅ Subscription activated for ${userId} (${tier})`);
    } catch (dbErr) {
      console.error('DB Update Failed:', dbErr);
      return res.status(500).send('DB Error');
    }
  }

  res.status(200).json({ received: true });
}