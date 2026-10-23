"""Restore small checked-in profile metadata fragments; no private keys or executable code."""
from pathlib import Path
import base64, gzip, json
root=Path(__file__).resolve().parents[1]
parts=sorted((root/'sources').glob('battle-profiles.*.b64'))
if not parts:raise SystemExit('Pinned battle profile fragments are missing')
data=base64.b64decode(''.join(p.read_text(encoding='ascii').strip() for p in parts),validate=True)
document=json.loads(gzip.decompress(data))
if not isinstance(document,dict):raise SystemExit('Invalid pinned battle profile data')
(root/'sources/battle-profiles.json.gz').write_bytes(data)
print('Restored',len(document),'printing-aware battle mappings')
