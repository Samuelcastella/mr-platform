type DB = any;
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
export async function ensureRestockSchema(db:DB){
 await db`CREATE TABLE IF NOT EXISTS restock_subscriptions (
 id BIGSERIAL PRIMARY KEY, product_id BIGINT NOT NULL REFERENCES products(id),
 variant_id BIGINT NOT NULL REFERENCES product_variants(id),
 customer_name TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('WHATSAPP','EMAIL','BOTH')),
 phone TEXT, email TEXT, consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','QUEUED','CANCELLED')),
 cancel_token UUID NOT NULL DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (phone IS NOT NULL OR email IS NOT NULL))`;
 await db`CREATE UNIQUE INDEX IF NOT EXISTS restock_unique_pending ON restock_subscriptions(variant_id,channel,COALESCE(phone,''),COALESCE(email,'')) WHERE status='PENDING'`;
 await db`CREATE TABLE IF NOT EXISTS restock_outbox (
 id BIGSERIAL PRIMARY KEY, subscription_id BIGINT NOT NULL REFERENCES restock_subscriptions(id),
 variant_id BIGINT NOT NULL REFERENCES product_variants(id), status TEXT NOT NULL DEFAULT 'PENDING',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(subscription_id))`;
 // Inventory transitions from zero to positive are handled by an outbox trigger.
 await db`CREATE OR REPLACE FUNCTION enqueue_restock_on_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF NEW.quantity - NEW.reserved > 0 AND (TG_OP='INSERT' OR OLD.quantity - OLD.reserved <= 0) THEN
 INSERT INTO restock_outbox(subscription_id,variant_id)
 SELECT id,variant_id FROM restock_subscriptions WHERE variant_id=NEW.variant_id AND status='PENDING'
 ON CONFLICT DO NOTHING;
 UPDATE restock_subscriptions SET status='QUEUED' WHERE variant_id=NEW.variant_id AND status='PENDING';
 END IF;
 RETURN NEW;
 END $$`;
 await db`DROP TRIGGER IF EXISTS trg_restock_inventory ON inventory`;
 await db`CREATE TRIGGER trg_restock_inventory AFTER INSERT OR UPDATE OF quantity,reserved ON inventory FOR EACH ROW EXECUTE FUNCTION enqueue_restock_on_inventory()`;
}
export async function handleRestock(req:Request,url:URL,db:DB):Promise<Response|null>{
 if(url.pathname==='/v1/restock/subscribe' && req.method==='POST'){
  if(Number(req.headers.get('content-length')||0)>4096)return reply({error:'payload_too_large'},413);
  let b:any;try{b=await req.json()}catch{return reply({error:'invalid_json'},400)}
  const productId=Number(b?.productId),variantId=Number(b?.variantId);
  const name=String(b?.name||'').trim().slice(0,120);
  const channel=String(b?.channel||'');
  const phone=String(b?.phone||'').trim().replace(/[\s()-]/g,'')||null;
  const email=String(b?.email||'').trim().toLowerCase().slice(0,254)||null;
  if(!Number.isSafeInteger(productId)||productId<=0||!Number.isSafeInteger(variantId)||variantId<=0||name.length<2||!['WHATSAPP','EMAIL','BOTH'].includes(channel)||b?.consent!==true)return reply({error:'invalid_subscription'},400);
  if(channel!=='EMAIL'&&!/^\+[1-9]\d{7,14}$/.test(phone||''))return reply({error:'invalid_phone'},400);
  if(channel!=='WHATSAPP'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email||''))return reply({error:'invalid_email'},400);
  const variants=await db`SELECT v.id FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=${variantId} AND p.id=${productId} AND p.status='active' AND v.active AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.variant_id=v.id GROUP BY i.variant_id HAVING SUM(i.quantity-i.reserved)>0)`;
  if(!variants.length)return reply({error:'variant_not_out_of_stock'},409);
  await db`INSERT INTO restock_subscriptions(product_id,variant_id,customer_name,channel,phone,email)
  VALUES(${productId},${variantId},${name},${channel},${channel==='EMAIL'?null:phone},${channel==='WHATSAPP'?null:email})
  ON CONFLICT DO NOTHING`;
  return reply({ok:true,message:'subscription_registered'},202);
 }
 return null;
}
