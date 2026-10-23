"""Rebuild reviewed packaging panels from immutable sources.

Runs locally and in Actions. Recipes distinguish photographed panels, supplied
flat panels, and companion artwork. Source checksums prevent a retailer changing
an image under the same URL from silently changing a published texture.
"""
from pathlib import Path
from io import BytesIO
import argparse, base64, concurrent.futures, hashlib, json, urllib.request, time, gzip
from PIL import Image, ImageOps

def digest(data):return hashlib.sha256(data).hexdigest()
def projective(quad,size):
    rows=[]
    for (x,y),(u,v)in zip([(0,0),(size[0]-1,0),(size[0]-1,size[1]-1),(0,size[1]-1)],quad):
        rows.extend([[x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]])
    for col in range(8):
        pivot=max(range(col,8),key=lambda j:abs(rows[j][col]));rows[col],rows[pivot]=rows[pivot],rows[col]
        if abs(rows[col][col])<1e-10:raise ValueError('Degenerate packaging face quad')
        div=rows[col][col];rows[col]=[v/div for v in rows[col]]
        for j in range(8):
            if j!=col:
                k=rows[j][col];rows[j]=[v-k*w for v,w in zip(rows[j],rows[col])]
    return tuple(row[-1]for row in rows)
def foreground(image):
    import numpy as np, cv2
    cv2.setNumThreads(1)
    image=image.convert('RGBA');image.thumbnail((1600,1600),Image.Resampling.LANCZOS);arr=np.array(image);alpha=arr[:,:,3]
    if (alpha<20).mean()>.02:mask=np.uint8(alpha>20)*255
    else:
        candidate=np.uint8(np.min(arr[:,:,:3],axis=2)<242)*255;ys,xs=np.where(candidate>0)
        if len(xs)<10:return image
        hull=cv2.convexHull(np.column_stack([xs,ys]).astype(np.int32));mask=np.zeros(candidate.shape,np.uint8);cv2.fillConvexPoly(mask,hull,255)
    arr[:,:,3]=np.minimum(alpha,mask);im=Image.fromarray(arr);box=im.getbbox();return im.crop(box)if box else im
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--recipes',default='sources/product-artwork.json');ap.add_argument('--output',default='artwork');ap.add_argument('--cache',default='.catalog-work/product-sources');ap.add_argument('--workers',type=int,default=4);a=ap.parse_args()
    source=Path(a.recipes);doc=json.loads(source.read_text('utf8'));out=Path(a.output);cache=Path(a.cache);cache.mkdir(parents=True,exist_ok=True)
    embedded={}
    if doc.get('embedded_bundle'):
        bundle=doc['embedded_bundle'];packed=(source.parent/bundle['file']).read_bytes()if bundle.get('file')else base64.b64decode(''.join((source.parent/p).read_text('ascii').strip()for p in bundle['files']),validate=True)
        if digest(packed)!=bundle['sha256']:raise ValueError('Supplied image bundle checksum mismatch')
        embedded=json.loads(gzip.decompress(packed))
    def one(pair):
        key,r=pair;target=out/r['path'];receipt=target.with_suffix(target.suffix+'.json')
        recipe_sha=digest(json.dumps(r,sort_keys=True,separators=(',',':')).encode())
        if target.exists()and receipt.exists():
            old=json.loads(receipt.read_text('utf8'))
            if old.get('recipe_sha256')==recipe_sha and old.get('sha256')==digest(target.read_bytes()):return key,old
        upstream=r['source'];expected=upstream['sha256'];stored=cache/expected
        if stored.exists()and digest(stored.read_bytes())==expected:data=stored.read_bytes()
        elif upstream.get('embedded'):
            data=base64.b64decode(embedded[upstream['sha256']],validate=True)
        else:
            error=None
            for attempt in range(5):
                try:
                    with urllib.request.urlopen(urllib.request.Request(upstream['url'],headers={'User-Agent':'StellarTCG-ProductArtwork/1.0'}),timeout=60)as response:data=response.read(24*1048576+1)
                    if len(data)>24*1048576:raise ValueError('Source image exceeds 24 MiB')
                    if digest(data)!=expected:raise ValueError('Source photograph checksum mismatch: '+key)
                    error=None;break
                except Exception as exc:error=exc;time.sleep(min(16,2**attempt))
            if error:raise error
        if digest(data)!=expected:raise ValueError('Source photograph changed: '+key)
        stored.write_bytes(data)
        image=Image.open(BytesIO(data)).convert('RGBA');original=image.size
        if r.get('source_crop'):image=image.crop(tuple(r['source_crop']))
        if r.get('companion'):
            import numpy as np
            ident=r['companion']['set'];face=r['companion']['face'];image=image.convert('RGB')
            if ident not in ['151_set','obsidian_flames_set','paldea_evolved_set','paradox_rift_set','scarlet_violet_set']:
                hsv=np.array(image.convert('HSV'));shift=int(hashlib.sha256(ident.encode()).hexdigest()[:2],16)//4
                if ident not in ['white_flare_set','black_bolt_set','pitch_black_set']:hsv[:,:,0]=(hsv[:,:,0].astype(np.uint16)+shift)%256
                if ident=='white_flare_set':hsv[:,:,1]=(hsv[:,:,1]*.12).astype(np.uint8);hsv[:,:,2]=np.maximum(hsv[:,:,2],205)
                if ident in ['black_bolt_set','pitch_black_set']:hsv[:,:,2]=(hsv[:,:,2]*.38).astype(np.uint8)
                image=Image.fromarray(hsv,mode='HSV').convert('RGB')
            if face=='right':image=ImageOps.mirror(image)
            if face in ['top','bottom']:image=image.transpose(Image.Transpose.ROTATE_90)
        if r.get('foreground'):image=foreground(image)
        if r.get('quad'):
            q=r['quad'];target_size=list(r['size'])
            import math
            available_w=(math.dist(q[0],q[1])+math.dist(q[3],q[2]))/2;available_h=(math.dist(q[0],q[3])+math.dist(q[1],q[2]))/2
            factor=min(1,available_w/target_size[0],available_h/target_size[1]);target_size=[max(2,round(n*factor))for n in target_size]
            image=image.transform(tuple(target_size),Image.Transform.PERSPECTIVE,projective(q,target_size),resample=Image.Resampling.BICUBIC)
        elif r.get('crop'):image=image.crop(tuple(r['crop']))
        if r.get('max_dimension'):image.thumbnail((r['max_dimension'],r['max_dimension']),Image.Resampling.LANCZOS)
        if r.get('operation')=='rotate':image=image.rotate(r['degrees'],expand=True)
        target.parent.mkdir(parents=True,exist_ok=True);buffer=BytesIO()
        # Match the mod's approved WebP 95 profile for photographic packaging.
        # Preserve the owner's exact flat panels and included card scans losslessly.
        lossless=r.get('encoding','lossless')=='lossless'
        image.save(buffer,'WEBP',lossless=lossless,quality=95,method=6,exact=True);output=buffer.getvalue();target.write_bytes(output)
        item={'path':r['path'],'sha256':digest(output),'bytes':len(output),'width':image.width,'height':image.height,'recipe_sha256':recipe_sha,'provenance':r['provenance'],'source':upstream.get('url','user-supplied')}
        receipt.write_text(json.dumps(item,separators=(',',':'))+'\n',encoding='utf8');return key,item
    results={}
    with concurrent.futures.ThreadPoolExecutor(max(1,min(8,a.workers)))as pool:
        for i,(key,item)in enumerate(pool.map(one,doc['textures'].items()),1):
            results[key]=item
            if i%50==0:print('Packaging textures',i,'/',len(doc['textures']),flush=True)
    out.mkdir(exist_ok=True);(out/'index.json').write_text(json.dumps({'format':1,'textures':results},separators=(',',':'))+'\n',encoding='utf8')
    # Only compiler-owned, unreferenced outputs are removed. Originals and source
    # bundles live elsewhere; no server content/cache is involved in this job.
    wanted={r['path']for r in results.values()}
    import re
    for branch in ['products','cards']:
        folder=out/branch
        if not folder.exists():continue
        for old in folder.rglob('*'):
            if not old.is_file()or old.is_symlink():continue
            relative=old.relative_to(out).as_posix();base=relative[:-5]if relative.endswith('.webp.json')else relative
            if re.fullmatch(r'(products|cards)/[a-f0-9]{2}/[a-f0-9]{24}\.webp',base)and base not in wanted:
                if not old.resolve().is_relative_to(out.resolve()):raise ValueError('Unsafe generated asset path')
                old.unlink()
    print(json.dumps({'textures':len(results),'bytes':sum(x['bytes']for x in results.values())}),flush=True)
if __name__=='__main__':main()
