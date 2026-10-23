import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root=path.resolve(process.argv[2]||'catalog'),index=JSON.parse(fs.readFileSync(path.join(root,'index.json'))),seen=new Set();let cards=0,variants=0;
assert.equal(index.format,1);assert.ok(index.sets.length>0);
for(const e of index.sets){
 assert.ok(!seen.has(e.id));seen.add(e.id);assert.match(e.id,/^[a-z0-9_]{1,96}$/);assert.ok(!/pocket/i.test(e.series));
 const packed=fs.readFileSync(path.join(root,e.manifest));assert.equal(packed.length,e.bytes);assert.equal(crypto.createHash('sha256').update(packed).digest('hex'),e.sha256);
 const decoded=gunzipSync(packed);assert.equal(decoded.length,e.json_bytes);const m=JSON.parse(decoded);assert.equal(m.id,e.id);assert.equal(m.set.id,e.id);assert.equal(m.coverage.source_cards,e.source_cards);assert.ok(e.source_cards>=e.importable_cards);
 const assets=new Set(m.assets.map(a=>a.path)),files=new Set();assert.equal(assets.size,m.assets.length);const rarities=new Set(m.rarities.map(r=>r.id));let setCards=0;
 for(const a of m.assets){assert.ok(!a.path.includes('..'));assert.match(a.path,/^(cards|products)\/[a-z0-9_.\/-]+\.(webp|png|jpg|jpeg)$/);assert.equal(new URL(a.url).protocol,'https:');}
 for(const f of m.files){assert.ok(!files.has(f.path));files.add(f.path);if(!f.path.startsWith('cards/'))continue;setCards++;cards++;const c=f.json;assert.ok(rarities.has(c.rarity));assert.ok(assets.has('cards/'+c.front));assert.ok(Object.keys(c.variants).length>0&&Object.keys(c.variants).length<=64);
  assert.equal(c.metadata.catalog_battle_verified, c.metadata.battle_engine?'true':'false');
  for(const [id,v]of Object.entries(c.variants)){variants++;assert.match(id,/^[a-z0-9_.-]+$/);if(v.front)assert.ok(assets.has('cards/'+v.front));assert.ok(v.weight>0);if(id==='source_scan')assert.ok(m.reviews.some(r=>r.card===c.number&&r.printing?.type==='unclassified'));}
 }
 assert.equal(setCards,e.importable_cards);
 if(e.artwork_status==='provider_listed')assert.equal(e.source_cards,e.importable_cards);
}
console.log(JSON.stringify({catalogs:index.sets.length,cards,variants,checks:'all compressed hashes, identities, paths, rarities, artwork references, variant identities and battle flags passed'}));
