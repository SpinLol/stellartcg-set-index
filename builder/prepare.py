"""Fetch a pinned public metadata snapshot. No artwork is downloaded."""
import argparse, hashlib, json, pathlib, urllib.request, zipfile

def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
    a.output.mkdir(parents=True,exist_ok=True)
    if (a.output/'source.json').is_file() and (a.output/'tcgdex/interfaces.d.ts').is_file():
        print((a.output/'source.json').read_text(encoding='utf8'),flush=True);return
    headers={'User-Agent':'StellarTCG-SetCatalog/1.0','Accept':'application/vnd.github+json'}
    def fetch(url):
        with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=120) as response:return response.read()
    revision=json.loads(fetch('https://api.github.com/repos/tcgdex/cards-database/commits/master'))['sha']
    archive=a.output/'tcgdex.zip';source=a.output/'tcgdex'
    if not (source/'interfaces.d.ts').exists():
        archive.write_bytes(fetch('https://codeload.github.com/tcgdex/cards-database/zip/'+revision))
        with zipfile.ZipFile(archive) as z:
            for item in z.infolist():
                parts=pathlib.PurePosixPath(item.filename).parts[1:]
                if not parts or parts[0] not in ('data','data-asia','interfaces.d.ts','LICENSE','meta'):continue
                target=source.joinpath(*parts)
                if not target.resolve().is_relative_to(source.resolve()):raise ValueError('Unsafe source archive')
                if item.is_dir():target.mkdir(parents=True,exist_ok=True)
                else:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(item))
    info={'repository':'https://github.com/tcgdex/cards-database','revision':revision,'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
    (a.output/'source.json').write_text(json.dumps(info,indent=2)+'\n',encoding='utf8')
    print(json.dumps(info),flush=True)
if __name__=='__main__':main()
