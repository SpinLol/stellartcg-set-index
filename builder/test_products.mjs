import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
const root=path.resolve(process.argv[2]||'catalog'),index=JSON.parse(fs.readFileSync(path.join(root,'index.json')));let products=0,panels=0;
const id=x=>x.startsWith('stellartcg:')?x.slice(11):x;
for(const e of index.sets.filter(e=>e.products)){
 const m=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,e.manifest)))),assets=new Set(m.assets.map(a=>a.path)),cards=new Map(m.files.filter(f=>f.path.startsWith('cards/')).map(f=>[e.id+'/'+f.json.id,f.json])),items=new Map(m.files.filter(f=>f.path.startsWith('products/')).map(f=>[id(f.json.id),f.json]));
 assert.equal(items.size,e.products);
 const eligible=(p,entry)=>[...cards.entries()].filter(([cid,c])=>(!entry.card||id(entry.card)===cid)&&(!entry.rarity||c.rarity===entry.rarity)&&(!entry.category||c.category===entry.category)&&(!entry.tag||c.tags?.includes(entry.tag))&&(!entry.variant||c.variants[entry.variant]));
 for(const [pid,p]of items){
  assert.ok(pid.startsWith(e.id+'/'));assert.ok(p.slots?.length||p.contents?.length,'Empty product '+pid);
  for(const entry of p.contents||[]){
   if(entry.product)assert.ok(items.has(id(entry.product)),'Unresolved product '+pid+' -> '+entry.product);
   if(entry.card){const c=cards.get(id(entry.card));assert.ok(c,'Unresolved card '+pid+' -> '+entry.card);assert.ok(c.variants[entry.variant||'normal'],'Unverified guaranteed variant '+pid+' -> '+entry.card);}
   assert.ok(!['club_item','cosmetic'].includes(entry.type),'Unconfigured server cosmetic '+pid);
   assert.ok(entry.amount>=1&&entry.amount<=4096);
  }
  for(const [name,pool]of Object.entries(p.pools||{}))for(const entry of pool.entries||[])assert.ok(eligible(p,entry).length,'No eligible cards '+pid+' pool '+name+' '+JSON.stringify(entry));
  for(const slot of p.slots||[])assert.ok(p.pools[slot.pool]?.entries?.length,'Missing slot pool '+pid);
  for(const side of ['front','back','left','right','top','bottom']){assert.ok(assets.has('products/'+p.model.textures[side]),'Missing '+side+' artwork '+pid);panels++;}
  assert.ok(assets.has('products/'+p.texture));products++;
 }
 const walk=(p,stack=new Set())=>{assert.ok(!stack.has(p),'Nested product cycle');const next=new Set([...stack,p]);for(const c of items.get(p).contents||[])if(c.product)walk(id(c.product),next);};for(const p of items.keys())walk(p);
 for(const c of cards.values())if(c.metadata.catalog_product_inclusion){assert.equal(c.completion.counts,false);assert.equal(c.completion.master_counts,false);assert.ok(!c.tags.includes('catalog_primary'));}
}
console.log(JSON.stringify({products,panels,checks:'Guaranteed cards/variants, nested products, nonempty pools, six packaging faces, cycle freedom and supplementary printing completion exclusions passed'}));
