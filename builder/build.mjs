/** Read upstream TypeScript as literal data, never execute upstream modules. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import ts from 'typescript';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,s)=>v.startsWith('--')?[...a,[v.slice(2),s[i+1]||'']]:a,[]));
const source=path.resolve(args.source||'work/tcgdex'),out=path.resolve(args.output||'catalog');
const cache=path.resolve(args.cache||'.catalog-work/http');
const languages=(args.languages||'en,fr,de,es,it,pt,nl,pl,ru,ja,ko,zh-tw,zh-cn,id,th,es-mx,pt-br,pt-pt').split(',');
const memo=new Map(),errors=[];
function load(file){
 file=path.resolve(file);if(!file.startsWith(source+path.sep))throw Error('Import escapes source');
 if(memo.has(file))return memo.get(file);
 const tree=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),vars=new Map(),imports=new Map();
 for(const s of tree.statements){
  if(ts.isImportDeclaration(s)&&s.importClause?.name)imports.set(s.importClause.name.text,s.moduleSpecifier.text);
  if(ts.isVariableStatement(s))for(const d of s.declarationList.declarations)if(ts.isIdentifier(d.name))vars.set(d.name.text,d.initializer);
 }
 const evalNode=n=>{
  if(!n)return undefined;
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isNumericLiteral(n))return ts.isNumericLiteral(n)?Number(n.text):n.text;
  if(n.kind===ts.SyntaxKind.TrueKeyword)return true;if(n.kind===ts.SyntaxKind.FalseKeyword)return false;if(n.kind===ts.SyntaxKind.NullKeyword)return null;
  if(ts.isAsExpression(n)||ts.isSatisfiesExpression(n)||ts.isParenthesizedExpression(n))return evalNode(n.expression);
  if(ts.isPrefixUnaryExpression(n)&&n.operator===ts.SyntaxKind.MinusToken)return -evalNode(n.operand);
  if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.PlusToken)return evalNode(n.left)+evalNode(n.right);
  if(ts.isIdentifier(n)){
   if(n.text==='undefined')return undefined;
   if(vars.has(n.text))return evalNode(vars.get(n.text));
   if(imports.has(n.text)){let p=path.resolve(path.dirname(file),imports.get(n.text));if(!p.endsWith('.ts'))p+='.ts';return load(p);}
  }
  if(ts.isPropertyAccessExpression(n))return evalNode(n.expression)?.[n.name.text];
  if(ts.isElementAccessExpression(n))return evalNode(n.expression)?.[evalNode(n.argumentExpression)];
  if(ts.isArrayLiteralExpression(n))return n.elements.flatMap(e=>ts.isSpreadElement(e)?evalNode(e.expression):[evalNode(e)]);
  if(ts.isObjectLiteralExpression(n)){
   const o={};for(const p of n.properties){
    if(ts.isSpreadAssignment(p)){Object.assign(o,evalNode(p.expression));continue;}
    if(ts.isShorthandPropertyAssignment(p)){o[p.name.text]=evalNode(p.name);continue;}
    if(!ts.isPropertyAssignment(p))throw Error('Nonliteral object member');
    const key=ts.isComputedPropertyName(p.name)?evalNode(p.name.expression):p.name.text;o[key]=evalNode(p.initializer);
   }return o;
  }
  throw Error('Unsupported nonliteral syntax '+ts.SyntaxKind[n.kind]);
 };
 const exp=tree.statements.find(ts.isExportAssignment);if(!exp)throw Error('Missing default export '+file);
 const result=evalNode(exp.expression);memo.set(file,result);return result;
}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const slug=s=>String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const norm=s=>String(s??'').normalize('NFKD').replace(/[’‘]/g,"'").replace(/×/g,'x').replace(/[^a-z0-9]/gi,'').toLowerCase();
const local=(v,lang,fallback='')=>typeof v==='object'&&v!==null?(v[lang]??fallback):(v??fallback);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function save(p,b){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);}
function write(p,o){save(p,JSON.stringify(o)+'\n');}
const enCost=a=>(a.cost||[]).map(t=>({DARK:'DARKNESS'}[String(t).toUpperCase()]||String(t).toUpperCase())).filter(t=>t!=='NONE').sort();
function attackSignature(a,engine=false){return [norm(local(a.name,'en')),enCost(a),norm(String(a.damage==null||a.damage===''?0:a.damage)+(engine?(a.damageCalculation||''):'')),norm(engine?a.text:local(a.effect??a.text,'en'))];}
function battleSignature(c,engine=false){return JSON.stringify([norm(local(c.name,'en')),String(c.hp??''),norm(engine?c.kind:c.category),norm(c.stage),engine?(c.retreat||[]).length:Number(c.retreat||0),norm(engine?c.evolvesFrom:local(c.evolveFrom,'en')),(c.attacks||[]).map(a=>attackSignature(a,engine)),(c[engine?'powers':'abilities']||[]).map(a=>[norm(local(a.name,'en')),norm(engine?a.text:local(a.effect,'en'))]),norm(engine?c.text:local(c.effect,'en'))]);}
let engines=[];
if(args.battle){const raw=fs.readFileSync(args.battle);engines=JSON.parse(args.battle.endsWith('.gz')?gunzipSync(raw):raw);}
const bySig=new Map();for(const c of engines){const sig=battleSignature(c,true);if(!bySig.has(sig))bySig.set(sig,[]);bySig.get(sig).push(c);}
let pinnedProfiles={};const exportedProfiles={};
if(args.profiles){const b=fs.readFileSync(args.profiles);pinnedProfiles=JSON.parse(args.profiles.endsWith('.gz')?gunzipSync(b):b);}
// Explicit metadata corrections belong here; no name-only battle matching.
let overrides={};if(args.overrides&&fs.existsSync(args.overrides))overrides=JSON.parse(fs.readFileSync(args.overrides,'utf8'));
const sets=new Map();let sourceCards=0;
for(const branch of ['data','data-asia'])if(fs.existsSync(path.join(source,branch)))for(const file of walk(path.join(source,branch)).filter(p=>p.endsWith('.ts')&&!p.includes('Pokémon TCG Pocket'))){
 try{const c=load(file);if(!c?.set||!c.category)continue;
  const set=c.set;if(!set.id||!set.serie?.id)continue;
  const key=branch+'/'+set.id;if(!sets.has(key))sets.set(key,{definition:set,cards:[],branch});
  sets.get(key).cards.push({data:c,number:path.basename(file,'.ts'),file:path.relative(source,file).replaceAll('\\','/')});sourceCards++;
 }catch(e){errors.push({file:path.relative(source,file).replaceAll('\\','/'),reason:e.message});}
}
console.log('Literal metadata:',sets.size,'sets;',sourceCards,'cards;',errors.length,'parse issues');
fs.mkdirSync(cache,{recursive:true});
async function get(url){const file=path.join(cache,hash(url)+'.json');if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'));
 for(let i=0;i<3;i++)try{const r=await fetch(url,{headers:{'User-Agent':'StellarTCG-SetCatalog/1.0'},signal:AbortSignal.timeout(45000)});if(r.status===404)return null;if(!r.ok)throw Error('HTTP '+r.status);const o=await r.json();write(file,o);return o;}catch(e){if(i===2)throw e;await new Promise(r=>setTimeout(r,1000*(i+1)));}
}
const tasks=[];
for(const item of sets.values())for(const language of languages){if(!item.definition.name?.[language])continue;const cards=item.cards.filter(c=>c.data.name?.[language]);if(cards.length)tasks.push({item,language,cards});}
let cursor=0,complete=0;const manifests=[],index=[];
function effects(type){return type==='holo'?[{id:'holo',area:'artwork'}]:type==='reverse'?[{id:'reverse_holo',area:'reverse'}]:[];}
function cardVariants(c,lang,override){
 let known=c.variants??[];
 if(!Array.isArray(known))known=Object.entries(known).filter(([k,v])=>v&&['normal','holo','reverse'].includes(k)).map(([type])=>({type}));
 const regular={},review=[];
 for(const v of known){if(v.languages&&!v.languages.includes(lang))continue;
  const simple=['normal','holo','reverse'].includes(v.type)&&!v.stamp?.length&&(!v.size||v.size==='standard')&&!v.subtype&&!v.foil;
  if(simple){const id=v.type==='reverse'?'reverse_holo':v.type;regular[id]={weight:1,effects:effects(v.type)};}
  else if(!Object.values(override?.variants||{}).some(o=>o.printing&&JSON.stringify(o.printing)===JSON.stringify(v)))review.push(v);
 }
 for(const [id,v]of Object.entries(override?.variants||{})){regular[id]=v.definition;}
 // A base scan remains collectible when upstream has no detailed finish classification.
 if(!Object.keys(regular).length){regular.source_scan={name:'Source scan (finish unclassified)',weight:1,effects:[]};review.push({type:'unclassified',note:'The source scan is available, but its exact finish has not been classified.'});}
 return {variants:regular,review};
}
function cardDefinition(row,set,lang,sourceUrl,override){
 const c=row.data,num=slug(row.number),id=override?.id||num;
 const rarity=slug(c.rarity||'unclassified'),vr=cardVariants(c,lang,override);
 const eligible=bySig.get(battleSignature(c))||[];
 const code=set.abbreviations?.official||set.tcgOnline||'';
 const exact=eligible.filter(e=>norm(e.set)===norm(code)&&norm(String(e.number).replace(/^0+/,''))===norm(row.number.replace(/^0+/,'')));
 let engine=exact.length===1?exact[0]:null;
 const profileId=set.id+'/'+row.number,signature=hash(battleSignature(c)),pinned=pinnedProfiles[profileId];
 if(!engine&&pinned&&pinned.signature===signature)engine={key:pinned.engine,pinned:true};
 if(override?.battle_engine)engine=engines.find(e=>e.key===override.battle_engine)||null;
 // Full text/cost/effect identity is necessary even for explicit mapping overrides.
 if(engine&&!engine.pinned&&battleSignature(engine,true)!==battleSignature(c))engine=null;
 if(engine)exportedProfiles[profileId]={engine:engine.key,signature};
 const d={id,name:local(c.name,lang),number:row.number,display_number:row.number+'/'+set.cardCount.official,rarity,category:String(c.category).toLowerCase(),types:(c.types||[]).map(t=>t.toLowerCase()),front:id+'.webp',variants:vr.variants,aliases:[],tags:['imported',slug(set.id),lang],completion:{counts:true,master_counts:true},metadata:{source_card_id:set.id+'-'+row.number,metadata_source:sourceUrl,image_source:'',source_provider:'tcgdex',source_language:lang,source_rarity:c.rarity||'',artist:c.illustrator||'',regulation_mark:c.regulationMark||'',hp:String(c.hp??''),stage:c.stage||'',catalog_battle_verified:engine?'true':'false',variant_coverage:vr.review.length?'review_required':'source_listed'}};
 if(engine)d.metadata.battle_engine=engine.key;
 const attacks=(c.attacks||[]).map(a=>({name:local(a.name,lang),cost:a.cost||[],damage:a.damage??'',text:local(a.effect,lang)}));if(attacks.length)d.attacks=attacks;
 const abilities=(c.abilities||[]).map(a=>({name:local(a.name,lang),text:local(a.effect,lang),type:a.type||'Ability'}));if(abilities.length)d.abilities=abilities;
 for(const field of ['weaknesses','resistances'])if(c[field])d[field]=c[field];
 if(c.retreat!==undefined)d.retreat_cost=Array(Number(c.retreat)||0).fill('Colorless');
 if(c.evolveFrom)d.evolves_from=local(c.evolveFrom,lang);if(c.effect)d.rules=[local(c.effect,lang)];
 return {definition:d,review:vr.review};
}
async function worker(){for(;;){const task=tasks[cursor++];if(!task)return;const {item,language:lang,cards}=task,set=item.definition,id='tcgdex_'+lang.replaceAll('-','_')+'_'+slug(set.id);
 let listing=null,lookup=new Map(),error='';try{listing=await get('https://api.tcgdex.net/v2/'+lang+'/sets/'+encodeURIComponent(set.id));if(listing)lookup=new Map((listing.cards||[]).map(c=>[String(c.localId),c]));}catch(e){error=e.message;}
 const slugName=slug(local(set.name,lang)),official=Number(set.cardCount?.official)||cards.length;
 const expectedCards=Math.max(cards.length,Number(listing?.cardCount?.total)||0,official);
 const date=local(set.releaseDate,lang,'2000-01-01');
 const def={id,name:local(set.name,lang)+' ('+lang.toUpperCase()+')',code:set.abbreviations?.official||set.tcgOnline||set.id,description:'Imported '+lang+' printing catalog. Detailed coverage is recorded in the import report.',release_date:/^\d{4}-\d{2}-\d{2}$/.test(date)?date:'2000-01-01',default_card_back:'defaultback.png','god-pack':false,completion:{enabled:true,requirement:'one_of_each_card'},aliases:[]};
 const files=[],assets=[],reviews=[],rarities=new Map();let mapped=0,importable=0;
 for(const row of cards){const key=lang+'/'+set.id+'/'+row.number,override=overrides.cards?.[key];const result=cardDefinition(row,{...set,cardCount:{official}},lang,'https://api.tcgdex.net/v2/'+lang+'/cards/'+set.id+'-'+row.number,override),d=result.definition;
  const image=override?.front||lookup.get(row.number)?.image;
  if(!image){reviews.push({card:row.number,reason:'Artwork is not listed by the provider'});continue;}
  const url=override?.front||image+'/high.webp';d.metadata.image_source=url;
  files.push({path:'cards/'+d.id+'.json',json:d});assets.push({path:'cards/'+d.id+'.webp',url});importable++;if(d.metadata.battle_engine)mapped++;
  for(const r of result.review)reviews.push({card:row.number,reason:'Special printing requires verified artwork/finish mapping',printing:r});
  for(const [variant,v]of Object.entries(override?.variants||{}))if(v.url)assets.push({path:'cards/'+v.definition.front,url:v.url,sha256:v.sha256||''});
  if(!rarities.has(d.rarity))rarities.set(d.rarity,{id:d.rarity,name:row.data.rarity||'Unclassified',weight:1,color:'#E9CC8D',sort_priority:50,announce:false,base_value:0});
 }
 const products=overrides.products?.[lang+'/'+set.id]||[];
 for(const p of products){if(p.status!=='verified'){reviews.push({product:p.definition?.id,reason:'Product is awaiting verification'});continue;}files.push({path:'products/'+slug(p.definition.id)+'.json',json:p.definition});for(const a of p.assets||[])assets.push(a);}
 if(cards.length<expectedCards)reviews.push({reason:'Localized metadata covers only '+cards.length+' / '+expectedCards+' expected cards; unprovided cards are not invented.'});
 const manifest={format:1,id,source:{provider:'tcgdex',set:set.id,language:lang,repository:'https://github.com/tcgdex/cards-database'},set:def,files,assets,rarities:[...rarities.values()],coverage:{source_cards:expectedCards,metadata_cards:cards.length,importable_cards:importable,battle_mapped:mapped,special_variant_reviews:reviews.filter(r=>r.printing).length,products:products.filter(p=>p.status==='verified').length,product_status:products.length?'curated':'not_available',variant_status:reviews.some(r=>r.printing)?'review_required':'source_listed',artwork_status:importable===expectedCards?'provider_listed':'incomplete'},reviews,...(error?{source_error:error}:{})};
 const raw=Buffer.from(JSON.stringify(manifest)+'\n'),compressed=gzipSync(raw,{level:9,mtime:0}),manifestFile='sets/'+id+'.json.gz';save(path.join(out,manifestFile),compressed);
 const aliases=[id,lang+'_'+slug(set.id),lang+'_'+slugName];if(lang==='en')aliases.push(slugName,slug(set.id),slugName+'_set');
 index.push({id,name:def.name,language:lang,source_set:set.id,series:local(set.serie.name,lang,local(set.serie.name,'en')),release_date:def.release_date,aliases:[...new Set(aliases)],manifest:manifestFile,sha256:hash(compressed),bytes:compressed.length,json_bytes:raw.length,...manifest.coverage});
 complete++;if(complete%25===0)console.log('Catalogs',complete,'/',tasks.length,'last:',id,'art',importable+'/'+cards.length);
 }}
await Promise.all(Array.from({length:6},worker));
index.sort((a,b)=>a.language.localeCompare(b.language)||a.id.localeCompare(b.id));
const revision=hash(JSON.stringify(index));
const wanted=new Set(index.map(e=>path.basename(e.manifest)));for(const file of fs.readdirSync(path.join(out,'sets')))if(file.endsWith('.json.gz')&&!wanted.has(file))fs.unlinkSync(path.join(out,'sets',file));
write(path.join(out,'index.json'),{format:1,revision,sets:index,scope:'Physical Pokemon TCG sets present in the pinned TCGdex snapshot; no Pocket cards. Missing art and special variants remain explicitly reported.'});
write(path.join(out,'coverage.json'),{format:1,revision,source_sets:sets.size,source_cards:sourceCards,catalogs:index.length,languages:[...new Set(index.map(s=>s.language))],source_printings:index.reduce((n,s)=>n+s.source_cards,0),importable_printings:index.reduce((n,s)=>n+s.importable_cards,0),battle_mapped:index.reduce((n,s)=>n+s.battle_mapped,0),special_variant_reviews:index.reduce((n,s)=>n+s.special_variant_reviews,0),catalog_bytes:index.reduce((n,s)=>n+s.bytes,0),parse_issues:errors});
console.log(JSON.stringify({catalogs:index.length,revision,coverage:path.join(out,'coverage.json')}));
if(args['export-profiles'])save(args['export-profiles'],gzipSync(JSON.stringify(exportedProfiles),{level:9,mtime:0}));
