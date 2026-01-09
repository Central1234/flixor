// Unified Media Service - Routes to Plex, Jellyfin, or Emby based on server type
import { apiClient } from './api';

const API_BASE = '/api';

type ServerType = 'plex' | 'jellyfin' | 'emby';

let cachedServerType: ServerType | null = null;

// Get the current server type from session
export async function getServerType(): Promise<ServerType> {
  if (cachedServerType) return cachedServerType;
  
  try {
    const session = await apiClient.getSession();
    cachedServerType = session.serverType || 'plex';
    return cachedServerType;
  } catch {
    return 'plex';
  }
}

// Clear cached server type (call on logout)
export function clearServerTypeCache() {
  cachedServerType = null;
}

// Generic fetch helper
async function mediaFetch<T>(path: string, serverType?: ServerType): Promise<T> {
  const type = serverType || await getServerType();
  const prefix = type === 'plex' ? '/plex' : type === 'jellyfin' ? '/jellyfin' : '/emby';
  
  const response = await fetch(`${API_BASE}${prefix}${path}`, {
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }
  
  return response.json();
}

// Get libraries
export async function getLibraries() {
  return mediaFetch<any[]>('/libraries');
}

// Get library items
export async function getLibraryItems(libraryId: string, options?: { limit?: number; start?: number; sort?: string }) {
  const params = new URLSearchParams();
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.start) params.append('start', String(options.start));
  if (options?.sort) params.append('sort', options.sort);
  
  const query = params.toString();
  return mediaFetch<{ items: any[]; totalSize: number }>(`/libraries/${libraryId}${query ? '?' + query : ''}`);
}

// Get continue watching
export async function getContinueWatching() {
  return mediaFetch<any[]>('/continue');
}

// Get latest items
export async function getLatestItems(libraryId?: string) {
  const params = libraryId ? `?libraryId=${libraryId}` : '';
  return mediaFetch<any[]>(`/latest${params}`);
}

// Get item details
export async function getItemDetails(itemId: string) {
  return mediaFetch<any>(`/items/${itemId}`);
}

// Search
export async function searchMedia(query: string, limit?: number) {
  const params = new URLSearchParams({ query });
  if (limit) params.append('limit', String(limit));
  return mediaFetch<any[]>(`/search?${params.toString()}`);
}

// Check if using Plex (for features only available on Plex)
export async function isPlex(): Promise<boolean> {
  const type = await getServerType();
  return type === 'plex';
}

// Check if using Jellyfin
export async function isJellyfin(): Promise<boolean> {
  const type = await getServerType();
  return type === 'jellyfin';
}

// Check if using Emby
export async function isEmby(): Promise<boolean> {
  const type = await getServerType();
  return type === 'emby';
}
