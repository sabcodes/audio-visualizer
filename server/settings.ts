import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { UserSettings } from '../src/settings';

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const validList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 512 && value.every(validId);

async function writeSettings(file: string, settings: UserSettings) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function readSettings(file: string): Promise<UserSettings> {
  let raw: string;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const defaults: UserSettings = { version: 1, favoriteModes: [] };
    await writeSettings(file, defaults);
    return defaults;
  }
  const settings = JSON.parse(raw) as UserSettings;
  if (settings?.version !== 1 || !validList(settings.favoriteModes)) throw new Error('Invalid settings file');
  return settings;
}

/** All mutations read the current file, rather than replacing it with a stale tab's list. */
export function settingsMiddleware(file: string) {
  let pending = Promise.resolve();
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.url?.split('?')[0] !== '/api/settings') { next(); return; }
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    // Browser requests from other sites must never change local preferences.
    const origin = request.headers.origin;
    if ((origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`)
      || request.headers['sec-fetch-site'] === 'cross-site') {
      reply(403, { error: 'Use the visualizer to access settings.' }); return;
    }
    if (request.method !== 'GET' && request.method !== 'PATCH') {
      response.setHeader('Allow', 'GET, PATCH'); reply(405, { error: 'Method not allowed' }); return;
    }
    const operation = async () => {
      try {
        if (request.method === 'GET') { reply(200, await readSettings(file)); return; }
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
          reply(415, { error: 'Expected JSON' }); return;
        }
        let raw = '';
        for await (const chunk of request) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 16384) { reply(413, { error: 'Settings request too large' }); return; }
        }
        let change;
        try { change = JSON.parse(raw); }
        catch { reply(400, { error: 'Invalid JSON' }); return; }
        const importing = validList(change?.importFavoriteModes);
        const toggling = validId(change?.favoriteMode) && typeof change?.favorite === 'boolean';
        if (importing === toggling) { reply(400, { error: 'Invalid favorites change' }); return; }
        const settings = await readSettings(file);
        const favorites = new Set(settings.favoriteModes);
        if (importing) for (const id of change.importFavoriteModes) favorites.add(id);
        else if (change.favorite) favorites.add(change.favoriteMode);
        else favorites.delete(change.favoriteMode);
        if (favorites.size > 512) { reply(400, { error: 'Too many favorites' }); return; }
        settings.favoriteModes = [...favorites];
        await writeSettings(file, settings);
        reply(200, settings);
      } catch {
        // Preserve an unreadable/corrupt file for recovery; never reset it silently.
        reply(500, { error: 'Could not read or save local settings. Check data/user-settings.json.' });
      }
    };
    pending = pending.then(operation, operation);
  };
}

export function localSettings(): Plugin {
  let file: string;
  return {
    name: 'local-user-settings',
    configResolved(config) { file = resolve(config.root, 'data/user-settings.json'); },
    configureServer(server) { server.middlewares.use(settingsMiddleware(file)); },
    configurePreviewServer(server) { server.middlewares.use(settingsMiddleware(file)); },
  };
}
