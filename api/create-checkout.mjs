import Stripe from 'stripe';

// 1. VALIDATE ENV VARS IMMEDIATELY
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const priceMonthly = process.env.STRIPE_PRICE_MONTHLY;
const priceAnnual = process.env.STRIPE_PRICE_ANNUAL;

if (!stripeSecretKey) {
  console.error('FATAL: STRIPE_SECRET_KEY is missing in environment variables');
  throw new Error('Server configuration error: STRIPE_SECRET_KEY missing');
}
if (!priceMonthly || !priceAnnual) {
  console.error('FATAL: Stripe Price IDs are missing', { priceMonthly, priceAnnual });
  throw new Error('Server configuration error: Price IDs missing');
}

// 2. INITIALIZE STRIPE
const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16',
});

export default async function handler(req, res) {
  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'OK',
      env: {
        STRIPE_SECRET_KEY: !!stripeSecretKey,
        STRIPE_PRICE_MONTHLY: !!priceMonthly,
        STRIPE_PRICE_ANNUAL: !!priceAnnual,
      },
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tier, return_url, user_id } = req.body;

    if (!tier || !return_url || !user_id) {
      throw new Error('Missing required fields: tier, return_url, user_id');
    }

    const priceId = tier === 'prize-6' ? priceMonthly : priceAnnual;

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
    // Return plain text to avoid JSON parse errors on frontend if we crash here
    return res.status(500).send(err.message);
  }
}