import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tier, return_url, user_id } = req.body;

  const priceId = tier === 'prize-6' 
    ? process.env.STRIPE_PRICE_MONTHLY 
    : process.env.STRIPE_PRICE_ANNUAL;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: req.body.email, // Optional: if you have it
      client_reference_id: user_id,
      success_url: `${return_url}?success=true&tier=${tier}`,
      cancel_url: `${return_url}?canceled=true`,
      metadata: { user_id, tier }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}