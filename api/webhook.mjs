import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let buf, sig, event;

  try {
    buf = await buffer(req);
    sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET not set');
    }

    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;
    const tier = session.metadata?.tier;

    if (!userId || !tier) {
      console.warn('Missing userId or tier', { userId, tier });
      return res.status(200).json({ received: true });
    }

    try {
      const { error } = await supabase
        .from('user_streaks')
        .update({ 
          subscription_status: 'active',
          subscription_tier: tier,
        })
        .eq('user_id', userId);

      if (error) throw error;
      console.log('Updated subscription for', userId);
    } catch (dbErr) {
      console.error('DB update failed:', dbErr);
      return res.status(500).send('Database update failed');
    }
  }

  res.status(200).json({ received: true });
}