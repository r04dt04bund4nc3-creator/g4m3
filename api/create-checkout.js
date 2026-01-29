const Stripe = require('stripe');

// Initialize Stripe with env var
let stripe;
try {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
  });
} catch (err) {
  console.error('Stripe initialization failed:', err.message);
}

module.exports = async (req, res) => {
  // Health check: if GET, return status
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'OK',
      env: {
        STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
        STRIPE_PRICE_MONTHLY: !!process.env.STRIPE_PRICE_MONTHLY,
        STRIPE_PRICE_ANNUAL: !!process.env.STRIPE_PRICE_ANNUAL,
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tier, return_url, user_id } = req.body;

    // Validate inputs
    if (!tier || !return_url || !user_id) {
      throw new Error('Missing required fields: tier, return_url, user_id');
    }

    const priceId = tier === 'prize-6' 
      ? process.env.STRIPE_PRICE_MONTHLY 
      : tier === 'prize-3' 
        ? process.env.STRIPE_PRICE_ANNUAL 
        : null;

    if (!priceId) {
      throw new Error(`Price ID not configured for tier: ${tier}`);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user_id,
      success_url: `${return_url}?success=true&tier=${tier}`,
      cancel_url: `${return_url}?canceled=true`,
      metadata: { user_id, tier }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    // Return plain text error so frontend doesn't crash on invalid JSON
    return res.status(400).send(err.message || 'Unknown server error');
  }
};