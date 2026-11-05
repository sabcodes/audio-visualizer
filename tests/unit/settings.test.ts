import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { settingsMiddleware } from '../../server/settings';

const servers: Server[] = [], directories: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp('test-results/settings-'); directories.push(directory);
  const file = join(directory, 'data/user-settings.json');
  return { directory, file, url: await serve(file) };
}
async function serve(file: string) {
  const middleware = settingsMiddleware(file);
  const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404); response.end(); }));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/api/settings`;
}
const change = (url: string, body: object) => fetch(url, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: new URL(url).origin }, body: JSON.stringify(body),
});

it('creates defaults and shares persisted favorites across server ports and restarts', async () => {
  const { file, url } = await fixture();
  expect(await (await fetch(url)).json()).toEqual({ version: 1, favoriteModes: [] });
  await change(url, { favoriteMode: 'scene', favorite: true });
  const otherPort = await serve(file);
  expect(new URL(otherPort).port).not.toBe(new URL(url).port);
  expect(await (await fetch(otherPort)).json()).toEqual({ version: 1, favoriteModes: ['scene'] });
  await change(otherPort, { importFavoriteModes: ['rings', 'scene'] });
  await change(url, { favoriteMode: 'scene', favorite: false });
  expect(JSON.parse(await readFile(file, 'utf8')).favoriteModes).toEqual(['rings']);
  expect(await readdir(join(file, '..'))).toEqual(['user-settings.json']);
  expect((await (await fetch(await serve(file))).json()).favoriteModes).toEqual(['rings']);
});

it('serializes simultaneous favorite changes without losing either save', async () => {
  const { file, url } = await fixture();
  const responses = await Promise.all(['scene', 'rings', 'dragonHD'].map(favoriteMode => change(url, { favoriteMode, favorite: true })));
  expect(responses.every(response => response.ok)).toBe(true);
  expect(JSON.parse(await readFile(file, 'utf8')).favoriteModes.sort()).toEqual(['dragonHD', 'rings', 'scene']);
});

it('rejects cross-origin and invalid writes without changing the saved list', async () => {
  const { file, url } = await fixture();
  await change(url, { favoriteMode: 'scene', favorite: true });
  const before = await readFile(file, 'utf8');
  expect((await fetch(url, { method: 'PATCH', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{"favoriteMode":"rings","favorite":true}' })).status).toBe(403);
  expect((await change(url, { favoriteMode: '../../outside', favorite: true })).status).toBe(400);
  expect((await change(url, { importFavoriteModes: [1] })).status).toBe(400);
  expect((await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status).toBe(400);
  expect((await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importFavoriteModes: ['a'.repeat(17000)] }) })).status).toBe(413);
  expect(await readFile(file, 'utf8')).toBe(before);
});

it('keeps corrupt settings intact and reports a recoverable error', async () => {
  const { file, url } = await fixture();
  await fetch(url);
  await writeFile(file, '{damaged');
  expect((await fetch(url)).status).toBe(500);
  expect((await change(url, { favoriteMode: 'scene', favorite: true })).status).toBe(500);
  expect(await readFile(file, 'utf8')).toBe('{damaged');
});
