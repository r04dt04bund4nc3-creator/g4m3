import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // Logic to update Supabase when payment is successful
  const event = req.body; 

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;
    const tier = session.metadata.tier;

    await supabase
      .from('user_streaks')
      .update({ 
        subscription_status: 'active',
        subscription_tier: tier 
      })
      .eq('user_id', userId);
  }

  res.status(200).json({ received: true });
}