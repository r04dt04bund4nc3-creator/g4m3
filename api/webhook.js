// api/webhook.js
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send('Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).send('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const sig = req.headers['stripe-signature'];
    const rawBody = await readRawBody(req);

    const event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);

    // Most important: mark subscription active after a successful checkout
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id || session?.metadata?.user_id;
      const tier = session?.metadata?.tier;
      const subscriptionId = session.subscription;

      if (userId) {
        await supabase
          .from('user_streaks')
          .update({
            subscription_status: 'active',
            subscription_tier: tier ?? null,
            stripe_subscription_id: subscriptionId ?? null,
          })
          .eq('user_id', userId);
      }
    }

    // Keep status in sync over time
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const userId = sub?.metadata?.user_id;
      const tier = sub?.metadata?.tier;

      if (userId) {
        await supabase
          .from('user_streaks')
          .update({
            subscription_status: sub?.status ?? (event.type === 'customer.subscription.deleted' ? 'canceled' : null),
            subscription_tier: tier ?? null,
            stripe_subscription_id: sub?.id ?? null,
            current_period_end: sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          })
          .eq('user_id', userId);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('webhook error:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};