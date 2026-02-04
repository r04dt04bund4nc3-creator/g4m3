import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const priceMonthly = process.env.STRIPE_PRICE_MONTHLY;
const priceAnnual = process.env.STRIPE_PRICE_ANNUAL;

if (!stripeSecretKey || !priceMonthly || !priceAnnual) {
  throw new Error('Server configuration error: Stripe environment variables missing');
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16', 
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'OK' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tier, return_url, user_id } = req.body;

    if (!tier || !return_url || !user_id) {
      throw new Error('Missing required fields');
    }

    const priceId = tier === 'prize-6' ? priceMonthly : priceAnnual;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user_id, // Used for the initial success webhook
      
      // ✅ CRITICAL FIX: This ensures metadata is attached to the SUBSCRIPTION object
      // so your 'customer.subscription.deleted' webhook can find the user_id later.
      subscription_data: {
        metadata: {
          user_id: user_id,
          tier: tier
        }
      },
      
      success_url: `${return_url}?success=true&tier=${tier}`,
      cancel_url: `${return_url}?canceled=true`,
      metadata: { user_id, tier } // Metadata for the Session
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).send(err.message);
  }
}