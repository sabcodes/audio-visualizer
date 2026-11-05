export interface UserSettings {
  version: 1;
  favoriteModes: string[];
}

const legacyKey = 'visualizer.favoriteModes';
const migrationKey = 'visualizer.favoriteModes.imported';
const browserKey = 'visualizer.staticFavorites';
let browserSettings = false;

function localSettings(change?: { favoriteMode?: string; favorite?: boolean; importFavoriteModes?: string[] }): UserSettings {
  const raw = localStorage.getItem(browserKey);
  const settings: UserSettings = raw ? JSON.parse(raw) : { version: 1, favoriteModes: [] };
  if (settings?.version !== 1 || !Array.isArray(settings.favoriteModes)
    || !settings.favoriteModes.every(id => typeof id === 'string')) throw new Error('Invalid browser favorites');
  if (change) {
    const favorites = new Set(settings.favoriteModes);
    if (change.importFavoriteModes) for (const id of change.importFavoriteModes) favorites.add(id);
    else if (change.favorite) favorites.add(change.favoriteMode!);
    else favorites.delete(change.favoriteMode!);
    settings.favoriteModes = [...favorites];
    localStorage.setItem(browserKey, JSON.stringify(settings));
  }
  return settings;
}

async function settingsRequest(change?: object): Promise<UserSettings> {
  if (browserSettings) return localSettings(change);
  const response = await fetch('/api/settings', change ? {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
  } : { cache: 'no-store' });
  // A plain static host has no settings API (some return their HTML fallback).
  // Never hide a real local-server error or a failed save by changing stores.
  if (!change && (response.status === 404 || response.status === 405
    || (response.ok && response.headers.get('content-type')?.includes('text/html')))) {
    browserSettings = true;
    return localSettings();
  }
  if (!response.ok) throw new Error('Local settings are unavailable');
  const settings: UserSettings = await response.json();
  if (settings?.version !== 1 || !Array.isArray(settings.favoriteModes)
    || !settings.favoriteModes.every(id => typeof id === 'string')) throw new Error('Invalid local settings');
  return settings;
}

export async function loadFavorites(validIds: ReadonlySet<string>): Promise<Set<string>> {
  let settings = await settingsRequest();
  let legacy: string[] = [], raw: string | null = null;
  try {
    raw = localStorage.getItem(legacyKey);
    if (raw && localStorage.getItem(migrationKey) !== raw) {
      const saved: unknown = JSON.parse(raw);
      if (Array.isArray(saved)) legacy = saved.filter((id): id is string => typeof id === 'string' && validIds.has(id));
    }
  } catch { /* Browser storage is optional; the project file remains available. */ }
  if (legacy.length) {
    settings = await settingsRequest({ importFavoriteModes: legacy });
    // Keep the original as a recovery copy, but don't resurrect removed favorites on reload.
    try { localStorage.setItem(migrationKey, raw!); } catch { /* Storage may be blocked. */ }
  }
  return new Set(settings.favoriteModes.filter(id => validIds.has(id)));
}

export async function saveFavorite(id: string, favorite: boolean, validIds: ReadonlySet<string>): Promise<Set<string>> {
  const settings = await settingsRequest({ favoriteMode: id, favorite });
  return new Set(settings.favoriteModes.filter(mode => validIds.has(mode)));
}
