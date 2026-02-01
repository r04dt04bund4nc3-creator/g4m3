import Stripe from 'npm:stripe@14.0.0';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const PRICE_MAP = {
  'prize-6': 'price_6_monthly',    // Replace with real Stripe Price ID
  'prize-3': 'price_36_annual'     // Replace with real Stripe Price ID
};

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { user_id, tier, return_url } = await req.json();
    
    if (!user_id || !PRICE_MAP[tier as keyof typeof PRICE_MAP]) {
      throw new Error('Invalid user or tier');
    }

    // Get or create Stripe customer
    const { data: userData } = await supabase
      .from('user_streaks')
      .select('stripe_customer_id')
      .eq('user_id', user_id)
      .single();

    let customerId = userData?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { supabase_user_id: user_id }
      });
      customerId = customer.id;
      
      await supabase
        .from('user_streaks')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', user_id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: PRICE_MAP[tier as keyof typeof PRICE_MAP],
        quantity: 1
      }],
      success_url: `${return_url}?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${return_url}?canceled=true`,
      metadata: {
        user_id,
        tier,
        platform: '4b4ku5'
      }
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});