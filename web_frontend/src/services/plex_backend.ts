// Backend-backed Media service (supports Plex, Jellyfin, Emby)
import { API_BASE_URL, apiClient } from './api';

type ServerType = 'plex' | 'jellyfin' | 'emby';
let cachedServerType: ServerType | null = null;

// Get the current server type from session
export async function getServerType(): Promise<ServerType> {
  if (cachedServerType) {
    console.debug('[plex_backend] Using cached serverType:', cachedServerType);
    return cachedServerType;
  }
  
  try {
    const session = await apiClient.getSession();
    console.debug('[plex_backend] Session response:', { authenticated: session.authenticated, serverType: session.serverType });
    // Only cache if we have an authenticated session with serverType
    if (session.authenticated && session.serverType) {
      cachedServerType = session.serverType;
      console.debug('[plex_backend] Cached serverType:', cachedServerType);
      return cachedServerType;
    }
    // Return serverType if present, otherwise default to plex
    const result = session.serverType || 'plex';
    console.debug('[plex_backend] Returning serverType (not cached):', result);
    return result;
  } catch (e) {
    console.warn('[plex_backend] Failed to get session, defaulting to plex:', e);
    return 'plex';
  }
}

// Clear cached server type (call on logout)
export function clearServerTypeCache() {
  cachedServerType = null;
}

async function backendFetch<T = any>(path: string, params?: Record<string, any>): Promise<T> {
  const serverType = await getServerType();
  const prefix = serverType === 'plex' ? '/plex' : serverType === 'jellyfin' ? '/jellyfin' : '/emby';
  const base = `${API_BASE_URL.replace(/\/$/, '')}${prefix}`;
  
  let url = `${base}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    });
    const q = qs.toString();
    if (q) url += (url.includes('?') ? '&' : '?') + q;
  }
  console.debug('[plex_backend] Fetching:', url);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Backend error ${res.status}`);
  return res.json();
}

// Wrap helpers to match legacy shapes used by UI (MediaContainer.*)

export async function plexBackendLibraries() {
  const libs = await backendFetch<any[]>('/libraries');
  return { MediaContainer: { Directory: libs || [] } };
}

export async function plexBackendOnDeckGlobal() {
  const items = await backendFetch<any[]>('/ondeck');
  return { MediaContainer: { Metadata: items || [] } };
}

export async function plexBackendContinue() {
  const items = await backendFetch<any[]>('/continue');
  return { MediaContainer: { Metadata: items || [] } };
}

export async function plexBackendRecentlyAdded(libraryKey?: string) {
  const items = await backendFetch<any[]>('/recent', libraryKey ? { library: libraryKey } : undefined);
  return { MediaContainer: { Metadata: items || [] } };
}

export async function plexBackendLibraryAll(sectionKey: string, params?: Record<string, any>) {
  const mc = await backendFetch<any>(`/library/${encodeURIComponent(sectionKey)}/all`, params);
  return { MediaContainer: mc?.MediaContainer || mc };
}

export async function plexBackendMetadata(ratingKey: string) {
  const meta = await backendFetch<any>(`/metadata/${encodeURIComponent(ratingKey)}`);
  return { MediaContainer: { Metadata: [meta] } };
}

export async function plexBackendMetadataWithExtras(ratingKey: string) {
  const meta = await backendFetch<any>(`/metadata/${encodeURIComponent(ratingKey)}`, {
    includeExtras: 1,
    includeExternalMedia: 1,
    includeChildren: 1,
  });
  return { MediaContainer: { Metadata: [meta] } };
}

export async function plexBackendLibrarySecondary(sectionKey: string, directory: string) {
  const mc = await backendFetch<any>(`/library/${encodeURIComponent(sectionKey)}/${encodeURIComponent(directory)}`);
  return { MediaContainer: mc };
}

export async function plexBackendDir(path: string, params?: Record<string, any>) {
  const p = path.startsWith('/') ? path.slice(1) : path;
  try {
    const mc = await backendFetch<any>(`/dir/${p}`, params);
    return { MediaContainer: mc };
  } catch (e: any) {
    // Graceful fallback for 404/500 so Details page doesn’t crash
    console.warn('[plexBackendDir] request failed', { path, error: String(e?.message || e) });
    return { MediaContainer: { Metadata: [], Directory: [] } } as any;
  }
}

export async function plexBackendSearch(query: string, type?: 1 | 2) {
  const items = await backendFetch<any[]>(`/search`, type ? { query, type } : { query });
  return { MediaContainer: { Metadata: items || [] } };
}

export async function plexBackendCollections(sectionKey: string) {
  const mc = await backendFetch<any>(`/library/${encodeURIComponent(sectionKey)}/collections`);
  return { MediaContainer: mc };
}

export async function plexBackendFindByGuid(guid: string, type?: 1 | 2) {
  const mc = await backendFetch<any>('/findByGuid', type ? { guid, type } : { guid });
  return { MediaContainer: mc };
}
