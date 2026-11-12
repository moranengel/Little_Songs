#!/usr/bin/env python3
"""Pin each page to matching JS/CSS bytes even under an older service worker."""
import hashlib
import json
import re
from pathlib import Path
root = Path(__file__).resolve().parents[1]
assets = root / 'assets'
assets.mkdir(exist_ok=True)
replacements = {}
for name in ['style.css', 'backup.js', 'app.js']:
    content = (root / name).read_bytes()
    digest = hashlib.sha256(content).hexdigest()[:12]
    path = f'assets/{Path(name).stem}-{digest}{Path(name).suffix}'
    (root / path).write_bytes(content)
    replacements[name] = path
html = (root / 'index.html').read_text()
for name,path in replacements.items():
    stem = re.escape(Path(name).stem)
    ext = re.escape(Path(name).suffix)
    html = re.sub(r'\./(?:assets/'+stem+r'-[a-f0-9]+|'+stem+r')'+ext, './'+path, html)
(root / 'index.html').write_text(html)
sw = (root / 'sw.js').read_text()
shell = ['./', './index.html', *['./'+p for p in replacements.values()], './manifest.webmanifest', './songs.json', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png']
sw = re.sub(r'const SHELL = .*?;', 'const SHELL = '+json.dumps(shell,separators=(',',':'))+';', sw, count=1)
(root / 'sw.js').write_text(sw)
# Keep older content-addressed files for already-open pages until a later cleanup.
print('Pinned JS/CSS assets:', ', '.join(replacements.values()))
