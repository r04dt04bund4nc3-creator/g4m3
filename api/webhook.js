const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Disable body parsing for Stripe signature verification
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// Helper to get raw body
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

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;
    const tier = session.metadata?.tier;

    console.log('Payment successful for user:', userId, 'tier:', tier);

    try {
      const { error } = await supabase
        .from('user_streaks')
        .update({ 
          subscription_status: 'active',
          subscription_tier: tier,
          current_period_end: session.subscription 
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // Approximate
            : null
        })
        .eq('user_id', userId);

      if (error) throw error;
      
      console.log('Database updated successfully');
    } catch (err) {
      console.error('Database update failed:', err);
      return res.status(500).json({ error: 'Database update failed' });
    }
  }

  res.status(200).json({ received: true });
};