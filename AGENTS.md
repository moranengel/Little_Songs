# Little Songs production

This repository is the production site moranengel/Little_Songs. Publish only after explicit user approval of a tested release. New work belongs first in moranengel/Little_Songs_Tests.

Preserve IndexedDB little-songs-web-v1 version 1, the little-songs-shell: cache prefix, and the production PWA identity. Never copy testing storage identifiers into production or automatically clear user data. Never publish personal audio/backups without explicit authorization.

Run python3 tools/version-assets.py after JS/CSS changes, then all tests/*.test.cjs. Include matching generated assets, index.html and sw.js. Preserve historical assets for old open pages.

Byte-backed audio and metadata overlays are part of the current storage format. Keep them readable in follow-up fixes. Startup must not rewrite legacy audio automatically.
