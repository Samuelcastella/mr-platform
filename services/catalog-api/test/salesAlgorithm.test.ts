import {describe,expect,test} from "bun:test";
import {calculateSalesRecommendations as recommend, cosineSimilarity} from "../ai/salesAlgorithm";
const base = {id:"dress",priceHnl:1000,embedding:[1,0]};
const candidate = (id:string, overrides:Record<string,unknown>={}) => ({id,name:id,priceHnl:200,stockLevel:5,embedding:[1,0],coOccurrenceScore:0.5,...overrides});
describe("Cross-Sell Engine",()=>{
 test("excludes base product and out-of-stock items",()=>expect(recommend(base,[candidate("dress"),candidate("none",{stockLevel:0}),candidate("bag")]).map(x=>x.id)).toEqual(["bag"]));
 test("accepts inclusive 15%-35% impulse range",()=>expect(recommend(base,[candidate("low",{priceHnl:150}),candidate("high",{priceHnl:350}),candidate("outside",{priceHnl:351})]).map(x=>x.id)).toEqual(["low","high","outside"]));
 test("ranks co-occurrence higher when other signals equal",()=>expect(recommend(base,[candidate("low",{coOccurrenceScore:0}),candidate("high",{coOccurrenceScore:1})])[0].id).toBe("high"));
 test("ranks similarity higher when other signals equal",()=>expect(recommend(base,[candidate("different",{embedding:[0,1]}),candidate("similar")])[0].id).toBe("similar"));
 test("respects recommendation limit",()=>expect(recommend(base,[candidate("a"),candidate("b"),candidate("c")],2)).toHaveLength(2));
 test("returns empty array for no candidates",()=>expect(recommend(base,[])).toEqual([]));
 test("preserves input order for tied scores",()=>expect(recommend(base,[candidate("a"),candidate("b")]).map(x=>x.id)).toEqual(["a","b"]));
 test("handles invalid vectors without NaN",()=>expect(cosineSimilarity([1,0],[NaN,0])).toBe(0));
 test("handles zero vectors and mismatched dimensions",()=>{expect(cosineSimilarity([0,0],[1,0])).toBe(0);expect(cosineSimilarity([1],[1,0])).toBe(0)});
 test("rejects invalid prices and nonpositive limit",()=>{expect(recommend(base,[candidate("bad",{priceHnl:NaN})])).toEqual([]);expect(recommend(base,[candidate("a")],0)).toEqual([])});
});
