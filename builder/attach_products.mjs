/** Attach packaging only after its inputs and generated assets are verified. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const arg=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,s)=>v.startsWith('--')?[...a,[v.slice(2),s[i+1]]]:a,[]));
const root=path.resolve(arg.catalog||'catalog'),sources=path.resolve(arg.sources||'sources'),art=path.resolve(arg.artwork||'artwork');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(p,d)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(d)+'\n');};
const library=read(path.join(sources,'product-artwork-catalog.json')),gameplay=read(path.join(sources,'product-definitions.json')),assets=read(path.join(art,'index.json')).textures,index=read(path.join(root,'index.json'));
const base='https://raw.githubusercontent.com/SpinLol/stellartcg-set-index/main/artwork/';
function texture(key){const a=assets[key];if(!a)throw Error('Unbuilt packaging texture '+key);const file=path.join(art,a.path);if(hash(fs.readFileSync(file))!==a.sha256)throw Error('Packaging texture checksum mismatch');return {...a,url:base+a.path};}
let products=0,supplements=0;
for(const e of index.sets){
 const records=library.products.filter(p=>p.set===e.id),templates=gameplay.products.filter(p=>p.set===e.id);if(!records.length)continue;
 const file=path.join(root,e.manifest),m=JSON.parse(gunzipSync(fs.readFileSync(file))),paths=new Map(m.assets.map(a=>[a.path,a])),files=new Set(m.files.map(f=>f.path)),ready=templates.filter(p=>p.status==='ready');
 for(const override of (gameplay.card_variant_overrides||[]).filter(o=>o.set===e.id)){
  const c=m.files.find(f=>f.path==='cards/'+override.card+'.json')?.json;if(!c)throw Error('Finish override targets an absent printing');
  for(const [key,v]of Object.entries(override.variants)){if(v.front)throw Error('Procedural finish override cannot replace artwork');c.variants[key]=v;}
  c.metadata.catalog_finish_note=override.provenance;
 }
 const artById=new Map(records.map(p=>[p.id,p]));
 const addAsset=(p,key)=>{const a=texture(key),value={path:p,url:a.url,sha256:a.sha256};if(paths.has(p)&&JSON.stringify(paths.get(p))!==JSON.stringify(value))throw Error('Conflicting artwork path '+p);paths.set(p,value);return a;};
 const supplement=gameplay.supplemental_cards.filter(p=>p.set===e.id);
 for(const s of supplement){
  const d=structuredClone(s.definition),p='cards/'+d.id+'.json';if(files.has(p))throw Error('Supplementary printing would replace a numbered card');
  if(s.asset){d.front=d.id+'.'+s.asset.extension;paths.set('cards/'+d.front,{path:'cards/'+d.front,url:s.asset.url,sha256:s.asset.sha256});}
  else addAsset('cards/'+d.front,s.texture);
  m.files.push({path:p,json:d});files.add(p);
  if(!m.rarities.some(r=>r.id===d.rarity))m.rarities.push({id:d.rarity,name:d.metadata.source_rarity||d.rarity,weight:1,color:'#E9CC8D',sort_priority:50,announce:false,base_value:0});
 }
 // Supplemental promo/energy scans must never enter the numbered set's random
 // pools or completion requirements simply because they share a rarity.
 for(const f of m.files)if(f.path.startsWith('cards/')&&!f.json.metadata.catalog_product_inclusion)f.json.tags=[...new Set([...(f.json.tags||[]),'catalog_primary'])];
 for(const p of ready){
  const source=artById.get(p.artwork_id);if(!source)throw Error('Product has no packaging record '+p.id);
  const d=structuredClone(p.definition);d.texture='textures/'+source.icon+'.webp';addAsset('products/'+d.texture,source.icon);d.model.textures={};
  for(const face of ['front','back','left','right','top','bottom']){
   const r=source.faces[face];if(!r)throw Error('Missing declared product face '+p.id+'/'+face);d.model.textures[face]='textures/'+r.texture+'.webp';addAsset('products/'+d.model.textures[face],r.texture);
  }
  if(source.wrapper_variants.length){d.wrapper_variants=source.wrapper_variants.map(k=>'textures/'+k+'.webp');for(let i=0;i<source.wrapper_variants.length;i++)addAsset('products/'+d.wrapper_variants[i],source.wrapper_variants[i]);}
  d.metadata.catalog_packaging_faces=JSON.stringify(Object.fromEntries(Object.entries(source.faces).map(([side,f])=>[side,f.status])));
  const pth='products/product_'+hash(p.id).slice(0,24)+'.json';if(files.has(pth))throw Error('Duplicate product identity');m.files.push({path:pth,json:d});files.add(pth);
 }
 for(const p of templates.filter(p=>p.status!=='ready'))m.reviews.push({product:p.id,reason:'Product artwork is catalogued; gameplay definition remains pending: '+p.reviews.join('; ')});
 for(const p of records.filter(p=>!templates.some(t=>t.id===p.id)))m.reviews.push({product:p.id,reason:'Packaging artwork is catalogued; its gameplay template is awaiting verified contents/printing dependencies.'});
 for(const r of records)for(const [face,panel]of Object.entries(r.faces))if(panel.status==='companion')m.reviews.push({product:r.id,face,reason:'Companion artwork; an authentic retail panel is not available yet.'});
 const counts={catalogued:records.length,photographed_panels:records.reduce((n,r)=>n+Object.values(r.faces).filter(f=>f.status!=='companion').length,0),companion_panels:records.reduce((n,r)=>n+Object.values(r.faces).filter(f=>f.status==='companion').length,0)};
 write(path.join(root,'products',e.id+'.json'),{format:1,set:e.id,coverage:counts,products:records.map(p=>({...p,icon:texture(p.icon),faces:Object.fromEntries(Object.entries(p.faces).map(([f,r])=>[f,{...r,...texture(r.texture)}])),wrapper_variants:p.wrapper_variants.map(texture)}))});
 m.assets=[...paths.values()];m.coverage.base_source_cards=m.coverage.source_cards;m.coverage.supplemental_cards=supplement.length;m.coverage.source_cards+=supplement.length;m.coverage.importable_cards+=supplement.length;m.coverage.products=ready.length;m.coverage.product_status=records.length>ready.length?'curated_with_reviews':'curated';m.coverage.product_artwork=counts;
 if(m.coverage.source_cards!==m.coverage.importable_cards)m.coverage.artwork_status='incomplete';
 const raw=Buffer.from(JSON.stringify(m)+'\n'),packed=gzipSync(raw,{level:9,mtime:0});fs.writeFileSync(file,packed);Object.assign(e,m.coverage,{sha256:hash(packed),bytes:packed.length,json_bytes:raw.length});products+=ready.length;supplements+=supplement.length;
}
const setIds=new Set(index.sets.map(e=>e.id));
for(const owner of new Set(library.products.map(p=>p.set))){
 if(setIds.has(owner))continue;const records=library.products.filter(p=>p.set===owner);
 write(path.join(root,'products',owner+'.json'),{format:1,set:owner,status:'awaiting_set_metadata',reason:'Public English card metadata is not yet available in the pinned source snapshot. Artwork is retained for review; no fabricated cards or active products are installed.',products:records.map(p=>({...p,icon:texture(p.icon),faces:Object.fromEntries(Object.entries(p.faces).map(([f,r])=>[f,{...r,...texture(r.texture)}])),wrapper_variants:p.wrapper_variants.map(texture)}))});
}
write(path.join(root,'product-coverage.json'),{format:1,catalogued_artwork:library.products.length,installable_templates:products,awaiting_template_or_dependencies:library.products.length-products,source_sets:new Set(library.products.map(p=>p.set)).size,photographed_panels:library.products.reduce((n,p)=>n+Object.values(p.faces).filter(f=>f.status!=='companion').length,0),companion_panels:library.products.reduce((n,p)=>n+Object.values(p.faces).filter(f=>f.status==='companion').length,0)});
index.revision=hash(JSON.stringify(index.sets));write(path.join(root,'index.json'),index);const coverage=read(path.join(root,'coverage.json'));coverage.revision=index.revision;coverage.products=products;coverage.product_supplemental_cards=supplements;coverage.importable_printings=index.sets.reduce((n,e)=>n+e.importable_cards,0);coverage.source_printings=index.sets.reduce((n,e)=>n+e.source_cards,0);coverage.catalog_bytes=index.sets.reduce((n,e)=>n+e.bytes,0);write(path.join(root,'coverage.json'),coverage);
console.log(JSON.stringify({products,supplements,catalogued_product_artwork:library.products.length}));
