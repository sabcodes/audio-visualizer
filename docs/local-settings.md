# Local settings

Run `npm run dev` (development) or `npm run build` followed by `npm run preview`.
The local server automatically creates `data/user-settings.json` the first time
the visualizer opens. Favorites are saved there, independent of browser,
hostname, or port. The file is gitignored; copy it to back up your preferences.
The built static files need this local server to save favorites.

When you open an address that still has the old browser favorites, the app
merges them into the project file once. It retains the old browser entry as a
recovery copy and marks the import, so removing a favorite stays removed.
If you forgot the address, search Chrome history (Command-Y) for `localhost`
or `127.0.0.1`, then open the old address while the updated server is running
on that port. Use the same Chrome profile that originally saved the favorites.

Save failures appear onscreen even when the controls are hidden. A damaged settings file is
preserved for recovery rather than replaced with an empty list. Settings contain
only a schema version and favorite mode IDs; audio files remain separate.
