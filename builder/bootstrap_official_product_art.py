"""One-time checksum-verified transfer of reviewed packaging into GitHub.

The Git blobs are transport only. The publication commits individual immutable
WebP assets; ordinary refreshes reuse those files without visiting photo hosts.
"""
from pathlib import Path
import hashlib,json,os,re,stat,tempfile,time,urllib.request,zipfile

request=Path('sources/official-product-art-bootstrap.json')
out=Path('artwork/official')
if not request.exists():
    print('No official packaging bootstrap requested');raise SystemExit(0)
doc=json.loads(request.read_text('utf8'))
if doc.get('format')!=1 or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',doc['repository']):raise ValueError('Invalid packaging transport')
if not 0<doc['archive_bytes']<=128*1048576 or not 1<=len(doc['parts'])<=32:raise ValueError('Oversized packaging transport')
headers={'User-Agent':'StellarTCG-PackagingPublication/1.0','Accept':'application/vnd.github.raw+json'}
if os.environ.get('GITHUB_TOKEN'):headers['Authorization']='Bearer '+os.environ['GITHUB_TOKEN']
with tempfile.TemporaryDirectory(prefix='stellartcg-official-')as temp:
    archive=Path(temp)/'panels.zip';whole=hashlib.sha256();total=0
    with archive.open('wb')as stream:
        for number,p in enumerate(doc['parts'],1):
            if not re.fullmatch('[a-f0-9]{40}',p['git_blob'])or not 0<p['bytes']<=8*1048576:raise ValueError('Invalid transport part')
            url='https://api.github.com/repos/'+doc['repository']+'/git/blobs/'+p['git_blob'];error=None
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=90)as response:data=response.read(p['bytes']+1)
                    if len(data)!=p['bytes']or hashlib.sha256(data).hexdigest()!=p['sha256']:raise ValueError('Transport part checksum mismatch')
                    error=None;break
                except Exception as exc:error=exc;time.sleep(min(8,2**attempt))
            if error:raise error
            stream.write(data);whole.update(data);total+=len(data)
            print('Verified packaging transfer',number,'/',len(doc['parts']),flush=True)
    if total!=doc['archive_bytes']or whole.hexdigest()!=doc['archive_sha256']:raise ValueError('Packaging archive checksum mismatch')
    if out.is_symlink():raise ValueError('Symbolic packaging directory')
    out.mkdir(parents=True,exist_ok=True);root=out.resolve();seen=set();decoded=0
    with zipfile.ZipFile(archive)as z:
        if len(z.infolist())>10000:raise ValueError('Too many packaging entries')
        for info in z.infolist():
            name=info.filename
            if name in seen or not(name=='index.json'or re.fullmatch(r'[a-f0-9]{2}/[a-f0-9]{64}\.webp',name))or stat.S_ISLNK(info.external_attr>>16):raise ValueError('Unsafe packaging path')
            seen.add(name);decoded+=info.file_size
            if decoded>128*1048576:raise ValueError('Packaging decoded budget exceeded')
            target=out/name
            if not target.resolve().is_relative_to(root):raise ValueError('Packaging path escapes output')
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(info))
    if hashlib.sha256((out/'index.json').read_bytes()).hexdigest()!=doc['index_sha256']:raise ValueError('Packaging index checksum mismatch')
print('Reviewed packaging restored; per-face checks and catalog validation run next')
