"""Restore the small curated metadata source bundle in an Actions checkout."""
from pathlib import Path
import gzip,json,hashlib
root=Path('sources');packed=(root/'product-metadata.json.gz').read_bytes()
expected=(root/'product-metadata.sha256').read_text('ascii').strip()
if len(packed)>16*1048576 or hashlib.sha256(packed).hexdigest()!=expected:raise ValueError('Product metadata bundle checksum/size mismatch')
with gzip.GzipFile(fileobj=__import__('io').BytesIO(packed))as stream:data=stream.read(32*1048576+1)
if len(data)>32*1048576:raise ValueError('Product metadata bundle exceeds decoded limit')
docs=json.loads(data);allowed={'product-artwork.json','product-artwork-catalog.json','product-definitions.json'}
if set(docs)!=allowed:raise ValueError('Unexpected product metadata source file')
for name,doc in docs.items():(root/name).write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('Restored',len(docs),'curated product metadata files')
