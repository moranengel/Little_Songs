# Little Songs testing environment

This branch is the testing version requested by Moran. New upgrades belong here first.

- Production is moranengel/Little_Songs, main branch. Do not change production or merge into it without explicit user approval of the tested upgrade.
- Intended testing repository: moranengel/Little_Songs_Test. The testing website must use its own IndexedDB database little-songs-test-v1 and its own service-worker cache prefix little-songs-test-shell:.
- Keep the visible testing label and testing PWA manifest name in this environment.
- Never publish personal audio or backup files to either repository without explicit authorization. User imports and backups remain local.
- After JS/CSS changes run python3 tools/version-assets.py, and include the generated assets, index.html, and sw.js in the update.
- Run node tests/backup.test.cjs, node tests/assets.test.cjs and node tests/staging.test.cjs before updating this environment.
- When promoting an approved feature, preserve production's DB name, cache prefix, PWA identity and existing user data. Copy the approved source changes and regenerate production assets; do not blindly replace production with this testing tree.
