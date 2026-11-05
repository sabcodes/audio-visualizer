# Music / Audio Visualizer

A free music visualizer that runs entirely in your browser. Choose from 100+ music-reactive scenes for personal listening, visual experiments, house parties, clubs, or DJ sets. WebGPU powers the visuals, with a WebGL2 compatibility fallback.

Visualize audio from apps such as Spotify, YouTube, Apple Music, or VirtualDJ through browser or system-audio capture, where supported. You can also load local music files directly. Audio analysis happens on your device. App compatibility depends on your browser, operating system, and audio routing; external DJ hardware, including Pioneer DJ equipment, needs its audio routed through the computer for capture.

Chrome is the primary tested browser. Performance varies by graphics support, scene, resolution, and quality setting. Start with **Balanced** quality and **Auto** render scale.

## Preview

[![Six visualizer scenes: glowing jellyfish, animated hands, green particles, a bridge, a geometric tunnel, and a misty tower.](docs/media/visualizations-overview.png)](docs/media/visualizer-demo.mp4)

[Watch or download the full demo recording](docs/media/visualizer-demo.mp4) — 5 minutes 48 seconds, 720p, with audio.

A few more scenes from existing captures:

| Akira | Water 7 | Ichiraku |
| --- | --- | --- |
| <img src="docs/references/akira/portrait.jpg" alt="Red Akira motorcycle against a neon city skyline" width="240"> | <img src="docs/references/water7/portrait.jpg" alt="Water 7 island city surrounded by turquoise water" width="240"> | <img src="docs/references/ichiraku/portrait.jpg" alt="Ichiraku ramen shop lit by green and purple neon" width="240"> |

## Run locally

Requires Node.js 22.12+ (22.x) or 24.x and npm. See [REQUIREMENTS.md](REQUIREMENTS.md) for the complete runtime, build, browser-test, and optional model-authoring requirements.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. The visualizer opens at the root URL.

Choose a scene, then load a track or select **Use audio playing on this Mac**. For live audio, choose a tab or screen in the browser's share picker and enable audio sharing if offered. Start with **Balanced** quality and **Auto** render scale. If graphics fail, use **Restart renderer** or **Restart in WebGL2**.

To build and preview the production version:

```sh
npm run build
npm run preview
```

Serve the app through localhost or HTTPS; opening the HTML directly with `file://` is unsupported.

Favorites are saved locally. See [local settings](docs/local-settings.md) for storage and backup details.

## Development checks

```sh
npm test -- --maxWorkers=2
npm run build
npm run test:browser:ogre
npm run test:security
```

The Ogre checks use isolated, headless Chrome sessions on WebGPU and WebGL2. The optional repository security scanner uses Python's standard library; it is not an application dependency. Run `npm run security:staged` before committing. `npm run security:install` installs repository-local commit/push hooks and preserves existing hooks.

All required models, textures, and animation data are versioned in this repository. Most runtime assets are under `src/assets/`; Water 7 and Ichiraku also use the two tracked GLBs in `Model assets/Wave6 assets /`. Keep these paths intact. The tracked dragon source ZIP is required only by its optional Blender rebuild script. See [REQUIREMENTS.md](REQUIREMENTS.md) for details.

Generated diagnostics, benchmarks, planning notes, and development reference captures stay local and are ignored. The README preview media and existing asset attribution notices are retained.
