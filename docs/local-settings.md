# Local settings

Run `npm run dev` (development) or `npm run build` followed by `npm run preview`.
The local server automatically creates `data/user-settings.json` the first time
the visualizer opens. Favorites are saved there, independent of browser,
hostname, or port. The file is gitignored; copy it to back up your preferences.
On a plain static host, favorites use browser storage instead and belong to that
browser profile and site address.

When you open an address that still has the old browser favorites, the app
merges them into the project file once. It retains the old browser entry as a
recovery copy and marks the import, so removing a favorite stays removed.
To recover older browser favorites, open the same site address and browser
profile while the updated app is running there.

Save failures appear onscreen even when the controls are hidden. A damaged settings file is
preserved for recovery rather than replaced with an empty list. Settings contain
only a schema version and favorite mode IDs; audio files remain separate.
