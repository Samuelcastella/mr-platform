export interface CandidateProduct {
  id: string;
  name: string;
  priceHnl: number;
  stockLevel: number;
  embedding: number[];
  coOccurrenceScore: number;
}
export interface BaseProduct { id: string; priceHnl: number; embedding: number[]; }
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length || ![...a,...b].every(Number.isFinite)) return 0;
  const dot = a.reduce((s,v,i)=>s+v*b[i],0);
  const na = Math.hypot(...a), nb = Math.hypot(...b);
  return na > 0 && nb > 0 ? dot / (na*nb) : 0;
}
export function calculateSalesRecommendations(base: BaseProduct, candidates: CandidateProduct[], limit = 3): CandidateProduct[] {
  if (!Number.isFinite(base.priceHnl) || base.priceHnl <= 0 || limit <= 0) return [];
  return candidates.filter(c => c.id !== base.id && c.stockLevel > 0 && Number.isFinite(c.priceHnl) && c.priceHnl > 0)
    .map((c,index) => {
      const similarity = Math.max(0, Math.min(1, cosineSimilarity(base.embedding,c.embedding)));
      const co = Number.isFinite(c.coOccurrenceScore) ? Math.max(0,Math.min(1,c.coOccurrenceScore)) : 0;
      const price = c.priceHnl >= base.priceHnl*0.15 && c.priceHnl <= base.priceHnl*0.35 ? 1 : 0.3;
      return {c,index,score:0.45*similarity+0.35*co+0.2*price};
    }).sort((a,b)=>b.score-a.score || a.index-b.index).slice(0,Math.floor(limit)).map(x=>x.c);
}
