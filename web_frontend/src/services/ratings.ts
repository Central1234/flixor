// Plex-backed ratings helpers
import { API_BASE_URL, apiClient } from './api';

// Plex-backed ratings by ratingKey (server metadata)
// Only works for Plex users - returns null for Jellyfin/Emby
export async function fetchPlexRatingsByRatingKey(ratingKey: string): Promise<{ imdb?: { rating?: number; votes?: number } | null; rt?: { critic?: number; audience?: number } | null } | null> {
  if (!ratingKey) return null;
  
  // Check if user is Plex - ratings endpoint only works for Plex
  try {
    const session = await apiClient.getSession();
    if (session.serverType && session.serverType !== 'plex') {
      return null; // Ratings not available for Jellyfin/Emby
    }
  } catch {
    return null;
  }
  
  const base = `${API_BASE_URL.replace(/\/$/, '')}/plex/ratings`;
  const res = await fetch(`${base}/${encodeURIComponent(ratingKey)}`, { credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  return { imdb: data.imdb || null, rt: data.rottenTomatoes || null };
}

export async function fetchPlexVodRatingsById(vodId: string): Promise<{ imdb?: { rating?: number; votes?: number } | null; rt?: { critic?: number; audience?: number } | null } | null> {
  if (!vodId) return null;
  
  // Check if user is Plex
  try {
    const session = await apiClient.getSession();
    if (session.serverType && session.serverType !== 'plex') {
      return null;
    }
  } catch {
    return null;
  }
  
  const base = `${API_BASE_URL.replace(/\/$/, '')}/plex/vod/ratings`;
  const res = await fetch(`${base}/${encodeURIComponent(vodId)}`, { credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  return { imdb: data.imdb || null, rt: data.rottenTomatoes || null };
}
