import Stripe from 'npm:stripe@14.0.0';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) throw new Error('Missing Authorization token');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userRes?.user) throw new Error('Invalid user session');

    const { tier, return_url } = await req.json();
    if (!return_url) throw new Error('Missing return_url');

    const price =
      tier === 'prize-6' ? Deno.env.get('STRIPE_PRICE_MONTHLY') :
      tier === 'prize-3' ? Deno.env.get('STRIPE_PRICE_ANNUAL') :
      null;

    if (!price) throw new Error('Invalid tier');

    const user = userRes.user;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      success_url: `${return_url}?success=true&tier=${encodeURIComponent(tier)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${return_url}?canceled=true&tier=${encodeURIComponent(tier)}`,
      metadata: { user_id: user.id, tier },
      subscription_data: { metadata: { user_id: user.id, tier } },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});