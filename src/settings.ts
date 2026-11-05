export interface UserSettings {
  version: 1;
  favoriteModes: string[];
}

const legacyKey = 'visualizer.favoriteModes';
const migrationKey = 'visualizer.favoriteModes.imported';

async function settingsRequest(change?: object): Promise<UserSettings> {
  const response = await fetch('/api/settings', change ? {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
  } : { cache: 'no-store' });
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
