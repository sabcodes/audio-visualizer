# Requirements and setup

## Run and build

| Requirement | Purpose |
| --- | --- |
| Node.js 22.12 or newer within 22.x, or Node.js 24.x | Supported by the project's `engines` setting |
| npm, supplied with Node.js | Installs the exact dependency versions from `package-lock.json` |
| A browser with WebGPU or WebGL2 and Web Audio | Rendering and local audio analysis; Chrome is the primary tested browser |
| A graphics device and driver supported by that browser | WebGPU is preferred; WebGL2 provides compatibility rendering |
| A local HTTP server or an HTTPS host | Secure browser APIs; opening `index.html` as a file is unsupported |

From the repository root:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Both development and preview commands bind to the local machine. No account, API key, database, paid service, Python package, Blender installation, or external model download is required to run the app. Installing npm dependencies initially requires access to the npm registry; the built app bundles its dependencies and assets without runtime CDN requests.

For a production bundle:

```sh
npm run build
npm run preview
```

Deploy the complete `dist/` folder to a static host. The root page is the application entry. The Vite development/preview server saves favorites to the ignored `data/user-settings.json`; a plain static host uses browser storage instead. See [local settings](docs/local-settings.md).

## Audio and graphics

Local music files must use a codec supported by the browser. Live audio requires a browser share picker that offers audio sharing and any applicable system permissions. Available sources vary by browser and operating system; external audio hardware must be routed into a capturable source on the computer. A Spotify or other streaming-service API integration is not required.

Most scenes support both graphics backends. Spark Plume requires WebGPU. Scene complexity, quality, render scale, effects, and screen resolution affect performance; there is no universal device-memory or frame-rate guarantee. Start with Balanced quality and Auto render scale. Use Restart renderer or Restart in WebGL2 if initialization fails.

## Included assets

Keep the repository's relative paths intact, including the spaces in the original delivery folder names:

| Path | Purpose |
| --- | --- |
| `src/assets/` | Runtime models, textures, effects, animation data, and photo attribution |
| `Model assets/Wave6 assets /Water 7 v2 model.glb` | Water 7 runtime model, bundled directly by Vite |
| `Model assets/Wave6 assets /ichiraku_ramen.glb` | Ichiraku runtime model, bundled directly by Vite |
| `Model assets/Wave4.5 /dragon_v1_final.zip` | Original input for the optional dragon rebuild; the app loads the included `dragon_hd.glb` |
| `docs/media/` and the three README portrait images | Project previews; not required for rendering |

Audio tracks, saved preferences, downloaded delivery duplicates, benchmark results, and private working notes are not application dependencies. The photo attribution in `src/assets/blob-track/LICENSE.md` remains part of the repository.

## Development checks

TypeScript, Vite, Vitest, Playwright, and Three.js are pinned in `package.json` and `package-lock.json`; `npm ci` installs them. Do not omit development dependencies when building from source.

```sh
npm test -- --maxWorkers=2
npm run build
npm run test:browser
npm run test:browser:ogre
```

Browser tests use a separately installed Google Chrome through Playwright's `chrome` channel. The project does not download a browser during npm installation. The default compatibility tests and dedicated Ogre checks run isolated headless sessions. The explicitly selected hardware and benchmark projects open browser windows. Release matrix commands are `npm run test:release` and, after a build, `npm run test:release:static`; the optional `test:release:soak` command runs long sessions. Commands that set environment variables inline require a POSIX-compatible shell, or equivalent environment-variable setup on Windows.

Test outputs, captures, and diagnostics are generated locally in ignored `test-results/`, `playwright-report/`, `benchmark-results/`, and development reference folders. These outputs may contain details of the test machine; do not force-add them to Git.

## Privacy checks

Python 3.9 or newer and Git are needed only for the optional offline security gate. It uses Python's standard library; no `pip` requirements file or package installation is needed.

```sh
npm run security:install
npm run security:scan
npm run security:staged
npm run test:security
```

Hook installation is local to the clone and preserves existing hooks. Commit checks inspect staged blobs; push checks inspect outgoing history, including intermediate commits. Checks cover credentials, personal paths, private network addresses, device details, and supported image/model/archive metadata. Names and usernames are not prohibited. Commit email exceptions, if needed, are stored as exact hashes in local Git configuration, rather than tracked personal values.

`npm run security:history` checks locally available remote branch/tag history without fetching. A clean current tree does not erase previous commits, branch tips, or tags. Local hooks can be bypassed and do not replace a final publication review.

## Optional model authoring

Blender 5.0 is the authoring version for the included rebuild scripts. Blender supplies its own Python, `bpy`, and `mathutils`; no separate Python environment is needed. Put the Blender executable on your command path, then run from the repository root:

```sh
blender --background --factory-startup --python scripts/build_ogre.py
blender --background --factory-startup --python scripts/refine_dragon.py
```

These commands overwrite the corresponding generated GLB in `src/assets/models/`. The Ogre is generated procedurally. The dragon rebuild reads the tracked source ZIP listed above. Neither command is needed to install, build, or render the included scenes.
