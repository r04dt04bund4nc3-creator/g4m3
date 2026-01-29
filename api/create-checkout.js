// api/create-checkout.js
const Stripe = require('stripe');

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY;
    const STRIPE_PRICE_ANNUAL = process.env.STRIPE_PRICE_ANNUAL;

    if (!STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Server misconfigured: STRIPE_SECRET_KEY missing.' });
    }
    if (!STRIPE_PRICE_MONTHLY || !STRIPE_PRICE_ANNUAL) {
      return res.status(500).json({ error: 'Server misconfigured: STRIPE_PRICE_MONTHLY/ANNUAL missing.' });
    }

    const body = await readJson(req);
    const { tier, return_url, user_id } = body;

    if (!tier || !return_url || !user_id) {
      return res.status(400).json({ error: 'Missing required fields: tier, return_url, user_id.' });
    }

    const priceId = tier === 'prize-6' ? STRIPE_PRICE_MONTHLY : tier === 'prize-3' ? STRIPE_PRICE_ANNUAL : null;
    if (!priceId) return res.status(400).json({ error: 'Invalid tier.' });

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user_id,
      success_url: `${return_url}?success=true&tier=${encodeURIComponent(tier)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${return_url}?canceled=true&tier=${encodeURIComponent(tier)}`,
      metadata: { user_id, tier },
      subscription_data: { metadata: { user_id, tier } },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};