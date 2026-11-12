#!/usr/bin/env python3
"""Run from the extracted site folder: python3 tools/build-catalog.py.
Keeps existing IDs/titles/icons for known files; adds new files from songs/.
"""
from pathlib import Path
import hashlib, json
root = Path(__file__).resolve().parent.parent
catalog = root / 'songs.json'
previous = json.loads(catalog.read_text(encoding='utf-8')) if catalog.exists() else {'songs': []}
known = {item['file']: item for item in previous['songs']}
icons = ['🐻','🐰','🐸','🐳','🦁','🦋','🐥','🐼']
items = []
for path in sorted((root / 'songs').iterdir()):
    if path.suffix.lower() not in {'.mp3','.m4a','.aac','.wav','.aif','.aiff','.flac','.caf','.ogg','.mp4'}: continue
    relative = path.relative_to(root).as_posix()
    item = known.get(relative, {'id': hashlib.sha256(relative.encode()).hexdigest()[:16], 'title': path.stem, 'icon': icons[len(items) % len(icons)], 'file': relative})
    items.append(item)
catalog.write_text(json.dumps({'version': 1, 'songs': items}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(f'Updated songs.json: {len(items)} songs')
