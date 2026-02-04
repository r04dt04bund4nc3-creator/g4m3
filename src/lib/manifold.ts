// src/lib/manifold.ts
import { supabase } from './supabaseClient';

// Public paid mint page (for non-subscribers or general visitors)
export const MANIFOLD_NFT_URL = 'https://manifold.xyz/@r41nb0w/id/4078311664';

// ---------------------------------------------------------
// 1. NFT SCHEDULE (FREE CLAIM PAGES)
// These URLs point to the individual NFTs for subscribers.
// We append the claim code automatically.
// ---------------------------------------------------------
const NFT_SCHEDULE = [
  'https://manifold.xyz/@r41nb0w/id/4080670960', // NFT #1 (Free Subscriber Page for 001 - GR33N - 4W4K3N1NG)
  'https://manifold.xyz/@r41nb0w/id/REPLACETHIS', // 002 - R3D - ជីពចរ
  'https://manifold.xyz/@r41nb0w/id/REPLACETHIS', // 003 - 0R4NG3 - N3W L1F3
];

// The codes you set in Manifold for each month
const CLAIM_CODES = [
  '0011296', // Month 1
  'REPLACETHIS', // Month 2
  'REPLACETHIS', // Month 3
];

// Fallback if they run out of scheduled NFTs
const MANIFOLD_FALLBACK_URL = 'https://manifold.xyz/@r41nb0w/id/4078311664'; // Redirect to first NFT

/**
 * Appends the claim code to the Manifold URL so the user doesn't have to type it.
 */
function buildAuthenticatedUrl(baseUrl: string, index: number) {
  const code = CLAIM_CODES[index];
  if (!code) return baseUrl;
  
  // Manifold uses ?code= for claim codes
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}code=${code}`;
}

export async function claimRitualArtifact(userId: string) {
  console.log('Processing Claim for:', userId);

  try {
    // 1. GET HISTORY
    const { data: claims, error: fetchError } = await supabase
      .from('user_claims')
      .select('claimed_at, month_id')
      .eq('user_id', userId)
      .order('claimed_at', { ascending: false });

    if (fetchError) throw fetchError;

    const claimCount = claims?.length || 0;
    const lastClaim = claims?.[0];

    // 2. CHECK COOLDOWN (25 days)
    const MIN_DAYS_BETWEEN_CLAIMS = 25;
    let isTooSoon = false;

    if (lastClaim) {
      const lastDate = new Date(lastClaim.claimed_at);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - lastDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < MIN_DAYS_BETWEEN_CLAIMS) {
        isTooSoon = true;
      }
    }

    // 3. DETERMINE WHICH LINK TO GIVE
    let targetIndex = claimCount; 

    if (isTooSoon && claimCount > 0) {
      targetIndex = claimCount - 1;
    }

    // 4. CHECK IF WE HAVE A REWARD FOR THIS LEVEL
    const nextNftUrl = NFT_SCHEDULE[targetIndex];

    if (!nextNftUrl) {
      return { 
        success: true, 
        claimUrl: MANIFOLD_FALLBACK_URL, 
        message: "You have collected all currently available artifacts!" 
      };
    }

    // 5. RECORD THE NEW CLAIM
    const distinctId = `nft-${targetIndex}`;
    const { error: insertError } = await supabase
      .from('user_claims')
      .insert([{ user_id: userId, month_id: distinctId }]);

    if (insertError && insertError.code !== '23505') {
        console.error('DB Error:', insertError);
    }

    // BUILD THE AUTHENTICATED URL
    const finalUrl = buildAuthenticatedUrl(nextNftUrl, targetIndex);

    return {
      success: true,
      claimUrl: finalUrl
    };

  } catch (err) {
    console.error('Logic Error:', err);
    return { success: true, claimUrl: MANIFOLD_FALLBACK_URL };
  }
}