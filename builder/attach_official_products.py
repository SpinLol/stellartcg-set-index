"""Attach pinned, documented retail releases without changing existing products.

This runs both locally and in GitHub Actions. Photos are checksum-pinned and
published to this repository, so set downloads use the existing GitHub artwork
host. Unphotographed sides are explicitly companion art, never retail scans.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import argparse,copy,gzip,hashlib,json,math,urllib.request,urllib.parse,time,re
from PIL import Image,ImageOps

def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path):return json.loads(path.read_text(encoding='utf8'))
def write(path,data):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
def canonical(value):return value.removeprefix('stellartcg:')
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--catalog',type=Path,default=Path('catalog'));ap.add_argument('--source',type=Path,default=Path('sources/official-products.json.gz'));ap.add_argument('--artwork',type=Path,default=Path('artwork'));ap.add_argument('--cache',type=Path,default=Path('.catalog-work/official-product-photos'));ap.add_argument('--workers',type=int,default=4);a=ap.parse_args()
    if not a.source.exists():print('No pinned official-product extension configured');return
    packed=a.source.read_bytes();expected=a.source.with_name('official-products.sha256').read_text(encoding='ascii').strip()
    if len(packed)>16*1024*1024 or sha(packed)!=expected:raise ValueError('Official product source checksum mismatch')
    with gzip.GzipFile(fileobj=BytesIO(packed))as stream:raw=stream.read(32*1024*1024+1)
    if len(raw)>32*1024*1024:raise ValueError('Official product source exceeds decoded budget')
    doc=json.loads(raw);index=read(a.catalog/'index.json');entries={e['id']:e for e in index['sets']};a.cache.mkdir(parents=True,exist_ok=True)
    if doc.get('format')!=1:raise ValueError('Unsupported official product source')
    faces=['front','back','left','right','top','bottom'];image_records={};receipt_path=a.artwork/'official/index.json';receipts=read(receipt_path)if receipt_path.exists()else{}
    photos={p['photo']:p['source_image_sha256']for p in doc['products']}
    def render(item):
        url,digest=item;uri=urllib.parse.urlsplit(url)
        if uri.scheme!='https'or not uri.hostname or uri.username or not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Unsafe photograph source')
        previous=receipts.get(url,{})
        if previous.get('source_sha256')==digest and previous.get('encoder')=='webp95-v1':
            records=previous.get('faces',{})
            if set(records)=={'icon','front','back','left','right','top','bottom'}and all((a.artwork/p['path']).is_file()and sha((a.artwork/p['path']).read_bytes())==p['sha256']for p in records.values()):return url,records
        stored=a.cache/sha(url.encode());data=stored.read_bytes()if stored.exists()else None
        if data is None or sha(data)!=digest:
            last=None
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'StellarTCG-VerifiedProductCatalog/1.0'}),timeout=45)as response:data=response.read(16*1024*1024+1)
                    if len(data)>16*1024*1024 or sha(data)!=digest:raise ValueError('Official product photograph changed: '+url)
                    stored.write_bytes(data);last=None;break
                except Exception as ex:last=ex;time.sleep(min(8,attempt*2))
            if last:raise last
        with Image.open(BytesIO(data))as source:
            if source.width*source.height>40_000_000:raise ValueError('Product photograph too large')
            image=source.convert('RGBA')
        # Crop only a uniform photographic margin; do not infer unseen faces or
        # replace a photograph's content. Texture fitting handles aspect ratio.
        if image.getextrema()[3][0]<240:
            bounds=image.getbbox()
            if bounds:image=image.crop(bounds)
        else:
            from PIL import ImageChops
            rgb=image.convert('RGB');border=Image.new('RGB',image.size,rgb.getpixel((0,0)));diff=ImageChops.difference(rgb,border).convert('L').point(lambda v:255 if v>22 else 0);bounds=diff.getbbox()
            if bounds and bounds[2]-bounds[0]>40 and bounds[3]-bounds[1]>40:image=image.crop(bounds)
        image.thumbnail((512,512),Image.Resampling.LANCZOS)
        result={}
        # Front/icon is the real product photograph. Matching side/back/top
        # companions reuse that artwork, with their provenance visible in the
        # product report. They are not advertised as authentic retail panels.
        for side in ['icon','front','back','left','right','top','bottom']:
            frame=image
            if side in ['left','right']:
                # A small continuous strip avoids tiny repeated product photos
                # down narrow box walls. This is explicit companion artwork.
                width=max(1,image.width//5);left=0 if side=='left'else image.width-width;frame=image.crop((left,0,left+width,image.height))
            elif side in ['top','bottom']:
                height=max(1,image.height//5);top=0 if side=='top'else image.height-height;frame=image.crop((0,top,image.width,top+height))
            elif side=='back':frame=ImageOps.mirror(image)
            out=BytesIO();frame.save(out,'WEBP',quality=95,method=6,exact=True);encoded=out.getvalue();digest_out=sha(encoded);relative='official/'+digest_out[:2]+'/'+digest_out+'.webp';target=a.artwork/relative
            target.parent.mkdir(parents=True,exist_ok=True)
            if not target.exists()or sha(target.read_bytes())!=digest_out:target.write_bytes(encoded)
            result[side]={'path':relative,'sha256':digest_out,'bytes':len(encoded),'width':frame.width,'height':frame.height,'provenance':'product_photograph'if side in ['icon','front']else'companion','url':'https://raw.githubusercontent.com/SpinLol/stellartcg-set-index/main/artwork/'+relative}
        return url,result
    with ThreadPoolExecutor(max(1,min(6,a.workers)))as pool:
        for i,(url,record)in enumerate(pool.map(render,photos.items()),1):
            image_records[url]=record
            if i%50==0:print('Verified official packaging',i,'/',len(photos),flush=True)
    write(receipt_path,{url:{'source_sha256':photos[url],'encoder':'webp95-v1','faces':record}for url,record in image_records.items()})
    by_set={};supplemental={}
    for p in doc['products']:by_set.setdefault(p['set'],[]).append(p)
    for c in doc['supplemental_cards']:supplemental.setdefault(c['set'],[]).append(c)
    new_total=0;report=[]
    for owner,products in by_set.items():
        e=entries.get(owner)
        if e is None:raise ValueError('Product references unpublished set '+owner)
        file=a.catalog/e['manifest'];manifest=json.loads(gzip.decompress(file.read_bytes()));files={f['path']:f for f in manifest['files']};assets={p['path']:p for p in manifest['assets']};old_cards=len([f for f in files if f.startswith('cards/')]);existing_cards={canonical(owner+'/'+f['json']['id']):f['json']for f in files.values()if f['path'].startswith('cards/')}
        old_products={canonical(f['json']['id']):f['json']for f in files.values()if f['path'].startswith('products/')};public=[]
        for printing in supplemental.get(owner,[]):
            c=copy.deepcopy(printing['definition']);path='cards/'+c['id']+'.json'
            if path in files:
                if files[path]['json']!=c:raise ValueError('Supplemental printing identity collision '+owner+'/'+c['id'])
            else:files[path]={'path':path,'json':c}
            asset=printing['asset'];assets[asset['path']]=asset
            existing_cards[owner+'/'+c['id']]=c
            if c['rarity']not in {r['id']for r in manifest['rarities']}:manifest['rarities'].append({'id':c['rarity'],'name':c.get('metadata',{}).get('source_rarity',c['rarity']),'weight':1,'color':'#E9CC8D','sort_priority':50,'announce':False,'base_value':0})
        for product in products:
            d=copy.deepcopy(product['definition']);pid=canonical(d['id']);path='products/official_'+sha(pid.encode())[:24]+'.json'
            if product.get('status')!='verified'or d.get('metadata',{}).get('official_product')!='true':raise ValueError('Unverified retail product')
            if not pid.startswith(owner+'/'):raise ValueError('Product identity escapes set')
            if pid in old_products and old_products[pid].get('metadata',{}).get('official_product')!='true':raise ValueError('Existing admin/source product would be replaced')
            art=image_records[product['photo']];d['texture']='textures/official_'+art['icon']['sha256']+'.webp';assets['products/'+d['texture']]={'path':'products/'+d['texture'],'url':art['icon']['url'],'sha256':art['icon']['sha256']};d['model']['textures']={}
            for side in faces:
                record=art[side];logical='textures/official_'+record['sha256']+'.webp';d['model']['textures'][side]=logical;assets['products/'+logical]={'path':'products/'+logical,'url':record['url'],'sha256':record['sha256']}
            d['metadata']['catalog_packaging_faces']=json.dumps({side:art[side]['provenance']for side in faces},separators=(',',':'));d['metadata']['catalog_source_image_sha256']=product['source_image_sha256']
            files[path]={'path':path,'json':d};old_products[pid]=d
            public.append({'id':pid,'name':d['name'],'type':d['type'],'source':product['source'],'photo':product['photo'],'source_image_sha256':product['source_image_sha256'],'pack_count':d.get('metadata',{}).get('catalog_pack_count'),'deck_cards':d.get('metadata',{}).get('catalog_deck_cards'),'faces':{side:art[side]['provenance']for side in faces}})
            new_total+=1
        # Validate each full set before touching its published manifest. Nothing
        # depends on another set being installed, and no cosmetics are invented.
        for pid,p in old_products.items():
            for content in p.get('contents',[]):
                if content.get('product')and canonical(content['product'])not in old_products:raise ValueError('Unresolved contained product '+pid+' -> '+content['product'])
                if content.get('card'):
                    c=existing_cards.get(canonical(content['card']))
                    if c is None or content.get('variant','normal')not in c['variants']:raise ValueError('Unresolved printing/variant '+pid+' -> '+content['card'])
                if content.get('type')in ['cosmetic','club_item']:raise ValueError('Product requires a server-specific cosmetic')
                if not 1<=int(content.get('amount',1))<=4096:raise ValueError('Invalid product quantity')
            expected_count=p.get('metadata',{}).get('catalog_deck_cards')
            if expected_count and sum(c.get('amount',1)for c in p.get('contents',[])if c.get('card'))!=int(expected_count):raise ValueError('Retail deck card count mismatch')
        manifest['files']=list(files.values());manifest['assets']=list(assets.values());now_cards=len([p for p in files if p.startswith('cards/')]);added_cards=now_cards-old_cards
        coverage=manifest['coverage'];coverage['source_cards']+=added_cards;coverage['importable_cards']=now_cards;coverage['supplemental_cards']=coverage.get('supplemental_cards',0)+added_cards;coverage['products']=len(old_products);coverage['product_status']='curated_with_reviews'if manifest['reviews']else'curated';coverage['official_product_extension']=len(products)
        manifest['reviews']=[r for r in manifest['reviews']if not r.get('official_product_extension')]
        for printing in supplemental.get(owner,[]):
            c=printing['definition']
            if 'source_scan'in c['variants']:manifest['reviews'].append({'official_product_extension':True,'card':c['number'],'reason':'The exact supplied source scan is retained; its special finish remains unclassified.','printing':{'type':'unclassified'},'source_card_id':c['metadata']['source_card_id']})
        manifest['reviews'].append({'official_product_extension':True,'reason':'Real photographed retail products with checked contents. Side/back/top textures are labelled companion artwork; physical non-card accessories and code redemption are not simulated.','report':'products/official_'+owner+'.json'})
        decoded=(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n').encode();compressed=gzip.compress(decoded,compresslevel=9,mtime=0);file.write_bytes(compressed)
        e.update(coverage);e.update({'sha256':sha(compressed),'bytes':len(compressed),'json_bytes':len(decoded)})
        write(a.catalog/'products'/('official_'+owner+'.json'),{'format':1,'set':owner,'products':public});report.append({'set':owner,'name':e['name'],'language':e['language'],'added_products':len(products),'total_products':len(old_products),'supplemental_cards':added_cards})
    index['revision']=sha(json.dumps(index['sets'],ensure_ascii=False,separators=(',',':')).encode());write(a.catalog/'index.json',index)
    coverage=read(a.catalog/'coverage.json');coverage.update({'revision':index['revision'],'products':sum(e.get('products',0)for e in index['sets']),'official_product_extension':new_total,'catalog_bytes':sum(e['bytes']for e in index['sets']),'importable_printings':sum(e['importable_cards']for e in index['sets']),'source_printings':sum(e['source_cards']for e in index['sets'])});write(a.catalog/'coverage.json',coverage)
    legacy_report=a.catalog/'product-coverage.json'
    if legacy_report.exists():
        legacy=read(legacy_report);legacy['official_product_extension']=new_total;legacy['total_installable_templates']=coverage['products'];legacy['total_source_sets']=sum(e.get('products',0)>0 for e in index['sets']);write(legacy_report,legacy)
    write(a.catalog/'official-product-coverage.json',{'format':1,'policy':doc['policy'],'added_products':new_total,'sets':len(report),'total_catalog_products':coverage['products'],'catalog_sets_with_products':sum(e.get('products',0)>0 for e in index['sets']),'photographs':len(image_records),'source_sha256':expected,'set_coverage':report})
    print(json.dumps({'added_products':new_total,'sets':len(report),'total_products':coverage['products'],'sets_with_products':sum(e.get('products',0)>0 for e in index['sets'])}),flush=True)
if __name__=='__main__':main()
