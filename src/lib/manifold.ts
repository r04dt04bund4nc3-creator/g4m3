export const MANIFOLD_NFT_URL = 'https://manifold.xyz/@r41nb0w/id/4078311664';

export const claimRitualArtifact = async (userId: string) => {
  console.log('Scaffolding Manifold claim for:', userId);
  return { success: true, claimUrl: MANIFOLD_NFT_URL };
};