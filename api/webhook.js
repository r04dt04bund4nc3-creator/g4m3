const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

let stripe;
try {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
  });
} catch (err) {
  console.error('Stripe init failed in webhook:', err.message);
}

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports.config = {
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

module.exports = async (req, res) => {
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
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;
    const tier = session.metadata?.tier;

    if (!userId || !tier) {
      console.warn('Missing userId or tier in session', { userId, tier });
      return res.status(200).json({ received: true });
    }

    try {
      const { error } = await supabase
        .from('user_streaks')
        .update({ 
          subscription_status: 'active',
          subscription_tier: tier,
          current_period_end: session.subscription 
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null
        })
        .eq('user_id', userId);

      if (error) throw error;

      console.log('Updated user streak for', userId, 'with tier', tier);
    } catch (dbErr) {
      console.error('Database update failed:', dbErr);
      return res.status(500).send('Database update failed');
    }
  }

  res.status(200).json({ received: true });
};