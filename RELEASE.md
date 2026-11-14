# 2026.11.14.1

Promoted the user-approved testing release 2026.11.14.18-test (213b8cda827496bda2721f715a33aa3c6296398a). Production parent: a5a079896cbe7436decf16c005b49893deb8091c.

Includes playlists, editing and multi-select, fixed dialog headers, metadata-only edits/deletion/undo/reordering, byte-backed audio, validation, portable backups and audio-only repair. Original player layout retained; sleep timer, personal images and playback-position resume are excluded.

Production DB name/version, cache namespace and PWA id/start URL/scope/name are preserved. No user data is copied from testing or migrated on startup. Legacy audio remains readable; new imports/restores store verified bytes. Existing production repository songs/catalog and historical versioned assets remain. New rainbow-note icons are included.

Rollback to the prior app code cannot play newly byte-backed audio records. Prefer a forward fix with the current storage reader; preserve user data and validated portable archives.

Validation: all 12 Node suites passed, including production identity, portable archives, byte storage, metadata-only deletion/undo and playback. Local browser migration QA seeded an isolated database with two legacy audio records and an existing confirmed backup revision; the release booted with both original titles/icons/audio and backup state intact, did not migrate the records automatically, played a legacy song and showed the new production version/offline-ready status. QA files and generated audio are excluded from the repository.

Update behavior: checkUpdate runs on app startup. The service worker prepares new resources in the background, but no code forces a reload during playback/editing. Users can use Settings → Check Update → Load Update in this release. The pre-release production app has no update button; a new online navigation/refresh is needed for this first upgrade. Testing data is not copied into production; importing a testing backup is a separate user action.
