"""One-time transport of already reviewed packaging assets into a clean checkout.

The ordinary build reuses the committed, checksummed files afterwards. Bootstrap
parts are temporary Git objects, not a runtime artwork host or a second library.
"""
from pathlib import Path
import os,json,hashlib,urllib.request,time,tempfile,zipfile,re,stat
root=Path('sources/packaging-bootstrap.json');out=Path('artwork')
if not root.exists():
    print('No packaging bootstrap requested');raise SystemExit(0)
doc=json.loads(root.read_text('utf8'));index=out/'index.json'
if index.exists()and hashlib.sha256(index.read_bytes()).hexdigest()==doc['index_sha256']:
    print('Reviewed packaging assets already present');raise SystemExit(0)
repo=doc['repository']
if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo):raise ValueError('Invalid bootstrap repository')
if doc['archive_bytes']>1024*1048576 or not 1<=len(doc['parts'])<=256:raise ValueError('Oversized packaging bootstrap')
headers={'User-Agent':'StellarTCG-PackagingPublication/1.0','Accept':'application/vnd.github.raw+json'}
if os.environ.get('GITHUB_TOKEN'):headers['Authorization']='Bearer '+os.environ['GITHUB_TOKEN']
with tempfile.TemporaryDirectory(prefix='stellartcg-packaging-')as temp:
    archive=Path(temp)/'panels.zip';total=0;whole=hashlib.sha256()
    with archive.open('wb')as stream:
        for i,p in enumerate(doc['parts']):
            if not re.fullmatch('[a-f0-9]{40}',p['git_blob'])or not 0<p['bytes']<=8*1048576:raise ValueError('Invalid bootstrap part')
            url='https://api.github.com/repos/'+repo+'/git/blobs/'+p['git_blob'];error=None
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=90)as response:data=response.read(p['bytes']+1)
                    if len(data)!=p['bytes']or hashlib.sha256(data).hexdigest()!=p['sha256']:raise ValueError('Bootstrap part checksum mismatch')
                    error=None;break
                except Exception as exc:error=exc;time.sleep(min(16,2**attempt))
            if error:raise error
            stream.write(data);whole.update(data);total+=len(data)
            if(i+1)%8==0:print('Verified packaging transfer',i+1,'/',len(doc['parts']),flush=True)
    if total!=doc['archive_bytes']or whole.hexdigest()!=doc['archive_sha256']:raise ValueError('Packaging archive checksum mismatch')
    if out.is_symlink():raise ValueError('Packaging output cannot be a symbolic link')
    out.mkdir(exist_ok=True);target_root=out.resolve();seen=set();decoded=0
    with zipfile.ZipFile(archive)as z:
        for info in z.infolist():
            name=info.filename
            if name in seen or not(name=='index.json'or re.fullmatch(r'(products|cards)/[a-f0-9]{2}/[a-f0-9]{24}\.webp(?:\.json)?',name))or stat.S_ISLNK(info.external_attr>>16):raise ValueError('Unsafe packaging archive entry')
            seen.add(name);decoded+=info.file_size
            if decoded>1024*1048576:raise ValueError('Packaging archive exceeds decoded size budget')
            target=out/name
            if not target.resolve().is_relative_to(target_root):raise ValueError('Packaging archive path escapes output')
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(info))
    if hashlib.sha256(index.read_bytes()).hexdigest()!=doc['index_sha256']:raise ValueError('Restored packaging index checksum mismatch')
print('Installed reviewed packaging assets; normal recipe/output checks run next')
